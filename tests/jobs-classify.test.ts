import { describe, expect, it } from "vitest";
import { BIM_ACCEPT_THRESHOLD, BIM_CORE_THRESHOLD, ROLE_RULES, classifyJob, platformDiscipline } from "@/lib/jobs/classify";
import { MIN_LISTED_QUALITY, QUALITY_WEIGHTS, recencyFactor, scoreQuality } from "@/lib/jobs/quality";
import { compareJobs, pickCanonical, type DedupeJob } from "@/lib/jobs/dedupe";
import { htmlToText } from "@/lib/jobs/normalize";
import { BIM_COORDINATOR_HTML, GENERIC_ARCHITECT_HTML, SALES_HTML, SOLUTION_ARCHITECT_HTML } from "./fixtures/jobs";
import { scoreJobMatch, JOB_WEIGHTS, type JobScoreJob, type JobScoreProfile } from "@/lib/scoring/job";

const coordinator = htmlToText(BIM_COORDINATOR_HTML);

describe("BIM role recognition (titles)", () => {
  const role = (title: string) => classifyJob({ title, description: "" }).bimRole;
  it.each([
    ["BIM Modeler", "BIM Modeler"], ["Senior BIM Modeller", "BIM Modeler"], ["BIM Engineer", "BIM Engineer"], ["BIM Coordinator (MEP)", "BIM Coordinator"], ["BIM Manager", "BIM Manager"], ["Head of BIM", "BIM Manager"],
    ["BIM Lead", "BIM Lead"], ["BIM Architect", "BIM Architect"], ["BIM Structural Engineer", "BIM Structural Engineer"], ["Structural BIM Engineer", "BIM Structural Engineer"], ["BIM MEP Engineer", "BIM MEP Engineer"],
    ["BIM Mechanical Engineer", "BIM Mechanical Engineer"], ["BIM Electrical Engineer", "BIM Electrical Engineer"], ["BIM Plumbing Engineer", "BIM Plumbing Engineer"], ["Revit Modeler", "Revit Modeler"], ["Revit Technician", "Revit Modeler"],
    ["Revit Specialist", "Revit Specialist"], ["Navisworks Specialist", "Navisworks Specialist"], ["Civil 3D BIM Technician", "Civil 3D BIM"], ["VDC Engineer", "VDC Engineer"], ["VDC Coordinator", "VDC Coordinator"],
    ["Digital Engineering Lead", "Digital Engineering"], ["Information Manager (ISO 19650)", "Information Manager"], ["BIM Consultant", "BIM Consultant"],
  ])("%s → %s", (title, expected) => expect(role(title)).toBe(expected));
  it("does not assign a BIM role to unrelated titles", () => {
    for (const t of ["Account Executive", "Backend Engineer", "Interior Designer", "Architect", "Site Engineer", "Project Manager"]) expect(role(t)).toBeUndefined();
  });
  it("covers every role named in the product spec", () => expect(new Set(ROLE_RULES.map((r) => r.role)).size).toBe(20));
});

describe("BIM relevance scoring (transparent, no false positives)", () => {
  it("a real BIM coordinator posting is a core BIM job, with itemised evidence", () => {
    const c = classifyJob({ title: "BIM Coordinator", description: coordinator });
    expect(c.bimRelevanceScore).toBeGreaterThanOrEqual(BIM_CORE_THRESHOLD);
    expect(c.tier).toBe("core");
    expect(c.accepted).toBe(true);
    expect(c.bimRole).toBe("BIM Coordinator");
    expect(c.tools).toEqual(expect.arrayContaining(["Revit", "Navisworks", "Dynamo", "Autodesk Construction Cloud"]));
    expect(c.standards).toEqual(expect.arrayContaining(["ISO 19650", "IFC", "COBie", "Clash Detection"]));
    expect(c.evidence.every((e) => /^(\+\d+|cap \d+)/.test(e) || e.startsWith("+0"))).toBe(true);
  });
  it("evidence points add up to the score (unless capped)", () => {
    const c = classifyJob({ title: "BIM Coordinator", description: coordinator });
    const sum = c.evidence.filter((e) => e.startsWith("+")).reduce((n, e) => n + Number(e.match(/^\+(\d+)/)![1]), 0);
    expect(Math.min(100, sum)).toBe(c.bimRelevanceScore);
  });
  it("a generic Architect job that mentions BIM once is NOT a BIM job", () => {
    const c = classifyJob({ title: "Architect", description: htmlToText(GENERIC_ARCHITECT_HTML) });
    expect(c.accepted).toBe(false);
    expect(c.bimRelevanceScore).toBeLessThan(BIM_ACCEPT_THRESHOLD);
    expect(c.evidence.join(" ")).toMatch(/cap 20|title is not a BIM role/);
  });
  it("sales, software and IT-architect roles that list BIM tools are rejected", () => {
    expect(classifyJob({ title: "Account Executive", description: htmlToText(SALES_HTML) }).accepted).toBe(false);
    const sa = classifyJob({ title: "Solution Architect", description: htmlToText(SOLUTION_ARCHITECT_HTML) });
    expect(sa.accepted).toBe(false);
    expect(sa.evidence.join(" ")).toMatch(/cap 15|cap 25/);
    expect(classifyJob({ title: "Senior Backend Engineer", description: "We build a Revit and Navisworks plugin platform. Python, Go." }).accepted).toBe(false);
  });
  it("an architect posting with heavy, concrete BIM duties is 'related' only when evidence is strong", () => {
    const desc = "Design hospital buildings. Lead the Revit and Navisworks models, run clash detection, maintain the BIM execution plan, ISO 19650 information management, COBie handover. BIM is central to our delivery: BIM coordination, BIM standards, BIM audits.";
    const c = classifyJob({ title: "Architect", description: desc });
    expect(c.bimRelevanceScore).toBeGreaterThan(20);
    expect(c.tier).not.toBe("core");
  });
  it("a BIM title with thin description still passes on the title alone", () => {
    const c = classifyJob({ title: "BIM Modeler", description: "Join our team." });
    expect(c.accepted).toBe(true);
    expect(c.tier).toBe("related");
  });
  it("AutoCAD alone is not BIM evidence", () => {
    expect(classifyJob({ title: "CAD Draftsman", description: "Produce 2D drawings in AutoCAD for mechanical parts." }).accepted).toBe(false);
  });
  it("recognises tools and disciplines", () => {
    const c = classifyJob({ title: "BIM MEP Engineer", description: "Mechanical, electrical and plumbing coordination in Revit MEP; Tekla and Solibri checks; Civil 3D for site utilities." });
    expect(c.tools).toEqual(expect.arrayContaining(["Revit", "Tekla Structures", "Solibri", "Civil 3D"]));
    expect(c.disciplines).toEqual(expect.arrayContaining(["MEP"]));
    expect(platformDiscipline(c.primaryDiscipline)).toBe("MEP");
    expect(platformDiscipline("Civil")).toBe("Civil / Infrastructure");
    expect(platformDiscipline("Landscape")).toBe("Architecture");
  });
  it("is deterministic", () => {
    const i = { title: "BIM Coordinator", description: coordinator };
    expect(classifyJob(i)).toEqual(classifyJob(i));
  });
});

describe("job quality", () => {
  const base = { bimRelevanceScore: 80, title: "Senior BIM Coordinator", description: coordinator.repeat(2), responsibilities: "x", requirements: "y", postedAt: new Date("2026-10-01"), discoveredAt: new Date("2026-10-02"), sourceReliability: 90, city: "Bengaluru", country: "India", remoteType: "HYBRID", salaryMin: 1, salaryMax: 2, bimRole: "BIM Coordinator" };
  const now = new Date("2026-10-03");
  it("weights sum to 100 and a complete fresh posting scores high", () => {
    expect(Object.values(QUALITY_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(scoreQuality(base, now).score).toBeGreaterThan(85);
  });
  it("penalises thin, stale, unlocated postings and explains why", () => {
    const thin = scoreQuality({ ...base, description: "Short.", responsibilities: null, requirements: null, postedAt: new Date("2025-01-01"), city: null, country: null, remoteType: "UNKNOWN", salaryMin: null, salaryMax: null, bimRole: null, sourceReliability: 40, bimRelevanceScore: 41 }, now);
    expect(thin.score).toBeLessThan(MIN_LISTED_QUALITY + 10);
    expect(thin.notes.join(" ")).toMatch(/Short description|No location|Role not clearly/);
  });
  it("recency decays with age", () => {
    expect(recencyFactor(new Date("2026-10-02"), now)).toBeGreaterThan(recencyFactor(new Date("2026-08-01"), now));
    expect(recencyFactor(new Date("2024-01-01"), now)).toBeLessThan(0.1);
  });
});

describe("deduplication", () => {
  const a: DedupeJob = { sourceId: "s1", sourceJobId: "1", canonicalUrl: "https://acme.com/jobs/1", companyName: "Acme Engineering Ltd", title: "Senior BIM Coordinator", city: "Bengaluru", country: "India", remoteType: "HYBRID", description: coordinator, postedAt: new Date("2026-09-28") };
  it("same source job id or canonical URL is a certain duplicate", () => {
    expect(compareJobs(a, { ...a, title: "Anything", companyName: "Other" }).probability).toBe(1);
    expect(compareJobs(a, { ...a, sourceId: "s2", sourceJobId: "9", title: "x" }).reasons).toEqual(["same canonical URL"]);
  });
  it("the same opening on an aggregator (different wording, company suffix, URL) is merged", () => {
    const b: DedupeJob = { sourceId: "s2", sourceJobId: "zz", canonicalUrl: "https://linkedin.com/jobs/view/999", companyName: "ACME Engineering Limited", title: "BIM Coordinator (Senior)", city: "Bengaluru", country: "India", remoteType: "UNKNOWN", description: coordinator + "\nApply via LinkedIn.", postedAt: new Date("2026-09-30") };
    const r = compareJobs(a, b);
    expect(r.duplicate).toBe(true);
    expect(r.probability).toBeGreaterThan(0.8);
  });
  it("different city, company, title or a very different description is NOT a duplicate", () => {
    const b = { ...a, sourceId: "s2", sourceJobId: "b", canonicalUrl: "https://x.com/2" };
    expect(compareJobs(a, { ...b, city: "London", country: "United Kingdom" }).duplicate).toBe(false);
    expect(compareJobs(a, { ...b, companyName: "Globex Corporation" }).duplicate).toBe(false);
    expect(compareJobs(a, { ...b, title: "BIM Manager" }).duplicate).toBe(false);
    expect(compareJobs(a, { ...b, description: "A completely different role about revenue operations and sales forecasting and pipeline management for enterprise customers." }).duplicate).toBe(false);
  });
  it("a re-post long after the original is a different opening", () => {
    expect(compareJobs(a, { ...a, sourceId: "s2", sourceJobId: "b", canonicalUrl: "https://x.com/2", postedAt: new Date("2026-01-01") }).duplicate).toBe(false);
  });
  it("remote openings match across locations within the same country", () => {
    const r1 = { ...a, city: null, remoteType: "REMOTE", country: "India" };
    const r2 = { ...a, sourceId: "s2", sourceJobId: "r", canonicalUrl: "https://x.com/r", city: "Pune", remoteType: "REMOTE", country: "India" };
    expect(compareJobs(r1, r2).duplicate).toBe(true);
  });
  it("native postings and more reliable sources win canonical selection", () => {
    const d = new Date();
    const native = { reliability: 100, descriptionLength: 100, discoveredAt: d, isNative: true };
    const ats = { reliability: 90, descriptionLength: 5000, discoveredAt: d, isNative: false };
    const agg = { reliability: 60, descriptionLength: 9000, discoveredAt: d, isNative: false };
    expect(pickCanonical(native, ats)).toBe(native);
    expect(pickCanonical(agg, ats)).toBe(ats);
  });
});

describe("compatibility scoring (candidate ↔ job)", () => {
  const profile: JobScoreProfile = { software: ["Revit", "Navisworks"], softwareYears: { Revit: 5 }, skills: ["BIM Coordination", "Clash Detection"], titles: ["BIM Coordinator"], yearsExperience: 5, discipline: "MEP", location: "Bengaluru, India", country: "India", remotePreference: "Hybrid", industries: ["Healthcare"], preferredRoles: ["BIM Coordinator"], preferredLocations: ["Bengaluru"], employmentTypes: ["Full-time"], minSalary: 1500000, salaryCurrency: "INR", projects: [{ name: "City Hospital", sector: "Healthcare", software: ["Revit"] }] };
  const job: JobScoreJob = { title: "BIM Coordinator", description: coordinator, software: ["Revit", "Navisworks", "Tekla Structures"], skills: ["BIM Coordination", "ISO 19650"], seniority: null, discipline: "MEP", location: "Bengaluru, Karnataka, India", city: "Bengaluru", country: "India", remote: false, remoteType: "HYBRID", bimRole: "BIM Coordinator", employmentType: "Full-time", experienceMin: 3, experienceMax: 5, industry: "Healthcare", salaryMin: 1800000, salaryMax: 2400000, salaryCurrency: "INR" };
  it("has the eight spec components and weights summing to 100", () => {
    const r = scoreJobMatch(profile, job);
    expect(r.components.map((c) => c.key)).toEqual(["role", "software", "experience", "skills", "location", "industry", "projects", "preference"]);
    expect(Object.values(JOB_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("produces positive reasons with real numbers and honest gaps", () => {
    const r = scoreJobMatch(profile, job);
    expect(r.total).toBeGreaterThan(75);
    expect(r.reasons).toEqual(expect.arrayContaining(["5 years Revit", "Navisworks", "BIM Coordination"]));
    expect(r.gaps).toEqual(expect.arrayContaining(["Tekla Structures", "ISO 19650"]));
    expect(r.components.find((c) => c.key === "preference")!.evidence).toMatch(/Bengaluru is a preferred location/);
    expect(r.components.find((c) => c.key === "preference")!.evidence).toMatch(/salary meets your minimum/);
  });
  it("preferences lower the score when the job conflicts with them", () => {
    const conflict = scoreJobMatch({ ...profile, preferredRoles: ["BIM Manager"], preferredLocations: ["Dubai"], employmentTypes: ["Contract"], minSalary: 5_000_000 }, job);
    const base = scoreJobMatch(profile, job);
    expect(conflict.total).toBeLessThan(base.total);
    expect(conflict.components.find((c) => c.key === "preference")!.score).toBeLessThan(base.components.find((c) => c.key === "preference")!.score);
  });
  it("never claims a hiring probability", () => {
    const r = scoreJobMatch(profile, job);
    expect(r.disclaimer).toMatch(/not a prediction/i);
    expect(JSON.stringify(r)).not.toMatch(/chance|probab/i);
  });
});
