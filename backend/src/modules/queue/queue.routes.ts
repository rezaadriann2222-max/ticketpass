import { Router } from "express";
import { z } from "zod";
import { db, redis } from "../../db";
import { wrap } from "../../http";
import { authenticate, requireRole } from "../auth/auth.middleware";
import { requireCheckout } from "./checkout.middleware";
import { checkoutTtl, hitRateLimit, joinQueue, queueStatus } from "./queue.service";

// Dipasang di /api/v1/events/:eventId/queue
export const queueRouter = Router({ mergeParams: true });

const eventIdSchema = z.string().uuid();
const statusQuery = z.object({ queueToken: z.string().min(8).max(64) });

/** Waktu buka penjualan, di-cache 60 detik agar join tidak membebani PostgreSQL. */
async function saleOpensAt(eventId: string): Promise<Date | null> {
  const key = `event:${eventId}:sale`;
  const cached = await redis.get(key);
  if (cached) return new Date(cached);
  const { rows } = await db.query("SELECT sale_opens_at FROM events WHERE id = $1", [eventId]);
  if (!rows[0]) return null;
  const at: Date = rows[0].sale_opens_at;
  await redis.set(key, at.toISOString(), "EX", 60);
  return at;
}

queueRouter.post(
  "/join",
  authenticate,
  requireRole("buyer"),
  wrap(async (req, res) => {
    const eventId = eventIdSchema.parse(req.params.eventId);
    if (await hitRateLimit(`join:${req.user!.id}`, 10, 10)) {
      return res.status(429).json({ code: "TOO_MANY_REQUESTS", message: "Terlalu sering mencoba" });
    }
    const opens = await saleOpensAt(eventId);
    if (!opens) return res.status(404).json({ code: "EVENT_NOT_FOUND", message: "Event tidak ada" });
    if (opens.getTime() > Date.now()) {
      return res.status(403).json({
        code: "SALE_NOT_OPEN",
        message: `Penjualan dibuka pada ${opens.toISOString()}`,
      });
    }
    return res.json(await joinQueue(eventId, req.user!.id));
  })
);

queueRouter.get(
  "/status",
  authenticate,
  wrap(async (req, res) => {
    const eventId = eventIdSchema.parse(req.params.eventId);
    const { queueToken } = statusQuery.parse(req.query);
    const r = await queueStatus(eventId, queueToken, req.user!.id);
    if (r.kind === "not_found") {
      return res.status(404).json({ code: "QUEUE_TOKEN_NOT_FOUND", message: "Token antrean tidak ditemukan" });
    }
    if (r.kind === "expired") {
      return res.status(410).json({ code: "QUEUE_EXPIRED", message: "Jendela checkout habis, antre ulang" });
    }
    const { kind: _k, ...body } = r;
    return res.json(body);
  })
);

/** Konfirmasi bahwa checkout token masih berlaku (dipakai frontend sebelum membuka denah). */
queueRouter.get(
  "/checkout",
  authenticate,
  requireCheckout,
  wrap(async (req, res) => {
    return res.json({ valid: true, expiresInSeconds: await checkoutTtl(req.checkout!.token) });
  })
);
