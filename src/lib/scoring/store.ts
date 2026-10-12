import { db } from "@/lib/db";
import { DEFAULT_CONFIG, DEFAULT_WEIGHTS, DIMENSION_KEYS, normalizeWeights, type BenchmarkTuning, type DimensionKey, type ScoringConfig } from "./config";
import { ROLE_BENCHMARKS } from "./benchmark";

// Admin-editable scoring weights. The table is append-only: the highest version is live and older rows are the history.
// Version 0 means "built-in defaults" (nothing saved yet). Scoring stays deterministic: same weights + same resume = same score.

export type ActiveScoring = { config: ScoringConfig; version: number; weights: Record<DimensionKey, number>; benchmark: Record<string, BenchmarkTuning> };

let cache: { at: number; value: ActiveScoring } | null = null;
const TTL_MS = 30_000;
export const resetScoringCache = () => (cache = null);

export function parseWeights(raw: unknown): Record<DimensionKey, number> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as Record<DimensionKey, number>;
  for (const k of DIMENSION_KEYS) {
    const v = Number(o[k]);
    out[k] = Number.isFinite(v) && v >= 0 ? Math.min(100, v) : DEFAULT_WEIGHTS[k];
  }
  return out;
}

const int = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
};

/** Sanitises stored/submitted benchmark overrides: known roles and sane numeric ranges only. */
export function parseBenchmark(raw: unknown): Record<string, BenchmarkTuning> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown>>;
  const out: Record<string, BenchmarkTuning> = {};
  for (const r of ROLE_BENCHMARKS) {
    const v = o[r.id];
    if (!v || typeof v !== "object") continue;
    const t: BenchmarkTuning = {};
    const q = int(v.expectedQuantified, 0, 30), p = int(v.expectedProjects, 0, 20), c = int(v.expectedCertifications, 0, 10);
    if (q !== undefined) t.expectedQuantified = q;
    if (p !== undefined) t.expectedProjects = p;
    if (c !== undefined) t.expectedCertifications = c;
    const ty = Array.isArray(v.typicalYears) ? [int(v.typicalYears[0], 0, 50), int(v.typicalYears[1], 0, 60)] : [];
    if (ty[0] !== undefined && ty[1] !== undefined && ty[0] <= ty[1]) t.typicalYears = [ty[0], ty[1]];
    if (Object.keys(t).length) out[r.id] = t;
  }
  return out;
}

export async function getScoringConfig(): Promise<ActiveScoring> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await db.scoringConfigVersion.findFirst({ orderBy: { version: "desc" } });
  const weights = row ? parseWeights(row.weights) : { ...DEFAULT_WEIGHTS };
  const benchmark = row ? parseBenchmark(row.benchmark) : {};
  const value: ActiveScoring = { config: { ...DEFAULT_CONFIG, weights, benchmark }, version: row?.version ?? 0, weights, benchmark };
  cache = { at: Date.now(), value };
  return value;
}

export class ScoringConfigError extends Error {}

/** Saves a new live version. Weights are relative (they are normalised to 100 when scoring), but must be valid numbers. */
export async function saveScoringConfig(adminId: string, input: Record<string, unknown>, note?: string | null, benchmarkInput?: unknown) {
  const weights = {} as Record<DimensionKey, number>;
  for (const k of DIMENSION_KEYS) {
    const raw = input[k];
    const v = typeof raw === "string" ? Number(raw) : (raw as number);
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new ScoringConfigError(`Weight for "${k}" must be a number between 0 and 100.`);
    weights[k] = v;
  }
  if (DIMENSION_KEYS.reduce((n, k) => n + weights[k], 0) <= 0) throw new ScoringConfigError("At least one weight must be above zero.");
  const last = await db.scoringConfigVersion.findFirst({ orderBy: { version: "desc" }, select: { version: true } });
  const row = await db.scoringConfigVersion.create({ data: { version: (last?.version ?? 0) + 1, weights, note: note?.trim().slice(0, 300) || null, createdById: adminId, benchmark: parseBenchmark(benchmarkInput ?? (await getScoringConfig()).benchmark) as never } });
  resetScoringCache();
  return { version: row.version, normalized: normalizeWeights(weights) };
}

export async function scoringHistory(limit = 20) {
  return db.scoringConfigVersion.findMany({ orderBy: { version: "desc" }, take: limit });
}
