import { describe, expect, it } from "vitest";
import { canonicalizeUrl, detectEmploymentType, detectIndustry, detectRemoteType, htmlToText, jaccard, normalizeCompany, normalizeTitle, parseExperience, parseLocation, parseSalary, shingles, splitSections, stripHtml, titleSimilarity } from "@/lib/jobs/normalize";
import { validateJob } from "@/lib/jobs/validate";
import { parseRobots, isAllowed } from "@/lib/jobs/robots";
import { BIM_COORDINATOR_HTML } from "./fixtures/jobs";
import type { NormalizedJobInput } from "@/lib/jobs/types";

describe("text normalization", () => {
  it("strips HTML, decodes entities and keeps list structure", () => {
    const t = stripHtml("<p>Hello&nbsp;&amp; welcome</p><ul><li>One</li><li>Two</li></ul><script>alert(1)</script>");
    expect(t).toContain("Hello & welcome");
    expect(t).toContain("• One");
    expect(t).not.toMatch(/alert|<|>/);
  });
  it("decodes entity-escaped HTML as returned by Greenhouse", () => {
    expect(htmlToText("&lt;p&gt;Use &lt;strong&gt;Revit&lt;/strong&gt;&lt;/p&gt;")).toBe("Use Revit");
  });
  it("splits responsibilities and requirements by their headings", () => {
    const s = splitSections(htmlToText(BIM_COORDINATOR_HTML));
    expect(s.responsibilities).toContain("clash detection");
    expect(s.requirements).toContain("3-5 years");
    expect(s.responsibilities).not.toContain("3-5 years");
  });
  it("parses locations without guessing missing parts", () => {
    expect(parseLocation("Bengaluru, Karnataka, India")).toMatchObject({ city: "Bengaluru", country: "India" });
    expect(parseLocation("Austin, TX")).toMatchObject({ city: "Austin", country: "United States" });
    expect(parseLocation("London, UK")).toMatchObject({ city: "London", country: "United Kingdom" });
    expect(parseLocation("Toronto, ON")).toMatchObject({ city: "Toronto", country: "Canada" });
    expect(parseLocation("Remote")).toMatchObject({ city: undefined, country: undefined });
    expect(parseLocation("Vienna")).toMatchObject({ city: "Vienna", country: undefined });
    expect(parseLocation(undefined)).toEqual({});
  });
  it("detects remote type", () => {
    expect(detectRemoteType("Remote (USA)")).toBe("REMOTE");
    expect(detectRemoteType("Berlin", "Hybrid working, 3 days in office")).toBe("HYBRID");
    expect(detectRemoteType("Dubai", "On-site role")).toBe("ONSITE");
    expect(detectRemoteType("Dubai")).toBe("UNKNOWN");
    expect(detectRemoteType("Dubai", "This is not remote")).not.toBe("REMOTE");
  });
  it("parses experience requirements", () => {
    expect(parseExperience("3-5 years of experience")).toEqual({ min: 3, max: 5 });
    expect(parseExperience("5+ years in BIM")).toEqual({ min: 5 });
    expect(parseExperience("minimum 7 years of experience")).toEqual({ min: 7 });
    expect(parseExperience("2 years' relevant experience")).toEqual({ min: 2 });
    expect(parseExperience("fresh graduates welcome")).toEqual({});
  });
  it("parses only explicit yearly salaries", () => {
    expect(parseSalary("Salary: INR 1,800,000 - 2,400,000 per year")).toEqual({ min: 1800000, max: 2400000, currency: "INR" });
    expect(parseSalary("$80,000 - $100,000")).toEqual({ min: 80000, max: 100000, currency: "USD" });
    expect(parseSalary("£55K - £70K")).toEqual({ min: 55000, max: 70000, currency: "GBP" });
    expect(parseSalary("$45 - $60 per hour")).toEqual({});
    expect(parseSalary("competitive salary")).toEqual({});
  });
  it("detects employment type and industry", () => {
    expect(detectEmploymentType("Senior BIM Engineer", "This is a full-time role")).toBe("Full-time");
    expect(detectEmploymentType("BIM Intern")).toBe("Internship");
    expect(detectEmploymentType("6 month contract")).toBe("Contract");
    expect(detectIndustry("new hospital project")).toBe("Healthcare");
    expect(detectIndustry("a data centre campus")).toBe("Data centers");
  });
  it("canonicalizes URLs (tracking removed, host/case/slash normalized, gh_jid kept)", () => {
    expect(canonicalizeUrl("https://WWW.Acme.com/jobs/12/?utm_source=x&ref=y#top")).toBe("https://acme.com/jobs/12");
    expect(canonicalizeUrl("https://boards.greenhouse.io/acme/jobs/9?gh_jid=9&utm_medium=z")).toBe("https://boards.greenhouse.io/acme/jobs/9?gh_jid=9");
    expect(canonicalizeUrl("https://a.com/x?b=2&a=1")).toBe("https://a.com/x?a=1&b=2");
  });
  it("normalizes company and title for comparison", () => {
    expect(normalizeCompany("Acme Engineering Ltd.")).toBe(normalizeCompany("ACME Engineering Limited"));
    expect(normalizeCompany("Arup Group")).toBe("arup");
    expect(normalizeTitle("Sr. BIM Modeller (m/f/d) - Remote")).toBe(normalizeTitle("Senior BIM Modeler"));
    expect(titleSimilarity("Senior BIM Coordinator", "BIM Coordinator (Senior)")).toBeGreaterThan(0.9);
    expect(titleSimilarity("BIM Coordinator", "Account Executive")).toBe(0);
  });
  it("computes description similarity", () => {
    const a = shingles(htmlToText(BIM_COORDINATOR_HTML));
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, shingles("completely different text about coffee and tea brewing at home"))).toBeLessThan(0.05);
  });
});

describe("validation", () => {
  const ok: NormalizedJobInput = { sourceJobId: "1", title: "BIM Coordinator", companyName: "Acme", description: "x".repeat(120), applyUrl: "https://a.com/1", canonicalUrl: "https://a.com/1" };
  it("accepts a well-formed posting", () => expect(validateJob(ok)).toEqual({ ok: true }));
  it("rejects structural problems with explicit reasons", () => {
    const bad = (o: Partial<NormalizedJobInput>) => { const r = validateJob({ ...ok, ...o }); return r.ok ? [] : r.reasons.join("|"); };
    expect(bad({ title: "" })).toMatch(/title/);
    expect(bad({ companyName: "" })).toMatch(/company/);
    expect(bad({ description: "short" })).toMatch(/description/);
    expect(bad({ applyUrl: "javascript:alert(1)" })).toMatch(/applyUrl/);
    expect(bad({ canonicalUrl: "not a url" })).toMatch(/canonicalUrl/);
    expect(bad({ title: "General Application" })).toMatch(/not a specific opening/);
    expect(bad({ title: "Join our Talent Network" })).toMatch(/not a specific opening/);
    expect(bad({ expiresAt: new Date("2020-01-01") })).toMatch(/expired/);
    expect(bad({ postedAt: new Date(Date.now() + 30 * 86400_000) })).toMatch(/future/);
    expect(bad({ salaryMin: 100, salaryMax: 50 })).toMatch(/inverted/);
  });
});

describe("robots.txt", () => {
  const txt = `User-agent: *\nDisallow: /private/\nAllow: /private/jobs/\nCrawl-delay: 5\n\nUser-agent: EvilBot\nDisallow: /`;
  it("applies the wildcard group, longest match wins, crawl-delay honoured", () => {
    const p = parseRobots(txt);
    expect(isAllowed(p, "/careers/1")).toBe(true);
    expect(isAllowed(p, "/private/x")).toBe(false);
    expect(isAllowed(p, "/private/jobs/1")).toBe(true);
    expect(p.crawlDelayMs).toBe(5000);
  });
  it("prefers a group addressed to our bot and supports wildcards", () => {
    const p = parseRobots(`User-agent: CareerPointBot\nDisallow: /*.json$\n\nUser-agent: *\nAllow: /`);
    expect(isAllowed(p, "/api/jobs.json")).toBe(false);
    expect(isAllowed(p, "/api/jobs")).toBe(true);
  });
  it("an empty Disallow allows everything", () => expect(isAllowed(parseRobots("User-agent: *\nDisallow:"), "/anything")).toBe(true));
});
