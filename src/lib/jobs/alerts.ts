import { log } from "@/lib/log";
import { z } from "zod";
import type { AlertFrequency, JobAlert, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sendMail, appUrl } from "@/lib/mail";
import { buildWhere, textMatchIds, type JobFilters } from "./search";

// Saved searches that notify the candidate when matching BIM jobs are found.
// Criteria are structured and evaluated deterministically; delivery is by in-app notification and optionally email.

export const criteriaSchema = z.object({
  keywords: z.string().trim().max(120).optional(),
  bimRole: z.string().trim().max(80).optional(),
  discipline: z.string().trim().max(60).optional(),
  software: z.array(z.string().trim().min(1).max(60)).max(8).default([]),
  country: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  remote: z.boolean().optional(),
  employmentType: z.string().trim().max(40).optional(),
  /** Only notify for jobs whose compatibility with the candidate's profile is at least this. 0 disables. */
  minMatch: z.number().int().min(0).max(100).default(0),
});
export type AlertCriteria = z.infer<typeof criteriaSchema>;

export const INTERVAL_MS: Record<AlertFrequency, number> = { INSTANT: 0, DAILY: 24 * 3600_000, WEEKLY: 7 * 24 * 3600_000 };
export const CHANNELS = ["IN_APP", "EMAIL"] as const;

export function criteriaToFilters(c: AlertCriteria): JobFilters {
  return { q: c.keywords || undefined, role: c.bimRole || undefined, discipline: c.discipline || undefined, software: c.software.length ? c.software : undefined, country: c.country || undefined, city: c.city || undefined, remote: c.remote ? "REMOTE" : undefined, employmentType: c.employmentType || undefined };
}

export function describeCriteria(c: AlertCriteria): string {
  const parts = [c.bimRole ? `${c.bimRole} jobs` : c.keywords ? `“${c.keywords}” jobs` : "BIM jobs", c.discipline && `in ${c.discipline}`, c.software.length && `using ${c.software.join(", ")}`, c.city ? `in ${c.city}` : c.country ? `in ${c.country}` : null, c.remote && "remote", c.employmentType, c.minMatch ? `matching your profile (${c.minMatch}%+)` : null];
  return parts.filter(Boolean).join(" · ");
}

type JobLike = { title: string; description?: string; bimRole: string | null; discipline: string | null; software: string[]; country: string | null; city: string | null; remote: boolean; remoteType: string; employmentType: string | null };
const lc = (s?: string | null) => (s ?? "").toLowerCase();

/** Pure in-memory evaluation (used for instant alerts on a single new job). Mirrors the SQL filters. */
export function alertMatchesJob(c: AlertCriteria, job: JobLike, matchScore: number | null): boolean {
  if (c.bimRole && lc(job.bimRole) !== lc(c.bimRole)) return false;
  if (c.discipline && job.discipline !== c.discipline) return false;
  if (c.software.length && !c.software.every((s) => job.software.some((x) => lc(x) === lc(s)))) return false;
  if (c.country && lc(job.country) !== lc(c.country)) return false;
  if (c.city && lc(job.city) !== lc(c.city)) return false;
  if (c.remote && !(job.remote || job.remoteType === "REMOTE")) return false;
  if (c.employmentType && lc(job.employmentType) !== lc(c.employmentType)) return false;
  if (c.keywords) {
    const hay = `${job.title} ${job.description ?? ""}`.toLowerCase();
    if (!c.keywords.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  if (c.minMatch > 0 && (matchScore ?? 0) < c.minMatch) return false;
  return true;
}

export const isDue = (a: Pick<JobAlert, "frequency" | "lastRunAt" | "createdAt">, now: Date) => a.frequency !== "INSTANT" && now.getTime() - (a.lastRunAt ?? a.createdAt).getTime() >= INTERVAL_MS[a.frequency];

async function deliver(alert: JobAlert & { user: { id: string; email: string; name: string; emailVerifiedAt: Date | null } }, jobs: { slug: string; title: string; companyName: string }[], mode: "instant" | "digest") {
  const c = criteriaSchema.parse(alert.criteria);
  const n = jobs.length;
  const title = n === 1 ? `New match: ${jobs[0].title} at ${jobs[0].companyName}` : `${n} new jobs for “${alert.name}”`;
  const href = n === 1 ? `/jobs/${jobs[0].slug}` : `/jobs?${new URLSearchParams({ ...(c.keywords ? { q: c.keywords } : {}), ...(c.bimRole ? { role: c.bimRole } : {}), ...(c.country ? { country: c.country } : {}), ...(c.city ? { city: c.city } : {}), sort: "newest" })}`;
  if (alert.channels.includes("IN_APP")) await db.notification.create({ data: { userId: alert.userId, type: "job.alert", title, body: describeCriteria(c), href } });
  if (alert.channels.includes("EMAIL") && alert.user.emailVerifiedAt) {
    await sendMail({ to: alert.user.email, subject: title, text: `${describeCriteria(c)}\n\n${jobs.slice(0, 10).map((j) => `• ${j.title} — ${j.companyName}\n  ${appUrl()}/jobs/${j.slug}`).join("\n")}\n\nManage alerts: ${appUrl()}/jobs/alerts` }).catch((err) => log.error("alerts.mail_failed", { err }));
  }
  void mode;
}

/** INSTANT alerts for one newly discovered job. Skips users already notified about this job. */
export async function runInstantAlerts(jobId: string): Promise<number> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true, slug: true, title: true, description: true, companyName: true, bimRole: true, discipline: true, software: true, country: true, city: true, remote: true, remoteType: true, employmentType: true, status: true, canonicalJobId: true } });
  if (!job || job.status !== "ACTIVE" || job.canonicalJobId) return 0;
  const alerts = await db.jobAlert.findMany({ where: { active: true, frequency: "INSTANT" }, include: { user: { select: { id: true, email: true, name: true, emailVerifiedAt: true, profile: { select: { id: true } } } } } });
  let sent = 0;
  for (const a of alerts) {
    const c = criteriaSchema.safeParse(a.criteria);
    if (!c.success) continue;
    const score = a.user.profile ? (await db.jobMatch.findUnique({ where: { profileId_jobId: { profileId: a.user.profile.id, jobId } }, select: { score: true } }))?.score ?? null : null;
    if (!alertMatchesJob(c.data, job, score)) continue;
    if (await db.notification.findFirst({ where: { userId: a.userId, type: "job.alert", href: `/jobs/${job.slug}` }, select: { id: true } })) continue;
    await deliver(a, [job], "instant");
    await db.jobAlert.update({ where: { id: a.id }, data: { lastNotifiedAt: new Date() } });
    sent++;
  }
  return sent;
}

/** DAILY/WEEKLY digests: everything discovered since the alert last ran that matches its criteria. */
export async function runDigestAlerts(now = new Date()): Promise<number> {
  const alerts = await db.jobAlert.findMany({ where: { active: true, frequency: { in: ["DAILY", "WEEKLY"] } }, include: { user: { select: { id: true, email: true, name: true, emailVerifiedAt: true, profile: { select: { id: true } } } } } });
  let sent = 0;
  for (const a of alerts) {
    if (!isDue(a, now)) continue;
    const c = criteriaSchema.safeParse(a.criteria);
    const since = a.lastRunAt ?? a.createdAt;
    await db.jobAlert.update({ where: { id: a.id }, data: { lastRunAt: now } });
    if (!c.success) continue;
    const base = buildWhere(criteriaToFilters(c.data), now);
    const and: Prisma.JobWhereInput[] = [base, { discoveredAt: { gt: since } }];
    if (c.data.keywords) {
      // Keywords use the same full-text index as search (buildWhere only covers the structured filters).
      const hits = await textMatchIds(c.data.keywords);
      if (!hits.length) continue;
      and.push({ id: { in: hits.map((h) => h.id) } });
    }
    const where: Prisma.JobWhereInput = { AND: and };
    let jobs = await db.job.findMany({ where, orderBy: { discoveredAt: "desc" }, take: 50, select: { id: true, slug: true, title: true, companyName: true } });
    if (c.data.minMatch > 0) {
      if (!a.user.profile) continue;
      const scores = new Map((await db.jobMatch.findMany({ where: { profileId: a.user.profile.id, jobId: { in: jobs.map((j) => j.id) } }, select: { jobId: true, score: true } })).map((m) => [m.jobId, m.score]));
      jobs = jobs.filter((j) => (scores.get(j.id) ?? 0) >= c.data.minMatch);
    }
    if (!jobs.length) continue;
    await deliver(a, jobs, "digest");
    await db.jobAlert.update({ where: { id: a.id }, data: { lastNotifiedAt: now } });
    sent++;
  }
  return sent;
}
