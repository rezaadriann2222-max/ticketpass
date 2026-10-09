// Uji otomatis M3 Seat Picker. Jalankan setelah server hidup:  npm run smoke:seat
// Opsi: RACE_USERS=20 WAIT_SECONDS=90 BASE=http://localhost:8080/api/v1 EVENT_ID=<uuid>
const BASE = process.env.BASE ?? "http://localhost:8080/api/v1";
const EVENT_ID = process.env.EVENT_ID ?? "11111111-1111-1111-1111-111111111111";
const N = Number(process.env.RACE_USERS ?? 20);
const WAIT_S = Number(process.env.WAIT_SECONDS ?? 90);
const run = Date.now().toString(36);

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* tanpa body */
  }
  return { status: res.status, data };
}

async function makeUser(i) {
  const email = `seat-${run}-${i}@example.com`;
  const password = "smoke-password-123";
  const reg = await api("POST", "/auth/register", {
    body: { email, password, fullName: `Seat ${i}` },
  });
  if (reg.status !== 201)
    throw new Error(`register gagal: ${reg.status} ${JSON.stringify(reg.data)}`);
  const login = await api("POST", "/auth/login", { body: { email, password } });
  const token = login.data?.token ?? login.data?.accessToken;
  if (!token) throw new Error(`login tanpa token: ${JSON.stringify(login.data)}`);
  return { i, token, checkout: null };
}

// cari token checkout di respons /queue/status (nama field mengandung "checkout")
function findCheckoutToken(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj)) {
    if (/checkout/i.test(k)) {
      if (typeof v === "string") return v;
      if (v && typeof v.token === "string") return v.token;
    }
    if (v && typeof v === "object") {
      const f = findCheckoutToken(v);
      if (f) return f;
    }
  }
  return null;
}

async function admit(u) {
  const j = await api("POST", `/events/${EVENT_ID}/queue/join`, { token: u.token });
  if (j.status !== 200)
    throw new Error(`join gagal: ${j.status} ${JSON.stringify(j.data)}`);
  u.queueToken = j.data?.queueToken;
  const until = Date.now() + WAIT_S * 1000;
  let last = null;
  while (Date.now() < until) {
    const s = await api(
      "GET",
      `/events/${EVENT_ID}/queue/status?queueToken=${u.queueToken}`,
      { token: u.token },
    );
    last = s.data;
    const ct = findCheckoutToken(s.data);
    if (ct) {
      u.checkout = ct;
      return;
    }
    await sleep(1000);
  }
  throw new Error(
    `user ${u.i} tidak mendapat token checkout dalam ${WAIT_S} detik. Status terakhir: ${JSON.stringify(last)}`,
  );
}

const p95 = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)];
};

async function main() {
  console.log(`Menyiapkan ${N} pengguna (daftar, login, antre)...`);
  const users = await Promise.all(Array.from({ length: N }, (_, i) => makeUser(i)));
  await Promise.all(users.map(admit));
  console.log("Semua pengguna sudah mendapat token checkout.\n");

  const [u0, u1] = users;
  const co = (u) => ({ "x-checkout-token": u.checkout });
  const seatsPath = `/events/${EVENT_ID}/seats`;
  const lock = (u, id) =>
    api("POST", `${seatsPath}/${id}/lock`, { token: u.token, headers: co(u) });
  const unlock = (u, id) =>
    api("DELETE", `${seatsPath}/${id}/lock`, { token: u.token, headers: co(u) });
  const list = (u) => api("GET", seatsPath, { token: u.token, headers: co(u) });

  // 1. tanpa token checkout
  const noCo = await api("GET", seatsPath, { token: u0.token });
  check("tanpa token checkout -> 403 CHECKOUT_TOKEN_INVALID",
    noCo.status === 403 && noCo.data?.code === "CHECKOUT_TOKEN_INVALID");

  // 2. denah
  const l0 = await list(u0);
  check("GET denah -> 200 berupa array", l0.status === 200 && Array.isArray(l0.data));
  const free = (l0.data ?? []).filter((s) => s.status === "available");
  if (free.length < 2) throw new Error("butuh minimal 2 kursi 'available' di event uji");
  const seatA = free[0].id;
  const seatB = free[1].id;

  // 3. lock kursi bebas
  const a0 = await lock(u0, seatA);
  const expMs = new Date(a0.data?.expiresAt).getTime() - Date.now();
  check("lock kursi bebas -> 200 {lockId, seatId, expiresAt}",
    a0.status === 200 && a0.data?.lockId && a0.data?.seatId === seatA && a0.data?.expiresAt);
  check("expiresAt sekitar 10 menit", expMs > 590_000 && expMs <= 601_000, `(${Math.round(expMs / 1000)} detik)`);

  // 4. pembeli lain
  const a1 = await lock(u1, seatA);
  check("lock kursi terkunci user lain -> 409 SEAT_LOCKED",
    a1.status === 409 && a1.data?.code === "SEAT_LOCKED");

  // 5. idempoten
  const a0b = await lock(u0, seatA);
  check("lock ulang oleh pemilik -> 200, lockId sama",
    a0b.status === 200 && a0b.data?.lockId === a0.data?.lockId);

  // 6. status gabungan
  const v0 = (await list(u0)).data?.find((s) => s.id === seatA);
  const v1 = (await list(u1)).data?.find((s) => s.id === seatA);
  check("denah: pemilik melihat locked + mine=true", v0?.status === "locked" && v0?.mine === true);
  check("denah: user lain melihat locked + mine=false", v1?.status === "locked" && v1?.mine === false);

  // 7. unlock oleh bukan pemilik
  const bad = await unlock(u1, seatA);
  const still = (await list(u0)).data?.find((s) => s.id === seatA);
  check("unlock oleh bukan pemilik -> 404 LOCK_NOT_FOUND, lock tetap ada",
    bad.status === 404 && bad.data?.code === "LOCK_NOT_FOUND" && still?.status === "locked");

  // 8. unlock oleh pemilik
  const ok = await unlock(u0, seatA);
  const after = (await list(u0)).data?.find((s) => s.id === seatA);
  check("unlock oleh pemilik -> 200, kursi available lagi",
    ok.status === 200 && after?.status === "available");

  // 9. validasi input
  const inv = await lock(u0, "bukan-uuid");
  check("ID kursi tidak valid -> 400 INVALID_ID",
    inv.status === 400 && inv.data?.code === "INVALID_ID");

  // 10. balapan: semua pengguna berebut satu kursi
  const timed = await Promise.all(
    users.map(async (u) => {
      const t0 = performance.now();
      const r = await lock(u, seatB);
      return { u, r, ms: performance.now() - t0 };
    }),
  );
  const winners = timed.filter((t) => t.r.status === 200);
  const losers = timed.filter((t) => t.r.status === 409 && t.r.data?.code === "SEAT_LOCKED");
  check(`${N} pengguna berebut 1 kursi -> tepat 1 sukses`,
    winners.length === 1 && losers.length === N - 1,
    `(sukses=${winners.length}, ditolak=${losers.length})`);
  console.log(`INFO  p95 latensi lock = ${p95(timed.map((t) => t.ms)).toFixed(1)} ms (target NFR-P-02: < 50 ms, ${N} request)`);

  // bersihkan
  if (winners[0]) await unlock(winners[0].u, seatB);

  console.log(failed === 0 ? "\nSEMUA UJI LULUS" : `\n${failed} UJI GAGAL`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nUJI BERHENTI:", e.message);
  process.exit(1);
});
