import "dotenv/config";
import { Pool } from "pg";
import Redis from "ioredis";

export const db = new Pool({ connectionString: process.env.DATABASE_URL });

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
