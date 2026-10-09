import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { db, redis } from "./db";
import { authRouter } from "./modules/auth/auth.routes";

const PORT = Number(process.env.PORT ?? 8080);

const app = express();
app.use(express.json({ limit: "100kb" }));

// Health check: memastikan PostgreSQL dan Redis dapat dijangkau.
app.get("/api/v1/health", async (_req, res) => {
  const status = { postgres: "down", redis: "down" };
  try {
    await db.query("SELECT 1");
    status.postgres = "up";
  } catch {
    /* dibiarkan down */
  }
  try {
    if (redis.status === "wait") await redis.connect();
    status.redis = (await redis.ping()) === "PONG" ? "up" : "down";
  } catch {
    /* dibiarkan down */
  }
  const ok = status.postgres === "up" && status.redis === "up";
  res.status(ok ? 200 : 503).json({ ok, ...status });
});

// ── Modul ──────────────────────────────────────────────
app.use("/api/v1/auth", authRouter);
// TODO: M1 queue, M2 identity/nik, M3 seats + orders, M4 tickets + gate
//       sesuai docs/api/openapi.yaml

// ── Penanganan error ───────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ code: "NOT_FOUND", message: "Endpoint tidak ditemukan" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return res.status(400).json({ code: "VALIDATION_ERROR", message });
  }
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ code: "BAD_JSON", message: "Body bukan JSON yang valid" });
  }
  console.error(err);
  res.status(500).json({ code: "INTERNAL_ERROR", message: "Terjadi kesalahan server" });
});

app.listen(PORT, () => {
  console.log(`TicketPass API berjalan di http://localhost:${PORT}/api/v1`);
});
