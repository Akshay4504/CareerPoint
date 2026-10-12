import { BIM_SKILLS, BIM_SOFTWARE, SECTORS, findTaxonomyMatches, inferDiscipline, inferSeniority } from "@/lib/taxonomy";
import { inferBenchmarkRole } from "./benchmark";

// Job-specific compatibility diagnostic. Deterministic. It compares what the candidate has provided with what the
// job asks for. It does NOT predict hiring outcomes and must never be presented as a chance of being hired.

export const JOB_SCORE_DISCLAIMER = "A compatibility diagnostic comparing your profile with this job description. It is not a prediction of hiring decisions.";

export type JobScoreProfile = {
  software: string[];
  skills: string[];
  titles: string[]; // current + previous role titles, desired roles, headline
  yearsExperience?: number | null;
  discipline?: string | null;
  location?: string | null;
  country?: string | null;
  remotePreference?: string | null;
  industries: string[];
  /** Years of use per tool (from the profile's software proficiency), used for evidence like "6 yrs Revit". */
  softwareYears?: Record<string, number | null | undefined>;
  preferredRoles?: string[];
  preferredLocations?: string[];
  employmentTypes?: string[];
  minSalary?: number | null;
  salaryCurrency?: string | null;
  projects: { name: string; sector?: string | null; software: string[]; description?: string | null; discipline?: string | null }[];
};

export type JobScoreJob = {
  title: string;
  description: string;
  software: string[];
  skills: string[];
  seniority?: string | null;
  discipline?: string | null;
  location?: string | null;
  city?: string | null;
  country?: string | null;
  remote: boolean;
  remoteType?: string | null;
  bimRole?: string | null;
  employmentType?: string | null;
  experienceMin?: number | null;
  experienceMax?: number | null;
  industry?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
};

export type JobComponent = { key: string; label: string; score: number; max: number; applicable: boolean; evidence: string };
export type JobScoreResult = { total: number; components: JobComponent[]; matched: string[]; missing: string[]; reasons: string[]; gaps: string[]; disclaimer: string };

export const JOB_WEIGHTS = { role: 12, software: 22, experience: 12, skills: 18, location: 10, industry: 6, projects: 8, preference: 12 } as const;

const lc = (s: string) => s.trim().toLowerCase();
const words = (s: string) => new Set(lc(s).split(/[^a-z0-9+#]+/).filter((w) => w.length > 2 && !["the", "and", "for", "with", "senior", "junior"].includes(w)));
const SENIORITY_YEARS: Record<string, [number, number]> = { Intern: [0, 1], Junior: [0, 3], Mid: [2, 6], Senior: [5, 12], Lead: [7, 20], Manager: [7, 25], Director: [10, 40] };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function scoreJobMatch(p: JobScoreProfile, job: JobScoreJob): JobScoreResult {
  const text = `${job.title}\n${job.description}`;
  const jobSoftware = job.software.length ? job.software : findTaxonomyMatches(text, BIM_SOFTWARE);
  const jobSkills = job.skills.length ? job.skills : findTaxonomyMatches(text, BIM_SKILLS);
  const haveSw = new Set(p.software.map(lc));
  const haveSk = new Set(p.skills.map(lc));
  const comps: JobComponent[] = [];
  const W = JOB_WEIGHTS;

  // Role
  {
    const mine = inferBenchmarkRole(...p.titles);
    const theirs = inferBenchmarkRole(job.title, job.bimRole);
    const jw = words(`${job.title} ${job.bimRole ?? ""}`);
    const overlap = p.titles.reduce((best, t) => {
      const tw = words(t);
      const common = [...jw].filter((w) => tw.has(w)).length;
      return Math.max(best, jw.size ? common / jw.size : 0);
    }, 0);
    const same = mine.id === theirs.id && theirs.id !== "general";
    const ratio = Math.min(1, (same ? 0.6 : 0) + overlap * 0.6);
    comps.push({ key: "role", label: "Role match", max: W.role, applicable: p.titles.length > 0, score: ratio * W.role, evidence: p.titles.length ? (same ? `Your titles align with the ${theirs.label} role.` : `Your titles read as ${mine.label}; the job is a ${theirs.label}.`) : "Add a headline or job titles to compare roles." });
  }

  // Software
  const matchedSw = jobSoftware.filter((s) => haveSw.has(lc(s)));
  const missingSw = jobSoftware.filter((s) => !haveSw.has(lc(s)));
  comps.push({ key: "software", label: "Software match", max: W.software, applicable: jobSoftware.length > 0, score: jobSoftware.length ? (matchedSw.length / jobSoftware.length) * W.software : 0, evidence: jobSoftware.length ? `You list ${matchedSw.length} of ${jobSoftware.length} required tools.` : "The job does not name specific software." });

  // Experience
  {
    const years = p.yearsExperience;
    const asked = job.experienceMin ?? (() => { const m = job.description.match(/(\d{1,2})\s*\+?\s*(?:years|yrs)/i); return m ? Number(m[1]) : null; })();
    const max = job.experienceMax ?? null;
    const seniority = job.seniority ?? inferSeniority(job.title);
    let score = 0;
    let evidence = "Add years of experience to compare.";
    let applicable = years != null && (asked != null || !!seniority);
    if (years != null && asked != null) {
      score = years >= asked ? (max != null && years > max + 3 ? 0.7 : 1) : Math.max(0, years / asked);
      evidence = max != null ? `You have ${years} years; the job asks for ${asked}–${max}.` : `You have ${years} years; the job asks for ${asked}+.`;
    } else if (years != null && seniority && SENIORITY_YEARS[seniority]) {
      const [lo, hi] = SENIORITY_YEARS[seniority];
      score = years >= lo && years <= hi ? 1 : years > hi ? 0.7 : Math.max(0, 1 - (lo - years) * 0.3);
      evidence = `${years} years vs. typical ${lo}–${hi} for ${seniority}.`;
    } else applicable = false;
    comps.push({ key: "experience", label: "Experience match", max: W.experience, applicable, score: score * W.experience, evidence });
  }

  // Skills
  const matchedSk = jobSkills.filter((s) => haveSk.has(lc(s)));
  const missingSk = jobSkills.filter((s) => !haveSk.has(lc(s)));
  comps.push({ key: "skills", label: "Skill match", max: W.skills, applicable: jobSkills.length > 0, score: jobSkills.length ? (matchedSk.length / jobSkills.length) * W.skills : 0, evidence: jobSkills.length ? `You list ${matchedSk.length} of ${jobSkills.length} required skills and standards.` : "The job does not name specific skills." });

  // Location
  {
    const myCity = p.location ? lc(p.location.split(",")[0]) : "";
    const sameCity = !!myCity && ((job.city && lc(job.city) === myCity) || (job.location && lc(job.location).includes(myCity)));
    const sameCountry = p.country && job.country && lc(p.country) === lc(job.country);
    const remoteOk = (job.remote || job.remoteType === "REMOTE") && p.remotePreference !== "On-site";
    const known = !!(p.location || p.country);
    let ratio = 0;
    let evidence = "Add your location to compare.";
    if (sameCity) {
      ratio = 1;
      evidence = `You are in ${p.location?.split(",")[0]}, where the job is based.`;
    } else if (remoteOk) {
      ratio = 0.9;
      evidence = "The job is remote-friendly.";
    } else if (sameCountry) {
      ratio = 0.6;
      evidence = `Same country (${job.country}).`;
    } else if (known) evidence = "The job is in a different location.";
    comps.push({ key: "location", label: "Location match", max: W.location, applicable: known || job.remote || job.remoteType === "REMOTE", score: ratio * W.location, evidence });
  }

  // Industry
  {
    const jobSectors = job.industry ? [job.industry] : SECTORS.filter((s) => new RegExp(s === "Data centers" ? "data cent" : s === "Mixed-use" ? "mixed[- ]use" : s.toLowerCase().slice(0, 6), "i").test(text) && s !== "Other");
    const mine = new Set([...p.industries, ...p.projects.map((x) => x.sector ?? "")].filter(Boolean).map(lc));
    const common = jobSectors.filter((s) => mine.has(lc(s)));
    comps.push({ key: "industry", label: "Industry match", max: W.industry, applicable: jobSectors.length > 0 && mine.size > 0, score: jobSectors.length ? (common.length ? 1 : 0) * W.industry : 0, evidence: jobSectors.length ? (common.length ? `You have ${common.join(", ")} experience.` : `The job is in ${jobSectors.join(", ")}; none appear in your profile.`) : "The job does not name an industry." });
  }

  // Projects
  {
    const jd = job.discipline ?? inferDiscipline(text);
    const relevant = p.projects.filter((x) => x.software.some((s) => jobSoftware.map(lc).includes(lc(s))) || (jd && (x.discipline === jd || inferDiscipline(`${x.name} ${x.description ?? ""}`) === jd)));
    comps.push({ key: "projects", label: "Project match", max: W.projects, applicable: p.projects.length > 0, score: Math.min(1, relevant.length / 2) * W.projects, evidence: p.projects.length ? `${plural(relevant.length, "project")} use the job's tools or discipline.` : "Add projects to compare." });
  }

  // Preferences
  {
    const roles = p.preferredRoles ?? [];
    const locs = p.preferredLocations ?? [];
    const types = p.employmentTypes ?? [];
    const hasAny = roles.length || locs.length || types.length || p.remotePreference || p.minSalary;
    let got = 0;
    let weight = 0;
    const notes: string[] = [];
    if (roles.length) {
      const jw = words(`${job.title} ${job.bimRole ?? ""}`);
      const best = roles.reduce((m, r) => { const rw = words(r); const c = [...rw].filter((w) => jw.has(w)).length; return Math.max(m, rw.size ? c / rw.size : 0); }, 0);
      weight += 35;
      got += Math.min(1, best * 1.2) * 35;
      notes.push(best >= 0.5 ? "role is one you are looking for" : "role differs from your preferred roles");
    }
    if (locs.length) {
      weight += 25;
      const hit = locs.find((l) => lc(job.location ?? "").includes(lc(l)) || (job.city && lc(job.city) === lc(l)) || (job.country && lc(job.country) === lc(l)));
      const remoteHit = job.remote || job.remoteType === "REMOTE";
      got += hit ? 25 : remoteHit ? 15 : 0;
      notes.push(hit ? `${hit} is a preferred location` : remoteHit ? "remote works for any location" : "not in your preferred locations");
    }
    if (types.length && job.employmentType) {
      weight += 15;
      const ok = types.some((t) => lc(t) === lc(job.employmentType!));
      got += ok ? 15 : 0;
      notes.push(ok ? `${job.employmentType} matches your preference` : `${job.employmentType} is not a preferred type`);
    }
    if (p.remotePreference && (job.remoteType && job.remoteType !== "UNKNOWN")) {
      weight += 10;
      const ok = (p.remotePreference === "Remote" && job.remoteType === "REMOTE") || (p.remotePreference === "Hybrid" && job.remoteType !== "ONSITE") || (p.remotePreference === "On-site" && job.remoteType !== "REMOTE");
      got += ok ? 10 : 0;
      notes.push(ok ? `${p.remotePreference} preference fits` : `job is ${job.remoteType.toLowerCase()}`);
    }
    if (p.minSalary && job.salaryMax && (!p.salaryCurrency || !job.salaryCurrency || p.salaryCurrency === job.salaryCurrency)) {
      weight += 15;
      const ok = job.salaryMax >= p.minSalary;
      got += ok ? 15 : 0;
      notes.push(ok ? "salary meets your minimum" : "salary range is below your minimum");
    }
    comps.push({ key: "preference", label: "Preference match", max: W.preference, applicable: !!hasAny && weight > 0, score: weight ? (got / weight) * W.preference : 0, evidence: weight ? notes.join("; ") : "Set your career preferences to compare." });
  }

  const applicable = comps.filter((c) => c.applicable);
  const maxApplicable = applicable.reduce((n, c) => n + c.max, 0);
  const raw = applicable.reduce((n, c) => n + c.score, 0);
  const total = maxApplicable ? Math.round((raw / maxApplicable) * 100) : 0;
  const reasons: string[] = [];
  for (const sw of matchedSw) {
    const y = p.softwareYears?.[sw] ?? p.softwareYears?.[Object.keys(p.softwareYears ?? {}).find((k) => lc(k) === lc(sw)) ?? ""];
    reasons.push(y ? `${y} year${y === 1 ? "" : "s"} ${sw}` : sw);
  }
  reasons.push(...matchedSk);
  for (const c of comps) if (c.applicable && c.score / c.max >= 0.99 && ["location", "preference", "experience", "industry"].includes(c.key)) reasons.push(c.evidence.replace(/\.$/, ""));
  const gaps = [...missingSw, ...missingSk];
  return {
    total,
    components: comps.map((c) => ({ ...c, score: Math.round(c.score * 10) / 10 })),
    matched: [...matchedSw, ...matchedSk],
    missing: [...missingSw, ...missingSk],
    reasons,
    gaps,
    disclaimer: JOB_SCORE_DISCLAIMER,
  };
}
