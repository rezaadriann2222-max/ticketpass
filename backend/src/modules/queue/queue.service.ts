import { randomBytes } from "crypto";
import { redis } from "../../db";

/**
 * M1 Virtual Waiting Room.
 *
 * Struktur Redis:
 *   queue:{event}              ZSET   member = queueToken, skor = nomor urut (INCR)
 *   queue:{event}:seq          STRING penghitung urutan
 *   queue:{event}:owner:{user} STRING queueToken milik user (SET NX → join idempoten)
 *   qtoken:{token}             STRING JSON {eventId, userId}
 *   qadmitted:{token}          STRING checkoutToken (ada hanya bila sudah di-admit)
 *   checkout:{checkoutToken}   STRING JSON {eventId, userId}, TTL = CHECKOUT_TTL_S
 *   queue:active               SET    daftar event yang punya antrean
 */
export const cfg = {
  admitBatch: Number(process.env.QUEUE_ADMIT_BATCH ?? 50),
  admitIntervalMs: Number(process.env.QUEUE_ADMIT_INTERVAL_MS ?? 5000),
  checkoutTtlS: Number(process.env.CHECKOUT_TTL_S ?? 600),
  queueTtlS: 6 * 3600,
};

const k = {
  zset: (e: string) => `queue:${e}`,
  seq: (e: string) => `queue:${e}:seq`,
  owner: (e: string, u: string) => `queue:${e}:owner:${u}`,
  token: (t: string) => `qtoken:${t}`,
  admitted: (t: string) => `qadmitted:${t}`,
  checkout: (c: string) => `checkout:${c}`,
  active: "queue:active",
};

export interface QueueMeta {
  eventId: string;
  userId: string;
}

export async function joinQueue(eventId: string, userId: string) {
  const candidate = randomBytes(16).toString("hex");
  const ownerKey = k.owner(eventId, userId);

  // SET NX membuat join idempoten dan aman terhadap request ganda bersamaan.
  const created = await redis.set(ownerKey, candidate, "EX", cfg.queueTtlS, "NX");
  let token = candidate;
  if (created !== "OK") {
    token = (await redis.get(ownerKey)) ?? candidate;
  } else {
    const seq = await redis.incr(k.seq(eventId));
    const meta: QueueMeta = { eventId, userId };
    await redis
      .multi()
      .set(k.token(token), JSON.stringify(meta), "EX", cfg.queueTtlS)
      .zadd(k.zset(eventId), seq, token)
      .sadd(k.active, eventId)
      .exec();
  }
  const rank = await redis.zrank(k.zset(eventId), token);
  return { queueToken: token, position: rank === null ? 0 : rank + 1 };
}

export type StatusResult =
  | { kind: "not_found" }
  | { kind: "expired" }
  | {
      kind: "ok";
      position: number;
      admitted: boolean;
      checkoutToken: string | null;
      estimatedWaitSeconds: number;
    };

export async function queueStatus(
  eventId: string,
  queueToken: string,
  userId: string
): Promise<StatusResult> {
  const raw = await redis.get(k.token(queueToken));
  if (!raw) return { kind: "not_found" };
  const meta = JSON.parse(raw) as QueueMeta;
  // Token milik orang lain diperlakukan seperti tidak ada (tidak bocorkan info).
  if (meta.eventId !== eventId || meta.userId !== userId) return { kind: "not_found" };

  const checkoutToken = await redis.get(k.admitted(queueToken));
  if (checkoutToken) {
    return { kind: "ok", position: 0, admitted: true, checkoutToken, estimatedWaitSeconds: 0 };
  }
  const rank = await redis.zrank(k.zset(eventId), queueToken);
  if (rank === null) return { kind: "expired" }; // sudah di-admit tetapi jendela checkout habis
  const position = rank + 1;
  const batches = Math.ceil(position / cfg.admitBatch);
  return {
    kind: "ok",
    position,
    admitted: false,
    checkoutToken: null,
    estimatedWaitSeconds: Math.ceil((batches * cfg.admitIntervalMs) / 1000),
  };
}

/** Admit `admitBatch` antrean teratas untuk tiap event. Aman dijalankan dari banyak instance. */
export async function admitNext(): Promise<number> {
  let admittedTotal = 0;
  const events = await redis.smembers(k.active);
  for (const eventId of events) {
    // ZPOPMIN atomik: dua worker tidak akan meng-admit token yang sama.
    const popped = await redis.zpopmin(k.zset(eventId), cfg.admitBatch);
    for (let i = 0; i < popped.length; i += 2) {
      const queueToken = popped[i];
      const raw = await redis.get(k.token(queueToken));
      if (!raw) continue;
      const meta = JSON.parse(raw) as QueueMeta;
      const checkoutToken = randomBytes(24).toString("hex");
      await redis
        .multi()
        .set(k.checkout(checkoutToken), JSON.stringify(meta), "EX", cfg.checkoutTtlS)
        .set(k.admitted(queueToken), checkoutToken, "EX", cfg.checkoutTtlS)
        .exec();
      admittedTotal++;
    }
  }
  return admittedTotal;
}

export async function lookupCheckout(checkoutToken: string): Promise<QueueMeta | null> {
  const raw = await redis.get(k.checkout(checkoutToken));
  return raw ? (JSON.parse(raw) as QueueMeta) : null;
}

export async function checkoutTtl(checkoutToken: string): Promise<number> {
  return Math.max(0, await redis.ttl(k.checkout(checkoutToken)));
}

/** Pembatas laju sederhana: maksimal `limit` percobaan per `windowS` detik. */
export async function hitRateLimit(key: string, limit: number, windowS: number) {
  const n = await redis.incr(`rl:${key}`);
  if (n === 1) await redis.expire(`rl:${key}`, windowS);
  return n > limit;
}
