import { createHash } from "crypto";
import { db, redis } from "../../db";
import {
  acquireSeatLock,
  releaseSeatLock,
  getSeatLockTtl,
  seatLockKey,
} from "./seat.lock";

/** Error dengan status HTTP dan kode, mengikuti format { code, message } milik M2 */
export class SeatError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** lockId berformat UUID, deterministik per (event, kursi, pemilik) */
function lockIdFor(eventId: string, seatId: string, userId: string): string {
  const h = createHash("sha256")
    .update(`${eventId}:${seatId}:${userId}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export type SeatStatus = "available" | "locked" | "sold";

export interface SeatView {
  id: string;
  section: string;
  rowLabel: string;
  number: number;
  price: number;
  status: SeatStatus;
  /** true jika kursi terkunci oleh pengguna yang sedang meminta */
  mine: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string) {
  if (!UUID_RE.test(value)) {
    throw new SeatError(400, "INVALID_ID", `${label} tidak valid`);
  }
}

/** Kursi terjual = ada di order_items milik order yang belum dibatalkan */
async function isSold(eventId: string, seatId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.event_id = $1 AND oi.seat_id = $2 AND o.status <> 'cancelled'`,
    [eventId, seatId],
  );
  return (rowCount ?? 0) > 0;
}

/** Denah + status gabungan: terjual (PostgreSQL) dan terkunci (Redis) */
export async function listSeats(
  eventId: string,
  userId: string,
): Promise<SeatView[]> {
  assertUuid(eventId, "ID event");

  const ev = await db.query("SELECT 1 FROM events WHERE id = $1", [eventId]);
  if ((ev.rowCount ?? 0) === 0) {
    throw new SeatError(404, "EVENT_NOT_FOUND", "Event tidak ditemukan");
  }

  const seatsRes = await db.query(
    `SELECT id, section, row_label, number, price
       FROM seats WHERE event_id = $1
      ORDER BY section, row_label, number`,
    [eventId],
  );
  const soldRes = await db.query(
    `SELECT oi.seat_id FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.event_id = $1 AND o.status <> 'cancelled'`,
    [eventId],
  );
  const sold = new Set<string>(soldRes.rows.map((r: any) => r.seat_id));

  const rows = seatsRes.rows as any[];
  const owners: (string | null)[] = rows.length
    ? await redis.mget(...rows.map((r) => seatLockKey(eventId, r.id)))
    : [];

  return rows.map((r, i) => {
    const owner = owners[i];
    const status: SeatStatus = sold.has(r.id)
      ? "sold"
      : owner
        ? "locked"
        : "available";
    return {
      id: r.id,
      section: r.section,
      rowLabel: r.row_label,
      number: r.number,
      price: Number(r.price),
      status,
      mine: status === "locked" && owner === userId, // ID pemilik lain tidak dibocorkan
    };
  });
}

/** Pasang lock 10 menit (FR-M3-02, FR-M3-03) */
export async function lockSeat(
  eventId: string,
  seatId: string,
  userId: string,
) {
  assertUuid(eventId, "ID event");
  assertUuid(seatId, "ID kursi");

  const seat = await db.query(
    "SELECT 1 FROM seats WHERE id = $1 AND event_id = $2",
    [seatId, eventId],
  );
  if ((seat.rowCount ?? 0) === 0) {
    throw new SeatError(404, "SEAT_NOT_FOUND", "Kursi tidak ditemukan pada event ini");
  }

  if (await isSold(eventId, seatId)) {
    throw new SeatError(409, "SEAT_SOLD", "Kursi sudah terjual");
  }

  const result = await acquireSeatLock(redis, eventId, seatId, userId);
  if (result === "TAKEN") {
    throw new SeatError(409, "SEAT_LOCKED", "Kursi sedang dipilih pembeli lain");
  }

  // cek ulang: jika kursi terjual di sela-sela pengecekan, lepas lock
  if (await isSold(eventId, seatId)) {
    await releaseSeatLock(redis, eventId, seatId, userId);
    throw new SeatError(409, "SEAT_SOLD", "Kursi sudah terjual");
  }

  const ttl = await getSeatLockTtl(redis, eventId, seatId);
  const expiresAt = new Date(Date.now() + Math.max(ttl, 0)).toISOString();
  return { lockId: lockIdFor(eventId, seatId, userId), seatId, expiresAt };
}

/** Batalkan lock milik sendiri (FR-M3-04) */
export async function unlockSeat(
  eventId: string,
  seatId: string,
  userId: string,
) {
  assertUuid(eventId, "ID event");
  assertUuid(seatId, "ID kursi");

  const released = await releaseSeatLock(redis, eventId, seatId, userId);
  if (!released) {
    throw new SeatError(
      404,
      "LOCK_NOT_FOUND",
      "Tidak ada lock aktif milik Anda pada kursi ini",
    );
  }
  return { seatId, status: "available" as const };
}