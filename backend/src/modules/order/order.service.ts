import { randomBytes } from "crypto";
import { redis, db, withTx } from "../../db";
import { seatLockKey, releaseSeatLock } from "../seat/seat.lock";
import {
  getBoundNik,
  reserveQuota,
  releaseQuota,
  MAX_TICKETS_PER_NIK,
} from "../identity/identity.service";

/** Error dengan status HTTP dan kode, format { code, message } seperti SeatError */
export class OrderError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CreateOrderInput {
  userId: string;
  eventId: string;
  seatIds: string[];
  checkoutToken: string;
}

/**
 * Membuat order 'pending' dalam SATU transaksi:
 * hitung total, reserveQuota (atomik), insert order_items dan tickets.
 * Constraint unik (event_id, seat_id) menjadi pengaman terakhir terhadap double booking.
 */
export async function createOrder(input: CreateOrderInput) {
  const { userId, eventId, checkoutToken } = input;
  const seatIds = [...new Set(input.seatIds)];

  const nikHash = await getBoundNik(checkoutToken);
  if (!nikHash) {
    throw new OrderError(403, "NIK_NOT_VERIFIED", "Verifikasi NIK terlebih dahulu");
  }

  // Semua kursi harus masih terkunci oleh pengguna ini (FR-M3-02)
  const owners = await redis.mget(...seatIds.map((s) => seatLockKey(eventId, s)));
  if (owners.some((o) => o !== userId)) {
    throw new OrderError(409, "LOCK_REQUIRED", "Kunci kursi sudah berakhir atau bukan milik Anda");
  }

  let order: any;
  try {
    order = await withTx(async (c) => {
      const seats = await c.query(
        "SELECT id, price FROM seats WHERE event_id = $1 AND id = ANY($2::uuid[])",
        [eventId, seatIds],
      );
      if (seats.rows.length !== seatIds.length) {
        throw new OrderError(404, "SEAT_NOT_FOUND", "Kursi tidak ditemukan pada event ini");
      }
      const total = seats.rows.reduce((sum: number, r: any) => sum + Number(r.price), 0);

      const o = await c.query(
        `INSERT INTO orders (user_id, event_id, total_amount)
         VALUES ($1, $2, $3)
         RETURNING id, status, total_amount, created_at`,
        [userId, eventId, total],
      );
      const orderId: string = o.rows[0].id;

      const res = await reserveQuota(c, orderId, eventId, nikHash, seatIds.length);
      if (res === "EXCEEDED") {
        throw new OrderError(409, "NIK_QUOTA_EXCEEDED", `Batas ${MAX_TICKETS_PER_NIK} tiket per NIK terlampaui`);
      }
      if (res === "NIK_NOT_FOUND") {
        throw new OrderError(403, "NIK_NOT_VERIFIED", "NIK belum terdaftar untuk event ini");
      }

      for (const seatId of seatIds) {
        const it = await c.query(
          "INSERT INTO order_items (order_id, event_id, seat_id) VALUES ($1, $2, $3) RETURNING id",
          [orderId, eventId, seatId],
        );
        await c.query("INSERT INTO tickets (order_item_id, secret) VALUES ($1, $2)", [
          it.rows[0].id,
          randomBytes(32).toString("hex"),
        ]);
      }
      return o.rows[0];
    });
  } catch (e: any) {
    if (e?.code === "23505") {
      throw new OrderError(409, "SEAT_SOLD", "Kursi sudah terjual");
    }
    throw e;
  }

  // Kursi kini dipegang database; lepas lock Redis (best effort, TTL tetap menjadi cadangan)
  await Promise.all(
    seatIds.map((s) => releaseSeatLock(redis, eventId, s, userId).catch(() => false)),
  );

  return {
    orderId: order.id as string,
    status: order.status as string,
    totalAmount: Number(order.total_amount),
    seatIds,
    createdAt: order.created_at,
  };
}

/** Konfirmasi pembayaran: pending menjadi paid (FR-M3-06). Idempoten. Belum memakai payment gateway. */
export async function payOrder(userId: string, orderId: string) {
  return withTx(async (c) => {
    const r = await c.query("SELECT user_id, status FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (r.rows.length === 0 || r.rows[0].user_id !== userId) {
      throw new OrderError(404, "ORDER_NOT_FOUND", "Order tidak ditemukan");
    }
    const status = r.rows[0].status;
    if (status === "cancelled") {
      throw new OrderError(409, "ORDER_CANCELLED", "Order sudah dibatalkan");
    }
    if (status === "pending") {
      await c.query("UPDATE orders SET status = 'paid' WHERE id = $1", [orderId]);
    }
    return { orderId, status: "paid" as const };
  });
}

/**
 * Membatalkan order pending: hapus order_items (kursi bebas, tickets ikut terhapus),
 * kembalikan kuota NIK, ubah status. Idempoten. Order paid ditolak (jalur refund terpisah).
 */
export async function cancelOrder(userId: string, orderId: string) {
  return withTx(async (c) => {
    const r = await c.query("SELECT user_id, status FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (r.rows.length === 0 || r.rows[0].user_id !== userId) {
      throw new OrderError(404, "ORDER_NOT_FOUND", "Order tidak ditemukan");
    }
    const status = r.rows[0].status;
    if (status === "cancelled") return { orderId, status: "cancelled" as const };
    if (status === "paid") {
      throw new OrderError(409, "ORDER_PAID", "Order yang sudah dibayar diproses lewat refund");
    }
    await c.query("DELETE FROM order_items WHERE order_id = $1", [orderId]);
    await releaseQuota(c, orderId);
    await c.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [orderId]);
    return { orderId, status: "cancelled" as const };
  });
}

/** Membatalkan order pending yang tidak dibayar. Panggil berkala (misalnya tiap menit). */
export async function expirePendingOrders(minutes = 15): Promise<number> {
  const { rows } = await db.query(
    `SELECT id, user_id FROM orders
      WHERE status = 'pending' AND created_at < now() - make_interval(mins => $1)`,
    [minutes],
  );
  let done = 0;
  for (const r of rows) {
    try {
      await cancelOrder(r.user_id, r.id);
      done++;
    } catch (e) {
      console.error("Gagal kedaluwarsa order", r.id, e);
    }
  }
  return done;
}