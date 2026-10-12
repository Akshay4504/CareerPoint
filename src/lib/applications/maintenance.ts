import { db } from "@/lib/db";
import { purgeRateLimits } from "@/lib/auth/rate-limit";
import { purgeChallenges } from "@/lib/auth/challenge";
import { notifyEvent } from "@/lib/notifications/service";
import { expireUnconfirmed } from "./candidate";

/** Saved jobs that close within 3 days (their own expiry date) or were taken down: one notice per job per candidate. */
export async function notifyExpiringSaved(now = new Date(), withinDays = 3) {
  const soon = new Date(now.getTime() + withinDays * 86400_000);
  const saved = await db.savedJob.findMany({
    where: { job: { OR: [{ status: "ACTIVE", expiresAt: { gt: now, lte: soon } }, { status: "INACTIVE", lastSeenAt: { gt: new Date(now.getTime() - 7 * 86400_000) } }] } },
    include: { job: { select: { slug: true, title: true, companyName: true, status: true, expiresAt: true } } },
    take: 500,
  });
  let n = 0;
  for (const s of saved) {
    // Already applied? Then it is no longer a saved-job reminder.
    if (await db.application.findUnique({ where: { userId_jobId: { userId: s.userId, jobId: s.jobId } }, select: { id: true } })) continue;
    const gone = s.job.status !== "ACTIVE";
    const r = await notifyEvent(s.userId, "job.expiring", { title: gone ? `Saved job is no longer listed: ${s.job.title}` : `Saved job closes soon: ${s.job.title}`, body: s.job.companyName, dedupeKey: `/jobs/${s.job.slug}` });
    if (r.inApp || r.email) n++;
  }
  return n;
}

export async function runApplicationMaintenance(now = new Date()) {
  const expired = await expireUnconfirmed(now);
  const notified = await notifyExpiringSaved(now);
  // Housekeeping that would otherwise grow without bound.
  const [limits, sessions, tokens, usage] = await Promise.all([
    purgeRateLimits().then(async (r) => (await purgeChallenges(), r)),
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.authToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86400_000) } } }),
    db.aiUsage.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 86400_000) } } }),
  ]);
  return { expired, notified, purged: { rateLimits: limits.count, sessions: sessions.count, tokens: tokens.count, aiUsage: usage.count } };
}
