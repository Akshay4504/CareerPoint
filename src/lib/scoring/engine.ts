import type { ResumeContent } from "@/lib/resume/types";
import { BIM_SKILLS, BIM_SOFTWARE, SECTORS, findTaxonomyMatches, inferDiscipline, inferSeniority } from "@/lib/taxonomy";
import { applyCalibration, inferBenchmarkRole, ROLE_BENCHMARKS, type CalibrationOverride, type RoleBenchmark } from "./benchmark";
import generated from "./benchmark.generated.json";
import { DEFAULT_CONFIG, DIMENSION_KEYS, RUBRIC_VERSION, normalizeWeights, type DimensionKey, type ScoringConfig } from "./config";

// Deterministic BIM resume scoring. Pure function of its input: no randomness, no network, no LLM.
// Every dimension reports the evidence it counted; nothing is inferred beyond what is present in the resume.

export type ScoreInput = {
  content: ResumeContent;
  /** Original extracted text, when the resume was uploaded. Enables formatting / ATS checks on the real document. */
  rawText?: string | null;
  /** Number of portfolio projects/items the candidate has published or attached. */
  portfolioCount?: number;
  /** Role the resume is aimed at (e.g. from a targeted version). Falls back to the headline / latest title. */
  targetRole?: string | null;
};

export type Dimension = { key: DimensionKey; label: string; score: number; max: number; evidence: string[]; gaps: string[] };
export type Group = { key: string; label: string; score: number; max: number; dimensions: Dimension[]; evidence: string[] };
export type Suggestion = { category: string; message: string; impact: number };

export type ScoreResult = {
  total: number;
  groups: Group[];
  dimensions: Dimension[];
  suggestions: Suggestion[];
  rubricVersion: number;
  benchmarkRole: { id: string; label: string };
};

export const LABELS: Record<DimensionKey, string> = {
  atsParseability: "ATS parseability",
  bimTerminology: "BIM terminology",
  roleClarity: "Role clarity",
  responsibilityEvidence: "BIM responsibility evidence",
  softwareEvidence: "Software evidence",
  projectSpecificity: "Project specificity",
  projectComplexity: "Project complexity",
  quantifiedAchievements: "Quantified achievements",
  careerProgression: "Career progression",
  disciplineCoverage: "Discipline coverage",
  industryExposure: "Industry exposure",
  certifications: "Certifications",
  education: "Education",
  portfolio: "Portfolio",
  chronology: "Chronology",
  formatting: "Formatting",
  sectionCompleteness: "Section completeness",
  keywordRelevance: "Keyword relevance",
  achievementQuality: "Achievement quality",
};

const BIM_TERMS = ["bim", "federated model", "clash", "lod", "level of development", "cobie", "ifc", "cde", "common data environment", "bep", "execution plan", "eir", "midp", "tidp", "information requirements", "model audit", "model checking", "4d", "5d", "scan to bim", "point cloud", "digital twin", "parametric", "families", "iso 19650", "openbim", "information management", "coordination", "quantity take"];
const RESPONSIBILITY_RE = /\b(coordinat\w*|model(?:l)?ing|modell?ed|clash\w*|audit\w*|standards?|execution plan|bep|issue[sd]?|federat\w*|qa\/?qc|quality|manage[ds]?|lead|led|setup|set up|established|implemented|delivered|produced|authored|reviewed|validated|publish\w*|handover|cobie)\b/i;
const QUANT_RE = /(\d[\d,.]*\s?(%|m2|m²|sqm|sq\.?\s?ft|sf|k\b|m\b|million|\$|£|€|models?|projects?|clashes|sheets|disciplines|people|members|team|hours|weeks|days|trades|floors|storeys|buildings)|[$£€]\s?\d|\b\d{2,}\b)/i;
const ACTION_RE = /^[•\-*\s]*(led|managed|coordinated|developed|created|delivered|modell?ed|implemented|automated|reduced|improved|established|authored|audited|resolved|produced|designed|built|mentored|streamlined|saved|detected|trained|standardi[sz]ed|introduced|owned|drove|executed|prepared|reviewed|validated|set up|supported|checked|issued|published|migrated|integrated)\b/i;
const COMPLEXITY_RE = /\b(hospital|healthcare|data cent(?:er|re)s?|airport|rail|metro|tower|high[- ]rise|stadium|infrastructure|bridge|tunnel|pharma\w*|laboratory|campus|mixed[- ]use|multi[- ]?disciplin\w*|federated|fast[- ]track|refurbishment|heritage|offshore|power plant|industrial)\b/i;
const NAME_SECTIONS = ["summary", "experience", "skills", "education", "projects", "certifications"];

const lines = (s?: string) => (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
const bulletsOf = (c: ResumeContent) => c.experiences.flatMap((e) => lines(e.description));
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function fullText(c: ResumeContent) {
  return [c.headline, c.summary, ...c.experiences.flatMap((e) => [e.title, e.company, e.description]), ...c.projects.flatMap((p) => [p.name, p.role, p.sector, p.lod, p.description, p.outcomes, ...(p.software ?? [])]), ...c.skills, ...c.software, ...c.certifications].filter(Boolean).join("\n");
}

function monthIndex(ym?: string) {
  if (!ym) return null;
  const [y, m] = ym.split("-").map(Number);
  return Number.isFinite(y) && Number.isFinite(m) ? y * 12 + m - 1 : null;
}

const SENIORITY_RANK: Record<string, number> = { Intern: 0, Junior: 1, Mid: 2, Senior: 3, Lead: 4, Manager: 5, Director: 6 };

type Ctx = { c: ResumeContent; raw: string; portfolio: number; role: RoleBenchmark; text: string; bullets: string[]; now: Date };
type Result = { ratio: number; evidence: string[]; gaps: string[] };

const DIMS: Record<DimensionKey, (x: Ctx) => Result> = {
  atsParseability(x) {
    const { c } = x;
    const signals: [boolean, string][] = [
      [!!c.name, "name"],
      [!!c.email, "email"],
      [!!c.phone, "phone number"],
      [c.experiences.length > 0 && c.experiences.every((e) => !!e.startDate), "dated work history"],
      [findSections(c, x.raw) >= 3, "standard section headings"],
    ];
    const found = signals.filter((s) => s[0]);
    const missing = signals.filter((s) => !s[0]).map((s) => s[1]);
    const evidence = [`${found.length} of ${signals.length} machine-readable signals found${found.length ? ` (${found.map((s) => s[1]).join(", ")})` : ""}.`];
    return { ratio: found.length / signals.length, evidence, gaps: missing.length ? [`Missing or unreadable: ${missing.join(", ")}. Applicant tracking systems may not capture these.`] : [] };
  },

  bimTerminology(x) {
    const lower = x.text.toLowerCase();
    const termHits = BIM_TERMS.filter((t) => new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(lower));
    const skills = findTaxonomyMatches(x.text, BIM_SKILLS);
    const distinct = new Set([...termHits, ...skills.map((s) => s.toLowerCase())]);
    const target = 10;
    return {
      ratio: clamp01(distinct.size / target),
      evidence: [`${plural(distinct.size, "distinct BIM term")} used in your resume${distinct.size ? ` (e.g. ${[...distinct].slice(0, 5).join(", ")})` : ""}.`],
      gaps: distinct.size < target ? [`Use more of the BIM vocabulary you actually work with (clash detection, LOD, ISO 19650, COBie, CDE, BEP). ${target - distinct.size} more distinct terms would max this out.`] : [],
    };
  },

  roleClarity(x) {
    const { c, role } = x;
    const isRole = (t?: string) => !!t && /\b(bim|revit|vdc|modell?er|coordinator|technician|engineer|architect|manager|lead|specialist|designer|drafter|detailer|technologist|consultant|director)\b/i.test(t);
    const headlineOk = isRole(c.headline);
    const latest = c.experiences[0]?.title;
    const latestOk = isRole(latest);
    const evidence: string[] = [];
    if (headlineOk) evidence.push(`Headline states a role: “${c.headline}”.`);
    if (latestOk) evidence.push(`Most recent title “${latest}” is a recognisable BIM/AEC role.`);
    evidence.push(`Closest benchmark role: ${role.label}.`);
    return { ratio: ((headlineOk ? 1 : 0) + (latestOk ? 1 : 0)) / 2, evidence, gaps: [...(!headlineOk ? ["Add a headline naming your role, e.g. “BIM Coordinator | MEP | Revit & Navisworks”."] : []), ...(!latestOk && c.experiences.length ? ["Your most recent job title is not clearly a BIM/AEC role; clarify it or add a role headline."] : [])] };
  },

  responsibilityEvidence(x) {
    const hits = x.bullets.filter((b) => RESPONSIBILITY_RE.test(b));
    const rolesWith = x.c.experiences.filter((e) => lines(e.description).filter((l) => RESPONSIBILITY_RE.test(l)).length >= 2).length;
    const target = 8;
    const ratio = clamp01(hits.length / target) * 0.7 + clamp01(x.c.experiences.length ? rolesWith / Math.min(x.c.experiences.length, 3) : 0) * 0.3;
    return {
      ratio,
      evidence: [`${plural(hits.length, "responsibility statement")} describe BIM work across ${plural(rolesWith, "role")} with two or more.`],
      gaps: hits.length < target ? [`Describe what you were responsible for in each role (coordination, modelling, audits, standards, delivery). Aim for ${target}+ specific statements overall.`] : [],
    };
  },

  softwareEvidence(x) {
    const { c } = x;
    const listed = new Set(c.software);
    const roleText = c.experiences.map((e) => `${e.title}\n${e.description ?? ""}`);
    const projText = c.projects.map((p) => `${p.description ?? ""} ${(p.software ?? []).join(" ")}`);
    const evidenced = new Map<string, number>();
    for (const sw of listed) {
      const n = [...roleText, ...projText].filter((t) => findTaxonomyMatches(t, BIM_SOFTWARE).includes(sw)).length;
      if (n) evidenced.set(sw, n);
    }
    const breadth = clamp01(listed.size / 5);
    const proof = listed.size ? clamp01(evidenced.size / Math.min(listed.size, 4)) : 0;
    const top = [...evidenced.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      ratio: breadth * 0.5 + proof * 0.5,
      evidence: [
        `${plural(listed.size, "BIM software tool")} listed.`,
        top.length ? `Used in context: ${top.map(([s, n]) => `${s} (${plural(n, "role/project")})`).join(", ")}.` : "No listed tool is mentioned inside a role or project description.",
      ],
      gaps: [...(listed.size < 5 ? [`List the BIM tools you use — aim for at least 5 across authoring, coordination, CDE and automation.`] : []), ...(proof < 1 && listed.size ? ["Show software in action: mention the tool inside role and project bullets, not only in a skills list."] : [])],
    };
  },

  projectSpecificity(x) {
    const ps = x.c.projects;
    const detailed = ps.filter((p) => [p.role, p.sector, p.lod, p.year, p.scale].filter(Boolean).length >= 2 || (p.software?.length ?? 0) > 0).length;
    const target = x.role.expectedProjects;
    return {
      ratio: clamp01(ps.length / target) * 0.5 + clamp01(detailed / target) * 0.5,
      evidence: [`${plural(ps.length, "project")} listed; ${detailed} include specifics (role, sector, LOD, year, scale or software).`],
      gaps: [...(ps.length < target ? [`Add key projects — a strong ${x.role.label} resume usually shows ${target}.`] : []), ...(detailed < Math.min(ps.length, target) ? ["State role, sector, LOD, scale and software for each project."] : [])],
    };
  },

  projectComplexity(x) {
    const blob = [...x.c.projects.map((p) => `${p.name} ${p.sector ?? ""} ${p.lod ?? ""} ${p.description ?? ""} ${p.scale ?? ""}`), ...x.bullets].join("\n");
    const signals = new Set<string>();
    for (const m of blob.matchAll(new RegExp(COMPLEXITY_RE.source, "gi"))) signals.add(m[0].toLowerCase());
    if (/\bLOD\s?(350|400|500)\b/i.test(blob)) signals.add("high LOD");
    if (/\b\d+\s+(disciplines|trades)\b/i.test(blob)) signals.add("multi-trade coordination");
    if (/[$£€]\s?\d[\d.,]*\s?(m|million|bn|billion)|\d+\s?(m2|m²|sqm|sq\.? ?ft)/i.test(blob)) signals.add("stated scale or value");
    const target = 4;
    return {
      ratio: clamp01(signals.size / target),
      evidence: [signals.size ? `Complexity indicators found: ${[...signals].slice(0, 6).join(", ")}.` : "No project complexity indicators (building type, scale, trades, LOD) found."],
      gaps: signals.size < target ? ["Indicate complexity: building type (hospital, data centre, rail), area or value, number of trades coordinated, LOD level."] : [],
    };
  },

  quantifiedAchievements(x) {
    const q = x.bullets.filter((b) => QUANT_RE.test(b));
    const target = x.role.expectedQuantified;
    return {
      ratio: clamp01(q.length / target),
      evidence: [`${plural(q.length, "bullet")} contain a measurable outcome${q.length ? ` (e.g. “${q[0].replace(/^[•\-*\s]+/, "").slice(0, 90)}”)` : ""}.`],
      gaps: q.length < target ? [`Quantify results — models delivered, clashes resolved, hours saved, area, value, team size. A ${x.role.label} resume typically shows ${target}+.`] : [],
    };
  },

  careerProgression(x) {
    const rows = [...x.c.experiences].map((e) => ({ r: SENIORITY_RANK[inferSeniority(e.title) ?? ""] ?? null, s: monthIndex(e.startDate) ?? 0 })).filter((r) => r.r != null).sort((a, b) => a.s - b.s);
    if (x.c.experiences.length === 0) return { ratio: 0, evidence: ["No work history to assess."], gaps: ["Add work history with titles and dates."] };
    if (rows.length < 2) return { ratio: x.c.experiences.length === 1 ? 0.5 : 0.3, evidence: [`${plural(x.c.experiences.length, "role")} listed; not enough roles to show progression.`], gaps: [] };
    const first = rows[0].r!;
    const last = rows[rows.length - 1].r!;
    const rose = last > first;
    const ratio = rose ? 1 : last === first ? 0.6 : 0.4;
    return { ratio, evidence: [rose ? "Titles show upward progression over time." : "Titles stay at a similar level over time."], gaps: rose ? [] : ["If you took on more responsibility, reflect it in your titles or bullets (lead, senior, manager)."] };
  },

  disciplineCoverage(x) {
    const discs = new Set<string>();
    for (const e of x.c.experiences) {
      const d = inferDiscipline(`${e.title} ${e.description ?? ""}`);
      if (d) discs.add(d);
    }
    for (const p of x.c.projects) {
      const d = inferDiscipline(`${p.name} ${p.role ?? ""} ${p.description ?? ""}`);
      if (d) discs.add(d);
    }
    if (x.c.discipline) discs.add(x.c.discipline);
    const multi = /multi[- ]?disciplin\w*|\b\d+\s+disciplines\b/i.test(x.text);
    return {
      ratio: clamp01((discs.size + (multi ? 1 : 0)) / 2),
      evidence: [discs.size ? `Disciplines evidenced: ${[...discs].join(", ")}${multi ? "; multidisciplinary coordination mentioned" : ""}.` : "No discipline evidenced."],
      gaps: discs.size + (multi ? 1 : 0) < 2 ? ["Show the range of disciplines you've worked across (architecture, structure, MEP, civil) or mention multidisciplinary coordination."] : [],
    };
  },

  industryExposure(x) {
    const text = x.text.toLowerCase();
    const sectorWords: Record<string, RegExp> = { Healthcare: /health|hospital|clinic/, Commercial: /commercial|office|retail/, Residential: /residential|housing|apartment/, Education: /education|school|universit|campus/, Industrial: /industrial|factory|warehouse|plant/, "Data centers": /data cent/, Transport: /airport|rail|metro|transport|road|highway/, Energy: /energy|power|solar|wind|oil|gas/, Water: /water|wastewater/, "Mixed-use": /mixed[- ]use/ };
    const found = new Set<string>();
    for (const s of x.c.projects) if (s.sector && (SECTORS as readonly string[]).includes(s.sector)) found.add(s.sector);
    for (const [k, re] of Object.entries(sectorWords)) if (re.test(text)) found.add(k);
    return { ratio: clamp01(found.size / 2), evidence: [found.size ? `Industry sectors evidenced: ${[...found].join(", ")}.` : "No industry sector evidenced."], gaps: found.size < 2 ? ["Name the sectors you've delivered in (healthcare, data centres, transport…)."] : [] };
  },

  certifications(x) {
    const n = x.c.certifications.length;
    const target = Math.max(1, x.role.expectedCertifications);
    return { ratio: clamp01(n / target), evidence: [`${plural(n, "certification")} listed.`], gaps: n < target ? [`Add recognised certifications (Autodesk Certified Professional, ISO 19650, BRE BIM Level 2, buildingSMART).`] : [] };
  },

  education(x) {
    const e = x.c.educations;
    const degree = e.some((d) => d.degree);
    return { ratio: degree ? 1 : e.length ? 0.7 : 0, evidence: [e.length ? `${plural(e.length, "education entry")}${degree ? " including a named degree/diploma" : ""}.` : "No education listed."], gaps: e.length ? (degree ? [] : ["Name the degree or diploma."]) : ["Add your highest qualification (institution, degree, year)."] };
  },

  portfolio(x) {
    const links = x.c.links.filter((l) => /behance|github|portfolio|sketchfab|issuu|\.(com|io|me|net)\b/i.test(l) && !/linkedin/i.test(l)).length;
    const total = x.portfolio + links;
    return {
      ratio: clamp01(x.portfolio / 3) * 0.85 + (links ? 0.15 : 0),
      evidence: [`${plural(x.portfolio, "portfolio project/item")} on your CareerPoint profile${links ? `, plus ${plural(links, "external portfolio link")} in the resume` : ""}.`],
      gaps: total < 3 ? ["Add 3+ portfolio projects with images, your role and the outcome."] : [],
    };
  },

  chronology(x) {
    const es = x.c.experiences;
    if (!es.length) return { ratio: 0, evidence: ["No dated roles to check."], gaps: ["Add dated work history."] };
    const dated = es.filter((e) => monthIndex(e.startDate) != null);
    const datedRatio = dated.length / es.length;
    let ordered = true;
    for (let i = 1; i < dated.length; i++) if ((monthIndex(dated[i].startDate) ?? 0) > (monthIndex(dated[i - 1].startDate) ?? 0)) ordered = false;
    const sorted = [...dated].sort((a, b) => (monthIndex(a.startDate) ?? 0) - (monthIndex(b.startDate) ?? 0));
    const nowIdx = x.now.getFullYear() * 12 + x.now.getMonth();
    let gap = false;
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].current ? nowIdx : (monthIndex(sorted[i - 1].endDate) ?? monthIndex(sorted[i - 1].startDate)!);
      if ((monthIndex(sorted[i].startDate) ?? 0) - prevEnd > 12) gap = true;
    }
    const ratio = datedRatio * 0.5 + (ordered ? 0.25 : 0) + (gap ? 0 : 0.25);
    return { ratio, evidence: [`${dated.length}/${es.length} roles are dated; ${ordered ? "listed most recent first" : "not in reverse-chronological order"}; ${gap ? "a gap over 12 months exists" : "no unexplained gaps over 12 months"}.`], gaps: [...(datedRatio < 1 ? ["Give every role a start and end date."] : []), ...(!ordered ? ["List roles in reverse-chronological order."] : []), ...(gap ? ["Briefly explain employment gaps over 12 months."] : [])] };
  },

  formatting(x) {
    const raw = x.raw;
    if (!raw) {
      // Structured (builder-generated) content has no layout problems by construction.
      return { ratio: x.c.experiences.length || x.c.summary ? 1 : 0, evidence: ["Generated from structured data — consistent bullets and headings."], gaps: [] };
    }
    const ls = raw.split("\n").filter((l) => l.trim());
    const bullets = ls.filter((l) => /^\s*[•\-*]/.test(l)).length;
    const long = ls.filter((l) => l.length > 220).length;
    const caps = ls.filter((l) => l.length > 25 && l === l.toUpperCase()).length;
    const bulletOk = bullets >= 4;
    const ratio = (bulletOk ? 0.5 : bullets ? 0.25 : 0) + (long === 0 ? 0.3 : long < 3 ? 0.15 : 0) + (caps < 3 ? 0.2 : 0);
    return { ratio, evidence: [`${plural(bullets, "bullet line")}; ${plural(long, "overly long line")}; ${plural(caps, "all-caps block")}.`], gaps: [...(!bulletOk ? ["Use bullet points for responsibilities and achievements."] : []), ...(long ? ["Break very long paragraphs into bullets."] : [])] };
  },

  sectionCompleteness(x) {
    const { c } = x;
    const present: [boolean, string][] = [
      [!!c.summary, "summary"],
      [c.experiences.length > 0, "experience"],
      [c.software.length + c.skills.length > 0, "skills"],
      [c.educations.length > 0, "education"],
      [c.projects.length > 0, "projects"],
      [c.certifications.length > 0, "certifications"],
    ];
    const missing = present.filter((p) => !p[0]).map((p) => p[1]);
    return { ratio: (present.length - missing.length) / present.length, evidence: [`${present.length - missing.length} of ${present.length} core sections present.`], gaps: missing.length ? [`Missing sections: ${missing.join(", ")}.`] : [] };
  },

  keywordRelevance(x) {
    const core = [...x.role.coreSoftware, ...x.role.coreSkills, ...x.role.standards];
    const have = new Set([...x.c.software, ...x.c.skills].map((s) => s.toLowerCase()));
    const textMatches = new Set([...findTaxonomyMatches(x.text, BIM_SOFTWARE), ...findTaxonomyMatches(x.text, BIM_SKILLS)].map((s) => s.toLowerCase()));
    const present = core.filter((k) => have.has(k.toLowerCase()) || textMatches.has(k.toLowerCase()));
    const missing = core.filter((k) => !present.includes(k));
    return { ratio: core.length ? present.length / core.length : 1, evidence: [`Covers ${present.length} of ${core.length} keywords typical for a ${x.role.label}${present.length ? ` (${present.slice(0, 5).join(", ")})` : ""}.`], gaps: missing.length ? [`Typical ${x.role.label} keywords not found: ${missing.slice(0, 5).join(", ")}. Add them only if you genuinely have the experience.`] : [] };
  },

  achievementQuality(x) {
    const bullets = x.bullets;
    if (!bullets.length) return { ratio: 0, evidence: ["No bullets to assess."], gaps: ["Write achievement bullets that start with an action verb."] };
    const good = bullets.filter((b) => ACTION_RE.test(b) && b.split(/\s+/).length >= 6);
    return { ratio: clamp01(good.length / bullets.length / 0.7), evidence: [`${good.length} of ${bullets.length} bullets start with an action verb and give enough detail.`], gaps: good.length / bullets.length < 0.7 ? ["Start bullets with action verbs (Led, Coordinated, Automated) and say what changed."] : [] };
  },
};

function findSections(c: ResumeContent, raw: string) {
  if (raw) {
    const lower = raw.toLowerCase();
    return NAME_SECTIONS.filter((s) => new RegExp(`^\\s*(professional |work |core |technical )?${s}`, "im").test(lower)).length;
  }
  return [!!c.summary, c.experiences.length > 0, c.skills.length + c.software.length > 0, c.educations.length > 0, c.projects.length > 0, c.certifications.length > 0].filter(Boolean).length;
}

function roleBenchmarks(): RoleBenchmark[] {
  return applyCalibration(ROLE_BENCHMARKS, generated as Record<string, CalibrationOverride>);
}

export function scoreResume(input: ScoreInput, config: ScoringConfig = DEFAULT_CONFIG, now = new Date()): ScoreResult {
  const c = input.content;
  const bench = roleBenchmarks();
  const inferred = inferBenchmarkRole(input.targetRole, c.headline, c.experiences[0]?.title);
  const baseRole = bench.find((r) => r.id === inferred.id) ?? inferred;
  const role: RoleBenchmark = { ...baseRole, ...(config.benchmark?.[baseRole.id] ?? {}) };
  const ctx: Ctx = { c, raw: input.rawText ?? "", portfolio: input.portfolioCount ?? 0, role, text: fullText(c), bullets: bulletsOf(c), now };
  const weights = normalizeWeights(config.weights);

  const dimensions: Dimension[] = DIMENSION_KEYS.map((key) => {
    const r = DIMS[key](ctx);
    const max = weights[key];
    return { key, label: LABELS[key], max, score: Math.round(clamp01(r.ratio) * max * 10) / 10, evidence: r.evidence, gaps: r.gaps };
  });

  const byKey = new Map(dimensions.map((d) => [d.key, d]));
  const groups: Group[] = config.groups.map((g) => {
    const dims = g.dimensions.map((k) => byKey.get(k)!).filter(Boolean);
    return { key: g.key, label: g.label, dimensions: dims, max: dims.reduce((n, d) => n + d.max, 0), score: Math.round(dims.reduce((n, d) => n + d.score, 0) * 10) / 10, evidence: dims.flatMap((d) => d.evidence) };
  });

  const suggestions: Suggestion[] = dimensions
    .flatMap((d) => {
      const lost = d.max - d.score;
      return lost >= 0.5 ? d.gaps.map((g, i) => ({ category: d.key, message: g, impact: Math.max(1, Math.round(lost / Math.max(1, d.gaps.length) + (i === 0 ? 0 : 0))) })) : [];
    })
    .sort((a, b) => b.impact - a.impact);

  const total = Math.max(0, Math.min(100, Math.round(dimensions.reduce((n, d) => n + d.score, 0))));
  return { total, groups, dimensions, suggestions, rubricVersion: RUBRIC_VERSION, benchmarkRole: { id: role.id, label: role.label } };
}

export function scoreLabel(total: number): string {
  if (total >= 85) return "Excellent";
  if (total >= 70) return "Strong";
  if (total >= 50) return "Developing";
  return "Needs work";
}
