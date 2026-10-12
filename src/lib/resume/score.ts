// Compatibility layer over the v2 scoring engine (src/lib/scoring). Kept so existing call sites keep working.
import type { ResumeContent } from "./types";
import { scoreResume as engine, scoreLabel, type Group, type ScoreInput, type ScoreResult, type Suggestion } from "@/lib/scoring/engine";
import { RUBRIC_VERSION, type ScoringConfig } from "@/lib/scoring/config";

export { RUBRIC_VERSION, scoreLabel };
export type { Suggestion, Group, ScoreResult };

export type ScoreCategory = { key: string; label: string; score: number; max: number; detail: string; evidence: string[] };

export type ResumeScoreResult = ScoreResult & { breakdown: ScoreCategory[] };

export function scoreResume(input: ResumeContent | ScoreInput, config?: ScoringConfig): ResumeScoreResult {
  const si: ScoreInput = "content" in input ? input : { content: input };
  const r = engine(si, config);
  const breakdown: ScoreCategory[] = r.groups.map((g) => ({ key: g.key, label: g.label, score: Math.round(g.score * 10) / 10, max: g.max, detail: g.evidence[0] ?? "", evidence: g.evidence }));
  return { ...r, breakdown };
}

export const SCORE_MAX = 100;
