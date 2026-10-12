import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { RUN, cleanup, makeUser } from "./helpers";
import { db } from "@/lib/db";
import { NonRetryableError, STALE_LOCK_MS, backoffMs, claim, complete, enqueue, enqueueMany, fail, recoverStale, runBatch, type Handler, type QueueName } from "@/lib/queue/queue";
import { buildWhere, jobFacets, resetFacetCache, searchJobs, textMatchIds, type JobFilters } from "@/lib/jobs/search";
import { buildFeed } from "@/lib/jobs/feed";
import { CHANNELS, alertMatchesJob, criteriaSchema, describeCriteria, isDue, runDigestAlerts, runInstantAlerts, type AlertCriteria } from "@/lib/jobs/alerts";
import { recomputeMatches, matchJobForProfiles } from "@/lib/services/matching";
import { activeJobWhere, listedJobWhere } from "@/lib/services/jobs";

afterAll(cleanup);
const TQ = `test.${RUN}.q`; // private queue name so we never touch real tasks

// ---------------------------------------------------------------------------------------------------------------
describe("work queue", () => {
  const put = (n: number, extra: Partial<Prisma.QueueJobCreateManyInput> = {}) => db.queueJob.createMany({ data: Array.from({ length: n }, (_, i) => ({ queue: TQ, payload: { i }, ...extra })) });

  it("dedupes identical pending work by key, and frees the key once finished", async () => {
    const q = `${TQ}.dedupe` as QueueName;
    expect(await enqueue(q, { a: 1 }, { dedupeKey: `${RUN}-k1` })).toBe(true);
    expect(await enqueue(q, { a: 1 }, { dedupeKey: `${RUN}-k1` })).toBe(false);
    expect(await enqueueMany(q, [{ payload: { a: 2 }, dedupeKey: `${RUN}-k1` }, { payload: { a: 3 }, dedupeKey: `${RUN}-k2` }])).toBe(1);
    const [job] = await claim("w", [q], 1);
    await complete(job.id);
    expect(await enqueue(q, { a: 4 }, { dedupeKey: job.dedupeKey! })).toBe(true); // key released after completion
  });

  it("concurrent workers never claim the same task (SKIP LOCKED)", async () => {
    const q = `${TQ}.conc`;
    await db.queueJob.createMany({ data: Array.from({ length: 12 }, (_, i) => ({ queue: q, payload: { i } })) });
    const [a, b, c] = await Promise.all([claim("w1", [q], 5), claim("w2", [q], 5), claim("w3", [q], 5)]);
    const ids = [...a, ...b, ...c].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(12);
    expect([...a, ...b, ...c].every((j) => j.status === "RUNNING" && j.attempts === 1 && j.lockedBy)).toBe(true);
  });

  it("only claims due work from the requested queues", async () => {
    const q = `${TQ}.due`;
    await put(1, { queue: q, runAt: new Date(Date.now() + 3600_000) });
    expect(await claim("w", [q], 5)).toHaveLength(0);
    expect(await claim("w", [`${TQ}.other`], 5)).toHaveLength(0);
  });

  it("failures retry with exponential backoff, then fail permanently", async () => {
    const q = `${TQ}.retry`;
    const t = await db.queueJob.create({ data: { queue: q, payload: {}, maxAttempts: 3 } });
    let [job] = await claim("w", [q], 1);
    expect(await fail(job, new Error("boom"))).toBe("retry");
    let row = await db.queueJob.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ status: "PENDING", attempts: 1, error: "boom" });
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + backoffMs(1) - 2000);
    await db.queueJob.update({ where: { id: t.id }, data: { runAt: new Date(Date.now() - 2000) } });
    [job] = await claim("w", [q], 1);
    await fail(job, new Error("boom2"));
    row = await db.queueJob.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + backoffMs(2) - 2000); // doubled
    await db.queueJob.update({ where: { id: t.id }, data: { runAt: new Date(Date.now() - 2000) } });
    [job] = await claim("w", [q], 1);
    expect(await fail(job, new Error("boom3"))).toBe("failed");
    expect((await db.queueJob.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("FAILED");
    expect(backoffMs(1)).toBe(15_000);
    expect(backoffMs(2)).toBe(30_000);
    expect(backoffMs(50)).toBeLessThanOrEqual(30 * 60_000);
  });

  it("non-retryable errors fail immediately", async () => {
    const q = `${TQ}.nr`;
    await put(1, { queue: q });
    const handlers: Record<string, Handler> = { [q]: async () => { throw new NonRetryableError("bad config"); } };
    await runBatch(handlers, "w", 5);
    expect(await db.queueJob.findFirstOrThrow({ where: { queue: q } })).toMatchObject({ status: "FAILED", error: "bad config", attempts: 1 });
  });

  it("recovers tasks stuck RUNNING after a worker crash", async () => {
    const q = `${TQ}.stale`;
    const t = await db.queueJob.create({ data: { queue: q, payload: {}, status: "RUNNING", lockedAt: new Date(Date.now() - STALE_LOCK_MS - 60_000), lockedBy: "dead" } });
    expect(await recoverStale()).toBeGreaterThanOrEqual(1);
    expect(await db.queueJob.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: "PENDING", lockedBy: null });
  });

  it("runBatch processes handlers and marks them done", async () => {
    const q = `${TQ}.batch`;
    await put(3, { queue: q });
    const seen: number[] = [];
    const n = await runBatch({ [q]: async (p) => void seen.push(p.i as number) }, "w", 10);
    expect(n).toBe(3);
    expect(seen.sort()).toEqual([0, 1, 2]);
    expect(await db.queueJob.count({ where: { queue: q, status: "DONE" } })).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------
let seq = 0;
const T = RUN; // token present in every test job so queries are isolated from other data
async function job(over: Partial<Prisma.JobUncheckedCreateInput> & { title: string }) {
  const n = ++seq;
  return db.job.create({
    data: {
      slug: `${RUN}-j${n}`, companyName: `${RUN} Studio ${n}`, description: `${T} ${over.title}. We need Revit and Navisworks skills for BIM coordination. `.repeat(8), status: "ACTIVE", qualityScore: 70, bimRelevanceScore: 80,
      software: ["Revit"], skills: [], postedAt: new Date(), discoveredAt: new Date(), lastSeenAt: new Date(), ...over,
    },
  });
}

describe("job search and filters (indexed)", () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const day = 86400_000;
    ids.coord = (await job({ title: `BIM Coordinator ${T}`, bimRole: "BIM Coordinator", discipline: "MEP", software: ["Revit", "Navisworks"], country: "India", city: "Bengaluru", remoteType: "HYBRID", experienceMin: 3, experienceMax: 5, salaryMin: 1800000, salaryMax: 2400000, salaryCurrency: "INR", employmentType: "Full-time", companyName: `${RUN} Acme Engineering`, postedAt: new Date(Date.now() - 2 * day), qualityScore: 90 })).id;
    ids.model = (await job({ title: `BIM Modeler ${T}`, bimRole: "BIM Modeler", discipline: "Architecture", software: ["Revit", "AutoCAD"], country: "United Kingdom", city: "London", remoteType: "ONSITE", experienceMin: 1, experienceMax: 3, employmentType: "Contract", postedAt: new Date(Date.now() - 40 * day), qualityScore: 60 })).id;
    ids.mgr = (await job({ title: `BIM Manager ${T}`, bimRole: "BIM Manager", discipline: "BIM Management", software: ["Revit", "Navisworks", "Solibri"], country: "India", city: "Pune", remoteType: "REMOTE", remote: true, experienceMin: 8, salaryMin: 3000000, salaryMax: 4000000, employmentType: "Full-time", qualityScore: 80, description: `${T} Leads the digital delivery team and ISO 19650 information management. `.repeat(8) })).id;
    ids.desc = (await job({ title: `Project Engineer ${T}`, bimRole: null, description: `${T} Mostly site work but some coordinator duties. `.repeat(8), qualityScore: 70, bimRelevanceScore: 45 })).id;
    ids.thin = (await job({ title: `BIM Technician ${T}`, bimRole: "BIM Modeler", qualityScore: 10 })).id; // ingested + low quality → hidden
    ids.inactive = (await job({ title: `BIM Engineer ${T}`, bimRole: "BIM Engineer", status: "INACTIVE" })).id;
    ids.merged = (await job({ title: `BIM Coordinator ${T} copy`, bimRole: "BIM Coordinator", canonicalJobId: ids.coord })).id;
    ids.future = (await job({ title: `BIM Lead ${T}`, bimRole: "BIM Lead", expiresAt: new Date(Date.now() - day) })).id; // past expiry
    const owner = await makeUser("search-owner");
    ids.native = (await job({ title: `BIM Native ${T}`, bimRole: "BIM Modeler", qualityScore: 5, postedByUserId: owner.user.id })).id; // native: always listed
  });

  const find = async (f: JobFilters) => (await searchJobs({ q: T, pageSize: 50, sort: "newest", ...f })).rows.map((r) => r.job.id);
  const has = (list: string[], key: string) => list.includes(ids[key]);

  it("lists only live, canonical, quality-passing jobs (merged, inactive, expired and thin ingested rows are hidden; native stays)", async () => {
    const all = await find({});
    for (const k of ["coord", "model", "mgr", "native"]) expect(has(all, k)).toBe(true);
    for (const k of ["thin", "inactive", "merged", "future"]) expect(has(all, k)).toBe(false);
    expect(await db.job.count({ where: { id: ids.coord, ...activeJobWhere() } })).toBe(1);
    expect(await db.job.count({ where: { id: ids.thin, ...listedJobWhere() } })).toBe(0);
  });

  it("full-text search ranks title matches above description-only matches and supports exclusion", async () => {
    const r = await searchJobs({ q: `${T} coordinator`, pageSize: 50 });
    const order = r.rows.map((x) => x.job.id);
    expect(order.indexOf(ids.coord)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(ids.desc)).toBeGreaterThan(order.indexOf(ids.coord)); // title+body beats body only
    const excl = await searchJobs({ q: `${T} -coordinator`, pageSize: 50 });
    expect(excl.rows.map((x) => x.job.id)).not.toContain(ids.coord);
    expect((await textMatchIds("zzzqqqnomatch" + T.slice(0, 2))).length).toBe(0);
    expect(await textMatchIds("")).toEqual([]);
  });

  it("stems words and handles user input safely (no SQL injection, no crash on odd syntax)", async () => {
    expect((await find({ q: `${T} coordinators` })).includes(ids.coord)).toBe(true);
    for (const q of ["'; DROP TABLE \"Job\"; --", "(((", "\"unterminated", "a & b | !c", "💥"]) await expect(searchJobs({ q })).resolves.toBeTruthy();
    expect(await db.job.count()).toBeGreaterThan(0);
  });

  it.each<[string, JobFilters, string[], string[]]>([
    ["role", { role: "BIM Coordinator" }, ["coord"], ["model", "mgr"]],
    ["role is case-insensitive", { role: "bim coordinator" }, ["coord"], ["model"]],
    ["discipline", { discipline: "Architecture" }, ["model"], ["coord"]],
    ["software (all required)", { software: ["Revit", "Navisworks"] }, ["coord", "mgr"], ["model"]],
    ["software single", { software: ["Solibri"] }, ["mgr"], ["coord"]],
    ["country", { country: "India" }, ["coord", "mgr"], ["model"]],
    ["city", { city: "london" }, ["model"], ["coord"]],
    ["remote", { remote: "REMOTE" }, ["mgr"], ["coord", "model"]],
    ["hybrid", { remote: "HYBRID" }, ["coord"], ["mgr", "model"]],
    ["on-site", { remote: "ONSITE" }, ["model"], ["coord"]],
    ["experience (candidate has 4 years)", { experience: 4 }, ["coord", "model"], ["mgr"]],
    ["salary at least", { salaryMin: 2_500_000 }, ["mgr"], ["coord", "model"]],
    ["employment type", { employmentType: "contract" }, ["model"], ["coord", "mgr"]],
    ["posted in the last 7 days", { postedWithinDays: 7 }, ["coord", "mgr"], ["model"]],
    ["company", { company: "acme" }, ["coord"], ["mgr", "model"]],
  ])("filter: %s", async (_n, f, yes, no) => {
    const got = await find(f);
    for (const k of yes) expect(has(got, k), `expected ${k}`).toBe(true);
    for (const k of no) expect(has(got, k), `did not expect ${k}`).toBe(false);
  });

  it("filters combine (AND)", async () => {
    const got = await find({ country: "India", software: ["Navisworks"], remote: "REMOTE", experience: 10 });
    expect(got).toEqual([ids.mgr]);
  });

  it("paginates with stable totals", async () => {
    const p1 = await searchJobs({ q: T, pageSize: 2, page: 1, sort: "newest" });
    const p2 = await searchJobs({ q: T, pageSize: 2, page: 2, sort: "newest" });
    expect(p1.total).toBe(p2.total);
    expect(p1.pages).toBe(Math.ceil(p1.total / 2));
    expect(p1.rows).toHaveLength(2);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.job.id)).size).toBe(p1.rows.length + p2.rows.length);
  });

  it("sorts by newest and by quality", async () => {
    const newest = await find({ sort: "newest" });
    expect(newest.indexOf(ids.model)).toBeGreaterThan(newest.indexOf(ids.coord));
    const q = (await searchJobs({ q: T, sort: "quality", pageSize: 50 })).rows.map((r) => r.job.qualityScore);
    expect([...q].sort((a, b) => b - a)).toEqual(q);
  });

  it("buildWhere is pure and composes only indexed predicates", () => {
    const w = buildWhere({ role: "BIM Manager", software: ["Revit"], country: "India" });
    expect(JSON.stringify(w)).toContain("hasEvery");
    expect(JSON.stringify(buildWhere({}))).toContain("canonicalJobId");
  });

  it("facets come from real data and are cached", async () => {
    resetFacetCache();
    const f = await jobFacets();
    expect(f.countries.some((c) => c.value === "India")).toBe(true);
    expect(f.roles.some((r) => r.value === "BIM Coordinator")).toBe(true);
    expect(f.software).toContain("Revit");
    expect(await jobFacets()).toBe(f); // same object: cache hit
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Other suites share this database, so assertions only look at jobs created by this suite (title carries the RUN token).
const bf = async (...a: Parameters<typeof buildFeed>) => {
  const f = await buildFeed(...a);
  return { ...f, items: f.items.filter((i) => i.job.title.includes(`FEED ${T}`) || i.job.title.includes(`FEED CANON ${T}`) || i.job.title.includes(`FEED DEAD ${T}`)) };
};

describe("personalized feed", () => {
  it("uses real candidate data: views, scores, reasons, exclusions and the incomplete-profile hint", async () => {
    const { user, profile } = await makeUser("feed");
    // Thin profile → hint and no matches.
    expect(await recomputeMatches(profile.id)).toBe(0);
    let feed = await bf(user.id, profile.id, "recommended");
    expect(feed.hint).toBe("Complete your BIM profile to improve recommendations.");
    expect(feed.items).toHaveLength(0);

    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { headline: "Senior BIM Coordinator", yearsExperience: 5, discipline: "MEP", location: "Bengaluru, India", country: "India", preferredRoles: ["BIM Coordinator"], preferredLocations: ["Bengaluru"], remotePreference: "Hybrid", employmentTypes: ["Full-time"] } });
    for (const software of ["Revit", "Navisworks"]) await db.softwareSkill.create({ data: { profileId: profile.id, software, years: 5 } });
    const skill = await db.skill.upsert({ where: { name: "BIM Coordination" }, update: {}, create: { name: "BIM Coordination" } });
    await db.profileSkill.create({ data: { profileId: profile.id, skillId: skill.id } });

    const fit = await job({ title: `BIM Coordinator FEED ${T}`, bimRole: "BIM Coordinator", software: ["Revit", "Navisworks"], skills: ["BIM Coordination"], discipline: "MEP", city: "Bengaluru", country: "India", remoteType: "HYBRID", experienceMin: 3, experienceMax: 6, employmentType: "Full-time", seniority: "Senior", qualityScore: 80, discoveredAt: new Date() });
    const remote = await job({ title: `BIM Modeler Remote FEED ${T}`, bimRole: "BIM Modeler", software: ["Revit"], remote: true, remoteType: "REMOTE", qualityScore: 80, discoveredAt: new Date(Date.now() - 5 * 86400_000), postedAt: new Date(Date.now() - 5 * 86400_000), country: "India" });
    const poor = await job({ title: `Rhino Designer FEED ${T}`, bimRole: null, software: ["SketchUp"], discipline: "Architecture", city: "Sydney", country: "Australia", remoteType: "ONSITE", qualityScore: 80 });
    await recomputeMatches(profile.id);
    await matchJobForProfiles(fit.id);

    const m = await db.jobMatch.findMany({ where: { profileId: profile.id, jobId: { in: [fit.id, remote.id, poor.id] } } });
    const score = (id: string) => m.find((x) => x.jobId === id)!.score;
    expect(score(fit.id)).toBeGreaterThan(75);
    expect(score(fit.id)).toBeGreaterThan(score(remote.id));
    expect(score(remote.id)).toBeGreaterThan(score(poor.id));
    const reasons = (m.find((x) => x.jobId === fit.id)!.reasons as { reasons: string[]; gaps: string[] });
    expect(reasons.reasons).toEqual(expect.arrayContaining(["5 years Revit", "5 years Navisworks", "BIM Coordination"]));
    expect(JSON.stringify(reasons)).not.toMatch(/hired|chance/i);

    feed = await bf(user.id, profile.id, "recommended");
    expect(feed.hint).toBeNull();
    expect(feed.items[0].job.id).toBe(fit.id);
    expect(feed.items[0].info?.reasons.length).toBeGreaterThan(0);
    expect(feed.items.every((i) => i.score! >= 55)).toBe(true);
    expect(feed.items.map((i) => i.job.id)).not.toContain(poor.id);

    const best = await bf(user.id, profile.id, "best");
    expect(best.items.map((i) => i.job.id)[0]).toBe(fit.id);
    expect((await bf(user.id, profile.id, "new")).items.map((i) => i.job.id)).toContain(fit.id);
    expect((await bf(user.id, profile.id, "new")).items.map((i) => i.job.id)).not.toContain(remote.id); // found 5 days ago
    const rem = await bf(user.id, profile.id, "remote");
    expect(rem.items.map((i) => i.job.id)).toContain(remote.id);
    expect(rem.items.map((i) => i.job.id)).not.toContain(fit.id);

    await db.savedJob.create({ data: { userId: user.id, jobId: remote.id } });
    await db.pinnedJob.create({ data: { userId: user.id, jobId: fit.id } });
    expect((await bf(user.id, profile.id, "saved")).items.map((i) => i.job.id)).toEqual([remote.id]);
    expect((await bf(user.id, profile.id, "pinned")).items.map((i) => i.job.id)).toEqual([fit.id]);

    // Applied jobs drop out of recommendations.
    await db.application.create({ data: { userId: user.id, jobId: fit.id, external: true } });
    expect((await bf(user.id, profile.id, "recommended")).items.map((i) => i.job.id)).not.toContain(fit.id);
    const counts = (await bf(user.id, profile.id, "best")).counts;
    expect(counts.saved).toBe(1);
    expect(counts.pinned).toBe(1);
  });

  it("merged duplicates and inactive jobs never score or appear", async () => {
    const { user, profile } = await makeUser("feed2");
    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { headline: "BIM Coordinator", yearsExperience: 4 } });
    await db.softwareSkill.create({ data: { profileId: profile.id, software: "Revit" } });
    const canon = await job({ title: `BIM Coordinator FEED CANON ${T}`, bimRole: "BIM Coordinator", software: ["Revit"], qualityScore: 80 });
    const dupe = await job({ title: `BIM Coordinator FEED CANON ${T}`, bimRole: "BIM Coordinator", software: ["Revit"], canonicalJobId: canon.id });
    const dead = await job({ title: `BIM Coordinator FEED DEAD ${T}`, bimRole: "BIM Coordinator", software: ["Revit"], status: "INACTIVE" });
    await recomputeMatches(profile.id);
    const got = (await bf(user.id, profile.id, "best")).items.map((i) => i.job.id);
    expect(got).toContain(canon.id);
    expect(got).not.toContain(dupe.id);
    expect(got).not.toContain(dead.id);
    await matchJobForProfiles(dupe.id);
    expect(await db.jobMatch.count({ where: { jobId: dupe.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("job alerts", () => {
  const crit = (o: Partial<AlertCriteria> = {}): AlertCriteria => criteriaSchema.parse(o);
  const j = { title: "Senior BIM Coordinator", description: "Revit coordination in Bengaluru", bimRole: "BIM Coordinator", discipline: "MEP", software: ["Revit", "Navisworks"], country: "India", city: "Bengaluru", remote: false, remoteType: "HYBRID", employmentType: "Full-time" };

  it("evaluates criteria deterministically", () => {
    expect(alertMatchesJob(crit({ bimRole: "BIM Coordinator", city: "Bengaluru" }), j, null)).toBe(true);
    expect(alertMatchesJob(crit({ bimRole: "bim coordinator", city: "bengaluru" }), j, null)).toBe(true);
    expect(alertMatchesJob(crit({ city: "Mumbai" }), j, null)).toBe(false);
    expect(alertMatchesJob(crit({ software: ["Revit", "Tekla Structures"] }), j, null)).toBe(false);
    expect(alertMatchesJob(crit({ remote: true }), j, null)).toBe(false);
    expect(alertMatchesJob(crit({ keywords: "revit coordination" }), j, null)).toBe(true);
    expect(alertMatchesJob(crit({ keywords: "tekla" }), j, null)).toBe(false);
    expect(alertMatchesJob(crit({ discipline: "Structural" }), j, null)).toBe(false);
    expect(alertMatchesJob(crit({ minMatch: 70 }), j, 82)).toBe(true);
    expect(alertMatchesJob(crit({ minMatch: 70 }), j, 60)).toBe(false);
    expect(alertMatchesJob(crit({ minMatch: 70 }), j, null)).toBe(false); // no profile score → no match
  });

  it("validates criteria and describes the example alert", () => {
    expect(() => criteriaSchema.parse({ minMatch: 150 })).toThrow();
    expect(() => criteriaSchema.parse({ software: Array(20).fill("Revit") })).toThrow();
    expect(describeCriteria(crit({ bimRole: "BIM Coordinator", city: "Bengaluru", minMatch: 60 }))).toBe("BIM Coordinator jobs · in Bengaluru · matching your profile (60%+)");
    expect(CHANNELS).toEqual(["IN_APP", "EMAIL"]);
  });

  it("digest due logic by frequency", () => {
    const now = new Date();
    const mk = (frequency: "DAILY" | "WEEKLY" | "INSTANT", ago: number) => ({ frequency, lastRunAt: new Date(now.getTime() - ago), createdAt: new Date(now.getTime() - 10 * 86400_000) });
    expect(isDue(mk("DAILY", 25 * 3600_000), now)).toBe(true);
    expect(isDue(mk("DAILY", 2 * 3600_000), now)).toBe(false);
    expect(isDue(mk("WEEKLY", 3 * 86400_000), now)).toBe(false);
    expect(isDue(mk("WEEKLY", 8 * 86400_000), now)).toBe(true);
    expect(isDue(mk("INSTANT", 99 * 86400_000), now)).toBe(false);
  });

  it("instant alerts notify once per job, only for matching jobs, honouring the match threshold", async () => {
    const { user, profile } = await makeUser("alerts");
    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { headline: "BIM Coordinator", yearsExperience: 5, location: "Bengaluru, India", country: "India" } });
    await db.softwareSkill.create({ data: { profileId: profile.id, software: "Revit", years: 4 } });
    const all = await db.jobAlert.create({ data: { userId: user.id, name: "Bengaluru coordinators", frequency: "INSTANT", channels: ["IN_APP"], criteria: crit({ bimRole: "BIM Coordinator", city: "Bengaluru" }) } });
    const strict = await db.jobAlert.create({ data: { userId: user.id, name: "Only strong matches", frequency: "INSTANT", channels: ["IN_APP"], criteria: crit({ minMatch: 99 }) } });
    const elsewhere = await db.jobAlert.create({ data: { userId: user.id, name: "Mumbai", frequency: "INSTANT", channels: ["IN_APP"], criteria: crit({ city: "Mumbai" }) } });
    const paused = await db.jobAlert.create({ data: { userId: user.id, name: "Paused", active: false, frequency: "INSTANT", channels: ["IN_APP"], criteria: crit({}) } });
    const newJob = await job({ title: `BIM Coordinator ALERT ${T}`, bimRole: "BIM Coordinator", software: ["Revit"], city: "Bengaluru", country: "India", qualityScore: 80 });
    await matchJobForProfiles(newJob.id);

    expect(await runInstantAlerts(newJob.id)).toBeGreaterThanOrEqual(1);
    const notes = await db.notification.findMany({ where: { userId: user.id, type: "job.alert" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].href).toBe(`/jobs/${newJob.slug}`);
    expect(notes[0].title).toContain("BIM Coordinator");
    expect((await db.jobAlert.findUniqueOrThrow({ where: { id: all.id } })).lastNotifiedAt).not.toBeNull();
    expect((await db.jobAlert.findUniqueOrThrow({ where: { id: strict.id } })).lastNotifiedAt).toBeNull();
    expect((await db.jobAlert.findUniqueOrThrow({ where: { id: elsewhere.id } })).lastNotifiedAt).toBeNull();
    expect((await db.jobAlert.findUniqueOrThrow({ where: { id: paused.id } })).lastNotifiedAt).toBeNull();
    await runInstantAlerts(newJob.id); // idempotent
    expect(await db.notification.count({ where: { userId: user.id, type: "job.alert" } })).toBe(1);
  });

  it("instant alerts ignore inactive and merged jobs", async () => {
    const { user } = await makeUser("alerts2");
    await db.jobAlert.create({ data: { userId: user.id, name: "any", frequency: "INSTANT", channels: ["IN_APP"], criteria: crit({ keywords: T }) } });
    const dead = await job({ title: `BIM Coordinator DEADALERT ${T}`, status: "INACTIVE" });
    expect(await runInstantAlerts(dead.id)).toBe(0);
    expect(await db.notification.count({ where: { userId: user.id } })).toBe(0);
  });

  it("digests batch new jobs since the last run and respect due time", async () => {
    const { user } = await makeUser("digest");
    const alert = await db.jobAlert.create({ data: { userId: user.id, name: "Daily coordinators", frequency: "DAILY", channels: ["IN_APP"], criteria: crit({ keywords: `${T} digestword` }), lastRunAt: new Date(Date.now() - 26 * 3600_000), createdAt: new Date(Date.now() - 3 * 86400_000) } });
    await job({ title: `BIM Coordinator one ${T}`, description: `${T} digestword role one. `.repeat(10), qualityScore: 80, discoveredAt: new Date(Date.now() - 3600_000) });
    await job({ title: `BIM Modeler two ${T}`, description: `${T} digestword role two. `.repeat(10), qualityScore: 80, discoveredAt: new Date(Date.now() - 2 * 3600_000) });
    await job({ title: `Old job ${T}`, description: `${T} digestword old. `.repeat(10), qualityScore: 80, discoveredAt: new Date(Date.now() - 2 * 86400_000) }); // before lastRunAt
    expect(await runDigestAlerts()).toBeGreaterThanOrEqual(1);
    const notes = await db.notification.findMany({ where: { userId: user.id, type: "job.alert" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/^2 new jobs/);
    expect((await db.jobAlert.findUniqueOrThrow({ where: { id: alert.id } })).lastRunAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    await runDigestAlerts(); // not due again, no duplicate digest
    expect(await db.notification.count({ where: { userId: user.id, type: "job.alert" } })).toBe(1);
  });
});
