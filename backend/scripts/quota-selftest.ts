import { randomBytes } from "crypto";
import { db, withTx } from "../src/db";
import {
  reserveQuota,
  releaseQuota,
  MAX_TICKETS_PER_NIK,
} from "../src/modules/identity/identity.service";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "LULUS" : "GAGAL"}  ${name}`);
  if (!ok) failed++;
}

async function main() {
  const ev = await db.query("SELECT id FROM events LIMIT 1");
  const us = await db.query("SELECT id FROM users LIMIT 1");
  if (!ev.rows[0] || !us.rows[0]) throw new Error("butuh minimal 1 event dan 1 user");
  const eventId: string = ev.rows[0].id;
  const userId: string = us.rows[0].id;
  const nikHash = "selftest-" + randomBytes(8).toString("hex");
  const orderIds: string[] = [];

  try {
    await db.query(
      "INSERT INTO nik_registry (event_id, nik_hash, nik_encrypted) VALUES ($1, $2, $3)",
      [eventId, nikHash, Buffer.from("x")],
    );

    const newOrder = async (): Promise<string> => {
      const r = await db.query(
        "INSERT INTO orders (user_id, event_id, total_amount) VALUES ($1, $2, 0) RETURNING id",
        [userId, eventId],
      );
      orderIds.push(r.rows[0].id);
      return r.rows[0].id;
    };
    const count = async (): Promise<number> => {
      const r = await db.query(
        "SELECT ticket_count FROM nik_registry WHERE event_id = $1 AND nik_hash = $2",
        [eventId, nikHash],
      );
      return Number(r.rows[0].ticket_count);
    };
    // Meniru caller yang benar: ROLLBACK jika hasil reserve bukan "OK"
    const attempt = (orderId: string, qty: number, hash = nikHash): Promise<string> =>
      withTx(async (c) => {
        const r = await reserveQuota(c, orderId, eventId, hash, qty);
        if (r !== "OK") throw Object.assign(new Error(r), { result: r });
        return r;
      }).catch((e: any) => {
        if (e?.result) return e.result as string;
        throw e;
      });

    const MAX = MAX_TICKETS_PER_NIK;

    // 1. 50 request paralel, tiap order qty=1
    const ids = await Promise.all(Array.from({ length: 50 }, () => newOrder()));
    const results = await Promise.all(ids.map((id) => attempt(id, 1)));
    check(`50 request paralel: tepat ${MAX} berhasil`, results.filter((r) => r === "OK").length === MAX);
    check("sisanya ditolak EXCEEDED", results.filter((r) => r === "EXCEEDED").length === 50 - MAX);
    check(`ticket_count = ${MAX}`, (await count()) === MAX);

    // 2. Idempoten: order yang sama tidak menambah dua kali
    const okId = ids[results.indexOf("OK")];
    check("reserve ulang order yang sama tetap OK", (await attempt(okId, 1)) === "OK");
    check("ticket_count tidak bertambah", (await count()) === MAX);

    // 3. Release idempoten
    const failId = ids[results.indexOf("EXCEEDED")];
    check("release order yang tidak memegang kuota = false", (await releaseQuota(db, failId)) === false);
    check("ticket_count tetap", (await count()) === MAX);
    check("release pertama = true", (await releaseQuota(db, okId)) === true);
    check("ticket_count turun 1", (await count()) === MAX - 1);
    check("release kedua = false", (await releaseQuota(db, okId)) === false);
    check("ticket_count tidak turun lagi", (await count()) === MAX - 1);

    // 4. Slot yang dilepas bisa dipakai lagi, lalu penuh kembali
    check("slot kosong terpakai lagi", (await attempt(await newOrder(), 1)) === "OK");
    check("setelah penuh ditolak", (await attempt(await newOrder(), 1)) === "EXCEEDED");

    // 5. NIK yang tidak terdaftar dibedakan dari kuota penuh
    check("NIK belum terdaftar = NIK_NOT_FOUND", (await attempt(await newOrder(), 1, "tidak-ada-" + nikHash)) === "NIK_NOT_FOUND");
    check("ticket_count akhir sesuai batas", (await count()) === MAX);
  } finally {
    // ledger ikut terhapus lewat ON DELETE CASCADE dari nik_registry
    await db.query("DELETE FROM nik_registry WHERE event_id = $1 AND nik_hash = $2", [eventId, nikHash]);
    if (orderIds.length) {
      await db.query("DELETE FROM orders WHERE id = ANY($1::uuid[])", [orderIds]);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(async () => {
    await db.end();
    console.log(failed ? `\n${failed} pemeriksaan GAGAL` : "\nSemua pemeriksaan LULUS");
    process.exit(failed ? 1 : 0);
  });