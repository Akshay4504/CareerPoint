import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN, cleanup, makeSource, makeUser } from "./helpers";
import { db } from "@/lib/db";
import { checkSourceHealth, discoverSource, expireByDate, fetchRaw, findStale, processRaw, recheckRef } from "@/lib/jobs/pipeline";
import { SourceError, type HttpLike } from "@/lib/jobs/types";
import { BIM_COORDINATOR_HTML, GENERIC_ARCHITECT_HTML, SALES_HTML, JSONLD_PAGE, SITEMAP, greenhouseBoard, greenhouseJob, leverPosting, RSS_FEED } from "../fixtures/jobs";

afterAll(cleanup);

// A fresh company per test keeps cross-test duplicates out, and the RUN token isolates this suite from real data.
let COMPANY = `${RUN} C0 Engineering Ltd`;
let seq = 0;
beforeEach(() => {
  COMPANY = `${RUN} C${++seq} Engineering Ltd`;
});
type Route = { status?: number; body: unknown } | Error;

function http(routes: Record<string, Route | (() => Route)>): HttpLike & { calls: string[] } {
  const calls: string[] = [];
  const hit = (url: string) => {
    calls.push(url);
    const k = Object.keys(routes).sort((a, b) => b.length - a.length).find((x) => url.startsWith(x));
    if (!k) return { status: 404, body: "" };
    const r = typeof routes[k] === "function" ? (routes[k] as () => Route)() : (routes[k] as Route);
    if (r instanceof Error) throw r;
    return r;
  };
  return {
    calls,
    async getText(url) { const r = hit(url); return { status: r.status ?? 200, text: typeof r.body === "string" ? r.body : JSON.stringify(r.body), url }; },
    async getJson(url) { const r = hit(url); return { status: r.status ?? 200, json: (r.status === 404 ? null : r.body) as never }; },
  };
}

const ghUrl = "https://boards-api.greenhouse.io/v1/boards";
const board = (...jobs: ReturnType<typeof greenhouseJob>[]) => ({ body: greenhouseBoard(jobs) });
const coordinator = (id = 1001, html = BIM_COORDINATOR_HTML) => greenhouseJob(id, "Senior BIM Coordinator", html, "Bengaluru, Karnataka, India", COMPANY);

async function drain(sourceId: string, h: HttpLike) {
  const raws = await db.rawJob.findMany({ where: { sourceId, status: "NEW" }, orderBy: { fetchedAt: "asc" } });
  const out = [];
  for (const r of raws) out.push(await processRaw(r.id, { http: h }));
  return out;
}

describe("ingestion pipeline: discover → process → structured job", () => {
  it("stores raw payloads separately, rejects non-BIM postings, and creates a fully structured job", async () => {
    const src = await makeSource("GREENHOUSE", { board: "acme" });
    const h = http({ [`${ghUrl}/acme/jobs`]: board(coordinator(), greenhouseJob(1002, "Architect", GENERIC_ARCHITECT_HTML, "London, UK", COMPANY), greenhouseJob(1003, "Account Executive", SALES_HTML, "Remote", COMPANY)) });
    const run = await discoverSource(src.id, { http: h });
    expect(run).toMatchObject({ found: 3, complete: true });
    expect(await db.rawJob.count({ where: { sourceId: src.id, status: "NEW" } })).toBe(3);
    // Work is queued, not done inline: nothing normalized yet.
    expect(await db.job.count({ where: { sourceId: src.id } })).toBe(0);
    expect(await db.queueJob.count({ where: { queue: "job.process", dedupeKey: { startsWith: "process:" }, payload: { path: ["rawJobId"], string_contains: "" } } })).toBeGreaterThanOrEqual(3);

    const outcomes = await drain(src.id, h);
    expect(outcomes.map((o) => o.status).sort()).toEqual(["created", "rejected", "rejected"]);

    const raws = await db.rawJob.findMany({ where: { sourceId: src.id }, orderBy: { sourceJobId: "asc" } });
    expect(raws.map((r) => r.status)).toEqual(["PROCESSED", "REJECTED", "REJECTED"]);
    expect(raws[1].reason).toMatch(/not a BIM role/);
    expect((raws[0].rawPayload as { content: string }).content).toMatch(/&lt;h2&gt;/); // original source response kept verbatim
    expect(raws[0].hash).toHaveLength(64);
    expect(raws[0].jobId).toBeTruthy();

    const job = await db.job.findFirstOrThrow({ where: { sourceId: src.id }, include: { refs: true } });
    expect(job).toMatchObject({ title: "Senior BIM Coordinator", companyName: COMPANY, status: "ACTIVE", bimRole: "BIM Coordinator", discipline: null, city: "Bengaluru", country: "India", remoteType: "HYBRID", remote: false, experienceMin: 3, experienceMax: 5, salaryMin: 1800000, salaryMax: 2400000, salaryCurrency: "INR", seniority: "Senior", sourceJobId: "1001", employmentType: null });
    expect(job.canonicalUrl).toBe("https://boards.greenhouse.io/acme/jobs/1001?gh_jid=1001");
    expect(job.software).toEqual(expect.arrayContaining(["Revit", "Navisworks", "Dynamo"]));
    expect(job.skills).toEqual(expect.arrayContaining(["ISO 19650", "COBie"]));
    expect(job.responsibilities).toContain("BIM Execution Plan");
    expect(job.requirements).toContain("3-5 years");
    expect(job.bimRelevanceScore).toBeGreaterThanOrEqual(65);
    expect(job.qualityScore).toBeGreaterThan(60);
    expect((job.qualityBreakdown as { parts: Record<string, number> }).parts.bimRelevance).toBeGreaterThan(15);
    expect(job.discoveredAt).toBeInstanceOf(Date);
    expect(job.lastSeenAt).toBeInstanceOf(Date);
    expect(job.refs).toHaveLength(1);
    expect(job.slug).toMatch(/^senior-bim-coordinator/);
    const final = await db.ingestionRun.findUniqueOrThrow({ where: { id: run.runId } });
    expect(final).toMatchObject({ status: "OK", complete: true, found: 3 });
    expect(final.durationMs).toBeGreaterThanOrEqual(0);
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: src.id } })).toMatchObject({ health: "HEALTHY", lastStatus: "OK", consecutiveFailures: 0 });
    // per-run counters for the admin dashboard
    const counted = await db.ingestionRun.findUniqueOrThrow({ where: { id: run.runId } });
    expect(counted.accepted).toBe(1);
    expect(counted.rejected).toBe(2);
  });

  it("is incremental: unchanged payloads are not reprocessed; changed payloads update the same job", async () => {
    const src = await makeSource("GREENHOUSE", { board: "inc" });
    const first = http({ [`${ghUrl}/inc/jobs`]: board(coordinator(2001)) });
    await discoverSource(src.id, { http: first });
    await drain(src.id, first);
    const job = await db.job.findFirstOrThrow({ where: { sourceId: src.id } });

    const again = await discoverSource(src.id, { http: first });
    expect(again).toMatchObject({ found: 1, unchanged: 1, queued: 0 });
    expect(await db.rawJob.count({ where: { sourceId: src.id, status: "NEW" } })).toBe(0);
    const bumped = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(bumped.lastSeenAt.getTime()).toBeGreaterThanOrEqual(job.lastSeenAt.getTime());

    const edited = http({ [`${ghUrl}/inc/jobs`]: board(coordinator(2001, BIM_COORDINATOR_HTML + "<p>We also need Solibri model checking experience.</p>")) });
    await discoverSource(src.id, { http: edited });
    // The changed payload resets the raw row for reprocessing and a (deduplicated) process task exists for it.
    const raw = await db.rawJob.findFirstOrThrow({ where: { sourceId: src.id } });
    expect(raw.status).toBe("NEW");
    expect(await db.queueJob.count({ where: { queue: "job.process", dedupeKey: `process:${raw.id}` } })).toBe(1);
    const out = await drain(src.id, edited);
    expect(out[0].status).toBe("updated");
    expect(await db.job.count({ where: { sourceId: src.id } })).toBe(1);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).description).toContain("Solibri");
  });

  it("merges the same opening found on other sources, keeps provenance, and shows one job", async () => {
    const gh = await makeSource("GREENHOUSE", { board: "dup" }, { reliability: 90 });
    const lv = await makeSource("LEVER", { company: "dup", display: COMPANY.replace("Ltd", "Limited") }, { reliability: 90 });
    const agg = await makeSource("RSS", {}, { reliability: 55, url: "https://agg.example/rss" });
    const ghH = http({ [`${ghUrl}/dup/jobs`]: board(coordinator(3001)) });
    await discoverSource(gh.id, { http: ghH });
    await drain(gh.id, ghH);
    const canonical = await db.job.findFirstOrThrow({ where: { sourceId: gh.id } });

    // Same role on Lever: different id/URL, company suffix variant, reworded title.
    const lvH = http({ "https://api.lever.co/v0/postings/dup": { body: [{ ...leverPosting("lv-1", "BIM Coordinator (Senior)", htmlText(BIM_COORDINATOR_HTML)), createdAt: Date.parse("2026-09-29T00:00:00Z") }] } });
    await discoverSource(lv.id, { http: lvH });
    const lvOut = await drain(lv.id, lvH);
    expect(lvOut[0]).toMatchObject({ status: "duplicate", jobId: canonical.id });

    // Aggregator copy (different wording, lower reliability).
    const aggFeed = `<rss><channel><item><title>Senior BIM Coordinator at ${COMPANY}</title><link>https://agg.example/j/9</link><guid>agg-9</guid><description>${htmlText(BIM_COORDINATOR_HTML)} Posted via aggregator.</description><location>Bengaluru, India</location><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    const aggH = http({ "https://agg.example/rss": { body: aggFeed } });
    await discoverSource(agg.id, { http: aggH });
    const aggOut = await drain(agg.id, aggH);
    expect(aggOut[0].status).toBe("duplicate");

    const jobs = await db.job.findMany({ where: { companyName: COMPANY, title: { contains: "BIM Coordinator" } } });
    expect(jobs).toHaveLength(1); // one canonical row for three sources
    const refs = await db.jobSourceRef.findMany({ where: { jobId: canonical.id }, include: { source: true } });
    expect(refs.map((r) => r.source.type).sort()).toEqual(["GREENHOUSE", "LEVER", "RSS"]);
    expect((await db.job.findUniqueOrThrow({ where: { id: canonical.id } })).duplicateProbability).toBeGreaterThan(0.7);
    expect(await db.rawJob.count({ where: { jobId: canonical.id, status: "DUPLICATE" } })).toBe(2);
    expect(jobs[0].sourceId).toBe(gh.id); // the highest-reliability, richest source stays canonical
  });

  it("does not merge different openings: other city, other title, other company", async () => {
    const src = await makeSource("GREENHOUSE", { board: "diff" });
    const h = http({ [`${ghUrl}/diff/jobs`]: board(coordinator(4001), greenhouseJob(4002, "Senior BIM Coordinator", BIM_COORDINATOR_HTML, "London, UK", COMPANY), greenhouseJob(4003, "BIM Manager", BIM_COORDINATOR_HTML, "Bengaluru, India", COMPANY), greenhouseJob(4004, "Senior BIM Coordinator", BIM_COORDINATOR_HTML, "Bengaluru, India", `Globex ${RUN} Corporation`)) });
    await discoverSource(src.id, { http: h });
    const out = await drain(src.id, h);
    expect(out.map((o) => o.status)).toEqual(["created", "created", "created", "created"]);
  });

  it("validation failures are rejected with reasons and counted", async () => {
    const src = await makeSource("GREENHOUSE", { board: "val" });
    const tiny = { ...coordinator(5001), content: "&lt;p&gt;BIM Coordinator needed&lt;/p&gt;" };
    const general = greenhouseJob(5002, "General Application — BIM", BIM_COORDINATOR_HTML, "London, UK", COMPANY);
    const h = http({ [`${ghUrl}/val/jobs`]: board(tiny, general) });
    await discoverSource(src.id, { http: h });
    const out = await drain(src.id, h);
    expect(out.every((o) => o.status === "rejected")).toBe(true);
    const reasons = (await db.rawJob.findMany({ where: { sourceId: src.id } })).map((r) => r.reason).join(" | ");
    expect(reasons).toMatch(/description too short/);
    expect(reasons).toMatch(/not a specific opening/);
  });

  it("career-page sources fetch pages through the queue (one task per page, spaced out) and ingest JobPosting data", async () => {
    const src = await makeSource("CAREER_PAGE", { company: `${RUN} Infrastructure`, sitemaps: ["https://gamma.example/sitemap.xml"], urlPattern: "/jobs/" });
    const h = http({ "https://gamma.example/sitemap.xml": { body: SITEMAP }, "https://gamma.example/jobs/1": { body: JSONLD_PAGE("BIM Manager", `<p>${BIM_COORDINATOR_HTML}</p>`) }, "https://gamma.example/jobs/2": { status: 404, body: "" } });
    const run = await discoverSource(src.id, { http: h });
    expect(run.found).toBe(2);
    const tasks = await db.queueJob.findMany({ where: { queue: "job.fetch", payload: { path: ["sourceId"], equals: src.id } }, orderBy: { runAt: "asc" } });
    expect(tasks).toHaveLength(2);
    expect(tasks[1].runAt.getTime()).toBeGreaterThanOrEqual(tasks[0].runAt.getTime()); // staggered
    const rawId = await fetchRaw(src.id, { sourceJobId: "https://gamma.example/jobs/1", url: "https://gamma.example/jobs/1" }, { http: h });
    expect(rawId).toBeTruthy();
    const out = await processRaw(rawId!, { http: h });
    expect(out.status).toBe("created");
    const job = await db.job.findFirstOrThrow({ where: { sourceId: src.id } });
    expect(job).toMatchObject({ bimRole: "BIM Manager", city: "Dubai", country: "United Arab Emirates", salaryMin: 240000, salaryCurrency: "AED" });
    expect(job.expiresAt).toBeInstanceOf(Date);
    // a removed page is recorded, not ingested
    expect(await fetchRaw(src.id, { sourceJobId: "https://gamma.example/jobs/2", url: "https://gamma.example/jobs/2" }, { http: h })).toBeNull();
  });
});

function htmlText(h: string) {
  return h.replace(/<\/(li|p|h\d)>/g, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ");
}

describe("expiry, rechecks and reappearing jobs", () => {
  async function liveJob(board: string, reliability = 90) {
    const src = await makeSource("GREENHOUSE", { board }, { reliability, expireAfterDays: 4 });
    const listing = http({ [`${ghUrl}/${board}/jobs`]: board_(coordinator(6000 + Math.floor(Math.random() * 999))) });
    await discoverSource(src.id, { http: listing });
    await drain(src.id, listing);
    const ref = await db.jobSourceRef.findFirstOrThrow({ where: { sourceId: src.id } });
    return { src, ref, jobId: ref.jobId };
  }
  const board_ = (j: ReturnType<typeof greenhouseJob>) => board(j);
  const old = (days: number) => new Date(Date.now() - days * 86400_000);

  it("a job that vanishes from a complete listing is rechecked, then becomes INACTIVE — never deleted, applications kept", async () => {
    const { src, ref, jobId } = await liveJob("exp1");
    const { user } = await makeUser("applicant");
    const app = await db.application.create({ data: { userId: user.id, jobId, external: true } });
    // The source now returns an empty-but-complete board (the job was taken down).
    const empty = http({ [`${ghUrl}/exp1/jobs`]: board() });
    const emptyRun = await discoverSource(src.id, { http: empty });
    expect(emptyRun.found).toBe(0);
    await db.ingestionRun.update({ where: { id: emptyRun.runId }, data: { complete: true } }); // listing was authoritative
    await db.jobSourceRef.update({ where: { id: ref.id }, data: { lastSeenAt: old(6) } });

    expect(await findStale(new Date())).toBeGreaterThanOrEqual(1); // queued a recheck
    expect(await db.queueJob.count({ where: { queue: "job.recheck", payload: { path: ["refId"], equals: ref.id } } })).toBe(1);

    const gone = http({ [`${ghUrl}/exp1/jobs/`]: { status: 404, body: null } });
    expect(await recheckRef(ref.id, { http: gone })).toBe("expired");
    expect(await db.jobSourceRef.findUniqueOrThrow({ where: { id: ref.id } })).toMatchObject({ active: false });
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: "INACTIVE" });
    expect(await db.application.findUnique({ where: { id: app.id } })).not.toBeNull();
  });

  it("a job still live at the source is kept alive by the recheck", async () => {
    const { ref, jobId, src } = await liveJob("exp2");
    await db.jobSourceRef.update({ where: { id: ref.id }, data: { lastSeenAt: old(6) } });
    const live = http({ [`${ghUrl}/exp2/jobs/`]: { body: greenhouseJob(Number(ref.sourceJobId), "Senior BIM Coordinator", BIM_COORDINATOR_HTML, "Bengaluru, India", COMPANY) } });
    expect(await recheckRef(ref.id, { http: live })).toBe("alive");
    const j = await db.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(j.status).toBe("ACTIVE");
    expect(Date.now() - j.lastSeenAt.getTime()).toBeLessThan(60_000);
    void src;
  });

  it("transient errors during a recheck never expire a job", async () => {
    const { ref, jobId } = await liveJob("exp3");
    const flaky = { async getText() { throw new SourceError("Server error 503", true, 503); }, async getJson() { throw new SourceError("Server error 503", true, 503); } } as HttpLike;
    await expect(recheckRef(ref.id, { http: flaky })).rejects.toBeInstanceOf(SourceError);
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("ACTIVE");
  });

  it("a job also listed on another source stays active when one source drops it", async () => {
    const a = await makeSource("GREENHOUSE", { board: "multiA" });
    const b = await makeSource("LEVER", { company: "multiB", display: COMPANY });
    const ha = http({ [`${ghUrl}/multiA/jobs`]: board(coordinator(7001)) });
    await discoverSource(a.id, { http: ha });
    await drain(a.id, ha);
    const hb = http({ "https://api.lever.co/v0/postings/multiB": { body: [leverPosting("m-1", "BIM Coordinator (Senior)", htmlText(BIM_COORDINATOR_HTML))] } });
    await discoverSource(b.id, { http: hb });
    await drain(b.id, hb);
    const refA = await db.jobSourceRef.findFirstOrThrow({ where: { sourceId: a.id } });
    expect(await recheckRef(refA.id, { http: http({ [`${ghUrl}/multiA/jobs/`]: { status: 404, body: null } }) })).toBe("gone-but-listed-elsewhere");
    expect((await db.job.findUniqueOrThrow({ where: { id: refA.jobId } })).status).toBe("ACTIVE");
  });

  it("partial or failed listings never trigger expiry (only a complete successful run does)", async () => {
    const src = await makeSource("GREENHOUSE", { board: "exp4" });
    const l = http({ [`${ghUrl}/exp4/jobs`]: board(coordinator(8001)) });
    await discoverSource(src.id, { http: l });
    await drain(src.id, l);
    const ref = await db.jobSourceRef.findFirstOrThrow({ where: { sourceId: src.id } });
    await db.ingestionRun.updateMany({ where: { sourceId: src.id }, data: { complete: false } }); // only a partial listing on record
    await db.jobSourceRef.update({ where: { id: ref.id }, data: { lastSeenAt: old(30) } });
    await findStale(new Date());
    expect(await db.queueJob.count({ where: { queue: "job.recheck", payload: { path: ["refId"], equals: ref.id } } })).toBe(0);
  });

  it("jobs reappear: a reappearing opening is revived (INACTIVE → ACTIVE) but moderator rejections stay", async () => {
    const { src, ref, jobId } = await liveJob("exp5");
    await db.job.update({ where: { id: jobId }, data: { status: "INACTIVE" } });
    const l = http({ [`${ghUrl}/exp5/jobs`]: board(coordinator(Number(ref.sourceJobId))) });
    await discoverSource(src.id, { http: l });
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("ACTIVE");
    await db.job.update({ where: { id: jobId }, data: { status: "REJECTED" } });
    await discoverSource(src.id, { http: l });
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("REJECTED");
  });

  it("jobs past their own expiry date become inactive", async () => {
    const { jobId } = await liveJob("exp6");
    await db.job.update({ where: { id: jobId }, data: { expiresAt: old(1) } });
    expect(await expireByDate()).toBeGreaterThanOrEqual(1);
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("INACTIVE");
  });
});

describe("source failures and health", () => {
  it("failed runs are recorded, the source degrades then becomes unhealthy, and recovers on success", async () => {
    const src = await makeSource("GREENHOUSE", { board: "fail" });
    const down = http({ [`${ghUrl}/fail/jobs`]: new SourceError("Server error 503", true, 503) });
    for (let i = 1; i <= 3; i++) {
      await expect(discoverSource(src.id, { http: down })).rejects.toBeInstanceOf(SourceError);
      const s = await db.jobSource.findUniqueOrThrow({ where: { id: src.id } });
      expect(s.consecutiveFailures).toBe(i);
      expect(s.health).toBe(i >= 3 ? "UNHEALTHY" : "DEGRADED");
      expect(s.lastStatus).toBe("ERROR");
      expect(s.lastError).toMatch(/503/);
    }
    const runs = await db.ingestionRun.findMany({ where: { sourceId: src.id } });
    expect(runs.every((r) => r.status === "FAILED" && r.failures === 1 && r.error)).toBe(true);
    expect(await db.ingestionLog.count({ where: { sourceId: src.id, level: "error" } })).toBe(3);
    const up = http({ [`${ghUrl}/fail/jobs`]: board(coordinator(9001)) });
    await discoverSource(src.id, { http: up });
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: src.id } })).toMatchObject({ health: "HEALTHY", consecutiveFailures: 0, lastStatus: "OK" });
  });

  it("health checks update status without scraping the source", async () => {
    const src = await makeSource("GREENHOUSE", { board: "hc" });
    const ok = http({ [`${ghUrl}/hc`]: { body: { name: "x" } } });
    expect((await checkSourceHealth(src.id, { http: ok })).ok).toBe(true);
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]).not.toContain("/jobs");
    const bad = http({ [`${ghUrl}/hc`]: { status: 404, body: null } });
    await checkSourceHealth(src.id, { http: bad });
    expect((await db.jobSource.findUniqueOrThrow({ where: { id: src.id } })).health).toBe("DEGRADED");
    await checkSourceHealth(src.id, { http: bad });
    await checkSourceHealth(src.id, { http: bad });
    expect((await db.jobSource.findUniqueOrThrow({ where: { id: src.id } })).health).toBe("UNHEALTHY");
    expect((await checkSourceHealth(src.id, { http: ok })).ok).toBe(true);
    expect((await db.jobSource.findUniqueOrThrow({ where: { id: src.id } })).health).toBe("HEALTHY");
  });

  it("an unusable payload is isolated: other jobs in the same run still ingest", async () => {
    const src = await makeSource("GREENHOUSE", { board: "iso" });
    const h = http({ [`${ghUrl}/iso/jobs`]: board(coordinator(9101), { ...coordinator(9102), content: undefined as never }) });
    await discoverSource(src.id, { http: h });
    const out = await drain(src.id, h);
    expect(out.map((o) => o.status).sort()).toEqual(["created", "rejected"]);
  });

  it("RSS feeds with an unusable item don't break ingestion of the rest", async () => {
    const src = await makeSource("RSS", { company: `${RUN} Beta` }, { url: "https://beta.example/rss", reliability: 65 });
    const h = http({ "https://beta.example/rss": { body: RSS_FEED.replace("Beta Consultants", `${COMPANY}`) } });
    const run = await discoverSource(src.id, { http: h });
    expect(run.found).toBe(2);
    const out = await drain(src.id, h);
    expect(out.map((o) => o.status).sort()).toEqual(["created", "rejected"]); // BIM Modeler accepted, Barista rejected
  });
});
