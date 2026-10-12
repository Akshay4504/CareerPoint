import { inferSeniority } from "@/lib/taxonomy";

// Job quality: a transparent 0-100 score used to rank listings and hide thin/stale ones.
// Duplicate probability is reported alongside (it is computed during deduplication) but is not part of this sum.

export const QUALITY_WEIGHTS = { bimRelevance: 30, descriptionCompleteness: 20, recency: 15, sourceReliability: 10, locationCompleteness: 10, salaryCompleteness: 5, roleClarity: 10 } as const;
export const MIN_LISTED_QUALITY = 25;

export type QualityInput = {
  bimRelevanceScore: number;
  title: string;
  description: string;
  responsibilities?: string | null;
  requirements?: string | null;
  postedAt?: Date | null;
  discoveredAt: Date;
  sourceReliability: number; // 0-100
  city?: string | null;
  country?: string | null;
  remoteType?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  bimRole?: string | null;
};

export type QualityResult = { score: number; parts: Record<keyof typeof QUALITY_WEIGHTS, number>; notes: string[] };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function recencyFactor(date: Date, now: Date) {
  const days = (now.getTime() - date.getTime()) / 86400_000;
  if (days <= 3) return 1;
  if (days <= 14) return 0.85;
  if (days <= 30) return 0.65;
  if (days <= 60) return 0.4;
  if (days <= 120) return 0.2;
  return 0.05;
}

export function scoreQuality(q: QualityInput, now = new Date()): QualityResult {
  const W = QUALITY_WEIGHTS;
  const notes: string[] = [];
  const descLen = q.description.trim().length;
  const desc = clamp01(descLen / 1500) * 0.5 + (q.responsibilities ? 0.25 : 0) + (q.requirements ? 0.25 : 0);
  if (descLen < 400) notes.push("Short description");
  if (!q.requirements) notes.push("No requirements section detected");
  const recency = recencyFactor(q.postedAt ?? q.discoveredAt, now);
  if (!q.postedAt) notes.push("No posting date; using discovery date");
  const loc = (q.city ? 0.5 : 0) + (q.country ? 0.35 : 0) + (q.remoteType && q.remoteType !== "UNKNOWN" ? 0.15 : 0);
  if (!q.city && !q.country) notes.push("No location");
  const salary = q.salaryMin && q.salaryMax ? 1 : q.salaryMin || q.salaryMax ? 0.6 : 0;
  const words = q.title.trim().split(/\s+/).length;
  const clarity = (q.bimRole ? 0.6 : 0) + (words >= 2 && words <= 9 ? 0.2 : 0) + (inferSeniority(q.title) ? 0.2 : 0);
  if (!q.bimRole) notes.push("Role not clearly identified as a BIM role");

  const parts = {
    bimRelevance: clamp01(q.bimRelevanceScore / 100) * W.bimRelevance,
    descriptionCompleteness: clamp01(desc) * W.descriptionCompleteness,
    recency: recency * W.recency,
    sourceReliability: clamp01(q.sourceReliability / 100) * W.sourceReliability,
    locationCompleteness: clamp01(loc) * W.locationCompleteness,
    salaryCompleteness: salary * W.salaryCompleteness,
    roleClarity: clamp01(clarity) * W.roleClarity,
  };
  const round = (n: number) => Math.round(n * 10) / 10;
  const score = Math.round(Object.values(parts).reduce((a, b) => a + b, 0));
  return { score: Math.max(0, Math.min(100, score)), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v)])) as QualityResult["parts"], notes };
}
