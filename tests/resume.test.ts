import { describe, expect, it } from "vitest";
import { parseResumeText, estimateYears, parseDate } from "@/lib/resume/parse";
import { scoreResume } from "@/lib/resume/score";
import { emptyResume } from "@/lib/resume/types";
import { SAMPLE_RESUME } from "./fixtures";

describe("resume parser", () => {
  const r = parseResumeText(SAMPLE_RESUME);
  it("extracts contact details", () => {
    expect(r.name).toBe("Arjun Mehta");
    expect(r.email).toBe("arjun.mehta@example.com");
    expect(r.phone).toContain("971");
    expect(r.links.join(" ")).toContain("linkedin.com/in/arjunmehta");
    expect(r.headline).toMatch(/BIM Coordinator/);
  });
  it("extracts experience roles with dates", () => {
    expect(r.experiences).toHaveLength(2);
    expect(r.experiences[0]).toMatchObject({ title: "Senior BIM Coordinator", company: "Alpha Engineering", startDate: "2019-03", current: true });
    expect(r.experiences[1]).toMatchObject({ title: "BIM Modeler", company: "Beta Consultants", startDate: "2015-06", endDate: "2019-02" });
    expect(r.experiences[0].description).toContain("4,200 clashes");
  });
  it("detects software, skills, certifications", () => {
    expect(r.software).toEqual(expect.arrayContaining(["Revit", "Navisworks", "Dynamo", "Solibri", "BIM 360", "Python", "AutoCAD"]));
    expect(r.skills).toEqual(expect.arrayContaining(["Clash Detection", "COBie", "IFC", "ISO 19650"]));
    expect(r.certifications).toEqual(expect.arrayContaining(["Autodesk Certified Professional: Revit"]));
  });
  it("parses education, projects, discipline", () => {
    expect(r.educations[0].school).toMatch(/National Institute/);
    expect(r.educations[0].endYear).toBe(2015);
    expect(r.projects.length).toBe(2);
    expect(r.projects[0].lod).toBe("LOD 400");
    expect(r.discipline).toBe("MEP");
  });
  it("is deterministic", () => {
    expect(parseResumeText(SAMPLE_RESUME)).toEqual(r);
  });
});

describe("date helpers", () => {
  it("parses month-year tokens", () => {
    expect(parseDate("Mar 2019")).toBe("2019-03");
    expect(parseDate("03/2019")).toBe("2019-03");
    expect(parseDate("Present")).toBeNull();
  });
  it("merges overlapping spans when estimating years", () => {
    const y = estimateYears([{ title: "a", company: "b", startDate: "2015-01", endDate: "2019-01" }, { title: "c", company: "d", startDate: "2018-01", endDate: "2020-01" }], new Date("2025-01-01"));
    expect(y).toBe(5);
  });
});

describe("resume score", () => {
  it("scores a strong BIM resume highly and is bounded", () => {
    const s = scoreResume(parseResumeText(SAMPLE_RESUME));
    expect(s.total).toBeGreaterThan(65);
    expect(s.total).toBeLessThanOrEqual(100);
    expect(s.breakdown.reduce((n, c) => n + c.max, 0)).toBe(100);
  });
  it("scores an empty resume 0 with suggestions", () => {
    const s = scoreResume(emptyResume());
    expect(s.total).toBe(0);
    expect(s.suggestions.length).toBeGreaterThan(3);
  });
  it("is deterministic", () => {
    const c = parseResumeText(SAMPLE_RESUME);
    expect(scoreResume(c)).toEqual(scoreResume(c));
  });
  it("improves when a measurable gap is filled", () => {
    const c = parseResumeText(SAMPLE_RESUME);
    const before = scoreResume({ ...c, certifications: [] }).total;
    expect(scoreResume(c).total).toBeGreaterThan(before);
  });
});
