import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listedJobWhere } from "@/lib/services/jobs";

// Indexed job search. Free text uses the Postgres full-text index (generated, weighted tsvector + GIN);
// every structured filter maps to an indexed column (btree / GIN array), so queries stay fast as the board grows.

export type JobFilters = {
  q?: string;
  role?: string; // bimRole
  discipline?: string;
  software?: string[];
  country?: string;
  city?: string;
  remote?: "REMOTE" | "HYBRID" | "ONSITE";
  experience?: number; // candidate's years: jobs asking for at most this much (or unspecified)
  salaryMin?: number; // jobs that can pay at least this
  employmentType?: string;
  postedWithinDays?: number;
  company?: string;
  sort?: "relevance" | "newest" | "quality" | "match";
  page?: number;
  pageSize?: number;
};

const clean = (s?: string) => (s ?? "").trim().slice(0, 120);

/** Pure: structured filters → Prisma where. Listed (live, canonical, quality) jobs only. */
export function buildWhere(f: JobFilters, now = new Date()): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [listedJobWhere()];
  if (f.role) and.push({ bimRole: { equals: clean(f.role), mode: "insensitive" } });
  if (f.discipline) and.push({ discipline: clean(f.discipline) });
  if (f.software?.length) and.push({ software: { hasEvery: f.software.map(clean).filter(Boolean) } });
  if (f.country) and.push({ country: { equals: clean(f.country), mode: "insensitive" } });
  if (f.city) and.push({ city: { equals: clean(f.city), mode: "insensitive" } });
  if (f.remote) and.push(f.remote === "REMOTE" ? { OR: [{ remoteType: "REMOTE" }, { remote: true }] } : { remoteType: f.remote });
  if (f.experience != null && Number.isFinite(f.experience)) and.push({ OR: [{ experienceMin: null }, { experienceMin: { lte: Math.max(0, Math.floor(f.experience)) } }] });
  if (f.salaryMin) and.push({ OR: [{ salaryMax: { gte: f.salaryMin } }, { AND: [{ salaryMax: null }, { salaryMin: { gte: f.salaryMin } }] }] });
  if (f.employmentType) and.push({ employmentType: { equals: clean(f.employmentType), mode: "insensitive" } });
  if (f.postedWithinDays) and.push({ postedAt: { gte: new Date(now.getTime() - f.postedWithinDays * 86400_000) } });
  if (f.company) and.push({ companyName: { contains: clean(f.company), mode: "insensitive" } });
  return { AND: and };
}

/** Ranked ids for a text query via the full-text index. Never interpolates user text into SQL. */
export async function textMatchIds(q: string, limit = 2000): Promise<{ id: string; rank: number }[]> {
  const query = clean(q);
  if (!query) return [];
  return db.$queryRaw<{ id: string; rank: number }[]>`
    SELECT j.id, ts_rank_cd(j.search, tsq, 33)::float AS rank
    FROM "Job" j, websearch_to_tsquery('english', ${query}) tsq
    WHERE j.search @@ tsq AND j.status = 'ACTIVE' AND j."canonicalJobId" IS NULL
    ORDER BY rank DESC, j."postedAt" DESC
    LIMIT ${limit}`;
}

const CARD_SELECT = {
  id: true, slug: true, title: true, companyName: true, company: { select: { slug: true, verified: true } }, location: true, city: true, country: true, remote: true, remoteType: true, seniority: true, discipline: true, bimRole: true,
  employmentType: true, software: true, salaryMin: true, salaryMax: true, salaryCurrency: true, postedAt: true, discoveredAt: true, qualityScore: true, bimRelevanceScore: true, companyId: true, applyUrl: true, experienceMin: true, experienceMax: true,
} satisfies Prisma.JobSelect;
export type JobCardRow = Prisma.JobGetPayload<{ select: typeof CARD_SELECT }>;

export type MatchInfo = { reasons: string[]; gaps: string[] };
export const matchInfo = (json: unknown): MatchInfo => {
  const o = (json && typeof json === "object" ? json : {}) as { reasons?: unknown; gaps?: unknown };
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { reasons: arr(o.reasons), gaps: arr(o.gaps) };
};

export type SearchResult = { rows: { job: JobCardRow; score: number | null; info?: MatchInfo }[]; total: number; page: number; pages: number };

export async function searchJobs(f: JobFilters, opts: { profileId?: string | null } = {}): Promise<SearchResult> {
  const pageSize = Math.min(50, Math.max(1, f.pageSize ?? 20));
  const page = Math.max(1, f.page ?? 1);
  const where = buildWhere(f);
  let sort = f.sort ?? (f.q ? "relevance" : "newest");
  if (sort === "match" && !opts.profileId) sort = f.q ? "relevance" : "newest";

  let ranked: Map<string, number> | null = null;
  if (f.q?.trim()) {
    const hits = await textMatchIds(f.q);
    ranked = new Map(hits.map((h) => [h.id, h.rank]));
    (where.AND as Prisma.JobWhereInput[]).push({ id: { in: hits.map((h) => h.id) } });
  }

  let rows: SearchResult["rows"];
  let total: number;

  if (sort === "match" && opts.profileId) {
    const mWhere: Prisma.JobMatchWhereInput = { profileId: opts.profileId, job: where };
    const [m, t] = await Promise.all([db.jobMatch.findMany({ where: mWhere, orderBy: [{ score: "desc" }, { jobId: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: { job: { select: CARD_SELECT } } }), db.jobMatch.count({ where: mWhere })]);
    rows = m.map((x) => ({ job: x.job, score: x.score, info: matchInfo(x.reasons) }));
    total = t;
  } else if (ranked && sort === "relevance") {
    // Rank order comes from the text index; filters narrow the id set, then the page is sliced in rank order.
    const ids = (await db.job.findMany({ where, select: { id: true } })).map((j) => j.id).sort((a, b) => (ranked!.get(b) ?? 0) - (ranked!.get(a) ?? 0));
    total = ids.length;
    const pageIds = ids.slice((page - 1) * pageSize, page * pageSize);
    const jobs = await db.job.findMany({ where: { id: { in: pageIds } }, select: CARD_SELECT });
    const byId = new Map(jobs.map((j) => [j.id, j]));
    rows = pageIds.map((id) => ({ job: byId.get(id)!, score: null })).filter((r) => r.job);
  } else {
    const orderBy: Prisma.JobOrderByWithRelationInput[] = sort === "quality" ? [{ qualityScore: "desc" }, { postedAt: "desc" }] : [{ postedAt: "desc" }, { id: "asc" }];
    const [jobs, t] = await Promise.all([db.job.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, select: CARD_SELECT }), db.job.count({ where })]);
    rows = jobs.map((job) => ({ job, score: null }));
    total = t;
  }

  if (opts.profileId && rows.some((r) => r.score == null)) {
    const found = new Map((await db.jobMatch.findMany({ where: { profileId: opts.profileId, jobId: { in: rows.map((r) => r.job.id) } }, select: { jobId: true, score: true, reasons: true } })).map((m) => [m.jobId, m]));
    rows = rows.map((r) => ({ ...r, score: r.score ?? found.get(r.job.id)?.score ?? null, info: r.info ?? (found.has(r.job.id) ? matchInfo(found.get(r.job.id)!.reasons) : undefined) }));
  }
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

// ---- Facets (cached) ----------------------------------------------------------------------------------

let facetCache: { at: number; value: Facets } | null = null;
export type Facets = { countries: { value: string; count: number }[]; disciplines: { value: string; count: number }[]; roles: { value: string; count: number }[]; employmentTypes: { value: string; count: number }[]; software: string[] };

/** Filter dropdown options come from real data and are cached for a minute. */
export async function jobFacets(ttlMs = 60_000): Promise<Facets> {
  if (facetCache && Date.now() - facetCache.at < ttlMs) return facetCache.value;
  const where = listedJobWhere();
  const group = async (by: "country" | "discipline" | "bimRole" | "employmentType") => {
    const rows = await db.job.groupBy({ by: [by], where: { AND: [where, { [by]: { not: null } }] }, _count: { _all: true }, orderBy: { _count: { [by]: "desc" } }, take: 25 });
    return rows.map((r) => ({ value: String((r as Record<string, unknown>)[by]), count: r._count._all }));
  };
  const [countries, disciplines, roles, employmentTypes, sw] = await Promise.all([
    group("country"), group("discipline"), group("bimRole"), group("employmentType"),
    db.$queryRaw<{ s: string; n: bigint }[]>`SELECT s, count(*) AS n FROM "Job", unnest(software) AS s WHERE status = 'ACTIVE' AND "canonicalJobId" IS NULL GROUP BY s ORDER BY n DESC LIMIT 30`,
  ]);
  const value = { countries, disciplines, roles, employmentTypes, software: sw.map((x) => x.s) };
  facetCache = { at: Date.now(), value };
  return value;
}

export const resetFacetCache = () => {
  facetCache = null;
};
