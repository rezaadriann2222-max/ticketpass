import { redis } from "../../db";

export const MAX_TICKETS_PER_NIK = 2;

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

/**
 * Menambah ticket_count secara ATOMIK hanya bila hasilnya tidak melebihi kuota.
 * Satu UPDATE bersyarat → aman dari balapan (race) walau 1000 request datang bersamaan;
 * CHECK (ticket_count <= 2) di tabel menjadi pengaman terakhir.
 * Dipanggil M3 saat checkout (idealnya di dalam transaksi yang sama dengan insert order).
 */
export async function reserveQuota(
  q: Queryable,
  eventId: string,
  nikHash: string,
  qty: number
): Promise<boolean> {
  const r = await q.query(
    `UPDATE nik_registry
        SET ticket_count = ticket_count + $3
      WHERE event_id = $1 AND nik_hash = $2 AND ticket_count + $3 <= $4`,
    [eventId, nikHash, qty, MAX_TICKETS_PER_NIK]
  );
  return (r.rowCount ?? 0) === 1;
}

/** Mengembalikan kuota (mis. order dibatalkan). */
export async function releaseQuota(q: Queryable, eventId: string, nikHash: string, qty: number) {
  await q.query(
    `UPDATE nik_registry
        SET ticket_count = GREATEST(ticket_count - $3, 0)
      WHERE event_id = $1 AND nik_hash = $2`,
    [eventId, nikHash, qty]
  );
}

const bindKey = (checkoutToken: string) => `nikbind:${checkoutToken}`;

/** Mengikat NIK terverifikasi ke sesi checkout; hilang bersama checkout token. */
export async function bindNik(checkoutToken: string, nikHash: string, ttlSeconds: number) {
  await redis.set(bindKey(checkoutToken), nikHash, "EX", Math.max(1, ttlSeconds));
}

export async function getBoundNik(checkoutToken: string): Promise<string | null> {
  return redis.get(bindKey(checkoutToken));
}
