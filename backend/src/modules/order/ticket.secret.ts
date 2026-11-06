import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

/** Kunci tiket diturunkan (HKDF) dari NIK_ENCRYPTION_KEY dengan label terpisah dari kunci NIK. */
function ticketKey(): Buffer {
  const hex = process.env.NIK_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("NIK_ENCRYPTION_KEY harus 64 karakter hex");
  }
  return Buffer.from(hkdfSync("sha256", Buffer.from(hex, "hex"), Buffer.alloc(0), "ticket-enc", 32));
}

/** Format: iv(12B) | tag(16B) | ciphertext, sama seperti nik_encrypted. */
export function encryptTicketSecret(secret: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ticketKey(), iv);
  const enc = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

export function decryptTicketSecret(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const data = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", ticketKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
