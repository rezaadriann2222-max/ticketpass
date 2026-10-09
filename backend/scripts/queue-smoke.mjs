// Uji otomatis M1 Virtual Waiting Room.
// Jalankan setelah server hidup:  npm run smoke:queue
// Opsi: SMOKE_USERS=60 BASE=http://localhost:8080/api/v1 EVENT_ID=<uuid>
const BASE = process.env.BASE ?? "http://localhost:8080/api/v1";
const EVENT_ID = process.env.EVENT_ID ?? "11111111-1111-1111-1111-111111111111";
const FUTURE_EVENT_ID = "22222222-2222-2222-2222-222222222222";
const N = Number(process.env.SMOKE_USERS ?? 60);
const run = Date.now().toString(36);

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
};

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
  const email = `smoke-${run}-${i}@example.com`;
  const password = "smoke-password-123";
  const reg = await api("POST", "/auth/register", { body: { email, password, fullName: `Smoke ${i}` } });
  if (reg.status !== 201) throw new Error(`register gagal: ${reg.status} ${JSON.stringify(reg.data)}`);
  const login = await api("POST", "/auth/login", { body: { email, password } });
  return { i, token: login.data.accessToken };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (path) => `/events/${EVENT_ID}/queue${path}`;

console.log(`Menyiapkan ${N} pengguna...`);
const users = await Promise.all(Array.from({ length: N }, (_, i) => makeUser(i)));

// 1. Semua pengguna join bersamaan
const joins = await Promise.all(users.map((u) => api("POST", q("/join"), { token: u.token })));
check("semua join berhasil", joins.every((j) => j.status === 200));
users.forEach((u, idx) => (u.queueToken = joins[idx].data.queueToken));
check("queueToken unik", new Set(users.map((u) => u.queueToken)).size === N);

// 2. Join ulang idempoten (tidak menambah antrean, token sama)
const again = await api("POST", q("/join"), { token: users[0].token });
check("join ulang mengembalikan token yang sama", again.data?.queueToken === users[0].queueToken);

// 3. Token milik orang lain tidak dapat dibaca
const steal = await api("GET", q(`/status?queueToken=${users[1].queueToken}`), { token: users[0].token });
check("status token milik orang lain → 404", steal.status === 404);

// 4. Penjualan belum dibuka
const future = await api("POST", `/events/${FUTURE_EVENT_ID}/queue/join`, { token: users[0].token });
check("event belum dibuka → 403 SALE_NOT_OPEN", future.status === 403 && future.data?.code === "SALE_NOT_OPEN");

// 5. Tanpa login / tanpa checkout token
const noAuth = await api("POST", q("/join"));
check("join tanpa login → 401", noAuth.status === 401);
const noCheckout = await api("GET", q("/checkout"), { token: users[0].token });
check("checkout tanpa token → 403", noCheckout.status === 403);

// 6. Admit bertahap sampai semua masuk
const firstRound = await Promise.all(
  users.map((u) => api("GET", q(`/status?queueToken=${u.queueToken}`), { token: u.token }))
);
const admittedEarly = firstRound.filter((r) => r.data?.admitted).length;
console.log(`INFO  saat pertama dicek: ${admittedEarly}/${N} sudah di-admit (admit berlangsung bertahap)`);

const deadline = Date.now() + 60_000;
let statuses = firstRound;
while (Date.now() < deadline && !statuses.every((s) => s.data?.admitted)) {
  await sleep(1000);
  statuses = await Promise.all(
    users.map((u) => api("GET", q(`/status?queueToken=${u.queueToken}`), { token: u.token }))
  );
}
check("semua pengguna akhirnya di-admit", statuses.every((s) => s.data?.admitted));
const checkoutTokens = statuses.map((s) => s.data?.checkoutToken);
check("checkoutToken unik", new Set(checkoutTokens).size === N);

// 7. Checkout token berlaku untuk pemiliknya saja
const ok = await api("GET", q("/checkout"), { token: users[0].token, headers: { "X-Checkout-Token": checkoutTokens[0] } });
check("checkout token milik sendiri → 200", ok.status === 200 && ok.data?.valid === true, `(sisa ${ok.data?.expiresInSeconds}s)`);
const wrong = await api("GET", q("/checkout"), { token: users[0].token, headers: { "X-Checkout-Token": checkoutTokens[1] } });
check("checkout token milik orang lain → 403", wrong.status === 403);

console.log(failed === 0 ? "\nSEMUA UJI LULUS" : `\n${failed} UJI GAGAL`);
process.exit(failed === 0 ? 0 : 1);
