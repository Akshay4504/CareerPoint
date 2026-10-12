import { access, constants, mkdir } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { getProvider } from "@/lib/ai/provider";

export type Status = "ok" | "degraded" | "down";
export type Component = { status: Status; detail: string; latencyMs?: number };
export type Health = { status: Status; checkedAt: string; components: Record<"application" | "database" | "queue" | "worker" | "storage" | "email" | "ai" | "sources", Component> };

const WORKER_STALE_MS = 90_000;
const worst = (a: Status, b: Status): Status => (a === "down" || b === "down" ? "down" : a === "degraded" || b === "degraded" ? "degraded" : "ok");

/** One place that knows how to ask "is the platform healthy?" — used by /api/health/ready and the admin System page. */
export async function checkHealth(): Promise<Health> {
  const components = {} as Health["components"];
  components.application = { status: "ok", detail: `up ${Math.round(process.uptime())}s` };

  const t0 = performance.now();
  try {
    await db.$queryRaw`SELECT 1`;
    components.database = { status: "ok", detail: "reachable", latencyMs: Math.round(performance.now() - t0) };
  } catch {
    components.database = { status: "down", detail: "unreachable" };
  }

  if (components.database.status === "ok") {
    try {
      const [pending, failed, oldest, beat, sources] = await Promise.all([
        db.queueJob.count({ where: { status: "PENDING", runAt: { lte: new Date() } } }),
        db.queueJob.count({ where: { status: "FAILED", finishedAt: { gt: new Date(Date.now() - 86400_000) } } }),
        db.queueJob.findFirst({ where: { status: "PENDING", runAt: { lte: new Date() } }, orderBy: { runAt: "asc" }, select: { runAt: true } }),
        db.heartbeat.findUnique({ where: { name: "worker" } }),
        db.jobSource.groupBy({ by: ["health"], where: { active: true }, _count: true }),
      ]);
      const lagSec = oldest ? Math.round((Date.now() - oldest.runAt.getTime()) / 1000) : 0;
      components.queue = { status: lagSec > 900 ? "degraded" : "ok", detail: `${pending} due, oldest waiting ${lagSec}s, ${failed} dead-lettered in 24h` };
      const age = beat ? Date.now() - beat.lastBeatAt.getTime() : null;
      components.worker = age == null ? { status: "degraded", detail: "no heartbeat yet — start `npm run worker`" } : age > WORKER_STALE_MS ? { status: "degraded", detail: `last heartbeat ${Math.round(age / 1000)}s ago` } : { status: "ok", detail: `heartbeat ${Math.round(age / 1000)}s ago` };
      const bad = sources.filter((s) => s.health === "UNHEALTHY" || s.health === "DEGRADED").reduce((n, s) => n + s._count, 0);
      const total = sources.reduce((n, s) => n + s._count, 0);
      components.sources = { status: bad > 0 ? "degraded" : "ok", detail: total === 0 ? "no active sources configured" : `${total - bad}/${total} healthy` };
    } catch {
      components.queue = { status: "down", detail: "query failed" };
      components.worker = { status: "degraded", detail: "unknown" };
      components.sources = { status: "degraded", detail: "unknown" };
    }
  } else {
    components.queue = { status: "down", detail: "database unavailable" };
    components.worker = { status: "degraded", detail: "unknown" };
    components.sources = { status: "degraded", detail: "unknown" };
  }

  try {
    const dir = path.resolve(process.env.STORAGE_DIR ?? "./storage");
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK);
    components.storage = { status: "ok", detail: "writable" };
  } catch {
    components.storage = { status: "down", detail: "not writable" };
  }
  components.email = process.env.SMTP_URL ? { status: "ok", detail: "SMTP configured" } : { status: "degraded", detail: "SMTP not configured — emails are only logged" };
  components.ai = getProvider() ? { status: "ok", detail: "configured" } : { status: "degraded", detail: "not configured — AI features are off (everything else works)" };

  // Only hard dependencies take the instance out of rotation; the rest is reported as degraded.
  const status = Object.values(components).reduce<Status>((s, c) => worst(s, c.status), "ok");
  return { status, checkedAt: new Date().toISOString(), components };
}
