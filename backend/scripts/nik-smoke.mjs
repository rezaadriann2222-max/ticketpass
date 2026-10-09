// Uji API M2 Anti-Scalper NIK Lock.
// Jalankan setelah server hidup:  npm run smoke:nik   (menunggu admit antrean, ±5-10 detik)
import "dotenv/config";
import pg from "pg";

const BASE = process.env.BASE ?? "http://localhost:8080/api/v1";
const EVENT_ID = process.env.EVENT_ID ?? "11111111-1111-1111-1111-111111111111";
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
  try { data = await res.json(); } catch { /* tanpa body */ }
  return { status: res.status, data, text: JSON.stringify(data) };
}

// NIK acak yang lolos validasi struktur: 3273 01 150590 + 4 digit acak
const nik = "327301150590" + String(Math.floor(Math.random() * 10000)).padStart(4, "0");

const email = `nik-${run}@example.com`;
const password = "smoke-password-123";
await api("POST", "/auth/register", { body: { email, password, fullName: "NIK Tester" } });
const token = (await api("POST", "/auth/login", { body: { email, password } })).data.accessToken;

const join = await api("POST", `/events/${EVENT_ID}/queue/join`, { token });
let checkoutToken = null;
for (let i = 0; i < 40 && !checkoutToken; i++) {
  const st = await api("GET", `/events/${EVENT_ID}/queue/status?queueToken=${join.data.queueToken}`, { token });
  checkoutToken = st.data?.checkoutToken ?? null;
  if (!checkoutToken) await sleep(1000);
}
check("lolos antrean (punya checkout token)", !!checkoutToken);
const H = { "X-Checkout-Token": checkoutToken };

const verify = (b, h = H, t = token) => api("POST", "/identity/nik/verify", { token: t, body: b, headers: h });

check("tanpa checkout token → 403", (await verify({ eventId: EVENT_ID, nik }, {})).status === 403);
check("tanpa login → 401", (await verify({ eventId: EVENT_ID, nik }, H, null)).status === 401);
check("NIK 15 digit → 400", (await verify({ eventId: EVENT_ID, nik: "123456789012345" })).status === 400);
check("NIK berisi huruf → 400", (await verify({ eventId: EVENT_ID, nik: "32730115059000AB" })).status === 400);
const badStruct = await verify({ eventId: EVENT_ID, nik: "0073011505900001" });
check("provinsi tidak valid → 400 INVALID_NIK", badStruct.status === 400 && badStruct.data?.code === "INVALID_NIK");

const ok = await verify({ eventId: EVENT_ID, nik });
check("NIK valid → 200, sisa kuota 2", ok.status === 200 && ok.data?.remainingQuota === 2);
check("NIK polos tidak ada di respons", !ok.text.includes(nik));

// Cek penyimpanan di database: harus terenkripsi, tidak polos
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  "SELECT nik_hash, nik_encrypted, ticket_count FROM nik_registry WHERE event_id = $1 ORDER BY id DESC LIMIT 1",
  [EVENT_ID]
);
const row = rows[0];
check("nik_hash berupa 64 hex", /^[0-9a-f]{64}$/.test(row?.nik_hash ?? ""));
check("nik_encrypted tidak memuat NIK polos", row && !row.nik_encrypted.toString("latin1").includes(nik));
const audit = await client.query("SELECT action FROM audit_log WHERE action LIKE 'nik.%' ORDER BY id DESC LIMIT 1");
check("audit log tercatat (tanpa NIK)", audit.rows[0]?.action === "nik.verify.ok");

// Habiskan kuota → ditolak
await client.query("UPDATE nik_registry SET ticket_count = 2 WHERE nik_hash = $1 AND event_id = $2", [row.nik_hash, EVENT_ID]);
const full = await verify({ eventId: EVENT_ID, nik });
check("kuota habis → 403 NIK_QUOTA_EXCEEDED", full.status === 403 && full.data?.code === "NIK_QUOTA_EXCEEDED");
await client.query("DELETE FROM nik_registry WHERE nik_hash = $1 AND event_id = $2", [row.nik_hash, EVENT_ID]);
await client.end();

console.log(failed === 0 ? "\nSEMUA UJI LULUS" : `\n${failed} UJI GAGAL`);
process.exit(failed === 0 ? 0 : 1);
