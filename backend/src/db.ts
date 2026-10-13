import "dotenv/config";
import { Pool, PoolClient } from "pg";
import Redis from "ioredis";

export const db = new Pool({ connectionString: process.env.DATABASE_URL });

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

/** Menjalankan fn dalam satu transaksi; COMMIT jika sukses, ROLLBACK jika error. */
export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
