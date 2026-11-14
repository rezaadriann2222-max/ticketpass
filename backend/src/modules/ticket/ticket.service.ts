import { createHmac, hkdfSync, timingSafeEqual } from "crypto";
import { db } from "../../db";
import { OrderError } from "../order/order.service";
import { decryptTicketSecret } from "../order/ticket.secret";

export const QR_STEP_SECONDS = 30;
const STEP_MS = QR_STEP_SECONDS * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kunci HMAC QR diturunkan (HKDF) dari NIK_ENCRYPTION_KEY dengan label terpisah. */
let _hmacKey: Buffer | null = null;
function hmacKey(): Buffer {
  if (_hmacKey) return _hmacKey;
  const hex = process.env.NIK_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("NIK_ENCRYPTION_KEY harus 64 karakter hex");
  }
  _hmacKey = Buffer.from(hkdfSync("sha256", Buffer.from(hex, "hex"), Buffer.alloc(0), "qr-hmac", 32));
  return _hmacKey;
}

function sign(ticketId: string, step: number, secret: string): string {
  return createHmac("sha256", hmacKey()).update(`${ticketId}.${step}.${secret}`).digest("base64url");
}

/** QR dinamis: berganti tiap 30 detik (FR-M4-02), ditandatangani HMAC (FR-M4-03). */
export async function getTicketQr(userId: string, ticketId: string) {
  const r = await db.query(
    `SELECT t.secret_enc, o.status
       FROM tickets t JOIN orders o ON o.id = t.order_id
      WHERE t.id = $1 AND o.user_id = $2`,
    [ticketId, userId],
  );
  if (r.rows.length === 0) {
    throw new OrderError(404, "TICKET_NOT_FOUND", "Tiket tidak ditemukan");
  }
  if (r.rows[0].status !== "paid") {
    throw new OrderError(409, "ORDER_NOT_PAID", "Pesanan belum dibayar");
  }
  const now = Date.now();
  const step = Math.floor(now / STEP_MS);
  const secret = decryptTicketSecret(r.rows[0].secret_enc);
  const validUntilMs = (step + 1) * STEP_MS;
  return {
    payload: `${ticketId}.${step}.${sign(ticketId, step, secret)}`,
    validUntil: new Date(validUntilMs).toISOString(),
    refreshInSeconds: Math.max(1, Math.ceil((validUntilMs - now) / 1000)),
  };
}

/** Validasi di gerbang (FR-M4-04): tolak QR palsu, kedaluwarsa, atau tiket sudah dipakai. */
export async function validateQr(qrPayload: string) {
  const bad = () => new OrderError(400, "QR_INVALID", "QR tidak valid");
  const parts = qrPayload.split(".");
  if (parts.length !== 3) throw bad();
  const [ticketId, stepStr, sig] = parts;
  const step = Number(stepStr);
  if (!UUID_RE.test(ticketId) || !Number.isInteger(step)) throw bad();

  const r = await db.query(
    `SELECT t.event_id, t.seat_id, t.secret_enc, o.status
       FROM tickets t JOIN orders o ON o.id = t.order_id
      WHERE t.id = $1`,
    [ticketId],
  );
  if (r.rows.length === 0) throw bad();

  const expected = Buffer.from(sign(ticketId, step, decryptTicketSecret(r.rows[0].secret_enc)));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw bad();

  const current = Math.floor(Date.now() / STEP_MS);
  if (step < current - 1 || step > current + 1) {
    throw new OrderError(410, "QR_EXPIRED", "QR kedaluwarsa");
  }
  if (r.rows[0].status !== "paid") {
    throw new OrderError(409, "ORDER_NOT_PAID", "Pesanan belum dibayar");
  }

  // Atomik: hanya satu pemindaian yang berhasil mengisi used_at
  const u = await db.query(
    "UPDATE tickets SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id",
    [ticketId],
  );
  if (u.rowCount === 0) {
    throw new OrderError(410, "TICKET_USED", "Tiket sudah dipakai");
  }
  return { valid: true, ticketId, eventId: r.rows[0].event_id, seatId: r.rows[0].seat_id };
}
