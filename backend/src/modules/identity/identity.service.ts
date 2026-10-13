import { redis } from "../../db";

export const MAX_TICKETS_PER_NIK = 2;

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export type ReserveResult = "OK" | "EXCEEDED" | "NIK_NOT_FOUND";

/** Menambah ticket_count ATOMIK dan idempoten per order. Panggil di dalam transaksi; ROLLBACK jika hasilnya bukan "OK". */
export async function reserveQuota(
  q: Queryable,
  orderId: string,
  eventId: string,
  nikHash: string,
  qty: number,
): Promise<ReserveResult> {
  // Kunci baris NIK dulu: request paralel untuk NIK yang sama jadi berurutan.
  const row = await q.query(
    "SELECT 1 FROM nik_registry WHERE event_id = $1 AND nik_hash = $2 FOR UPDATE",
    [eventId, nikHash],
  );
  if ((row.rowCount ?? 0) === 0) return "NIK_NOT_FOUND";

  const led = await q.query(
    `INSERT INTO nik_quota_ledger (order_id, event_id, nik_hash, qty)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, eventId, nikHash, qty],
  );
  if ((led.rowCount ?? 0) === 0) return "OK"; // order ini sudah pernah memesan

  const r = await q.query(
    `UPDATE nik_registry
        SET ticket_count = ticket_count + $3
      WHERE event_id = $1 AND nik_hash = $2 AND ticket_count + $3 <= $4`,
    [eventId, nikHash, qty, MAX_TICKETS_PER_NIK],
  );
  return (r.rowCount ?? 0) === 1 ? "OK" : "EXCEEDED";
}

/** Mengembalikan kuota milik satu order. Idempoten: panggilan kedua mengembalikan false. */
export async function releaseQuota(q: Queryable, orderId: string): Promise<boolean> {
  const d = await q.query(
    `DELETE FROM nik_quota_ledger
      WHERE order_id = $1
  RETURNING event_id, nik_hash, qty`,
    [orderId],
  );
  if ((d.rowCount ?? 0) === 0) return false;
  const { event_id, nik_hash, qty } = d.rows[0];
  await q.query(
    `UPDATE nik_registry
        SET ticket_count = ticket_count - $3
      WHERE event_id = $1 AND nik_hash = $2`,
    [event_id, nik_hash, qty],
  );
  return true;
}

const bindKey = (checkoutToken: string) => `nikbind:${checkoutToken}`;

/** Mengikat NIK terverifikasi ke sesi checkout; hilang bersama checkout token. */
export async function bindNik(checkoutToken: string, nikHash: string, ttlSeconds: number) {
  await redis.set(bindKey(checkoutToken), nikHash, "EX", Math.max(1, Math.ceil(ttlSeconds)));
}

export async function getBoundNik(checkoutToken: string): Promise<string | null> {
  return redis.get(bindKey(checkoutToken));
}
