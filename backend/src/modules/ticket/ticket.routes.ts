import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../auth/auth.middleware";
import { wrap } from "../../http";
import { getTicketQr, validateQr } from "./ticket.service";

export const ticketRouter = Router();

const uuid = z.string().uuid();

// GET /api/v1/tickets/:ticketId/qr -> QR dinamis milik pembeli
ticketRouter.get(
  "/tickets/:ticketId/qr",
  authenticate,
  wrap(async (req, res) => {
    const ticketId = uuid.parse(req.params.ticketId);
    res.json(await getTicketQr(req.user!.id, ticketId));
  }),
);

// Validasi QR di gerbang masuk (petugas gerbang / admin)
ticketRouter.post(
  "/gate/validate",
  authenticate,
  requireRole("gate_staff", "admin"),
  wrap(async (req, res) => {
    const { qrPayload } = z.object({ qrPayload: z.string().min(1) }).parse(req.body);
    res.json(await validateQr(qrPayload));
  }),
);
