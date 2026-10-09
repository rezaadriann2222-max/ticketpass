import "dotenv/config";
import express from "express";
import { Pool } from "pg";
import Redis from "ioredis";

const PORT = Number(process.env.PORT ?? 8080);

export const db = new Pool({ connectionString: process.env.DATABASE_URL });
export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

const app = express();
app.use(express.json());

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

// TODO (Fase IV): daftarkan router modul M1-M4 sesuai docs/api/openapi.yaml
//   /auth, /events/:id/queue, /identity/nik, /events/:id/seats, /orders, /tickets, /gate

app.listen(PORT, () => {
  console.log(`TicketPass API berjalan di http://localhost:${PORT}/api/v1`);
});
