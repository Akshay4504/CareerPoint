/* Background worker for the BIM job intelligence pipeline.
 *   npm run worker          # long-running: schedules source runs, processes the queue
 *   npm run worker:once     # drain the queue then exit (dev / CI)
 * Scraping and processing never happen in web requests; this process owns all of it.
 */
import { hostname } from "node:os";
import { QUEUES, enqueue, recoverStale, runBatch } from "../src/lib/queue/queue";
import { scheduleDueSources } from "../src/lib/jobs/pipeline";
import { HANDLERS } from "../src/lib/jobs/handlers";
import { db } from "../src/lib/db";
import { log } from "../src/lib/log";

const once = process.argv.includes("--once");
const workerId = `${hostname()}:${process.pid}`;
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bucket = (ms: number) => Math.floor(Date.now() / ms);

let lastBeat = 0;
/** Liveness beacon read by /api/health/ready; written at most every 15s. */
async function beat() {
  if (Date.now() - lastBeat < 15_000) return;
  lastBeat = Date.now();
  await db.heartbeat.upsert({ where: { name: "worker" }, create: { name: "worker", meta: { workerId } }, update: { lastBeatAt: new Date(), meta: { workerId } } }).catch((err) => log.warn("worker.heartbeat_failed", { err }));
}

async function schedule() {
  const n = await scheduleDueSources();
  if (n) log.info("worker.scheduled", { count: n });
  await enqueue(QUEUES.expire, {}, { dedupeKey: `expire:${bucket(3600_000)}`, maxAttempts: 2 });
  await enqueue(QUEUES.alerts, {}, { dedupeKey: `alerts:${bucket(3600_000)}`, maxAttempts: 2 });
  const stale = await recoverStale();
  if (stale) log.warn("worker.recovered_stale", { count: stale });
}

async function main() {
  log.info("worker.started", { workerId, once });
  let lastSchedule = 0;
  let idleRounds = 0;
  while (!stopping) {
    if (Date.now() - lastSchedule > 60_000) {
      await schedule().catch((err) => log.error("worker.schedule_failed", { err }));
      lastSchedule = Date.now();
    }
    await beat();
    const n = await runBatch(HANDLERS, workerId, 5).catch((err) => {
      log.error("worker.batch_failed", { err });
      return 0;
    });
    if (n === 0) {
      idleRounds++;
      if (once && idleRounds >= 2) break;
      await sleep(once ? 500 : 2000);
    } else idleRounds = 0;
  }
  log.info("worker.stopped", { workerId });
  process.exit(0);
}

main().catch((err) => {
  log.error("worker.crashed", { err });
  process.exit(1);
});
