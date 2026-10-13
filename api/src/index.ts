import Fastify from "fastify";
import pg from "pg";
import { Redis } from "ioredis";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});

const redis = new Redis(process.env.REDIS_URL!);

// Daftarkan Lua script M2 sebagai command atomik: redis.nikQuota(key, add, max, ttl)
redis.defineCommand("nikQuota", {
  numberOfKeys: 1,
  lua: readFileSync(join(__dirname, "lua", "nik_quota.lua"), "utf8"),
});

const app = Fastify({ logger: true });

app.get("/health", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    const pong = await redis.ping();
    return { status: "ok", postgres: "up", redis: pong === "PONG" ? "up" : "down" };
  } catch (err) {
    app.log.error(err);
    return reply.code(503).send({ status: "error" });
  }
});

// Endpoint awal untuk memastikan seed + skema terbaca
app.get("/events/:id/seats/summary", async (req) => {
  const { id } = req.params as { id: string };
  const { rows } = await pool.query(
    "SELECT section, status, count(*)::int AS total FROM seats WHERE event_id = $1 GROUP BY section, status ORDER BY section",
    [id]
  );
  return rows;
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" });
