import { db } from "@/lib/db";
import { QUEUES, NonRetryableError, enqueue, purgeFinished, type Handler } from "@/lib/queue/queue";
import { checkSourceHealth, discoverSource, expireByDate, fetchRaw, findStale, processRaw, recheckRef } from "./pipeline";
import { runDigestAlerts, runInstantAlerts } from "./alerts";
import { matchJobForProfiles } from "@/lib/services/matching";
import { resetFacetCache } from "./search";
import { SourceError } from "./types";
import { runApplicationMaintenance } from "@/lib/applications/maintenance";
import { deliverOutbox, notifyEvent } from "@/lib/notifications/service";

const str = (v: unknown, name: string) => {
  if (typeof v !== "string" || !v) throw new NonRetryableError(`payload.${name} missing`);
  return v;
};

/** Source failures that retrying cannot fix (bad config, robots disallow, 4xx) are not retried. */
const wrap = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SourceError && !e.retryable) throw new NonRetryableError(e.message);
    throw e;
  }
};

export const HANDLERS: Record<string, Handler> = {
  [QUEUES.discover]: async (p) => void (await wrap(() => discoverSource(str(p.sourceId, "sourceId")))),
  [QUEUES.fetch]: async (p) => void (await wrap(() => fetchRaw(str(p.sourceId, "sourceId"), { sourceJobId: str(p.sourceJobId, "sourceJobId"), url: str(p.url, "url") }))),
  [QUEUES.process]: async (p) => void (await processRaw(str(p.rawJobId, "rawJobId"))),
  [QUEUES.recheck]: async (p) => void (await wrap(() => recheckRef(str(p.refId, "refId")))),
  [QUEUES.match]: async (p) => {
    const jobId = str(p.jobId, "jobId");
    await matchJobForProfiles(jobId);
    const job = await db.job.findUnique({ where: { id: jobId }, select: { discoveredAt: true, status: true, slug: true, title: true, companyName: true } });
    // Strong new matches become a "new matching job" notification (once per job; preferences decide in-app/email).
    if (job?.status === "ACTIVE" && Date.now() - job.discoveredAt.getTime() < 12 * 3600_000) {
      const strong = await db.jobMatch.findMany({ where: { jobId, score: { gte: 80 } }, orderBy: { score: "desc" }, take: 100, select: { score: true, profile: { select: { userId: true } } } });
      for (const m of strong) await notifyEvent(m.profile.userId, "job.match", { title: `New ${m.score}% match: ${job.title}`, body: job.companyName, dedupeKey: `/jobs/${job.slug}` });
    }
    // Instant alerts only for jobs that are genuinely new, and only after their matches exist.
    if (job?.status === "ACTIVE" && Date.now() - job.discoveredAt.getTime() < 12 * 3600_000) await enqueue(QUEUES.alertsInstant, { jobId }, { dedupeKey: `alert-instant:${jobId}` });
  },
  [QUEUES.alertsInstant]: async (p) => void (await runInstantAlerts(str(p.jobId, "jobId"))),
  [QUEUES.alerts]: async () => void (await runDigestAlerts()),
  [QUEUES.expire]: async () => {
    await expireByDate();
    await runApplicationMaintenance();
    await findStale();
    await purgeFinished();
    resetFacetCache();
  },
  [QUEUES.email]: async (p) => void (await deliverOutbox(str(p.outboxId, "outboxId"))),
  [QUEUES.health]: async (p) => void (await checkSourceHealth(str(p.sourceId, "sourceId"))),
};
