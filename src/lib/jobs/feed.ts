import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listedJobWhere } from "@/lib/services/jobs";
import { profileCompleteness } from "@/lib/services/profile";
import { matchInfo, type MatchInfo } from "./search";

// Personalized feed built from real candidate data and stored JobMatch scores.

export type FeedView = "recommended" | "best" | "new" | "remote" | "saved" | "pinned";
export const FEED_VIEWS: { key: FeedView; label: string }[] = [
  { key: "recommended", label: "Recommended" },
  { key: "best", label: "Best match" },
  { key: "new", label: "New today" },
  { key: "remote", label: "Remote" },
  { key: "saved", label: "Saved" },
  { key: "pinned", label: "Pinned" },
];

export const RECOMMENDED_MIN = 55;
export const FEED_MIN = 35;

const CARD = {
  id: true, slug: true, title: true, companyName: true, company: { select: { slug: true, verified: true } }, location: true, city: true, country: true, remote: true, remoteType: true, seniority: true, discipline: true, bimRole: true,
  employmentType: true, software: true, salaryMin: true, salaryMax: true, salaryCurrency: true, postedAt: true, discoveredAt: true, qualityScore: true, bimRelevanceScore: true, companyId: true, applyUrl: true, experienceMin: true, experienceMax: true,
} satisfies Prisma.JobSelect;
export type FeedJob = Prisma.JobGetPayload<{ select: typeof CARD }>;
export type FeedItem = { job: FeedJob; score: number | null; info?: MatchInfo };

export type FeedResult = { view: FeedView; items: FeedItem[]; total: number; hint: string | null; counts: Record<FeedView, number> };

/** Recommendations need at least some software and skills to compare; without them the feed prompts for a fuller profile. */
export async function profileHint(profileId: string): Promise<string | null> {
  const { profile } = await profileCompleteness(profileId);
  const thin = profile._count.softwareSkills === 0 || profile._count.skills === 0;
  return thin ? "Complete your BIM profile to improve recommendations." : null;
}

const since = (ms: number) => new Date(Date.now() - ms);

function matchWhere(profileId: string, view: FeedView, userId: string): Prisma.JobMatchWhereInput {
  const job: Prisma.JobWhereInput[] = [listedJobWhere(), { applications: { none: { userId } } }];
  if (view === "new") job.push({ discoveredAt: { gte: since(24 * 3600_000) } });
  if (view === "remote") job.push({ OR: [{ remoteType: "REMOTE" }, { remote: true }] });
  const min = view === "recommended" ? RECOMMENDED_MIN : FEED_MIN;
  return { profileId, score: { gte: min }, job: { AND: job } };
}

export async function buildFeed(userId: string, profileId: string, view: FeedView, take = 24): Promise<FeedResult> {
  const hint = await profileHint(profileId);
  const countFor = async (v: FeedView) => {
    if (v === "saved") return db.savedJob.count({ where: { userId, job: listedJobWhere() } });
    if (v === "pinned") return db.pinnedJob.count({ where: { userId, job: listedJobWhere() } });
    return db.jobMatch.count({ where: matchWhere(profileId, v, userId) });
  };
  const counts = Object.fromEntries(await Promise.all(FEED_VIEWS.map(async (v) => [v.key, await countFor(v.key)]))) as Record<FeedView, number>;

  let items: FeedItem[];
  if (view === "saved" || view === "pinned") {
    const rows = view === "saved" ? await db.savedJob.findMany({ where: { userId, job: listedJobWhere() }, orderBy: { createdAt: "desc" }, take, include: { job: { select: CARD } } }) : await db.pinnedJob.findMany({ where: { userId, job: listedJobWhere() }, orderBy: { createdAt: "desc" }, take, include: { job: { select: CARD } } });
    const found = new Map((await db.jobMatch.findMany({ where: { profileId, jobId: { in: rows.map((r) => r.jobId) } }, select: { jobId: true, score: true, reasons: true } })).map((m) => [m.jobId, m]));
    items = rows.map((r) => ({ job: r.job, score: found.get(r.jobId)?.score ?? null, info: found.has(r.jobId) ? matchInfo(found.get(r.jobId)!.reasons) : undefined }));
  } else {
    // Recommended blends compatibility with listing quality so thin postings don't outrank solid ones at equal fit.
    const rows = await db.jobMatch.findMany({ where: matchWhere(profileId, view, userId), orderBy: [{ score: "desc" }, { job: { qualityScore: "desc" } }, { jobId: "asc" }], take: view === "recommended" ? take * 3 : take, include: { job: { select: CARD } } });
    let list: FeedItem[] = rows.map((r) => ({ job: r.job, score: r.score, info: matchInfo(r.reasons) }));
    if (view === "recommended") list = list.sort((a, b) => b.score! * 0.8 + b.job.qualityScore * 0.2 - (a.score! * 0.8 + a.job.qualityScore * 0.2)).slice(0, take);
    items = list;
  }
  return { view, items, total: counts[view], hint, counts };
}
