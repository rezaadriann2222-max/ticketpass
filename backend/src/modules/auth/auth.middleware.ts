import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export type Role = "buyer" | "gate_staff" | "admin";
export interface AuthUser {
  id: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const TOKEN_TTL_SECONDS = 900; // 15 menit

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error("JWT_SECRET belum diset (minimal 16 karakter)");
  return s;
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ role: user.role }, secret(), {
    subject: user.id,
    expiresIn: TOKEN_TTL_SECONDS,
    algorithm: "HS256",
  });
}

/** Wajib login: membaca header Authorization: Bearer <token>. */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return res.status(401).json({ code: "UNAUTHORIZED", message: "Token tidak ada" });
  }
  try {
    const p = jwt.verify(token, secret(), { algorithms: ["HS256"] }) as jwt.JwtPayload;
    req.user = { id: String(p.sub), role: p.role as Role };
    next();
  } catch {
    res.status(401).json({ code: "UNAUTHORIZED", message: "Token tidak valid atau kedaluwarsa" });
  }
}

/** RBAC: hanya peran tertentu yang boleh lewat. Pakai setelah authenticate. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ code: "FORBIDDEN", message: "Peran tidak diizinkan" });
    }
    next();
  };
}
