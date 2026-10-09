import { Router } from "express";
import { db } from "../../db";
import { wrap } from "../../http";

export const eventsRouter = Router();

eventsRouter.get(
  "/",
  wrap(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT id, name, venue, starts_at AS "startsAt"
       FROM events ORDER BY starts_at ASC LIMIT 100`
    );
    return res.json(rows);
  })
);
