import { describe, expect, it } from "vitest";
import { PoliteHttpClient } from "@/lib/jobs/http";
import { greenhouseConnector, leverConnector, ashbyConnector, rssConnector, jsonFeedConnector, careerPageConnector, getConnector, CONNECTOR_TYPES } from "@/lib/jobs/connectors";
import { extractJobPostings } from "@/lib/jobs/connectors/career-page";
import { SourceError, type ConnectorContext, type HttpLike } from "@/lib/jobs/types";
import { BIM_COORDINATOR_HTML, GENERIC_ARCHITECT_HTML, JSONLD_PAGE, RSS_FEED, SITEMAP, ashbyBoard, ashbyJob, greenhouseBoard, greenhouseJob, leverPosting } from "./fixtures/jobs";

// ---- fake HTTP layer for connectors ------------------------------------------------------------------------------
function fakeHttp(routes: Record<string, { status?: number; body: unknown } | (() => never)>): HttpLike & { calls: string[] } {
  const calls: string[] = [];
  const find = (url: string) => {
    calls.push(url);
    const hit = Object.entries(routes).sort((a, b) => b[0].length - a[0].length).find(([k]) => url.startsWith(k));
    if (!hit) return { status: 404, body: "" };
    if (typeof hit[1] === "function") hit[1]();
    return hit[1] as { status?: number; body: unknown };
  };
  return {
    calls,
    async getText(url) {
      const r = find(url);
      return { status: r.status ?? 200, text: typeof r.body === "string" ? r.body : JSON.stringify(r.body), url };
    },
    async getJson(url) {
      const r = find(url);
      return { status: r.status ?? 200, json: (r.status === 404 ? null : r.body) as never };
    },
  };
}
const ctx = (http: HttpLike, config: Record<string, unknown> = {}, url?: string): ConnectorContext => ({ sourceId: "s", config, url, http });

describe("connector registry", () => {
  it("has an independent connector for every public source type", () => {
    expect(CONNECTOR_TYPES.sort()).toEqual(["ASHBY", "CAREER_PAGE", "GREENHOUSE", "JSON", "LEVER", "RSS"]);
    for (const t of CONNECTOR_TYPES) {
      const c = getConnector(t);
      expect(typeof c.discoverJobs).toBe("function");
      expect(typeof c.fetchJob).toBe("function");
      expect(typeof c.normalizeJob).toBe("function");
      expect(typeof c.healthCheck).toBe("function");
    }
    expect(() => getConnector("MANUAL")).toThrow();
  });
});

describe("Greenhouse connector", () => {
  const board = greenhouseBoard([greenhouseJob(101, "BIM Coordinator", BIM_COORDINATOR_HTML), greenhouseJob(102, "Architect", GENERIC_ARCHITECT_HTML, "London, UK")]);
  const http = fakeHttp({ "https://boards-api.greenhouse.io/v1/boards/acme/jobs/101": { body: board.jobs[0] }, "https://boards-api.greenhouse.io/v1/boards/acme/jobs/999": { status: 404, body: null }, "https://boards-api.greenhouse.io/v1/boards/acme/jobs": { body: board }, "https://boards-api.greenhouse.io/v1/boards/acme": { body: { name: "Acme" } } });
  const c = ctx(http, { board: "acme" });

  it("discovers the full board with payloads and marks the listing complete", async () => {
    const d = await greenhouseConnector.discoverJobs(c);
    expect(d.complete).toBe(true);
    expect(d.jobs.map((j) => j.sourceJobId)).toEqual(["101", "102"]);
    expect(http.calls[0]).toContain("content=true");
  });
  it("normalizes entity-escaped HTML, sections, location, salary, experience, remote, dates and canonical URL", async () => {
    const d = await greenhouseConnector.discoverJobs(c);
    const n = greenhouseConnector.normalizeJob(c, d.jobs[0].payload, d.jobs[0])!;
    expect(n.title).toBe("BIM Coordinator");
    expect(n.companyName).toBe("Acme Engineering Ltd");
    expect(n.description).toContain("clash detection");
    expect(n.description).not.toMatch(/&lt;|<p>/);
    expect(n.responsibilities).toContain("BIM Execution Plan");
    expect(n.requirements).toContain("3-5 years");
    expect(n).toMatchObject({ city: "Bengaluru", country: "India", remoteType: "HYBRID", experienceMin: 3, experienceMax: 5, salaryMin: 1800000, salaryMax: 2400000, currency: "INR" });
    expect(n.postedAt?.toISOString()).toBe("2026-09-28T14:00:00.000Z");
    expect(n.canonicalUrl).toBe("https://boards.greenhouse.io/acme/jobs/101?gh_jid=101"); // utm removed, gh_jid kept
  });
  it("returns null for unusable payloads instead of inventing data", () => {
    expect(greenhouseConnector.normalizeJob(c, { id: 1, title: "x" }, { sourceJobId: "1", url: "https://x" })).toBeNull();
  });
  it("fetchJob returns the payload, or null when the job is gone (404)", async () => {
    expect(await greenhouseConnector.fetchJob(c, { sourceJobId: "101", url: "u" })).toMatchObject({ id: 101 });
    expect(await greenhouseConnector.fetchJob(c, { sourceJobId: "999", url: "u" })).toBeNull();
  });
  it("health check reports reachability; a missing board is a non-retryable error", async () => {
    expect((await greenhouseConnector.healthCheck(c)).ok).toBe(true);
    const bad = ctx(fakeHttp({ "https://boards-api.greenhouse.io/v1/boards/ghost/jobs": { status: 404, body: null } }), { board: "ghost" });
    await expect(greenhouseConnector.discoverJobs(bad)).rejects.toMatchObject({ retryable: false, status: 404 });
    expect((await greenhouseConnector.healthCheck(bad)).ok).toBe(false);
  });
  it("rejects invalid board tokens without making a request", async () => {
    const h = fakeHttp({});
    await expect(greenhouseConnector.discoverJobs(ctx(h, { board: "../../etc" }))).rejects.toBeInstanceOf(SourceError);
    expect(h.calls).toHaveLength(0);
  });
});

describe("Lever connector", () => {
  const http = fakeHttp({ "https://api.lever.co/v0/postings/acme/nope": { status: 404, body: null }, "https://api.lever.co/v0/postings/acme/abc": { body: leverPosting("abc", "BIM Coordinator", "Coordinate Revit and Navisworks models.") }, "https://api.lever.co/v0/postings/acme": { body: [leverPosting("abc", "BIM Coordinator", "Coordinate Revit and Navisworks models, clash detection and ISO 19650 compliance for hospital projects. 3-5 years of experience.")] } });
  const c = ctx(http, { company: "acme", display: "Acme Co" });
  it("discovers postings and normalizes them (workplaceType, ISO country, list headings, epoch date)", async () => {
    const d = await leverConnector.discoverJobs(c);
    expect(d.jobs).toHaveLength(1);
    const n = leverConnector.normalizeJob(c, d.jobs[0].payload, d.jobs[0])!;
    expect(n).toMatchObject({ title: "BIM Coordinator", companyName: "Acme Co", city: "Bengaluru", country: "India", remoteType: "HYBRID", employmentType: "Full-time" });
    expect(n.requirements).toContain("Revit and Navisworks");
    expect(n.postedAt?.toISOString()).toBe("2026-09-29T08:00:00.000Z");
    expect(n.applyUrl).toBe("https://jobs.lever.co/acme/abc/apply");
    expect(n.canonicalUrl).toBe("https://jobs.lever.co/acme/abc");
  });
  it("fetchJob works and gone postings return null", async () => {
    expect(await leverConnector.fetchJob(c, { sourceJobId: "abc", url: "" })).toMatchObject({ id: "abc" });
    expect(await leverConnector.fetchJob(c, { sourceJobId: "nope", url: "" })).toBeNull();
  });
});

describe("Ashby connector", () => {
  const http = fakeHttp({ "https://api.ashbyhq.com/posting-api/job-board/acme": { body: ashbyBoard([ashbyJob("a1", "BIM Engineer", BIM_COORDINATOR_HTML), { ...ashbyJob("a2", "Hidden", "<p>x</p>"), isListed: false }]) } });
  const c = ctx(http, { board: "acme", company: "Acme" });
  it("lists only publicly listed jobs and normalizes compensation and workplace type", async () => {
    const d = await ashbyConnector.discoverJobs(c);
    expect(d.jobs.map((j) => j.sourceJobId)).toEqual(["a1"]);
    const n = ashbyConnector.normalizeJob(c, d.jobs[0].payload, d.jobs[0])!;
    expect(n).toMatchObject({ city: "London", country: "United Kingdom", remoteType: "HYBRID", employmentType: "Full-time", salaryMin: 55000, salaryMax: 70000, currency: "GBP" });
  });
  it("recheck finds a job by id and returns null when it was removed or unlisted", async () => {
    expect(await ashbyConnector.fetchJob(c, { sourceJobId: "a1", url: "" })).toMatchObject({ id: "a1" });
    expect(await ashbyConnector.fetchJob(c, { sourceJobId: "a2", url: "" })).toBeNull();
    expect(await ashbyConnector.fetchJob(c, { sourceJobId: "zzz", url: "" })).toBeNull();
  });
});

describe("RSS and JSON feeds", () => {
  it("parses RSS items, splits 'Title at Company', skips malformed items", async () => {
    const c = ctx(fakeHttp({ "https://feed.example/rss": { body: RSS_FEED } }), {}, "https://feed.example/rss");
    const d = await rssConnector.discoverJobs(c);
    expect(d.jobs).toHaveLength(2);
    const n = rssConnector.normalizeJob(c, d.jobs[0].payload, d.jobs[0])!;
    expect(n).toMatchObject({ title: "BIM Modeler", companyName: "Beta Consultants", experienceMin: 2 });
    expect(n.description).not.toContain("<p>");
    expect(rssConnector.normalizeJob(c, d.jobs[1].payload, d.jobs[1])).toMatchObject({ title: "Barista", companyName: "Cafe" }); // structurally valid; BIM classification rejects it later
    expect(rssConnector.normalizeJob(c, { id: "z", title: "Revit Modeler", link: "https://z.example/1", description: "x".repeat(100) }, { sourceJobId: "z", url: "https://z.example/1" })).toBeNull(); // no company → unusable, never guessed
  });
  it("an empty feed is an incomplete listing, never a signal to expire jobs", async () => {
    const d = await rssConnector.discoverJobs(ctx(fakeHttp({ "https://feed.example/rss": { body: "<rss><channel></channel></rss>" } }), {}, "https://feed.example/rss"));
    expect(d.complete).toBe(false);
  });
  it("JSON feeds accept common field aliases and numeric ids", async () => {
    const body = { jobs: [{ id: 7, title: "Revit Modeler", company_name: "Delta", url: "https://delta.example/7", description: "<p>" + "Model in Revit for towers. ".repeat(5) + "</p>", candidate_required_location: "Dubai, UAE" }, { title: "no id" }] };
    const c = ctx(fakeHttp({ "https://feed.example/j": { body } }), {}, "https://feed.example/j");
    const d = await jsonFeedConnector.discoverJobs(c);
    expect(d.jobs).toHaveLength(1);
    expect(jsonFeedConnector.normalizeJob(c, d.jobs[0].payload, d.jobs[0])).toMatchObject({ sourceJobId: "7", companyName: "Delta", country: "United Arab Emirates" });
  });
  it("invalid JSON is a non-retryable source error", async () => {
    await expect(jsonFeedConnector.discoverJobs(ctx(fakeHttp({ "https://feed.example/j": { body: "{not json" } }), {}, "https://feed.example/j"))).rejects.toMatchObject({ retryable: false });
  });
});

describe("Career-page connector (schema.org JobPosting)", () => {
  it("extracts JobPosting from JSON-LD, including @graph", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"JobPosting","title":"X"}]}</script><script type="application/ld+json">not json</script>`;
    expect(extractJobPostings(html)).toHaveLength(1);
  });
  it("discovers URLs from a sitemap (filtered by pattern), fetches pages and normalizes salary, expiry and location", async () => {
    const desc = `<p>${BIM_COORDINATOR_HTML}</p>`;
    const http = fakeHttp({ "https://gamma.example/sitemap.xml": { body: SITEMAP }, "https://gamma.example/jobs/1": { body: JSONLD_PAGE("BIM Manager", desc) }, "https://gamma.example/jobs/2": { status: 404, body: "" } });
    const c = ctx(http, { company: "Gamma", sitemaps: ["https://gamma.example/sitemap.xml"], urlPattern: "/jobs/" });
    const d = await careerPageConnector.discoverJobs(c);
    expect(d.jobs.map((j) => j.sourceJobId).sort()).toEqual(["https://gamma.example/jobs/1", "https://gamma.example/jobs/2"]);
    const raw = await careerPageConnector.fetchJob(c, d.jobs.find((j) => j.url.endsWith("/1"))!);
    const n = careerPageConnector.normalizeJob(c, raw, d.jobs[0])!;
    expect(n).toMatchObject({ title: "BIM Manager", companyName: "Gamma Infrastructure", city: "Dubai", country: "United Arab Emirates", employmentType: "Full-time", salaryMin: 240000, salaryMax: 300000, currency: "AED" });
    expect(n.expiresAt?.getUTCFullYear()).toBe(2026);
    expect(await careerPageConnector.fetchJob(c, d.jobs.find((j) => j.url.endsWith("/2"))!)).toBeNull(); // 404 → gone
  });
  it("a page that loads but has no JobPosting means the opening was taken down", async () => {
    const c = ctx(fakeHttp({ "https://gamma.example/jobs/1": { body: "<html>Position filled</html>" } }), { company: "G" });
    expect(await careerPageConnector.fetchJob(c, { sourceJobId: "x", url: "https://gamma.example/jobs/1" })).toBeNull();
  });
  it("a failing sitemap makes the listing incomplete (so nothing is expired from it)", async () => {
    const http = fakeHttp({ "https://gamma.example/ok.xml": { body: SITEMAP }, "https://gamma.example/bad.xml": { status: 500, body: "" } });
    const d = await careerPageConnector.discoverJobs(ctx(http, { company: "G", sitemaps: ["https://gamma.example/ok.xml", "https://gamma.example/bad.xml"] }));
    expect(d.complete).toBe(false);
    expect(d.warnings.join(" ")).toMatch(/bad\.xml/);
    expect(d.jobs.length).toBeGreaterThan(0);
  });
  it("needs something to crawl", async () => {
    await expect(careerPageConnector.discoverJobs(ctx(fakeHttp({}), { company: "G" }))).rejects.toMatchObject({ retryable: false });
  });
});

// ---- polite HTTP client ----------------------------------------------------------------------------------------------
type Step = { status?: number; body?: string; headers?: Record<string, string>; throw?: Error };
function scripted(steps: Record<string, Step[]>) {
  const hits: Record<string, number> = {};
  const log: { url: string; at: number }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    log.push({ url, at: Date.now() });
    const key = Object.keys(steps).find((k) => url.startsWith(k));
    if (!key) return new Response("", { status: 404 });
    const i = (hits[key] = (hits[key] ?? -1) + 1);
    const s = steps[key][Math.min(i, steps[key].length - 1)];
    if (s.throw) throw s.throw;
    return new Response(s.body ?? "", { status: s.status ?? 200, headers: s.headers });
  }) as typeof fetch;
  return { fetchImpl, log, hits };
}
const client = (steps: Record<string, Step[]>, extra: ConstructorParameters<typeof PoliteHttpClient>[0] = {}) => {
  const s = scripted({ "https://api.test/robots.txt": [{ status: 404 }], ...steps });
  const sleeps: number[] = [];
  const http = new PoliteHttpClient({ fetchImpl: s.fetchImpl, sleep: async (ms) => void sleeps.push(ms), skipUrlCheck: true, minIntervalMs: 0, baseBackoffMs: 100, maxRetries: 3, ...extra });
  return { http, sleeps, ...s };
};

describe("PoliteHttpClient: retries, backoff, throttling, robots", () => {
  it("retries 5xx with exponential backoff and then succeeds", async () => {
    const c = client({ "https://api.test/x": [{ status: 503 }, { status: 500 }, { status: 200, body: "ok" }] });
    const r = await c.http.getText("https://api.test/x");
    expect(r.text).toBe("ok");
    expect(c.http.retries).toBe(2);
    const backoffs = c.sleeps.filter((s) => s >= 100);
    expect(backoffs[0]).toBeGreaterThanOrEqual(100);
    expect(backoffs[1]).toBeGreaterThanOrEqual(200); // doubled
  });
  it("gives up after maxRetries with a retryable SourceError", async () => {
    const c = client({ "https://api.test/x": [{ status: 500 }] });
    await expect(c.http.getText("https://api.test/x")).rejects.toMatchObject({ retryable: true });
    expect(c.hits["https://api.test/x"]).toBe(3); // initial + retries per cap (index of last hit)
  });
  it("429 honours Retry-After (it slows down, never evades)", async () => {
    const c = client({ "https://api.test/x": [{ status: 429, headers: { "retry-after": "7" } }, { status: 200, body: "ok" }] });
    await c.http.getText("https://api.test/x");
    expect(Math.max(...c.sleeps)).toBeGreaterThanOrEqual(7000);
  });
  it("network errors and timeouts are retried", async () => {
    const c = client({ "https://api.test/x": [{ throw: new Error("ECONNRESET") }, { throw: Object.assign(new Error("timed out"), { name: "TimeoutError" }) }, { body: "fine" }] });
    expect((await c.http.getText("https://api.test/x")).text).toBe("fine");
  });
  it("4xx (other than 429) fails immediately without retrying; 404/410 are reported as gone", async () => {
    const c = client({ "https://api.test/x": [{ status: 403 }], "https://api.test/gone": [{ status: 404 }], "https://api.test/old": [{ status: 410 }] });
    await expect(c.http.getText("https://api.test/x")).rejects.toMatchObject({ retryable: false, status: 403 });
    expect(c.http.retries).toBe(0);
    expect((await c.http.getText("https://api.test/gone")).status).toBe(404);
    expect((await c.http.getText("https://api.test/old")).status).toBe(410);
  });
  it("throttles requests to the same host", async () => {
    const c = client({ "https://api.test/a": [{ body: "1" }], "https://api.test/b": [{ body: "2" }] }, { minIntervalMs: 1500 });
    await c.http.getText("https://api.test/a");
    await c.http.getText("https://api.test/b");
    expect(c.sleeps.some((s) => s > 0 && s <= 1500)).toBe(true);
  });
  it("obeys robots.txt: disallowed paths are refused (not circumvented) and nothing is fetched", async () => {
    const c = client({ "https://api.test/robots.txt": [{ body: "User-agent: *\nDisallow: /private/" }], "https://api.test/private/jobs": [{ body: "secret" }], "https://api.test/open": [{ body: "ok" }] });
    await expect(c.http.getText("https://api.test/private/jobs")).rejects.toMatchObject({ retryable: false, status: 403 });
    expect(c.log.some((l) => l.url.includes("/private/jobs"))).toBe(false);
    expect((await c.http.getText("https://api.test/open")).text).toBe("ok");
  });
  it("an unreachable robots.txt is treated conservatively (no crawling)", async () => {
    const c = client({ "https://api.test/robots.txt": [{ status: 500 }], "https://api.test/x": [{ body: "ok" }] });
    await expect(c.http.getText("https://api.test/x")).rejects.toMatchObject({ retryable: false });
  });
  it("crawl-delay in robots.txt slows requests", async () => {
    const c = client({ "https://api.test/robots.txt": [{ body: "User-agent: *\nCrawl-delay: 4" }], "https://api.test/x": [{ body: "ok" }], "https://api.test/y": [{ body: "ok" }] });
    await c.http.getText("https://api.test/x");
    await c.http.getText("https://api.test/y");
    expect(c.sleeps.some((s) => s > 3000)).toBe(true);
  });
  it("redirects are followed manually, re-validated, and capped", async () => {
    const ok = client({ "https://api.test/a": [{ status: 302, headers: { location: "/b" } }], "https://api.test/b": [{ body: "landed" }] });
    expect((await ok.http.getText("https://api.test/a")).text).toBe("landed");
    const loop = client({ "https://api.test/a": [{ status: 302, headers: { location: "/a" } }] });
    await expect(loop.http.getText("https://api.test/a")).rejects.toMatchObject({ message: /redirect/i });
  });
  it("identifies itself with a bot user agent and refuses oversized responses", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (_u: RequestInfo | URL, init?: RequestInit) => { seen.push(String((init?.headers as Record<string, string>)["user-agent"])); return new Response("x".repeat(50), { status: 200, headers: { "content-length": "50" } }); }) as typeof fetch;
    const h = new PoliteHttpClient({ fetchImpl, sleep: async () => {}, skipUrlCheck: true, minIntervalMs: 0, respectRobots: false, maxBytes: 10 });
    await expect(h.getText("https://api.test/x")).rejects.toMatchObject({ message: /too large/i });
    expect(seen[0]).toMatch(/CareerPointBot/);
  });
  it("refuses private / non-public targets before any request (SSRF)", async () => {
    const s = scripted({});
    const h = new PoliteHttpClient({ fetchImpl: s.fetchImpl, sleep: async () => {}, minIntervalMs: 0 });
    for (const u of ["http://127.0.0.1/x", "http://169.254.169.254/latest", "http://localhost:3000/", "file:///etc/passwd"]) await expect(h.getText(u)).rejects.toBeInstanceOf(SourceError);
    expect(s.log).toHaveLength(0);
  });
});
