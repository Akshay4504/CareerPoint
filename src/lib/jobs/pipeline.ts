import { createHash } from "crypto";
import type { Job, JobSource, Prisma, RawJob } from "@prisma/client";
import { db } from "@/lib/db";
import { QUEUES, enqueue, enqueueMany } from "@/lib/queue/queue";
import { inferSeniority } from "@/lib/taxonomy";
import { slugify, uniqueSuffix } from "@/lib/utils";
import { getConnector } from "./connectors";
import { PoliteHttpClient } from "./http";
import { classifyJob, platformDiscipline } from "./classify";
import { compareJobs, descriptionShingles, pickCanonical, type DedupeJob } from "./dedupe";
import { canonicalizeUrl, detectIndustry, normalizeCompany, normalizeTitle } from "./normalize";
import { scoreQuality } from "./quality";
import { SourceError, type ConnectorContext, type DiscoveredJob, type HttpLike, type NormalizedJobInput } from "./types";
import { validateJob } from "./validate";

// DB-facing orchestration of the ingestion pipeline. Each stage is a separate function invoked by a queue worker:
//   discoverSource → (fetchRaw) → processRaw [normalize → validate → classify → dedupe → score → upsert] → match/alerts
// Nothing here runs inside an HTTP request.

export type Deps = { http?: HttpLike; now?: () => Date };

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
const asJson = (v: unknown) => v as Prisma.InputJsonValue;

export function contextFor(source: JobSource, http: HttpLike, now?: Date): ConnectorContext {
  return { sourceId: source.id, config: (source.config ?? {}) as Record<string, unknown>, url: source.url, http, now };
}

export function httpFor(source: JobSource): PoliteHttpClient {
  return new PoliteHttpClient({ minIntervalMs: source.minIntervalMs });
}

async function log(sourceId: string, runId: string | null, level: "info" | "warn" | "error", message: string, meta?: unknown) {
  await db.ingestionLog.create({ data: { sourceId, runId, level, message: message.slice(0, 500), meta: meta === undefined ? undefined : asJson(meta) } }).catch(() => {});
}

// ---------------------------------------------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------------------------------------------

export type RunSummary = { runId: string; found: number; queued: number; unchanged: number; complete: boolean };

/** Lists a source's openings, stores raw payloads incrementally and queues processing. Never normalizes inline. */
export async function discoverSource(sourceId: string, deps: Deps = {}): Promise<RunSummary> {
  const now = deps.now?.() ?? new Date();
  const source = await db.jobSource.findUniqueOrThrow({ where: { id: sourceId } });
  const run = await db.ingestionRun.create({ data: { sourceId, startedAt: now } });
  const started = Date.now();
  const http = deps.http ?? httpFor(source);
  const connector = getConnector(source.type);
  const ctx = contextFor(source, http, now);
  const summary: RunSummary = { runId: run.id, found: 0, queued: 0, unchanged: 0, complete: false };
  try {
    const result = await connector.discoverJobs(ctx);
    summary.found = result.jobs.length;
    summary.complete = result.complete;
    for (const w of result.warnings) await log(sourceId, run.id, "warn", w);

    const existing = await db.rawJob.findMany({ where: { sourceId, sourceJobId: { in: result.jobs.map((j) => j.sourceJobId) } }, select: { sourceJobId: true, hash: true, status: true } });
    const known = new Map(existing.map((r) => [r.sourceJobId, r]));
    const toProcess: string[] = [];
    const toFetch: DiscoveredJob[] = [];
    const seen: string[] = [];
    for (const j of result.jobs) {
      seen.push(j.sourceJobId);
      if (j.payload === undefined) {
        toFetch.push(j);
        continue;
      }
      const hash = sha(j.payload);
      const prev = known.get(j.sourceJobId);
      if (prev && prev.hash === hash && prev.status !== "ERROR" && prev.status !== "NEW") {
        summary.unchanged++;
        continue; // incremental ingestion: identical payload, nothing to redo
      }
      const raw = await db.rawJob.upsert({
        where: { sourceId_sourceJobId: { sourceId, sourceJobId: j.sourceJobId } },
        create: { sourceId, sourceJobId: j.sourceJobId, sourceUrl: j.url, rawPayload: asJson(j.payload), hash, fetchedAt: now, lastSeenAt: now },
        update: { rawPayload: asJson(j.payload), sourceUrl: j.url, hash, status: "NEW", reason: null, fetchedAt: now, lastSeenAt: now },
      });
      toProcess.push(raw.id);
    }
    // Everything seen this run: bump lastSeenAt on raw rows, refs and jobs (and revive jobs that came back).
    await touchSeen(sourceId, seen, now);

    summary.queued += await enqueueMany(QUEUES.process, toProcess.map((id) => ({ payload: { rawJobId: id }, dedupeKey: `process:${id}` })));
    // Sources that only list URLs get one fetch task per page, spread out in time so a single run never bursts.
    const gap = Math.max(source.minIntervalMs, 1000);
    summary.queued += await enqueueMany(QUEUES.fetch, toFetch.map((j, i) => ({ payload: { sourceId, sourceJobId: j.sourceJobId, url: j.url }, runAt: new Date(now.getTime() + i * gap), dedupeKey: `fetch:${sourceId}:${j.sourceJobId}:${now.toISOString().slice(0, 13)}` })));

    await db.ingestionRun.update({ where: { id: run.id }, data: { status: "OK", complete: result.complete, found: summary.found, unchanged: summary.unchanged, finishedAt: new Date(), durationMs: Date.now() - started } });
    await db.jobSource.update({ where: { id: sourceId }, data: { lastRunAt: now, lastSuccessAt: now, lastStatus: "OK", lastError: null, consecutiveFailures: 0, health: "HEALTHY" } });
    await log(sourceId, run.id, "info", `Discovered ${summary.found} openings (${summary.unchanged} unchanged, ${summary.queued} queued)${result.complete ? "" : " — partial listing"}`);
    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const failures = source.consecutiveFailures + 1;
    await db.ingestionRun.update({ where: { id: run.id }, data: { status: "FAILED", error: message.slice(0, 500), failures: 1, finishedAt: new Date(), durationMs: Date.now() - started } });
    await db.jobSource.update({ where: { id: sourceId }, data: { lastRunAt: now, lastStatus: "ERROR", lastError: message.slice(0, 500), consecutiveFailures: failures, health: failures >= 3 ? "UNHEALTHY" : "DEGRADED" } });
    await log(sourceId, run.id, "error", message);
    throw e;
  }
}

async function touchSeen(sourceId: string, seenIds: string[], now: Date) {
  if (!seenIds.length) return;
  for (let i = 0; i < seenIds.length; i += 500) {
    const chunk = seenIds.slice(i, i + 500);
    await db.rawJob.updateMany({ where: { sourceId, sourceJobId: { in: chunk } }, data: { lastSeenAt: now } });
    await db.jobSourceRef.updateMany({ where: { sourceId, sourceJobId: { in: chunk } }, data: { lastSeenAt: now, active: true } });
    const refs = await db.jobSourceRef.findMany({ where: { sourceId, sourceJobId: { in: chunk } }, select: { jobId: true } });
    const ids = [...new Set(refs.map((r) => r.jobId))];
    if (ids.length) {
      await db.job.updateMany({ where: { id: { in: ids } }, data: { lastSeenAt: now } });
      // A job that reappeared at its source is live again (moderator decisions — CLOSED/REJECTED — are never overridden).
      await db.job.updateMany({ where: { id: { in: ids }, status: "INACTIVE" }, data: { status: "ACTIVE" } });
    }
  }
}

/** Fetches one page (career-page style sources) and queues it for processing. */
export async function fetchRaw(sourceId: string, ref: DiscoveredJob, deps: Deps = {}) {
  const source = await db.jobSource.findUniqueOrThrow({ where: { id: sourceId } });
  const now = deps.now?.() ?? new Date();
  const connector = getConnector(source.type);
  const payload = await connector.fetchJob(contextFor(source, deps.http ?? httpFor(source), now), ref);
  if (payload == null) {
    // The page is gone or no longer carries a posting: treat as "not seen" and let expiry rechecks confirm.
    await db.rawJob.updateMany({ where: { sourceId, sourceJobId: ref.sourceJobId }, data: { status: "REJECTED", reason: "Page has no job posting (removed?)" } });
    return null;
  }
  const hash = sha(payload);
  const prev = await db.rawJob.findUnique({ where: { sourceId_sourceJobId: { sourceId, sourceJobId: ref.sourceJobId } } });
  if (prev && prev.hash === hash && prev.status !== "ERROR" && prev.status !== "NEW") {
    await db.rawJob.update({ where: { id: prev.id }, data: { lastSeenAt: now } });
    await touchSeen(sourceId, [ref.sourceJobId], now);
    return null;
  }
  const raw = await db.rawJob.upsert({
    where: { sourceId_sourceJobId: { sourceId, sourceJobId: ref.sourceJobId } },
    create: { sourceId, sourceJobId: ref.sourceJobId, sourceUrl: ref.url, rawPayload: asJson(payload), hash, fetchedAt: now, lastSeenAt: now },
    update: { rawPayload: asJson(payload), hash, status: "NEW", reason: null, fetchedAt: now, lastSeenAt: now },
  });
  await touchSeen(sourceId, [ref.sourceJobId], now);
  await enqueue(QUEUES.process, { rawJobId: raw.id }, { dedupeKey: `process:${raw.id}` });
  return raw.id;
}

// ---------------------------------------------------------------------------------------------------------------
// Processing: normalize → validate → classify → dedupe → quality → upsert
// ---------------------------------------------------------------------------------------------------------------

export type ProcessOutcome = { status: "created" | "updated" | "duplicate" | "rejected"; jobId?: string; reason?: string };

export async function uniqueJobSlug(title: string, company: string) {
  return `${slugify(`${title} ${company}`, 70)}-${uniqueSuffix(5)}`;
}

const dedupeShape = (j: DedupeJob): DedupeJob => j;

function buildJobFields(norm: NormalizedJobInput, cls: ReturnType<typeof classifyJob>, quality: ReturnType<typeof scoreQuality>, now: Date) {
  const companyKey = normalizeCompany(norm.companyName);
  const titleKey = normalizeTitle(norm.title);
  const all = `${norm.title}\n${norm.description}`;
  return {
    title: norm.title,
    companyName: norm.companyName,
    companyKey,
    titleKey,
    description: norm.description.slice(0, 30_000),
    responsibilities: norm.responsibilities?.slice(0, 10_000) ?? null,
    requirements: norm.requirements?.slice(0, 10_000) ?? null,
    location: norm.location ?? null,
    city: norm.city ?? null,
    country: norm.country ?? null,
    remote: norm.remoteType === "REMOTE",
    remoteType: norm.remoteType ?? "UNKNOWN",
    employmentType: norm.employmentType ?? null,
    seniority: inferSeniority(norm.title),
    experienceMin: norm.experienceMin ?? null,
    experienceMax: norm.experienceMax ?? null,
    salaryMin: norm.salaryMin ?? null,
    salaryMax: norm.salaryMax ?? null,
    salaryCurrency: norm.currency ?? null,
    discipline: platformDiscipline(cls.primaryDiscipline) ?? null,
    bimRole: cls.bimRole ?? null,
    industry: detectIndustry(all) ?? null,
    software: cls.tools,
    skills: [...new Set([...cls.skills, ...cls.standards])],
    bimRelevanceScore: cls.bimRelevanceScore,
    qualityScore: quality.score,
    qualityBreakdown: asJson({ parts: quality.parts, notes: quality.notes, classification: { tier: cls.tier, evidence: cls.evidence, disciplines: cls.disciplines } }),
    applyUrl: norm.applyUrl,
    canonicalUrl: norm.canonicalUrl ?? canonicalizeUrl(norm.applyUrl),
    postedAt: norm.postedAt ?? now,
    expiresAt: norm.expiresAt ?? null,
    lastSeenAt: now,
  };
}

type JobFields = ReturnType<typeof buildJobFields>;

export async function processRaw(rawJobId: string, deps: Deps = {}): Promise<ProcessOutcome> {
  const now = deps.now?.() ?? new Date();
  const raw = await db.rawJob.findUniqueOrThrow({ where: { id: rawJobId }, include: { source: true } });
  const source = raw.source;
  const connector = getConnector(source.type);
  const ctx = contextFor(source, deps.http ?? ({} as HttpLike), now);
  const run = await db.ingestionRun.findFirst({ where: { sourceId: source.id }, orderBy: { startedAt: "desc" }, select: { id: true } });
  const count = (field: "accepted" | "rejected" | "duplicates" | "updated" | "failures") => run ? db.ingestionRun.update({ where: { id: run.id }, data: { [field]: { increment: 1 } } }).catch(() => {}) : Promise.resolve();

  let norm: NormalizedJobInput | null;
  try {
    norm = connector.normalizeJob(ctx, raw.rawPayload, { sourceJobId: raw.sourceJobId, url: raw.sourceUrl });
  } catch (e) {
    await db.rawJob.update({ where: { id: raw.id }, data: { status: "ERROR", reason: `normalize failed: ${e instanceof Error ? e.message : e}`, processedAt: now } });
    await count("failures");
    await log(source.id, run?.id ?? null, "error", `normalize failed for ${raw.sourceJobId}`, { error: String(e) });
    return { status: "rejected", reason: "normalize failed" };
  }
  const reject = async (reason: string): Promise<ProcessOutcome> => {
    await db.rawJob.update({ where: { id: raw.id }, data: { status: "REJECTED", reason, processedAt: now } });
    await count("rejected");
    return { status: "rejected", reason };
  };
  if (!norm) return reject("unusable payload (missing title, company or description)");

  const valid = validateJob(norm, now);
  if (!valid.ok) return reject(`invalid: ${valid.reasons.join("; ")}`);

  const cls = classifyJob({ title: norm.title, description: norm.description, responsibilities: norm.responsibilities, requirements: norm.requirements });
  if (!cls.accepted) return reject(`not a BIM role (relevance ${cls.bimRelevanceScore}): ${cls.evidence[0]}`);

  const quality = scoreQuality({ bimRelevanceScore: cls.bimRelevanceScore, title: norm.title, description: norm.description, responsibilities: norm.responsibilities, requirements: norm.requirements, postedAt: norm.postedAt, discoveredAt: now, sourceReliability: source.reliability, city: norm.city, country: norm.country, remoteType: norm.remoteType, salaryMin: norm.salaryMin, salaryMax: norm.salaryMax, bimRole: cls.bimRole }, now);
  const fields = buildJobFields(norm, cls, quality, now);

  // 1. Same source opening already known → update in place (follow merges to the canonical row).
  const ref = await db.jobSourceRef.findUnique({ where: { sourceId_sourceJobId: { sourceId: source.id, sourceJobId: raw.sourceJobId } }, include: { job: true } });
  if (ref) {
    const jobId = ref.job.canonicalJobId ?? ref.job.id;
    const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
    const better = source.reliability >= (await refReliability(job.id, source.id));
    await db.jobSourceRef.update({ where: { id: ref.id }, data: { lastSeenAt: now, active: true, url: raw.sourceUrl } });
    await db.job.update({
      where: { id: job.id },
      data: { lastSeenAt: now, ...(better && job.status !== "REJECTED" ? { ...fields, discoveredAt: undefined } : {}), ...(job.status === "INACTIVE" ? { status: "ACTIVE" } : {}) },
    });
    await db.rawJob.update({ where: { id: raw.id }, data: { status: "PROCESSED", jobId: job.id, processedAt: now, reason: null } });
    await count("updated");
    await enqueue(QUEUES.match, { jobId: job.id }, { dedupeKey: `match:${job.id}` });
    return { status: "updated", jobId: job.id };
  }

  // 2. Same opening seen elsewhere → merge into the canonical job, keep provenance.
  const dupe = await findDuplicate(fields, source.id, raw.sourceJobId);
  if (dupe) {
    await mergeInto(dupe.job, fields, source, raw, dupe.probability, now);
    await count("duplicates");
    return { status: "duplicate", jobId: dupe.job.id, reason: dupe.reasons.join(", ") };
  }

  // 3. New opening.
  const job = await db.job.create({
    data: { ...fields, slug: await uniqueJobSlug(norm.title, norm.companyName), sourceId: source.id, externalId: raw.sourceJobId, sourceJobId: raw.sourceJobId, status: "ACTIVE", discoveredAt: now, refs: { create: { sourceId: source.id, sourceJobId: raw.sourceJobId, url: raw.sourceUrl, lastSeenAt: now } } },
  });
  await db.rawJob.update({ where: { id: raw.id }, data: { status: "PROCESSED", jobId: job.id, processedAt: now, reason: null } });
  await count("accepted");
  await enqueue(QUEUES.match, { jobId: job.id }, { dedupeKey: `match:${job.id}` });
  return { status: "created", jobId: job.id };
}

async function refReliability(jobId: string, exceptSourceId: string) {
  const refs = await db.jobSourceRef.findMany({ where: { jobId, active: true, sourceId: { not: exceptSourceId } }, include: { source: { select: { reliability: true } } } });
  return refs.reduce((m, r) => Math.max(m, r.source.reliability), 0);
}

export async function findDuplicate(f: { companyName: string; title: string; companyKey: string | null; titleKey: string | null; city: string | null; country: string | null; remoteType: string; description: string; postedAt: Date | null; canonicalUrl: string | null }, sourceId: string, sourceJobId: string) {
  const candidates = await db.job.findMany({
    where: {
      canonicalJobId: null,
      status: { in: ["ACTIVE", "INACTIVE", "PENDING"] },
      OR: [
        ...(f.canonicalUrl ? [{ canonicalUrl: f.canonicalUrl }] : []),
        ...(f.companyKey ? [{ companyKey: f.companyKey }] : []),
        ...(f.titleKey && f.city ? [{ titleKey: f.titleKey, city: f.city }] : []),
      ],
    },
    orderBy: { discoveredAt: "desc" },
    take: 80,
  });
  if (!candidates.length) return null;
  const mine = dedupeShape({ sourceId, sourceJobId, canonicalUrl: f.canonicalUrl, companyName: f.companyName, title: f.title, city: f.city, country: f.country, remoteType: f.remoteType as Job["remoteType"], description: f.description, postedAt: f.postedAt });
  const shMine = descriptionShingles(f.description);
  let best: { job: Job; probability: number; reasons: string[] } | null = null;
  for (const c of candidates) {
    const r = compareJobs(mine, dedupeShape(c), shMine);
    if (r.duplicate && (!best || r.probability > best.probability)) best = { job: c, probability: r.probability, reasons: r.reasons };
  }
  return best;
}

async function mergeInto(canonical: Job, f: JobFields, source: JobSource, raw: RawJob, probability: number, now: Date) {
  const canonSourceRel = canonical.sourceId ? (await db.jobSource.findUnique({ where: { id: canonical.sourceId }, select: { reliability: true } }))?.reliability ?? 50 : 100;
  const winner = pickCanonical(
    { reliability: canonSourceRel, descriptionLength: canonical.description.length, discoveredAt: canonical.discoveredAt, isNative: !canonical.sourceId && !!canonical.companyId },
    { reliability: source.reliability, descriptionLength: f.description.length, discoveredAt: now, isNative: false },
  );
  const newWins = winner.reliability === source.reliability && winner.descriptionLength === f.description.length && winner.discoveredAt === now;
  await db.$transaction([
    db.jobSourceRef.upsert({ where: { sourceId_sourceJobId: { sourceId: source.id, sourceJobId: raw.sourceJobId } }, create: { jobId: canonical.id, sourceId: source.id, sourceJobId: raw.sourceJobId, url: raw.sourceUrl, lastSeenAt: now }, update: { jobId: canonical.id, lastSeenAt: now, active: true, url: raw.sourceUrl } }),
    db.job.update({
      where: { id: canonical.id },
      data: {
        lastSeenAt: now,
        duplicateProbability: Math.max(canonical.duplicateProbability, probability),
        ...(canonical.status === "INACTIVE" ? { status: "ACTIVE" } : {}),
        // The richer / more reliable source supplies the displayed content; id, slug and applications stay put.
        ...(newWins && canonical.companyId == null && canonical.postedByUserId == null ? { ...f, discoveredAt: undefined, canonicalUrl: canonical.canonicalUrl ?? f.canonicalUrl } : {}),
        // Always fill gaps the canonical row has.
        ...(canonical.salaryMin == null && f.salaryMin != null ? { salaryMin: f.salaryMin, salaryMax: f.salaryMax, salaryCurrency: f.salaryCurrency } : {}),
        ...(canonical.city == null && f.city ? { city: f.city } : {}),
        ...(canonical.country == null && f.country ? { country: f.country } : {}),
      },
    }),
    db.rawJob.update({ where: { id: raw.id }, data: { status: "DUPLICATE", jobId: canonical.id, processedAt: now, reason: `duplicate of ${canonical.id} (p=${probability})` } }),
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// Expiry, rechecks, health, scheduling
// ---------------------------------------------------------------------------------------------------------------

/**
 * Finds refs that stopped appearing at a source that has since produced a COMPLETE successful listing, and queues a
 * recheck for each. Jobs are never expired because of a partial/failed run, and are never deleted.
 */
export async function findStale(now = new Date(), limit = 500) {
  const sources = await db.jobSource.findMany({ where: { active: true } });
  let queued = 0;
  for (const s of sources) {
    const lastComplete = await db.ingestionRun.findFirst({ where: { sourceId: s.id, status: "OK", complete: true }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
    if (!lastComplete) continue;
    const cutoff = new Date(Math.min(now.getTime() - s.expireAfterDays * 86400_000, lastComplete.startedAt.getTime() - 1));
    const refs = await db.jobSourceRef.findMany({ where: { sourceId: s.id, active: true, lastSeenAt: { lt: cutoff } }, take: limit });
    queued += await enqueueMany(QUEUES.recheck, refs.map((r) => ({ payload: { refId: r.id }, dedupeKey: `recheck:${r.id}:${now.toISOString().slice(0, 10)}` })));
  }
  return queued;
}

/** Rechecks one ref at its source. Gone → inactive ref; if no active refs remain the job becomes INACTIVE. */
export async function recheckRef(refId: string, deps: Deps = {}) {
  const now = deps.now?.() ?? new Date();
  const ref = await db.jobSourceRef.findUnique({ where: { id: refId }, include: { source: true } });
  if (!ref) return "missing" as const;
  const connector = getConnector(ref.source.type);
  let payload: unknown | null;
  try {
    payload = await connector.fetchJob(contextFor(ref.source, deps.http ?? httpFor(ref.source), now), { sourceJobId: ref.sourceJobId, url: ref.url });
  } catch (e) {
    if (e instanceof SourceError && !e.retryable && e.status !== 404 && e.status !== 410) throw e;
    if (!(e instanceof SourceError) || e.retryable) throw e; // transient: let the queue retry; never expire on an error
    payload = null;
  }
  if (payload != null) {
    await db.jobSourceRef.update({ where: { id: ref.id }, data: { lastSeenAt: now, active: true } });
    await db.job.updateMany({ where: { id: ref.jobId }, data: { lastSeenAt: now } });
    await db.job.updateMany({ where: { id: ref.jobId, status: "INACTIVE" }, data: { status: "ACTIVE" } });
    return "alive" as const;
  }
  await db.jobSourceRef.update({ where: { id: ref.id }, data: { active: false } });
  const remaining = await db.jobSourceRef.count({ where: { jobId: ref.jobId, active: true } });
  if (remaining === 0) {
    // Only source-ingested, currently ACTIVE jobs are expired. Applications and saved jobs are untouched.
    await db.job.updateMany({ where: { id: ref.jobId, status: "ACTIVE", postedByUserId: null }, data: { status: "INACTIVE" } });
    return "expired" as const;
  }
  return "gone-but-listed-elsewhere" as const;
}

/** Jobs past their own expiry date (validThrough / expiresAt) become inactive. */
export async function expireByDate(now = new Date()) {
  const r = await db.job.updateMany({ where: { status: "ACTIVE", expiresAt: { lt: now } }, data: { status: "INACTIVE" } });
  return r.count;
}

export async function checkSourceHealth(sourceId: string, deps: Deps = {}) {
  const source = await db.jobSource.findUniqueOrThrow({ where: { id: sourceId } });
  let ok = false;
  let message = "";
  try {
    const r = await getConnector(source.type).healthCheck(contextFor(source, deps.http ?? httpFor(source), deps.now?.()));
    ok = r.ok;
    message = r.message;
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  const failures = ok ? 0 : source.consecutiveFailures + 1;
  await db.jobSource.update({ where: { id: sourceId }, data: { health: ok ? "HEALTHY" : failures >= 3 ? "UNHEALTHY" : "DEGRADED", consecutiveFailures: failures, ...(ok ? {} : { lastError: message.slice(0, 500) }) } });
  await log(sourceId, null, ok ? "info" : "warn", `Health check: ${message}`);
  return { ok, message };
}

/** Called by the worker's scheduler: queue discovery for every source that is due. */
export async function scheduleDueSources(now = new Date()) {
  const due = await db.jobSource.findMany({ where: { active: true, type: { not: "MANUAL" }, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }, select: { id: true, runEveryMinutes: true } });
  for (const s of due) {
    await enqueue(QUEUES.discover, { sourceId: s.id }, { dedupeKey: `discover:${s.id}`, maxAttempts: 3 });
    const jitter = Math.floor(Math.random() * 5) * 60_000;
    await db.jobSource.update({ where: { id: s.id }, data: { nextRunAt: new Date(now.getTime() + s.runEveryMinutes * 60_000 + jitter) } });
  }
  return due.length;
}
