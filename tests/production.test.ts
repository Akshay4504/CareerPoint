import { describe, expect, it, vi } from "vitest";
import { AiError, completeResilient, getProvider } from "@/lib/ai/provider";
import { categorize, log, timed, withLogContext } from "@/lib/log";
import { absoluteUrl, jobPostingLd, jsonLd, pageMeta } from "@/lib/seo";
import { assertPublicHttpUrl } from "@/lib/jobs/http";
import { parseBenchmark, parseWeights } from "@/lib/scoring/store";
import { DEFAULT_WEIGHTS, DEFAULT_CONFIG, normalizeWeights } from "@/lib/scoring/config";
import { scoreResume } from "@/lib/scoring/engine";
import { emptyResume } from "@/lib/resume/types";
import robots from "@/app/robots";

const ok = (text = "answer") => new Response(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });

describe("AI provider resilience", () => {
  it("retries transient failures, then succeeds", async () => {
    let n = 0;
    const r = await completeResilient(["m1"], async () => {
      if (++n < 3) throw new AiError("unavailable", "boom");
      return { text: "fine" };
    }, { retries: 2, baseDelayMs: 1 });
    expect(r.text).toBe("fine");
    expect(n).toBe(3);
  });

  it("falls back to the next model when the first keeps failing", async () => {
    const seen: string[] = [];
    const r = await completeResilient(["primary", "backup"], async (m) => {
      seen.push(m);
      if (m === "primary") throw new AiError("unavailable", "down");
      return { text: "from backup", model: m };
    }, { retries: 1, baseDelayMs: 1 });
    expect(r.model).toBe("backup");
    expect(seen).toEqual(["primary", "primary", "backup"]);
  });

  it("does not retry a request the provider rejected, and surfaces a typed error", async () => {
    let n = 0;
    await expect(completeResilient(["m"], async () => { n++; throw new AiError("rejected", "bad request"); }, { retries: 3, baseDelayMs: 1 })).rejects.toMatchObject({ kind: "rejected" });
    expect(n).toBe(1);
  });

  it("is off without a key and reads credentials from the environment only", async () => {
    const prev = { key: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL, fb: process.env.AI_FALLBACK_MODEL, retries: process.env.AI_MAX_RETRIES };
    delete process.env.ANTHROPIC_API_KEY;
    expect(getProvider()).toBeNull();
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.AI_MODEL = "model-a";
    process.env.AI_FALLBACK_MODEL = "model-b";
    process.env.AI_MAX_RETRIES = "0";
    const calls: { model: string; max: number; key: string | null }[] = [];
    const fake = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ model: body.model, max: body.max_tokens, key: new Headers(init?.headers).get("x-api-key") });
      return body.model === "model-a" ? new Response("{}", { status: 503 }) : ok("hello");
    }) as unknown as typeof fetch;
    const p = getProvider(fake, 1)!;
    const res = await p.complete("sys", "user");
    expect(typeof res === "string" ? res : res.text).toBe("hello");
    expect(calls.map((c) => c.model)).toEqual(["model-a", "model-b"]);
    expect(calls[0].max).toBeLessThanOrEqual(2000); // hard output cap
    expect(calls[0].key).toBe("test-key");
    for (const [k, v] of Object.entries({ ANTHROPIC_API_KEY: prev.key, AI_MODEL: prev.model, AI_FALLBACK_MODEL: prev.fb, AI_MAX_RETRIES: prev.retries })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("treats timeouts and empty answers as failures, not as blank suggestions", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.AI_MAX_RETRIES = "0";
    const empty = getProvider((async () => new Response(JSON.stringify({ content: [] }), { status: 200 })) as unknown as typeof fetch, 1)!;
    await expect(empty.complete("s", "u")).rejects.toMatchObject({ kind: "empty" });
    const hang = getProvider((async () => { throw new DOMException("timeout", "TimeoutError"); }) as unknown as typeof fetch, 1)!;
    await expect(hang.complete("s", "u")).rejects.toMatchObject({ kind: "unavailable" });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_MAX_RETRIES;
  });
});

describe("structured logging", () => {
  it("emits one JSON line carrying request/user/job ids and a categorised error", () => {
    const lines: string[] = [];
    const w = vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => (lines.push(String(s)), true)) as never);
    withLogContext({ requestId: "req-1", userId: "u1" }, () => log.error("application.apply", { jobId: "j1", applicationId: "a1", source: "greenhouse", err: new Error("fetch failed ECONNRESET") }));
    w.mockRestore();
    const e = JSON.parse(lines[0]);
    expect(e).toMatchObject({ level: "error", event: "application.apply", requestId: "req-1", userId: "u1", jobId: "j1", applicationId: "a1", source: "greenhouse", errorCategory: "external" });
    expect(e.ts).toMatch(/^\d{4}-/);
  });

  it("times operations and logs failures with duration", async () => {
    const out: string[] = [];
    const wo = vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => (out.push(String(s)), true)) as never);
    const we = vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => (out.push(String(s)), true)) as never);
    await timed("op.ok", { jobId: "j" }, async () => 1);
    await expect(timed("op.bad", {}, async () => { throw new Error("nope"); })).rejects.toThrow("nope");
    wo.mockRestore();
    we.mockRestore();
    const [a, b] = out.map((l) => JSON.parse(l));
    expect(a).toMatchObject({ event: "op.ok", outcome: "ok" });
    expect(typeof a.durationMs).toBe("number");
    expect(b).toMatchObject({ event: "op.bad", outcome: "error", level: "error" });
  });

  it("categorises errors", () => {
    expect(categorize(Object.assign(new Error("x"), { name: "Forbidden" }))).toBe("forbidden");
    expect(categorize(new Error("Too many requests"))).toBe("rate_limit");
    expect(categorize(new Error("request timed out"))).toBe("timeout");
    expect(categorize(new Error("weird"))).toBe("internal");
  });
});

describe("SEO helpers", () => {
  it("builds canonical, OpenGraph and Twitter metadata, and can mark a page noindex", () => {
    const m = pageMeta({ title: "BIM jobs", description: "x".repeat(400), path: "/jobs" });
    expect(m.alternates?.canonical).toBe(absoluteUrl("/jobs"));
    expect((m.description ?? "").length).toBeLessThanOrEqual(200);
    expect(m.openGraph).toMatchObject({ url: absoluteUrl("/jobs"), siteName: "CareerPoint" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
    expect(pageMeta({ title: "t", description: "d", path: "/x", noindex: true }).robots).toMatchObject({ index: false });
  });

  it("emits JobPosting structured data only with real fields, and cannot break out of the script tag", () => {
    const ld = jobPostingLd({ title: "BIM Coordinator", description: "Coordinate models", slug: "bim-coordinator", companyName: "Acme", postedAt: new Date("2026-01-01"), employmentType: "Full-time", city: "Dubai", country: "UAE", salaryMin: 1000 });
    expect(ld).toMatchObject({ "@type": "JobPosting", employmentType: "FULL_TIME", title: "BIM Coordinator" });
    expect(ld).not.toHaveProperty("validThrough");
    expect(jobPostingLd({ title: "t", description: "d", slug: "s", companyName: "c", postedAt: new Date() })).not.toHaveProperty("baseSalary");
    expect(jsonLd({ description: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });

  it("robots.txt hides private areas and points at the sitemap", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    for (const p of ["/admin", "/employer", "/dashboard", "/api/", "/applications", "/settings"]) expect(rule.disallow).toContain(p);
    expect(r.sitemap).toContain("/sitemap.xml");
  });
});

describe("SSRF guard", () => {
  it("rejects loopback, private, link-local and IPv4-mapped IPv6 targets", async () => {
    for (const u of ["http://127.0.0.1/", "http://10.0.0.5/x", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "http://localhost/", "ftp://example.com/"]) {
      await expect(assertPublicHttpUrl(u), u).rejects.toThrow();
    }
  });
});

describe("scoring configuration", () => {
  it("sanitises weights and benchmark overrides from storage", () => {
    const w = parseWeights({ portfolio: 40, bimTerminology: -3, roleClarity: "abc" });
    expect(w.portfolio).toBe(40);
    expect(w.bimTerminology).toBe(DEFAULT_WEIGHTS.bimTerminology); // invalid -> default
    const b = parseBenchmark({ coordinator: { expectedProjects: 9, expectedQuantified: 999, typicalYears: [7, 3] }, bogus: { expectedProjects: 1 } });
    expect(b.coordinator).toEqual({ expectedProjects: 9 }); // out-of-range and inverted values dropped
    expect(b).not.toHaveProperty("bogus");
  });

  it("different weights change the score deterministically; same weights never do", () => {
    const content = { ...emptyResume(), headline: "BIM Coordinator", summary: "BIM coordinator on hospital projects using Revit and Navisworks.", software: ["Revit", "Navisworks"] };
    const base = scoreResume({ content }, DEFAULT_CONFIG, new Date("2026-01-01"));
    expect(scoreResume({ content }, DEFAULT_CONFIG, new Date("2026-01-01")).total).toBe(base.total);
    const heavyPortfolio = { ...DEFAULT_CONFIG, weights: { ...DEFAULT_WEIGHTS, portfolio: 80 } };
    expect(scoreResume({ content }, heavyPortfolio, new Date("2026-01-01")).total).toBeLessThan(base.total); // no portfolio -> heavier weight hurts
    expect(Object.values(normalizeWeights(heavyPortfolio.weights)).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("benchmark overrides raise or lower what a role is expected to show", () => {
    const content = { ...emptyResume(), headline: "BIM Coordinator", experiences: [{ title: "BIM Coordinator", company: "A", startDate: "2020-01", current: true, description: "• Resolved 120 clashes" }] } as never;
    const lenient = scoreResume({ content }, { ...DEFAULT_CONFIG, benchmark: { coordinator: { expectedQuantified: 1 } } }, new Date("2026-01-01"));
    const strict = scoreResume({ content }, { ...DEFAULT_CONFIG, benchmark: { coordinator: { expectedQuantified: 20 } } }, new Date("2026-01-01"));
    expect(lenient.total).toBeGreaterThan(strict.total);
  });
});
