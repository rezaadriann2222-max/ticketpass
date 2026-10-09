// Uji mandiri M2: enkripsi, deteksi pengubahan data, dan balapan kuota.
// Jalankan: npm run test:nik   (butuh PostgreSQL hidup + NIK_ENCRYPTION_KEY di .env)
import "dotenv/config";
import { randomBytes } from "crypto";
import { db } from "../src/db";
import { decryptNik, encryptNik, hashNik, isPlausibleNik } from "../src/modules/identity/nik";
import { reserveQuota } from "../src/modules/identity/identity.service";

const EVENT_ID = process.env.EVENT_ID ?? "11111111-1111-1111-1111-111111111111";
let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
};

async function main() {
  const nik = "3273011505900001";

  // 1. Enkripsi
  const blob = encryptNik(nik);
  check("dekripsi mengembalikan NIK asli", decryptNik(blob) === nik);
  check("ciphertext tidak memuat NIK polos", !blob.toString("latin1").includes(nik));
  check("dua enkripsi NIK sama menghasilkan ciphertext berbeda (IV acak)", !encryptNik(nik).equals(blob));
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1] ^= 0x01;
  let detected = false;
  try {
    decryptNik(tampered);
  } catch {
    detected = true;
  }
  check("data yang diubah 1 bit terdeteksi (GCM)", detected);

  // 2. Hash
  check("hash deterministik & 64 hex", hashNik(nik) === hashNik(nik) && /^[0-9a-f]{64}$/.test(hashNik(nik)));
  check("hash berbeda untuk NIK berbeda", hashNik(nik) !== hashNik("3273011505900002"));

  // 3. Validasi struktur
  check("NIK valid diterima", isPlausibleNik(nik));
  check("NIK perempuan (tanggal+40) diterima", isPlausibleNik("3273015505900001"));
  check("kode provinsi 00 ditolak", !isPlausibleNik("0073011505900001"));
  check("bulan 13 ditolak", !isPlausibleNik("3273011513900001"));
  check("15 digit ditolak", !isPlausibleNik("327301150590000"));
  check("huruf ditolak", !isPlausibleNik("32730115059000AB"));

  // 4. Balapan kuota: 50 request paralel, hanya 2 yang boleh lolos
  const hash = hashNik(randomBytes(8).toString("hex"));
  await db.query(
    "INSERT INTO nik_registry (event_id, nik_hash, nik_encrypted) VALUES ($1, $2, $3)",
    [EVENT_ID, hash, encryptNik(nik)]
  );
  const results = await Promise.all(Array.from({ length: 50 }, () => reserveQuota(db, EVENT_ID, hash, 1)));
  const granted = results.filter(Boolean).length;
  check("50 request paralel → tepat 2 lolos", granted === 2, `(lolos: ${granted})`);
  const { rows } = await db.query("SELECT ticket_count FROM nik_registry WHERE event_id=$1 AND nik_hash=$2", [EVENT_ID, hash]);
  check("ticket_count akhir = 2", Number(rows[0].ticket_count) === 2);
  check("permintaan qty=1 ke-3 ditolak", (await reserveQuota(db, EVENT_ID, hash, 1)) === false);

  // 5. CHECK constraint sebagai pengaman terakhir
  let blocked = false;
  try {
    await db.query("UPDATE nik_registry SET ticket_count = 3 WHERE event_id=$1 AND nik_hash=$2", [EVENT_ID, hash]);
  } catch {
    blocked = true;
  }
  check("constraint DB menolak ticket_count > 2", blocked);

  await db.query("DELETE FROM nik_registry WHERE event_id=$1 AND nik_hash=$2", [EVENT_ID, hash]);
  await db.end();
  console.log(failed === 0 ? "\nSEMUA UJI LULUS" : `\n${failed} UJI GAGAL`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
