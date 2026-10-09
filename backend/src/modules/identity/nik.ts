import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "crypto";

/**
 * Perlindungan NIK:
 *  - nik_encrypted : AES-256-GCM (iv 12B | tag 16B | ciphertext) — dapat didekripsi bila perlu audit.
 *  - nik_hash      : HMAC-SHA256 — untuk pencarian dan penegakan kuota tanpa menyimpan NIK polos.
 * Kedua kunci diturunkan (HKDF) dari NIK_ENCRYPTION_KEY sehingga hanya satu secret yang dikelola.
 */
function masterKey(): Buffer {
  const hex = process.env.NIK_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("NIK_ENCRYPTION_KEY harus 64 karakter hex (buat dengan: openssl rand -hex 32)");
  }
  return Buffer.from(hex, "hex");
}

function derive(label: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), `ticketpass:${label}`, 32));
}

export function encryptNik(nik: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive("nik-enc"), iv);
  const ct = Buffer.concat([cipher.update(nik, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

/** Melempar error bila data diubah (autentikasi GCM gagal). */
export function decryptNik(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", derive("nik-enc"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function hashNik(nik: string): string {
  return createHmac("sha256", derive("nik-hash")).update(nik).digest("hex");
}

/**
 * Pemeriksaan struktur NIK 16 digit: kode provinsi (11–94), tanggal lahir
 * (tanggal +40 untuk perempuan), dan bulan 01–12. Tidak memverifikasi ke Dukcapil.
 */
export function isPlausibleNik(nik: string): boolean {
  if (!/^\d{16}$/.test(nik)) return false;
  const province = Number(nik.slice(0, 2));
  let day = Number(nik.slice(6, 8));
  const month = Number(nik.slice(8, 10));
  if (day > 40) day -= 40;
  return province >= 11 && province <= 94 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}
