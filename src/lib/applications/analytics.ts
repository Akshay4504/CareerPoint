import type { ApplicationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { viewSummary } from "@/lib/services/profile-views";
import { listedJobWhere } from "@/lib/services/jobs";
import { msAgo } from "@/lib/utils";
import { OPEN_STAGES } from "./lifecycle";
import type { EmployerCtx } from "@/lib/employer/permissions";

// Analytics are counted from rows that exist. A metric with no basis is returned as null (and shown as "—"),
// never as a made-up number.

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const REACHED_SHORTLIST: ApplicationStatus[] = ["SHORTLISTED", "ASSESSMENT", "INTERVIEW", "OFFER", "ACCEPTED"];
const REACHED_INTERVIEW: ApplicationStatus[] = ["INTERVIEW", "OFFER", "ACCEPTED"];
const REACHED_OFFER: ApplicationStatus[] = ["OFFER", "ACCEPTED"];

export async function candidateAnalytics(userId: string, profileId: string) {
  const apps = await db.application.findMany({
    where: { userId },
    select: { id: true, status: true, external: true, viewedByEmployerAt: true, job: { select: { bimRole: true } }, events: { where: { toStatus: { not: null } }, select: { toStatus: true, actorRole: true } }, interviews: { select: { id: true } } },
  });
  const everReached = (a: (typeof apps)[number], set: ApplicationStatus[]) => set.includes(a.status) || a.events.some((e) => e.toStatus && set.includes(e.toStatus));
  const submitted = apps.filter((a) => a.status !== "APPLYING");
  const native = submitted.filter((a) => !a.external);
  // "Response" needs platform evidence: only CareerPoint applications can have it. External responses are self-reported and excluded.
  const responded = native.filter((a) => a.viewedByEmployerAt || a.events.some((e) => e.actorRole === "EMPLOYER")).length;

  const [views, latest, topMatches] = await Promise.all([
    viewSummary(profileId, 30),
    db.resume.findFirst({ where: { profileId }, orderBy: { updatedAt: "desc" }, select: { currentVersionId: true } }).then(async (r) => (r?.currentVersionId ? ((await db.resumeScore.findFirst({ where: { resumeVersionId: r.currentVersionId }, orderBy: { createdAt: "desc" }, select: { total: true } }))?.total ?? null) : null)),
    db.jobMatch.findMany({ where: { profileId, score: { gte: 50 }, job: listedJobWhere() }, orderBy: { score: "desc" }, take: 40, select: { score: true, job: { select: { bimRole: true, skills: true, software: true } } } }),
  ]);

  const roles = new Map<string, number>();
  const wanted = new Map<string, number>();
  for (const m of topMatches) {
    if (m.job.bimRole) roles.set(m.job.bimRole, (roles.get(m.job.bimRole) ?? 0) + 1);
    for (const s of new Set([...m.job.skills, ...m.job.software])) wanted.set(s, (wanted.get(s) ?? 0) + 1);
  }
  const prof = await db.bIMProfessionalProfile.findUnique({ where: { id: profileId }, select: { softwareSkills: { select: { software: true } }, skills: { select: { skill: { select: { name: true } } } }, bimStandards: true } });
  const have = new Set([...(prof?.softwareSkills.map((s) => s.software) ?? []), ...(prof?.skills.map((s) => s.skill.name) ?? []), ...(prof?.bimStandards ?? [])].map((s) => s.toLowerCase()));
  const top = <T,>(m: Map<string, number>, f: (k: string, n: number) => T) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([k, n]) => f(k, n));

  return {
    total: apps.length,
    submitted: submitted.length,
    active: apps.filter((a) => OPEN_STAGES.includes(a.status)).length,
    interviews: apps.filter((a) => everReached(a, REACHED_INTERVIEW) || a.interviews.length > 0).length,
    offers: apps.filter((a) => everReached(a, REACHED_OFFER)).length,
    nativeSubmitted: native.length,
    responseRate: native.length ? Math.round((responded / native.length) * 100) : null,
    views,
    resumeScore: latest,
    topRoles: top(roles, (role, count) => ({ role, count })),
    topSkills: top(wanted, (name, count) => ({ name, count, have: have.has(name.toLowerCase()) })),
    matchedJobs: topMatches.length,
  };
}

export async function employerAnalytics(ctx: EmployerCtx, days = 90) {
  const since = msAgo(days * 86400_000);
  const [jobs, apps] = await Promise.all([
    db.job.groupBy({ by: ["status"], where: { companyId: ctx.companyId }, _count: true }),
    db.application.findMany({ where: { external: false, status: { not: "APPLYING" }, job: { companyId: ctx.companyId }, createdAt: { gte: since } }, select: { id: true, status: true, origin: true, appliedAt: true, createdAt: true, viewedByEmployerAt: true, jobId: true, events: { where: { toStatus: { not: null } }, select: { toStatus: true, createdAt: true } }, interviews: { select: { id: true } } } }),
  ]);
  const reached = (a: (typeof apps)[number], set: ApplicationStatus[]) => set.includes(a.status) || a.events.some((e) => e.toStatus && set.includes(e.toStatus));
  const shortlisted = apps.filter((a) => reached(a, REACHED_SHORTLIST));
  const interviewed = apps.filter((a) => reached(a, REACHED_INTERVIEW) || a.interviews.length > 0);
  const hours: number[] = [];
  for (const a of apps) {
    const first = a.events.filter((e) => e.toStatus === "SHORTLISTED").sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())[0];
    if (first) hours.push((first.createdAt.getTime() - (a.appliedAt ?? a.createdAt).getTime()) / 3600_000);
  }
  const bySource = new Map<string, number>();
  for (const a of apps) bySource.set(a.origin ?? "unknown", (bySource.get(a.origin ?? "unknown") ?? 0) + 1);
  const funnel = new Map<ApplicationStatus, number>();
  for (const a of apps) funnel.set(a.status, (funnel.get(a.status) ?? 0) + 1);
  const jobCount = (s: string) => jobs.find((j) => j.status === s)?._count ?? 0;
  const perJob = new Map<string, number>();
  for (const a of apps) perJob.set(a.jobId, (perJob.get(a.jobId) ?? 0) + 1);

  return {
    days,
    jobsPosted: jobs.reduce((n, j) => n + j._count, 0),
    jobsLive: jobCount("ACTIVE"),
    applications: apps.length,
    viewed: apps.filter((a) => a.viewedByEmployerAt).length,
    shortlisted: shortlisted.length,
    interviewed: interviewed.length,
    shortlistRate: apps.length ? Math.round((shortlisted.length / apps.length) * 100) : null,
    interviewRate: apps.length ? Math.round((interviewed.length / apps.length) * 100) : null,
    medianHoursToShortlist: median(hours) == null ? null : Math.round(median(hours)! * 10) / 10,
    bySource: [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count })),
    funnel: [...funnel.entries()].map(([status, count]) => ({ status, count })),
    perJob: perJob,
  };
}
