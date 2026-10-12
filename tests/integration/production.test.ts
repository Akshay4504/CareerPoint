import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanup, makeEmployer, makeUser, RUN } from "./helpers";
import { db } from "@/lib/db";
import { AiError, type AiProvider } from "@/lib/ai/provider";
import { assertBudget, recordUsage } from "@/lib/ai/usage";
import { decideSuggestion, requestSuggestion } from "@/lib/services/ai";
import { getScoringConfig, resetScoringCache, saveScoringConfig, ScoringConfigError, scoringHistory } from "@/lib/scoring/store";
import { DIMENSION_KEYS, DEFAULT_WEIGHTS } from "@/lib/scoring/config";
import { saveResumeVersion } from "@/lib/services/profile";
import { emptyResume } from "@/lib/resume/types";
import { checkHealth } from "@/lib/health";
import { QUEUES, deadLetters, enqueue, retryDeadLetter, runBatch, NonRetryableError } from "@/lib/queue/queue";
import { rateLimitShared } from "@/lib/auth/rate-limit";
import { applyNative, ApplicationError } from "@/lib/applications/candidate";
import { employerCtx, moveApplication } from "@/lib/applications/employer";
import sitemap from "@/app/sitemap";

let adminId: string;
let prevScoringVersion = 0;
beforeAll(async () => {
  adminId = (await makeUser("prod-admin", "ADMIN", { profile: false })).user.id;
  prevScoringVersion = (await db.scoringConfigVersion.findFirst({ orderBy: { version: "desc" } }))?.version ?? 0;
});
afterAll(async () => {
  // Leave the live scoring config exactly as found.
  await db.scoringConfigVersion.deleteMany({ where: { version: { gt: prevScoringVersion } } });
  resetScoringCache();
  await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: RUN } } });
  await db.aiUsage.deleteMany({ where: { kind: { startsWith: "test" } } });
  await cleanup();
});

const fake = (reply: string | Error): AiProvider => ({ name: "fake", model: "fake-model", complete: async () => { if (reply instanceof Error) throw reply; return { text: reply, inputTokens: 100, outputTokens: 40, model: "fake-model" }; } });

async function profileWithFacts(label: string) {
  const { user, profile } = await makeUser(label);
  await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { headline: "BIM Coordinator", summary: "BIM coordinator on hospital projects.", yearsExperience: 6 } });
  await db.softwareSkill.createMany({ data: [{ profileId: profile.id, software: "Revit", level: "ADVANCED" }, { profileId: profile.id, software: "Navisworks", level: "ADVANCED" }] });
  return { user, profile };
}

async function activeJob(title: string, companyId: string, companyName: string, extra: Record<string, unknown> = {}) {
  return db.job.create({ data: { slug: `${RUN}-${title.replace(/\W+/g, "-").toLowerCase()}`, title, companyId, companyName, description: "Coordinate models in Revit and Navisworks and run clash detection. ".repeat(3), status: "ACTIVE", software: ["Revit", "Navisworks", "Solibri"], skills: ["Clash Detection"], ...extra } });
}

describe("AI usage limits, fallback and fabrication guard", () => {
  it("enforces the per-user daily limit and the global token budget", async () => {
    const { user } = await makeUser("ai-limit");
    process.env.AI_USER_DAILY_LIMIT = "2";
    await recordUsage({ userId: user.id, kind: "test", status: "ok", inputTokens: 1, outputTokens: 1 });
    await recordUsage({ userId: user.id, kind: "test", status: "ok", inputTokens: 1, outputTokens: 1 });
    await expect(assertBudget(user.id)).rejects.toMatchObject({ kind: "limit" });
    delete process.env.AI_USER_DAILY_LIMIT;

    const other = await makeUser("ai-limit2");
    process.env.AI_DAILY_TOKEN_BUDGET = "1";
    await expect(assertBudget(other.user.id)).rejects.toMatchObject({ kind: "limit" }); // the rows above already exceed 1 token
    delete process.env.AI_DAILY_TOKEN_BUDGET;
    await db.aiUsage.deleteMany({ where: { userId: user.id } });
  });

  it("records usage and falls back to deterministic advice when the model is down, with no invented content", async () => {
    const t = await makeEmployer("ai-co", true);
    const { user, profile } = await profileWithFacts("ai-fallback");
    const job = await activeJob("BIM Coordinator AIFB", t.company.id, t.company.name);
    await db.jobMatch.deleteMany({ where: { profileId: profile.id } });
    const s = await requestSuggestion(user.id, fake(new AiError("unavailable", "down")), { kind: "explain-missing", jobId: job.id });
    expect(s.model).toBe("deterministic");
    expect(s.output).toMatch(/Solibri/); // the real gap from the job
    expect(s.output).not.toMatch(/Dynamo|ISO 19650/);
    expect(await db.aiUsage.count({ where: { userId: user.id, status: { in: ["error", "fallback"] } } })).toBeGreaterThanOrEqual(1);
    // Works with no provider at all (AI switched off).
    const noAi = await requestSuggestion(user.id, null, { kind: "interview-questions", jobId: job.id });
    expect(noAi.output).toMatch(/^1\./);
    expect(noAi.model).toBe("deterministic");
    // Draft kinds have no fallback: the failure is reported, nothing is fabricated.
    await expect(requestSuggestion(user.id, fake(new AiError("unavailable", "down")), { kind: "cover-letter", jobId: job.id })).rejects.toBeInstanceOf(AiError);
  });

  it("blocks cover letters that invent figures or tools, and only approves facts the candidate provided", async () => {
    const t = await makeEmployer("ai-co2", true);
    const { user } = await profileWithFacts("ai-cover");
    const job = await activeJob("BIM Coordinator COVER", t.company.id, t.company.name);
    const bad = await requestSuggestion(user.id, fake("I have 15 years of experience and led 40 Dynamo scripting projects, certified in ISO 19650."), { kind: "cover-letter", jobId: job.id });
    const flags = bad.flags as { severity: string }[];
    expect(flags.some((f) => f.severity === "block")).toBe(true);
    await expect(decideSuggestion(user.id, bad.id, "approve")).rejects.toThrow(/Cannot approve/);
    const good = await requestSuggestion(user.id, fake("I am a BIM coordinator with 6 years of experience in Revit and Navisworks on hospital projects."), { kind: "cover-letter", jobId: job.id });
    expect((good.flags as { severity: string }[]).some((f) => f.severity === "block")).toBe(false);
    await expect(decideSuggestion(user.id, good.id, "approve")).resolves.toMatchObject({ applied: false }); // a draft: kept, never written into the resume
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: good.id } })).status).toBe("APPROVED");
  });
});

describe("admin-configurable scoring with history", () => {
  it("saves versions, rejects invalid weights, stamps scores with the config version and restores", async () => {
    const w = (over: Record<string, number> = {}) => Object.fromEntries(DIMENSION_KEYS.map((k) => [k, over[k] ?? DEFAULT_WEIGHTS[k]]));
    await expect(saveScoringConfig(adminId, { ...w(), portfolio: -1 })).rejects.toBeInstanceOf(ScoringConfigError);
    await expect(saveScoringConfig(adminId, Object.fromEntries(DIMENSION_KEYS.map((k) => [k, 0])))).rejects.toBeInstanceOf(ScoringConfigError);

    const { user, profile } = await makeUser("score-cfg");
    const r = await db.resume.create({ data: { profileId: profile.id, title: "CV" } });
    const content = { ...emptyResume(), headline: "BIM Coordinator", summary: "BIM coordinator on hospital projects using Revit and Navisworks.", software: ["Revit", "Navisworks"] };
    resetScoringCache();
    const before = (await getScoringConfig()).version;
    const first = await saveResumeVersion(r.id, content, "test");
    const v1 = await saveScoringConfig(adminId, w({ portfolio: 90 }), "Weight portfolio heavily");
    expect(v1.version).toBe(before + 1);
    expect((await getScoringConfig()).weights.portfolio).toBe(90);
    const second = await saveResumeVersion(r.id, content, "test");
    expect(second.score.total).toBeLessThan(first.score.total); // same resume, heavier portfolio weight, no portfolio
    const stored = await db.resumeScore.findFirstOrThrow({ where: { resumeVersionId: second.version.id } });
    expect((stored.breakdown as { configVersion: number }).configVersion).toBe(v1.version);
    expect(user.id).toBeTruthy();

    const history = await scoringHistory(5);
    expect(history[0].note).toBe("Weight portfolio heavily");
    expect(history[0].createdById).toBe(adminId);
    // Restoring = appending a new version with the old weights.
    const restored = await saveScoringConfig(adminId, (history[1]?.weights ?? w()) as Record<string, unknown>, "restore");
    expect(restored.version).toBe(v1.version + 1);
  });
});

describe("health, queue dead-letters and shared rate limits", () => {
  it("reports each component and flips the worker status on heartbeat age", async () => {
    await db.heartbeat.deleteMany({ where: { name: "worker" } });
    const none = await checkHealth();
    expect(Object.keys(none.components).sort()).toEqual(["ai", "application", "database", "email", "queue", "sources", "storage", "worker"]);
    expect(none.components.database.status).toBe("ok");
    expect(none.components.worker.status).toBe("degraded");
    await db.heartbeat.create({ data: { name: "worker", lastBeatAt: new Date() } });
    expect((await checkHealth()).components.worker.status).toBe("ok");
    await db.heartbeat.update({ where: { name: "worker" }, data: { lastBeatAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await checkHealth()).components.worker.status).toBe("degraded");
    await db.heartbeat.deleteMany({ where: { name: "worker" } });
  });

  it("dead-letters a failing task after its retries and lets an admin retry it", async () => {
    const q = `test.${RUN}.dl` as never;
    await enqueue(q, { x: 1 }, { maxAttempts: 1 });
    let calls = 0;
    const handlers = { [q as string]: async () => { calls++; throw new NonRetryableError("cannot work"); } };
    await runBatch(handlers, "t", 5);
    expect(calls).toBe(1);
    const dead = (await deadLetters(200)).find((d) => d.queue === (q as string));
    expect(dead?.error).toMatch(/cannot work/);
    expect(await retryDeadLetter(dead!.id)).toBe(true);
    expect((await db.queueJob.findUniqueOrThrow({ where: { id: dead!.id } })).status).toBe("PENDING");
    expect(await retryDeadLetter(dead!.id)).toBe(false); // already requeued
    await db.queueJob.deleteMany({ where: { queue: q as string } });
    void QUEUES;
  });

  it("rate limits across calls through the database and expires the window", async () => {
    const key = `${RUN}:rl`;
    for (let i = 0; i < 3; i++) expect((await rateLimitShared(key, 3, 60_000)).ok).toBe(true);
    const blocked = await rateLimitShared(key, 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    await db.rateLimitBucket.update({ where: { key }, data: { windowStart: new Date(Date.now() - 120_000) } });
    expect((await rateLimitShared(key, 3, 60_000)).ok).toBe(true); // new window
  });
});

describe("race conditions", () => {
  it("two simultaneous native applications create exactly one", async () => {
    const t = await makeEmployer("race-co", true);
    const { user, profile } = await makeUser("race1");
    const rv = await db.resume.create({ data: { profileId: profile.id, title: "CV" } });
    const v = (await saveResumeVersion(rv.id, { ...emptyResume(), summary: "BIM." }, "test")).version;
    const job = await activeJob("BIM Coordinator RACE", t.company.id, t.company.name);
    const results = await Promise.allSettled([applyNative(user.id, job.id, { resumeVersionId: v.id }), applyNative(user.id, job.id, { resumeVersionId: v.id })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ApplicationError);
    expect(await db.application.count({ where: { userId: user.id, jobId: job.id } })).toBe(1);
  });

  it("two recruiters moving the same application: exactly one transition wins", async () => {
    const t = await makeEmployer("race-co2", true);
    const rec = async (label: string) => {
      const { user } = await makeUser(label, "RECRUITER", { profile: false });
      await db.employerUser.create({ data: { userId: user.id, companyId: t.company.id, role: "RECRUITER" } });
      return (await employerCtx(user.id))!;
    };
    const [a, b] = [await rec("race-r1"), await rec("race-r2")];
    const { user, profile } = await makeUser("race2");
    const rv = await db.resume.create({ data: { profileId: profile.id, title: "CV" } });
    const v = (await saveResumeVersion(rv.id, { ...emptyResume(), summary: "BIM." }, "test")).version;
    const job = await activeJob("BIM Coordinator RACE2", t.company.id, t.company.name);
    const app = await applyNative(user.id, job.id, { resumeVersionId: v.id });
    const res = await Promise.allSettled([moveApplication(a, app.id, "SHORTLISTED"), moveApplication(b, app.id, "REJECTED")]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const events = await db.applicationEvent.count({ where: { applicationId: app.id, type: "status_changed" } });
    expect(events).toBe(1);
  });
});

describe("job reports and sitemap", () => {
  it("lets a user report a job once (re-reporting updates), and the sitemap lists only public, active content", async () => {
    const t = await makeEmployer("sm-co", true);
    const unverified = await makeEmployer("sm-unv", false);
    const open = await activeJob("BIM Coordinator SITEMAP", t.company.id, t.company.name);
    const closed = await activeJob("BIM Coordinator CLOSEDJOB", t.company.id, t.company.name, { status: "CLOSED" });
    const pub = await makeUser("sm-pub");
    const priv = await makeUser("sm-priv");
    await db.bIMProfessionalProfile.update({ where: { id: pub.profile.id }, data: { visibility: "PUBLIC" } });

    const reporter = await makeUser("reporter");
    await db.jobReport.upsert({ where: { userId_jobId: { userId: reporter.user.id, jobId: open.id } }, create: { userId: reporter.user.id, jobId: open.id, reason: "scam" }, update: { reason: "scam" } });
    await db.jobReport.upsert({ where: { userId_jobId: { userId: reporter.user.id, jobId: open.id } }, create: { userId: reporter.user.id, jobId: open.id, reason: "expired" }, update: { reason: "expired" } });
    expect(await db.jobReport.count({ where: { jobId: open.id } })).toBe(1);

    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.endsWith(`/jobs/${open.slug}`))).toBe(true);
    expect(urls.some((u) => u.endsWith(`/jobs/${closed.slug}`))).toBe(false);
    expect(urls.some((u) => u.endsWith(`/professionals/${pub.profile.slug}`))).toBe(true);
    expect(urls.some((u) => u.endsWith(`/professionals/${priv.profile.slug}`))).toBe(false);
    expect(urls.some((u) => u.endsWith(`/companies/${t.company.slug}`))).toBe(true);
    expect(urls.some((u) => u.endsWith(`/companies/${unverified.company.slug}`))).toBe(false);
  });
});
