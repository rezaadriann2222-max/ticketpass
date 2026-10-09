import type { Redis } from "ioredis";

/** TTL lock kursi: 10 menit (FR-M3-02) */
export const SEAT_LOCK_TTL_MS = 600_000;

export type AcquireResult = "ACQUIRED" | "ALREADY_MINE" | "TAKEN";

export const seatLockKey = (eventId: string, seatId: string) =>
  `seat:lock:${eventId}:${seatId}`;

/**
 * Acquire atomik dalam satu Lua script:
 * - kunci kosong        -> SET NX PX, return 1
 * - kunci milik sendiri -> return 2 (idempoten, TTL tidak diperpanjang)
 * - kunci milik orang lain -> return 0
 */
const ACQUIRE_LUA = `
if redis.call("set", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
  return 1
end
if redis.call("get", KEYS[1]) == ARGV[1] then
  return 2
end
return 0
`;

/** Release hanya jika pemilik sama */
const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export async function acquireSeatLock(
  redis: Redis,
  eventId: string,
  seatId: string,
  userId: string,
  ttlMs: number = SEAT_LOCK_TTL_MS,
): Promise<AcquireResult> {
  const r = (await redis.eval(
    ACQUIRE_LUA,
    1,
    seatLockKey(eventId, seatId),
    userId,
    String(ttlMs),
  )) as number;
  if (r === 1) return "ACQUIRED";
  if (r === 2) return "ALREADY_MINE";
  return "TAKEN";
}

export async function releaseSeatLock(
  redis: Redis,
  eventId: string,
  seatId: string,
  userId: string,
): Promise<boolean> {
  const r = (await redis.eval(
    RELEASE_LUA,
    1,
    seatLockKey(eventId, seatId),
    userId,
  )) as number;
  return r === 1;
}

export async function getSeatLockOwner(
  redis: Redis,
  eventId: string,
  seatId: string,
): Promise<string | null> {
  return redis.get(seatLockKey(eventId, seatId));
}

/** Sisa TTL dalam ms; -2 = tidak ada, -1 = tanpa TTL */
export async function getSeatLockTtl(
  redis: Redis,
  eventId: string,
  seatId: string,
): Promise<number> {
  return redis.pttl(seatLockKey(eventId, seatId));
}
