import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../auth/auth.middleware";
import { requireCheckout } from "../queue/checkout.middleware";
import { listSeats, lockSeat, unlockSeat } from "./seat.service";

// mergeParams: agar :eventId dari path induk terbaca di sini
export const seatRouter = Router({ mergeParams: true });

// Hanya pembeli login yang sudah lolos antrean M1 (FR-M1-04)
seatRouter.use(authenticate, requireCheckout);

const handler =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

// GET /api/v1/events/:eventId/seats  -> denah + status
seatRouter.get(
  "/",
  handler(async (req, res) => {
    const seats = await listSeats(String(req.params.eventId), req.user!.id);
    res.json(seats);
  }),
);

// POST /api/v1/events/:eventId/seats/:seatId/lock  -> lock 10 menit
seatRouter.post(
  "/:seatId/lock",
  handler(async (req, res) => {
    const result = await lockSeat(
      String(req.params.eventId),
      String(req.params.seatId),
      req.user!.id,
    );
    res.json(result);
  }),
);

// DELETE /api/v1/events/:eventId/seats/:seatId/lock  -> batalkan lock
seatRouter.delete(
  "/:seatId/lock",
  handler(async (req, res) => {
    const result = await unlockSeat(
      String(req.params.eventId),
      String(req.params.seatId),
      req.user!.id,
    );
    res.json(result);
  }),
);