import { Router } from "express";
import { z } from "zod";
import { db } from "../../db";
import { wrap } from "../../http";
import { authenticate, requireRole } from "../auth/auth.middleware";
import { requireCheckout } from "../queue/checkout.middleware";
import { checkoutTtl, hitRateLimit } from "../queue/queue.service";
import { encryptNik, hashNik, isPlausibleNik } from "./nik";
import { bindNik, MAX_TICKETS_PER_NIK } from "./identity.service";

// Dipasang di /api/v1/identity
export const identityRouter = Router();

const verifySchema = z.object({
  eventId: z.string().uuid(),
  nik: z.string().regex(/^\d{16}$/, "NIK harus 16 digit angka"),
});

identityRouter.post(
  "/nik/verify",
  authenticate,
  requireRole("buyer"),
  requireCheckout, // hanya pengguna yang sudah lolos antrean (eventId dibaca dari body)
  wrap(async (req, res) => {
    const { eventId, nik } = verifySchema.parse(req.body);
    const userId = req.user!.id;

    if (await hitRateLimit(`nik:${userId}`, 5, 60)) {
      return res.status(429).json({ code: "TOO_MANY_REQUESTS", message: "Terlalu sering memverifikasi NIK" });
    }
    if (!isPlausibleNik(nik)) {
      return res.status(400).json({ code: "INVALID_NIK", message: "Format NIK tidak valid" });
    }

    const nikHash = hashNik(nik);
    await db.query(
      `INSERT INTO nik_registry (event_id, nik_hash, nik_encrypted)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, nik_hash) DO NOTHING`,
      [eventId, nikHash, encryptNik(nik)]
    );
    const { rows } = await db.query(
      "SELECT ticket_count FROM nik_registry WHERE event_id = $1 AND nik_hash = $2",
      [eventId, nikHash]
    );
    const remaining = MAX_TICKETS_PER_NIK - Number(rows[0].ticket_count);

    // Jejak audit tanpa NIK: hanya siapa, kapan, event mana, hasilnya apa.
    await db.query("INSERT INTO audit_log (actor_id, action, entity) VALUES ($1, $2, $3)", [
      userId,
      remaining > 0 ? "nik.verify.ok" : "nik.verify.quota_exceeded",
      `event:${eventId}`,
    ]);

    if (remaining <= 0) {
      return res.status(403).json({
        code: "NIK_QUOTA_EXCEEDED",
        message: `NIK ini sudah mencapai batas ${MAX_TICKETS_PER_NIK} tiket`,
      });
    }
    await bindNik(req.checkout!.token, nikHash, await checkoutTtl(req.checkout!.token));
    return res.json({ remainingQuota: remaining });
  })
);
