// Scoring configuration. Every weight lives here — nothing in the engine hardcodes points.
// Bump RUBRIC_VERSION when weights, groups or checks change so historical scores stay interpretable.

export const RUBRIC_VERSION = 2;

export const DIMENSION_KEYS = [
  "atsParseability",
  "bimTerminology",
  "roleClarity",
  "responsibilityEvidence",
  "softwareEvidence",
  "projectSpecificity",
  "projectComplexity",
  "quantifiedAchievements",
  "careerProgression",
  "disciplineCoverage",
  "industryExposure",
  "certifications",
  "education",
  "portfolio",
  "chronology",
  "formatting",
  "sectionCompleteness",
  "keywordRelevance",
  "achievementQuality",
] as const;

export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export type GroupDef = { key: string; label: string; dimensions: DimensionKey[] };

export type ScoringConfig = {
  /** Relative weights. They are normalised to sum to 100, so editing one does not silently break the total. */
  weights: Record<DimensionKey, number>;
  /** Display groups used for the headline breakdown. */
  groups: GroupDef[];
  /** Admin overrides for the numeric expectations of each benchmark role. */
  benchmark?: Record<string, BenchmarkTuning>;
};

export type BenchmarkTuning = { expectedQuantified?: number; expectedProjects?: number; expectedCertifications?: number; typicalYears?: [number, number] };

export const DEFAULT_WEIGHTS: Record<DimensionKey, number> = {
  atsParseability: 5,
  bimTerminology: 8,
  roleClarity: 5,
  responsibilityEvidence: 10,
  softwareEvidence: 10,
  projectSpecificity: 6,
  projectComplexity: 5,
  quantifiedAchievements: 8,
  careerProgression: 5,
  disciplineCoverage: 4,
  industryExposure: 3,
  certifications: 5,
  education: 3,
  portfolio: 7,
  chronology: 4,
  formatting: 3,
  sectionCompleteness: 4,
  keywordRelevance: 3,
  achievementQuality: 2,
};

export const DEFAULT_GROUPS: GroupDef[] = [
  { key: "experience", label: "BIM Experience", dimensions: ["roleClarity", "responsibilityEvidence", "careerProgression", "disciplineCoverage", "industryExposure"] },
  { key: "software", label: "Software Evidence", dimensions: ["softwareEvidence", "keywordRelevance"] },
  { key: "projects", label: "Project Evidence", dimensions: ["projectSpecificity", "projectComplexity"] },
  { key: "achievements", label: "Achievements", dimensions: ["quantifiedAchievements", "achievementQuality"] },
  { key: "terminology", label: "BIM Terminology", dimensions: ["bimTerminology"] },
  { key: "credentials", label: "Certifications & Education", dimensions: ["certifications", "education"] },
  { key: "portfolio", label: "Portfolio", dimensions: ["portfolio"] },
  { key: "structure", label: "ATS & Structure", dimensions: ["atsParseability", "chronology", "formatting", "sectionCompleteness"] },
];

export const DEFAULT_CONFIG: ScoringConfig = { weights: DEFAULT_WEIGHTS, groups: DEFAULT_GROUPS };

/** Returns weights scaled to sum exactly 100 (largest-remainder rounding to integers). */
export function normalizeWeights(w: Record<DimensionKey, number>): Record<DimensionKey, number> {
  const total = DIMENSION_KEYS.reduce((n, k) => n + Math.max(0, w[k] ?? 0), 0);
  if (total <= 0) throw new Error("Scoring weights must sum to more than zero");
  const raw = DIMENSION_KEYS.map((k) => ({ k, v: (Math.max(0, w[k] ?? 0) / total) * 100 }));
  const floored = raw.map((r) => ({ ...r, f: Math.floor(r.v), rem: r.v - Math.floor(r.v) }));
  let left = 100 - floored.reduce((n, r) => n + r.f, 0);
  for (const r of [...floored].sort((a, b) => b.rem - a.rem)) {
    if (left <= 0) break;
    r.f += 1;
    left--;
  }
  return Object.fromEntries(floored.map((r) => [r.k, r.f])) as Record<DimensionKey, number>;
}
