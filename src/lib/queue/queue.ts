import type { Prisma, QueueJob } from "@prisma/client";
import { db } from "@/lib/db";
import { log, withLogContext } from "@/lib/log";

// Postgres-backed work queue. No extra infrastructure: workers claim rows with FOR UPDATE SKIP LOCKED, so any
// number of worker processes can run concurrently without double-processing. Failures retry with exponential
// backoff; stuck RUNNING rows (crashed worker) are returned to the queue.

export const QUEUES = {
  discover: "source.discover",
  fetch: "job.fetch",
  process: "job.process",
  recheck: "job.recheck",
  match: "job.match",
  alerts: "alerts.run",
  alertsInstant: "alerts.instant",
  expire: "maintenance.expire",
  health: "source.health",
  email: "email.send",
  maintenanceApps: "maintenance.applications",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const STALE_LOCK_MS = 10 * 60_000;

export function backoffMs(attempt: number, base = 15_000, max = 30 * 60_000): number {
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}

export type EnqueueOptions = { runAt?: Date; dedupeKey?: string; maxAttempts?: number };

/** Returns false when an identical pending/running item (same dedupeKey) already exists. */
export async function enqueue(queue: QueueName, payload: Prisma.InputJsonValue, opts: EnqueueOptions = {}): Promise<boolean> {
  // createMany + skipDuplicates → ON CONFLICT DO NOTHING: an existing dedupeKey is a normal outcome, not an error.
  const r = await db.queueJob.createMany({ data: [{ queue, payload, runAt: opts.runAt ?? new Date(), dedupeKey: opts.dedupeKey, maxAttempts: opts.maxAttempts ?? 5 }], skipDuplicates: true });
  return r.count > 0;
}

/** Bulk enqueue. Items whose dedupeKey already exists are skipped. Returns the number inserted. */
export async function enqueueMany(queue: QueueName, items: { payload: Prisma.InputJsonValue; runAt?: Date; dedupeKey?: string }[], maxAttempts = 5): Promise<number> {
  if (!items.length) return 0;
  const r = await db.queueJob.createMany({ data: items.map((i) => ({ queue, payload: i.payload, runAt: i.runAt ?? new Date(), dedupeKey: i.dedupeKey, maxAttempts })), skipDuplicates: true });
  return r.count;
}

export async function recoverStale(now = new Date()): Promise<number> {
  const r = await db.queueJob.updateMany({ where: { status: "RUNNING", lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } }, data: { status: "PENDING", lockedAt: null, lockedBy: null } });
  return r.count;
}

// The 1s tolerance absorbs clock skew between app hosts and the database, so freshly enqueued work is never stranded.
export async function claim(workerId: string, queues: string[], limit = 1): Promise<QueueJob[]> {
  return db.$queryRaw<QueueJob[]>`
    UPDATE "QueueJob" SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "QueueJob"
      WHERE status = 'PENDING' AND "runAt" <= now() + interval '1 second' AND queue = ANY(${queues}::text[])
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

export async function complete(id: string) {
  await db.queueJob.update({ where: { id }, data: { status: "DONE", finishedAt: new Date(), lockedAt: null, lockedBy: null, dedupeKey: null, error: null } });
}

export async function fail(job: Pick<QueueJob, "id" | "attempts" | "maxAttempts">, error: unknown, retryable = true, now = new Date()) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  if (!retryable || job.attempts >= job.maxAttempts) {
    await db.queueJob.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: now, error: message, lockedAt: null, lockedBy: null, dedupeKey: null } });
    return "failed" as const;
  }
  await db.queueJob.update({ where: { id: job.id }, data: { status: "PENDING", runAt: new Date(now.getTime() + backoffMs(job.attempts)), error: message, lockedAt: null, lockedBy: null } });
  return "retry" as const;
}

export type Handler = (payload: Record<string, unknown>, job: QueueJob) => Promise<void>;
export class NonRetryableError extends Error {}

/** Claims up to `limit` items and runs their handlers. Returns how many were processed. */
export async function runBatch(handlers: Partial<Record<string, Handler>>, workerId: string, limit = 5): Promise<number> {
  const jobs = await claim(workerId, Object.keys(handlers), limit);
  for (const job of jobs) {
    const h = handlers[job.queue];
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const ctx = { queue: job.queue, taskId: job.id, jobId: typeof payload.jobId === "string" ? payload.jobId : undefined, sourceId: typeof payload.sourceId === "string" ? payload.sourceId : undefined, applicationId: typeof payload.applicationId === "string" ? payload.applicationId : undefined, attempt: job.attempts };
    const t0 = performance.now();
    await withLogContext(ctx, async () => {
      try {
        if (!h) throw new NonRetryableError(`No handler for ${job.queue}`);
        await h(payload, job);
        await complete(job.id);
        log.info("queue.task", { durationMs: Math.round(performance.now() - t0), outcome: "done" });
      } catch (err) {
        const res = await fail(job, err, !(err instanceof NonRetryableError));
        // "failed" = dead-lettered (kept as FAILED for inspection and manual retry in the admin panel).
        log.error("queue.task", { durationMs: Math.round(performance.now() - t0), outcome: res === "failed" ? "dead_letter" : "retry", err });
      }
    });
  }
  return jobs.length;
}

export async function queueStats() {
  const rows = await db.queueJob.groupBy({ by: ["queue", "status"], _count: true });
  const oldest = await db.queueJob.findFirst({ where: { status: "PENDING" }, orderBy: { runAt: "asc" }, select: { runAt: true } });
  return { rows, oldestPending: oldest?.runAt ?? null };
}

/** Housekeeping: finished rows are only kept for a week. */
export async function purgeFinished(now = new Date()) {
  return db.queueJob.deleteMany({ where: { status: { in: ["DONE", "FAILED"] }, finishedAt: { lt: new Date(now.getTime() - 7 * 86400_000) } } });
}

/** Dead-lettered tasks (exhausted retries or non-retryable). */
export async function deadLetters(limit = 50) {
  return db.queueJob.findMany({ where: { status: "FAILED" }, orderBy: { finishedAt: "desc" }, take: limit });
}

/** Puts a dead-lettered task back on the queue with a fresh attempt budget. */
export async function retryDeadLetter(id: string) {
  const r = await db.queueJob.updateMany({ where: { id, status: "FAILED" }, data: { status: "PENDING", attempts: 0, runAt: new Date(), error: null, finishedAt: null } });
  return r.count > 0;
}
