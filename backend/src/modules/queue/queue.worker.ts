import { admitNext, cfg } from "./queue.service";

let running = false;

/** Menjalankan admit berkala. Matikan dengan QUEUE_WORKER=off. */
export function startQueueWorker() {
  if (process.env.QUEUE_WORKER === "off") return;
  setInterval(async () => {
    if (running) return; // jangan tumpang tindih
    running = true;
    try {
      const n = await admitNext();
      if (n > 0) console.log(`[queue] ${n} pengguna di-admit`);
    } catch (e) {
      console.error("[queue] worker error:", e);
    } finally {
      running = false;
    }
  }, cfg.admitIntervalMs);
}
