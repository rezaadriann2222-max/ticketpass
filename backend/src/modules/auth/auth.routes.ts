import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { db } from "../../db";
import { hashPassword, verifyPassword } from "./password";
import { authenticate, signToken, TOKEN_TTL_SECONDS, Role } from "./auth.middleware";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email().max(254).transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(1).max(120),
});

const loginSchema = z.object({
  email: z.string().email().max(254).transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
});

// Hash palsu agar waktu respons login tidak membocorkan apakah email terdaftar.
const DUMMY_HASH = "scrypt$" + "00".repeat(16) + "$" + "00".repeat(64);

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

authRouter.post(
  "/register",
  wrap(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    try {
      const { rows } = await db.query(
        `INSERT INTO users (email, password_hash, full_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, full_name AS "fullName", role`,
        [body.email, passwordHash, body.fullName]
      );
      return res.status(201).json(rows[0]);
    } catch (e: any) {
      if (e?.code === "23505") {
        return res.status(409).json({ code: "EMAIL_TAKEN", message: "Email sudah terdaftar" });
      }
      throw e;
    }
  })
);

authRouter.post(
  "/login",
  wrap(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const { rows } = await db.query(
      "SELECT id, password_hash, role FROM users WHERE email = $1",
      [body.email]
    );
    const user = rows[0];
    const ok = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      return res
        .status(401)
        .json({ code: "INVALID_CREDENTIALS", message: "Email atau password salah" });
    }
    const accessToken = signToken({ id: user.id, role: user.role as Role });
    return res.json({ accessToken, expiresIn: TOKEN_TTL_SECONDS });
  })
);

authRouter.get(
  "/me",
  authenticate,
  wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT id, email, full_name AS "fullName", role FROM users WHERE id = $1`,
      [req.user!.id]
    );
    if (!rows[0]) {
      return res.status(401).json({ code: "UNAUTHORIZED", message: "Pengguna tidak ditemukan" });
    }
    return res.json(rows[0]);
  })
);
