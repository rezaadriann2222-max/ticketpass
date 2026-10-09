import Redis from "ioredis";
import {
  acquireSeatLock,
  releaseSeatLock,
  getSeatLockOwner,
  getSeatLockTtl,
  seatLockKey,
  SEAT_LOCK_TTL_MS,
} from "../src/modules/seat/seat.lock";

const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const EVENT = `selftest-${Date.now()}`; // namespace unik, tidak menyentuh data asli

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${detail}`}`);
  if (!ok) failed++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. kursi bebas -> berhasil
  check("lock kursi bebas berhasil",
    (await acquireSeatLock(redis, EVENT, "A1", "u1")) === "ACQUIRED");

  // 2. TTL default 10 menit
  const ttl = await getSeatLockTtl(redis, EVENT, "A1");
  check("TTL lock ~10 menit",
    ttl > SEAT_LOCK_TTL_MS - 2000 && ttl <= SEAT_LOCK_TTL_MS, `ttl=${ttl}`);

  // 3. user lain pada kursi terkunci -> TAKEN
  check("kursi terkunci user lain -> TAKEN",
    (await acquireSeatLock(redis, EVENT, "A1", "u2")) === "TAKEN");

  // 4. user sama -> idempoten
  check("lock ulang oleh pemilik -> ALREADY_MINE",
    (await acquireSeatLock(redis, EVENT, "A1", "u1")) === "ALREADY_MINE");

  // 5. release oleh bukan pemilik -> ditolak, lock tetap
  const bad = await releaseSeatLock(redis, EVENT, "A1", "u2");
  check("release oleh bukan pemilik ditolak, lock tetap ada",
    !bad && (await getSeatLockOwner(redis, EVENT, "A1")) === "u1");

  // 6. release oleh pemilik
  const ok = await releaseSeatLock(redis, EVENT, "A1", "u1");
  check("release oleh pemilik berhasil",
    ok && (await getSeatLockOwner(redis, EVENT, "A1")) === null);

  // 7. setelah dilepas, user lain bisa lock
  check("kursi dilepas -> user lain bisa lock",
    (await acquireSeatLock(redis, EVENT, "A1", "u2")) === "ACQUIRED");

  // 8. TTL habis -> kursi tersedia lagi (NFR-R-02: <= 1 detik setelah TTL)
  await acquireSeatLock(redis, EVENT, "B1", "u1", 300);
  await sleep(1300);
  check("TTL habis -> lock hilang maksimal 1 detik setelah TTL",
    (await getSeatLockOwner(redis, EVENT, "B1")) === null);
  check("setelah TTL habis, user lain bisa lock",
    (await acquireSeatLock(redis, EVENT, "B1", "u2")) === "ACQUIRED");

  // 9. release lock yang sudah kedaluwarsa tidak menghapus lock baru
  await acquireSeatLock(redis, EVENT, "C1", "u1", 200);
  await sleep(400);
  await acquireSeatLock(redis, EVENT, "C1", "u2");
  const stale = await releaseSeatLock(redis, EVENT, "C1", "u1");
  check("release basi (u1) tidak menghapus lock baru milik u2",
    !stale && (await getSeatLockOwner(redis, EVENT, "C1")) === "u2");

  // 10. konkurensi: 2.000 user berebut 1 kursi -> tepat 1 sukses
  const N = 2000;
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      acquireSeatLock(redis, EVENT, "HOT", `user-${i}`)),
  );
  const winners = results.filter((r) => r === "ACQUIRED").length;
  const taken = results.filter((r) => r === "TAKEN").length;
  check(`konkurensi ${N} request -> tepat 1 ACQUIRED`,
    winners === 1 && taken === N - 1, `winners=${winners}, taken=${taken}`);

  // bersihkan key uji
  const keys = await redis.keys(seatLockKey(EVENT, "*"));
  if (keys.length) await redis.del(...keys);

  console.log(failed === 0 ? "\nSEMUA UJI LULUS" : `\n${failed} UJI GAGAL`);
  await redis.quit();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await redis.quit();
  process.exit(1);
});