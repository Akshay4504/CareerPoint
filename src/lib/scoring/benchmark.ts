// Expert-curated benchmark for BIM resumes.
//
// PROVENANCE — read before quoting this anywhere:
//   These expectations were written by hand to describe what a strong resume for each BIM role typically
//   demonstrates. They are NOT derived from, and do not claim to represent, "the best BIM resumes".
//   To ground them in data, reviewers can supply anonymised, structured resumes (ResumeContent JSON) and run
//   `npm run benchmark:calibrate`; the output (src/lib/scoring/benchmark.generated.json) overrides the
//   curated numbers below for any role that has at least MIN_SAMPLE reviewed resumes.

import type { ResumeContent } from "@/lib/resume/types";
import { findTaxonomyMatches, BIM_SKILLS } from "@/lib/taxonomy";

export type RoleBenchmark = {
  id: string;
  label: string;
  /** Title keywords used to recognise the role. */
  titleHints: string[];
  coreSoftware: string[];
  commonSoftware: string[];
  coreSkills: string[];
  standards: string[];
  /** Typical years of experience for a strong resume at this role (informational + progression checks). */
  typicalYears: [number, number];
  /** Quantified achievement lines a strong resume usually contains. */
  expectedQuantified: number;
  expectedProjects: number;
  expectedCertifications: number;
};

export const BENCHMARK_META = {
  source: "expert-curated" as const,
  description: "Hand-written expectations per BIM role. Not derived from a resume dataset unless calibrated.",
  minSampleForOverride: 20,
};

export const ROLE_BENCHMARKS: RoleBenchmark[] = [
  { id: "coordinator", label: "BIM Coordinator", titleHints: ["bim coordinator", "coordinator", "model coordinator"], coreSoftware: ["Revit", "Navisworks"], commonSoftware: ["Solibri", "BIM 360", "Autodesk Construction Cloud", "BIMcollab", "Dynamo"], coreSkills: ["Clash Detection", "BIM Coordination", "Model Auditing"], standards: ["ISO 19650", "IFC", "COBie", "BIM Execution Plan"], typicalYears: [3, 10], expectedQuantified: 4, expectedProjects: 3, expectedCertifications: 1 },
  { id: "modeler", label: "BIM Modeler", titleHints: ["bim modeler", "bim modeller", "modeler", "modeller", "revit technician", "bim technician", "drafter", "draftsman"], coreSoftware: ["Revit", "AutoCAD"], commonSoftware: ["Navisworks", "Dynamo", "Tekla Structures", "SketchUp"], coreSkills: ["Family Creation", "Construction Documentation", "Shop Drawings"], standards: ["LOD", "IFC"], typicalYears: [1, 6], expectedQuantified: 3, expectedProjects: 3, expectedCertifications: 1 },
  { id: "engineer", label: "BIM Engineer", titleHints: ["bim engineer", "vdc engineer", "design technologist", "digital engineer"], coreSoftware: ["Revit", "Navisworks"], commonSoftware: ["Dynamo", "Python", "Solibri", "Synchro"], coreSkills: ["BIM Coordination", "Parametric Design", "Model Auditing"], standards: ["ISO 19650", "IFC", "LOD"], typicalYears: [3, 10], expectedQuantified: 4, expectedProjects: 3, expectedCertifications: 1 },
  { id: "manager", label: "BIM Manager", titleHints: ["bim manager", "head of bim", "bim lead", "bim director", "information manager", "digital delivery"], coreSoftware: ["Revit", "Navisworks"], commonSoftware: ["Autodesk Construction Cloud", "BIM 360", "Solibri", "ProjectWise", "Power BI"], coreSkills: ["BIM Management", "BIM Standards", "Team Leadership", "Common Data Environment"], standards: ["ISO 19650", "BIM Execution Plan", "COBie", "IFC", "openBIM"], typicalYears: [7, 25], expectedQuantified: 5, expectedProjects: 4, expectedCertifications: 2 },
  { id: "revit-specialist", label: "Revit Specialist", titleHints: ["revit specialist", "revit expert", "revit architect", "revit developer"], coreSoftware: ["Revit", "Dynamo"], commonSoftware: ["C#", "Python", "Navisworks", "AutoCAD"], coreSkills: ["Family Creation", "Parametric Design", "Visual Programming"], standards: ["LOD", "IFC"], typicalYears: [3, 15], expectedQuantified: 4, expectedProjects: 3, expectedCertifications: 1 },
  { id: "vdc", label: "VDC / Construction BIM", titleHints: ["vdc", "construction bim", "4d", "5d"], coreSoftware: ["Navisworks", "Revit"], commonSoftware: ["Synchro", "Primavera", "Procore", "Autodesk Construction Cloud"], coreSkills: ["4D Simulation", "Quantity Takeoff", "BIM Coordination"], standards: ["LOD", "IFC"], typicalYears: [3, 15], expectedQuantified: 5, expectedProjects: 3, expectedCertifications: 1 },
  { id: "general", label: "BIM professional", titleHints: [], coreSoftware: ["Revit"], commonSoftware: ["Navisworks", "AutoCAD", "Solibri", "Dynamo"], coreSkills: ["BIM Coordination", "Clash Detection"], standards: ["ISO 19650", "IFC", "LOD"], typicalYears: [1, 15], expectedQuantified: 3, expectedProjects: 3, expectedCertifications: 1 },
];

export const BENCHMARK_ROLES_FOR_TARGETING = ROLE_BENCHMARKS.filter((r) => r.id !== "general");

export function benchmarkById(id?: string | null): RoleBenchmark {
  return ROLE_BENCHMARKS.find((r) => r.id === id) ?? ROLE_BENCHMARKS[ROLE_BENCHMARKS.length - 1];
}

/** Picks the benchmark role that best matches a free-text role (target role, headline or latest title). */
export function inferBenchmarkRole(...texts: Array<string | undefined | null>): RoleBenchmark {
  const t = texts.filter(Boolean).join(" | ").toLowerCase();
  let best: RoleBenchmark | null = null;
  let bestLen = 0;
  for (const r of ROLE_BENCHMARKS) {
    for (const h of r.titleHints) {
      if (t.includes(h) && h.length > bestLen) {
        best = r;
        bestLen = h.length;
      }
    }
  }
  return best ?? benchmarkById("general");
}

// ---- Optional calibration from a reviewed dataset ------------------------------------------------------------

export type CalibrationOverride = Partial<Pick<RoleBenchmark, "expectedQuantified" | "expectedProjects" | "expectedCertifications" | "typicalYears">> & { sampleSize: number };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Derives per-role medians from reviewer-supplied resumes. Pure: pass the samples in. */
export function calibrate(samples: Array<{ role: string; resume: ResumeContent }>): Record<string, CalibrationOverride> {
  const byRole = new Map<string, ResumeContent[]>();
  for (const s of samples) byRole.set(s.role, [...(byRole.get(s.role) ?? []), s.resume]);
  const out: Record<string, CalibrationOverride> = {};
  for (const [role, rs] of byRole) {
    if (rs.length < BENCHMARK_META.minSampleForOverride) continue;
    const quant = rs.map((r) => r.experiences.flatMap((e) => (e.description ?? "").split("\n")).filter((l) => /\d/.test(l)).length);
    const years = rs.map((r) => r.yearsExperience ?? 0).filter(Boolean);
    out[role] = {
      sampleSize: rs.length,
      expectedQuantified: Math.max(1, median(quant)),
      expectedProjects: Math.max(1, median(rs.map((r) => r.projects.length))),
      expectedCertifications: median(rs.map((r) => r.certifications.length)),
      ...(years.length ? { typicalYears: [Math.min(...years), Math.max(...years)] as [number, number] } : {}),
    };
  }
  return out;
}

export function applyCalibration(base: RoleBenchmark[], overrides: Record<string, CalibrationOverride>): RoleBenchmark[] {
  return base.map((r) => {
    const o = overrides[r.id];
    return o && o.sampleSize >= BENCHMARK_META.minSampleForOverride ? { ...r, ...o } : r;
  });
}

export const benchmarkSkillNames = (text: string) => findTaxonomyMatches(text, BIM_SKILLS);
