import { jaccard, normalizeCompany, normalizeTitle, shingles, titleSimilarity } from "./normalize";

// Canonical deduplication of the same opening seen on several sources (company site, ATS, aggregators).
// Pure and deterministic; the pipeline decides what to merge using `compareJobs`.

export type DedupeJob = {
  sourceId?: string | null;
  sourceJobId?: string | null;
  canonicalUrl?: string | null;
  companyName: string;
  title: string;
  city?: string | null;
  country?: string | null;
  remoteType?: string | null;
  description: string;
  postedAt?: Date | null;
};

export type DedupeResult = { duplicate: boolean; probability: number; reasons: string[] };

export const THRESHOLDS = { titleMin: 0.75, companyMin: 0.8, descStrong: 0.6, descWeak: 0.35, maxPostingGapDays: 60 };

const norm = (s?: string | null) => (s ?? "").toLowerCase().trim();

function companySimilarity(a: string, b: string) {
  const ka = normalizeCompany(a);
  const kb = normalizeCompany(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  return jaccard(new Set(ka.split(" ")), new Set(kb.split(" ")));
}

function locationCompat(a: DedupeJob, b: DedupeJob): { ok: boolean; sameCity: boolean; score: number } {
  const ca = norm(a.city);
  const cb = norm(b.city);
  const sameCity = !!ca && ca === cb;
  const bothUnknown = !ca && !cb && !a.country && !b.country;
  const remoteEither = a.remoteType === "REMOTE" || b.remoteType === "REMOTE";
  const sameCountry = !!a.country && norm(a.country) === norm(b.country);
  if (sameCity) return { ok: true, sameCity, score: 1 };
  if (remoteEither && (sameCountry || !a.country || !b.country)) return { ok: true, sameCity, score: 0.7 };
  if (bothUnknown || ((!ca || !cb) && (sameCountry || !a.country || !b.country))) return { ok: true, sameCity, score: 0.5 };
  return { ok: false, sameCity, score: 0 };
}

/** Pre-computed shingles let the pipeline compare one new job against many candidates cheaply. */
export function descriptionShingles(text: string) {
  return shingles(text.slice(0, 6000));
}

export function compareJobs(a: DedupeJob, b: DedupeJob, shA = descriptionShingles(a.description), shB = descriptionShingles(b.description)): DedupeResult {
  const reasons: string[] = [];
  if (a.sourceId && a.sourceId === b.sourceId && a.sourceJobId && a.sourceJobId === b.sourceJobId) return { duplicate: true, probability: 1, reasons: ["same source job id"] };
  if (a.canonicalUrl && a.canonicalUrl === b.canonicalUrl) return { duplicate: true, probability: 1, reasons: ["same canonical URL"] };

  const company = companySimilarity(a.companyName, b.companyName);
  const title = titleSimilarity(a.title, b.title);
  const titleEqual = normalizeTitle(a.title) === normalizeTitle(b.title);
  const loc = locationCompat(a, b);
  const desc = jaccard(shA, shB);
  const gapDays = a.postedAt && b.postedAt ? Math.abs(a.postedAt.getTime() - b.postedAt.getTime()) / 86400_000 : 0;
  const dateOk = gapDays <= THRESHOLDS.maxPostingGapDays;
  const dateScore = a.postedAt && b.postedAt ? Math.max(0, 1 - gapDays / (THRESHOLDS.maxPostingGapDays * 2)) : 0.5;

  const probability = Math.round((title * 0.3 + company * 0.2 + loc.score * 0.15 + desc * 0.3 + dateScore * 0.05) * 100) / 100;

  if (company < THRESHOLDS.companyMin) return { duplicate: false, probability, reasons: ["different company"] };
  if (!(titleEqual || title >= THRESHOLDS.titleMin)) return { duplicate: false, probability, reasons: ["different title"] };
  if (!loc.ok) return { duplicate: false, probability, reasons: ["different location"] };
  if (!dateOk) return { duplicate: false, probability, reasons: ["posted too far apart"] };

  reasons.push(`company ${company.toFixed(2)}`, `title ${title.toFixed(2)}`, `description ${desc.toFixed(2)}`, loc.sameCity ? "same city" : "compatible location");
  const strong = desc >= THRESHOLDS.descStrong;
  const weak = desc >= THRESHOLDS.descWeak && titleEqual && loc.sameCity;
  return { duplicate: strong || weak, probability, reasons };
}

/** Which of two duplicate rows should be the canonical one. Higher reliability first, then richer, then older. */
export function pickCanonical<T extends { reliability: number; descriptionLength: number; discoveredAt: Date; isNative?: boolean }>(a: T, b: T): T {
  if (a.isNative !== b.isNative) return a.isNative ? a : b; // a native CareerPoint posting always wins (applications stay in-app)
  if (a.reliability !== b.reliability) return a.reliability > b.reliability ? a : b;
  if (Math.abs(a.descriptionLength - b.descriptionLength) > 300) return a.descriptionLength > b.descriptionLength ? a : b;
  return a.discoveredAt <= b.discoveredAt ? a : b;
}
