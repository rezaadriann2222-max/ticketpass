import { NextFunction, Request, Response } from "express";
import { lookupCheckout } from "./queue.service";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      checkout?: { token: string; eventId: string };
    }
  }
}

/**
 * Hanya pengguna yang sudah di-admit antrean (header X-Checkout-Token)
 * yang boleh memanggil endpoint kursi dan order. Pakai setelah `authenticate`.
 * Event diambil dari path param :eventId, atau dari body.eventId bila tidak ada di path.
 */
export async function requireCheckout(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.header("x-checkout-token") ?? "";
    const meta = token ? await lookupCheckout(token) : null;
    const eventId =
      req.params.eventId ?? (typeof req.body?.eventId === "string" ? req.body.eventId : undefined);
    if (!meta || meta.userId !== req.user?.id || meta.eventId !== eventId) {
      return res.status(403).json({
        code: "CHECKOUT_TOKEN_INVALID",
        message: "Token checkout tidak valid atau sudah kedaluwarsa",
      });
    }
    req.checkout = { token, eventId: meta.eventId };
    next();
  } catch (e) {
    next(e);
  }
}
