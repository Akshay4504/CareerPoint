import { describe, expect, it } from "vitest";
import { scoreResume } from "@/lib/scoring/engine";
import { DEFAULT_CONFIG, DEFAULT_WEIGHTS, DIMENSION_KEYS, normalizeWeights, type DimensionKey } from "@/lib/scoring/config";
import { applyCalibration, benchmarkById, calibrate, inferBenchmarkRole, ROLE_BENCHMARKS } from "@/lib/scoring/benchmark";
import { scoreJobMatch, JOB_SCORE_DISCLAIMER, type JobScoreJob, type JobScoreProfile } from "@/lib/scoring/job";
import { parseResumeText } from "@/lib/resume/parse";
import { emptyResume, type ResumeContent } from "@/lib/resume/types";
import { SAMPLE } from "./sample";

const strong = parseResumeText(SAMPLE);

describe("scoring engine: structure", () => {
  it("weights sum to exactly 100 and every dimension is weighted", () => {
    const n = normalizeWeights(DEFAULT_WEIGHTS);
    expect(DIMENSION_KEYS.reduce((s, k) => s + n[k], 0)).toBe(100);
    expect(DIMENSION_KEYS.length).toBe(19);
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("weights are configurable and always renormalised to 100", () => {
    const w = { ...DEFAULT_WEIGHTS, portfolio: 50 } as Record<DimensionKey, number>;
    const n = normalizeWeights(w);
    expect(DIMENSION_KEYS.reduce((s, k) => s + n[k], 0)).toBe(100);
    expect(n.portfolio).toBeGreaterThan(DEFAULT_WEIGHTS.portfolio);
    const heavy = scoreResume({ content: strong, portfolioCount: 0 }, { ...DEFAULT_CONFIG, weights: w });
    const base = scoreResume({ content: strong, portfolioCount: 0 });
    expect(heavy.total).toBeLessThan(base.total); // no portfolio, and portfolio now matters more
    expect(() => normalizeWeights(Object.fromEntries(DIMENSION_KEYS.map((k) => [k, 0])) as Record<DimensionKey, number>)).toThrow();
  });
  it("groups cover every dimension exactly once and total 100", () => {
    const r = scoreResume({ content: strong });
    const keys = r.groups.flatMap((g) => g.dimensions.map((d) => d.key)).sort();
    expect(keys).toEqual([...DIMENSION_KEYS].sort());
    expect(r.groups.reduce((s, g) => s + g.max, 0)).toBe(100);
    expect(r.dimensions.reduce((s, d) => s + d.max, 0)).toBe(100);
  });
  it("is deterministic and bounded", () => {
    const a = scoreResume({ content: strong, portfolioCount: 2 }, DEFAULT_CONFIG, new Date("2026-01-01"));
    const b = scoreResume({ content: strong, portfolioCount: 2 }, DEFAULT_CONFIG, new Date("2026-01-01"));
    expect(a).toEqual(b);
    expect(a.total).toBeGreaterThanOrEqual(0);
    expect(a.total).toBeLessThanOrEqual(100);
    expect(a.dimensions.every((d) => d.score >= 0 && d.score <= d.max)).toBe(true);
  });
});

describe("scoring engine: behaviour and honest evidence", () => {
  it("scores empty resumes near zero and a rich one well", () => {
    expect(scoreResume({ content: emptyResume() }).total).toBeLessThan(5);
    expect(scoreResume({ content: strong, portfolioCount: 3 }).total).toBeGreaterThan(60);
  });
  it("every evidence line is backed by the resume (counts match the data)", () => {
    const r = scoreResume({ content: strong, portfolioCount: 0 });
    const d = Object.fromEntries(r.dimensions.map((x) => [x.key, x]));
    expect(d.certifications.evidence[0]).toContain(`${strong.certifications.length} certification`);
    expect(d.softwareEvidence.evidence[0]).toContain(`${strong.software.length} BIM software`);
    expect(d.portfolio.evidence[0]).toContain("0 portfolio");
    expect(d.projectSpecificity.evidence[0]).toContain(`${strong.projects.length} project`);
    expect(d.softwareEvidence.evidence.join(" ")).toMatch(/Revit/);
  });
  it("does not invent evidence: no portfolio, no points; no certs, no points", () => {
    const r = scoreResume({ content: { ...strong, certifications: [], links: [] }, portfolioCount: 0 });
    const d = Object.fromEntries(r.dimensions.map((x) => [x.key, x]));
    expect(d.portfolio.score).toBe(0);
    expect(d.certifications.score).toBe(0);
    expect(d.certifications.gaps.length).toBeGreaterThan(0);
  });
  it("rewards quantified achievements measurably", () => {
    const vague: ResumeContent = { ...strong, experiences: strong.experiences.map((e) => ({ ...e, description: "• Coordinated models\n• Worked with teams\n• Helped with drawings" })) };
    const q = (c: ResumeContent) => scoreResume({ content: c }).dimensions.find((d) => d.key === "quantifiedAchievements")!;
    expect(q(strong).score).toBeGreaterThan(q(vague).score);
    expect(q(vague).gaps[0]).toMatch(/Quantify/);
  });
  it("portfolio items raise the portfolio dimension", () => {
    const p = (n: number) => scoreResume({ content: strong, portfolioCount: n }).dimensions.find((d) => d.key === "portfolio")!.score;
    expect(p(3)).toBeGreaterThan(p(1));
    expect(p(1)).toBeGreaterThan(p(0));
  });
  it("uses raw text for ATS/formatting only when available", () => {
    const f = scoreResume({ content: strong, rawText: SAMPLE }).dimensions.find((d) => d.key === "formatting")!;
    expect(f.evidence[0]).toMatch(/bullet line/);
    const noRaw = scoreResume({ content: strong }).dimensions.find((d) => d.key === "formatting")!;
    expect(noRaw.evidence[0]).toMatch(/structured data/);
  });
  it("detects chronology problems", () => {
    const bad: ResumeContent = { ...strong, experiences: [{ title: "BIM Modeler", company: "A" }, { title: "BIM Coordinator", company: "B", startDate: "2015-01", endDate: "2016-01" }] };
    const c = scoreResume({ content: bad }).dimensions.find((d) => d.key === "chronology")!;
    expect(c.score).toBeLessThan(c.max);
    expect(c.gaps.join(" ")).toMatch(/start and end date/);
  });
});

describe("benchmark", () => {
  it("is explicitly expert-curated, never presented as a dataset of best resumes", async () => {
    const { BENCHMARK_META } = await import("@/lib/scoring/benchmark");
    expect(BENCHMARK_META.source).toBe("expert-curated");
    expect(BENCHMARK_META.description).toMatch(/not derived/i);
  });
  it("infers the benchmark role from titles, preferring the most specific match", () => {
    expect(inferBenchmarkRole("Senior BIM Coordinator").id).toBe("coordinator");
    expect(inferBenchmarkRole(null, "Head of BIM").id).toBe("manager");
    expect(inferBenchmarkRole("Revit Technician").id).toBe("modeler");
    expect(inferBenchmarkRole("Chef").id).toBe("general");
    expect(benchmarkById("nope").id).toBe("general");
  });
  it("the target role changes keyword relevance", () => {
    const c: ResumeContent = { ...emptyResume(), headline: "BIM Professional", software: ["Revit", "Navisworks"], skills: ["Clash Detection"] };
    const kr = (role: string) => scoreResume({ content: c, targetRole: role }).dimensions.find((d) => d.key === "keywordRelevance")!.score;
    expect(kr("BIM Coordinator")).toBeGreaterThan(kr("BIM Manager"));
  });
  it("calibration only overrides roles that have enough reviewed samples", () => {
    const sample = (n: number) => Array.from({ length: n }, () => ({ role: "coordinator", resume: { ...strong, projects: Array(5).fill(strong.projects[0]) } }));
    expect(calibrate(sample(5))).toEqual({});
    const o = calibrate(sample(25));
    expect(o.coordinator.sampleSize).toBe(25);
    const merged = applyCalibration(ROLE_BENCHMARKS, o);
    expect(merged.find((r) => r.id === "coordinator")!.expectedProjects).toBe(5);
    expect(merged.find((r) => r.id === "manager")).toEqual(ROLE_BENCHMARKS.find((r) => r.id === "manager"));
  });
});

describe("job-specific score", () => {
  const profile: JobScoreProfile = { software: ["Revit", "Navisworks", "Dynamo"], skills: ["Clash Detection", "BIM Coordination"], titles: ["Senior BIM Coordinator"], yearsExperience: 8, discipline: "MEP", location: "London, UK", country: "UK", industries: ["Healthcare"], projects: [{ name: "City Hospital", sector: "Healthcare", software: ["Revit", "Navisworks"], description: "MEP coordination" }] };
  const job: JobScoreJob = { title: "BIM Coordinator (MEP)", description: "Coordinate MEP models in Revit and Navisworks for hospital projects. ISO 19650 and Civil 3D desirable. 5+ years.", software: ["Revit", "Navisworks", "Civil 3D"], skills: ["BIM Coordination", "ISO 19650"], seniority: "Senior", discipline: "MEP", location: "London, UK", country: "UK", remote: false };

  it("breaks the score into the eight components with the stated weights", () => {
    const r = scoreJobMatch(profile, job);
    expect(r.components.map((c) => c.key)).toEqual(["role", "software", "experience", "skills", "location", "industry", "projects", "preference"]);
    expect(r.components.reduce((n, c) => n + c.max, 0)).toBe(100);
    expect(r.total).toBeGreaterThan(60);
  });
  it("lists exactly what matched and what is missing — no more, no less", () => {
    const r = scoreJobMatch(profile, job);
    expect(r.matched).toEqual(["Revit", "Navisworks", "BIM Coordination"]);
    expect(r.missing).toEqual(["Civil 3D", "ISO 19650"]);
  });
  it("always carries the non-prediction disclaimer", () => {
    const r = scoreJobMatch(profile, job);
    expect(r.disclaimer).toBe(JOB_SCORE_DISCLAIMER);
    expect(r.disclaimer.toLowerCase()).toContain("not a prediction");
    expect(JSON.stringify(r).toLowerCase()).not.toMatch(/probability|chance of (being )?hired/);
  });
  it("drops to a low score for a mismatched candidate and ignores components it cannot evaluate", () => {
    const weak = scoreJobMatch({ ...profile, software: ["SketchUp"], skills: [], titles: ["Interior Designer"], yearsExperience: 1, location: "Sydney", country: "Australia", industries: [], projects: [] }, job);
    expect(weak.total).toBeLessThan(25);
    const sparse = scoreJobMatch({ software: [], skills: [], titles: [], industries: [], projects: [] }, { ...job, software: [], skills: [], description: "A role.", title: "Role", seniority: null });
    expect(sparse.components.filter((c) => c.applicable).length).toBeLessThan(8);
    expect(sparse.total).toBeGreaterThanOrEqual(0);
  });
  it("is deterministic", () => {
    expect(scoreJobMatch(profile, job)).toEqual(scoreJobMatch(profile, job));
  });
});
