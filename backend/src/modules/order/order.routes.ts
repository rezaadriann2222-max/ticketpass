import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth/auth.middleware";
import { requireCheckout } from "../queue/checkout.middleware";
import { wrap } from "../../http";
import { MAX_TICKETS_PER_NIK } from "../identity/identity.service";
import { createOrder, payOrder, cancelOrder, OrderError } from "./order.service";

export const orderRouter = Router();

const uuid = z.string().uuid();
const createBody = z.object({
  seatIds: z.array(uuid).min(1).max(MAX_TICKETS_PER_NIK),
});

// POST /api/v1/events/:eventId/orders -> buat order dari kursi yang sedang dikunci
orderRouter.post(
  "/events/:eventId/orders",
  authenticate,
  requireCheckout,
  wrap(async (req, res) => {
    const eventId = uuid.parse(req.params.eventId);
    const { seatIds } = createBody.parse(req.body);
    const result = await createOrder({
      userId: req.user!.id,
      eventId,
      seatIds,
      checkoutToken: req.checkout!.token,
    });
    res.status(201).json(result);
  }),
);

// POST /api/v1/orders/:orderId/pay -> SIMULASI pembayaran, hanya aktif di dev
orderRouter.post(
  "/orders/:orderId/pay",
  authenticate,
  wrap(async (req, res) => {
    if (process.env.ALLOW_FAKE_PAYMENT !== "true") {
      throw new OrderError(404, "NOT_FOUND", "Endpoint tidak tersedia");
    }
    const orderId = uuid.parse(req.params.orderId);
    res.json(await payOrder(req.user!.id, orderId));
  }),
);

// POST /api/v1/orders/:orderId/cancel -> batalkan order pending
orderRouter.post(
  "/orders/:orderId/cancel",
  authenticate,
  wrap(async (req, res) => {
    const orderId = uuid.parse(req.params.orderId);
    res.json(await cancelOrder(req.user!.id, orderId));
  }),
);