import "server-only";
import type { Prisma } from "@prisma/client";
import { classifyJob, platformDiscipline } from "@/lib/jobs/classify";
import { detectIndustry, normalizeCompany, normalizeTitle, parseLocation } from "@/lib/jobs/normalize";
import { MIN_LISTED_QUALITY, scoreQuality } from "@/lib/jobs/quality";
import { inferSeniority } from "@/lib/taxonomy";

export { uniqueJobSlug } from "@/lib/jobs/pipeline";

/**
 * Derived fields for a job posted natively by an employer. Native jobs are never rejected for low BIM relevance
 * (the employer chose to post on a BIM board), but they get the same classification and quality metadata so they
 * rank and filter consistently with ingested jobs.
 */
export function enrichNativeJob(input: { title: string; description: string; companyName: string; location?: string | null; country?: string | null; remote?: boolean; salaryMin?: number | null; salaryMax?: number | null }) {
  const cls = classifyJob({ title: input.title, description: input.description });
  const loc = parseLocation(input.location ?? undefined);
  const remoteType = input.remote ? ("REMOTE" as const) : /\bhybrid\b/i.test(input.description.slice(0, 600)) ? ("HYBRID" as const) : ("UNKNOWN" as const);
  const q = scoreQuality({ bimRelevanceScore: Math.max(cls.bimRelevanceScore, 60), title: input.title, description: input.description, discoveredAt: new Date(), sourceReliability: 100, city: loc.city, country: input.country ?? loc.country, remoteType, salaryMin: input.salaryMin, salaryMax: input.salaryMax, bimRole: cls.bimRole });
  return {
    software: cls.tools,
    skills: [...new Set([...cls.skills, ...cls.standards])],
    discipline: platformDiscipline(cls.primaryDiscipline) ?? null,
    seniority: inferSeniority(input.title),
    bimRole: cls.bimRole ?? null,
    city: loc.city ?? null,
    remote: remoteType === "REMOTE",
    remoteType,
    industry: detectIndustry(`${input.title}\n${input.description}`) ?? null,
    bimRelevanceScore: Math.max(cls.bimRelevanceScore, 60),
    qualityScore: q.score,
    companyKey: normalizeCompany(input.companyName),
    titleKey: normalizeTitle(input.title),
  };
}

/** Jobs that may appear anywhere in the product: live, canonical (merged duplicates hidden), not past their expiry. */
export const activeJobWhere = (): Prisma.JobWhereInput => ({ status: "ACTIVE", canonicalJobId: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] });

/** Same, minus thin/low-quality ingested postings, for browse/search/feeds. Native employer jobs always pass. */
export const listedJobWhere = (): Prisma.JobWhereInput => ({ AND: [activeJobWhere(), { OR: [{ qualityScore: { gte: MIN_LISTED_QUALITY } }, { postedByUserId: { not: null } }] }] });
