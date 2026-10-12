import type { Application, ApplicationStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyEvent } from "@/lib/notifications/service";
import { can } from "@/lib/employer/permissions";
import { safeUrl, msAgo } from "@/lib/utils";
import { STAGE_LABEL, canMove, isNativeJob, isOpen, isSelfReported, isTerminal, type Actor } from "./lifecycle";

// Candidate side of the application journey. Every function takes the acting user's id and re-checks ownership in the
// query itself (`where: { id, userId }`), so another user's application id simply does not exist for the caller (no IDOR).

export class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationError";
  }
}

type Tx = Prisma.TransactionClient | typeof db;

export async function addEvent(tx: Tx, applicationId: string, e: { type: string; actorId?: string | null; actorRole: Actor | "EMPLOYER"; fromStatus?: ApplicationStatus | null; toStatus?: ApplicationStatus | null; note?: string | null; visibleToCandidate?: boolean; meta?: Prisma.InputJsonValue }) {
  return tx.applicationEvent.create({ data: { applicationId, type: e.type, actorId: e.actorId ?? null, actorRole: e.actorRole, fromStatus: e.fromStatus ?? null, toStatus: e.toStatus ?? null, note: e.note ?? null, visibleToCandidate: e.visibleToCandidate ?? true, meta: e.meta } });
}

/** Notify every member of a company who may see applications. */
export async function notifyCompany(companyId: string, event: string, input: { title: string; body?: string; href?: string }, exceptUserId?: string) {
  const members = await db.employerUser.findMany({ where: { companyId, ...(exceptUserId ? { userId: { not: exceptUserId } } : {}) }, select: { userId: true, role: true } });
  await Promise.all(members.filter((m) => can(m.role, "applications.view")).map((m) => notifyEvent(m.userId, event, input)));
}

// ---- interactions (what the candidate actually did) -------------------------------------------------------------

export type InteractionType = "VIEWED" | "SAVED" | "UNSAVED" | "PINNED" | "UNPINNED" | "APPLY_CLICK";

/** Records a real action. Job views are collapsed to one per user per job per day. */
export async function recordInteraction(userId: string, jobId: string, type: InteractionType, meta?: Prisma.InputJsonValue) {
  if (type === "VIEWED" && (await db.jobInteraction.findFirst({ where: { userId, jobId, type, createdAt: { gt: msAgo(86400_000) } }, select: { id: true } }))) return null;
  return db.jobInteraction.create({ data: { userId, jobId, type, meta } });
}

// ---- resume + portfolio validation ------------------------------------------------------------------------------

async function ownedResumeVersion(userId: string, id?: string | null) {
  if (!id) return null;
  const v = await db.resumeVersion.findFirst({ where: { id, resume: { profile: { userId } } }, select: { id: true } });
  if (!v) throw new ApplicationError("Selected resume not found.");
  return v.id;
}

async function ownedPortfolio(userId: string, projectIds: string[], itemIds: string[]) {
  const [projects, items] = await Promise.all([
    projectIds.length ? db.project.findMany({ where: { id: { in: projectIds }, profile: { userId } }, select: { id: true } }) : [],
    itemIds.length ? db.portfolioItem.findMany({ where: { id: { in: itemIds }, profile: { userId } }, select: { id: true } }) : [],
  ]);
  if (projects.length !== new Set(projectIds).size || items.length !== new Set(itemIds).size) throw new ApplicationError("A selected portfolio item was not found.");
  return { projectIds: [...new Set(projectIds)].slice(0, 6), itemIds: [...new Set(itemIds)].slice(0, 12) };
}

const sourceLabelOf = (job: { source?: { name: string } | null; applyUrl?: string | null; companyName: string }) => job.source?.name ?? (job.applyUrl ? new URL(job.applyUrl).hostname.replace(/^www\./, "") : "CareerPoint");

// ---- EXTERNAL applications --------------------------------------------------------------------------------------

/**
 * "Apply" on an external job: the candidate is sent to the official application page. We record the click and create an
 * APPLYING application. Nothing says the employer received anything until the candidate confirms they submitted — and
 * even then it is self-reported.
 */
export async function startExternalApply(userId: string, jobId: string, opts: { resumeVersionId?: string | null; origin?: string | null } = {}) {
  const job = await db.job.findFirst({ where: { id: jobId, status: "ACTIVE", canonicalJobId: null }, include: { source: { select: { name: true } } } });
  if (!job) throw new ApplicationError("This job is no longer open.");
  if (isNativeJob(job)) throw new ApplicationError("This employer takes applications on CareerPoint.");
  const url = safeUrl(job.applyUrl);
  if (!url) throw new ApplicationError("This posting has no official application link.");
  const resumeVersionId = await ownedResumeVersion(userId, opts.resumeVersionId);
  const now = new Date();

  const existing = await db.application.findUnique({ where: { userId_jobId: { userId, jobId } } });
  let app: Application;
  if (!existing) {
    try {
    app = await db.application.create({ data: { userId, jobId, external: true, status: "APPLYING", resumeVersionId, origin: opts.origin ?? "direct", sourceLabel: sourceLabelOf(job), applyClickedAt: now, lastActivityAt: now, events: { create: { type: "apply_click", actorId: userId, actorRole: "CANDIDATE", toStatus: "APPLYING", meta: { source: sourceLabelOf(job), resumeVersionId } } } } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") return { application: (await db.application.findUniqueOrThrow({ where: { userId_jobId: { userId, jobId } } })), url, alreadyTracked: true as const };
      throw e;
    }
    await audit(userId, "application.created", "Application", app.id, { jobId, external: true });
  } else if (existing.status === "APPLYING" || existing.status === "WITHDRAWN" || existing.status === "EXPIRED") {
    const restart = existing.status !== "APPLYING";
    app = await db.application.update({ where: { id: existing.id }, data: { status: "APPLYING", applyClickedAt: now, lastActivityAt: now, resumeVersionId: resumeVersionId ?? existing.resumeVersionId, external: true } });
    await addEvent(db, app.id, { type: "apply_click", actorId: userId, actorRole: "CANDIDATE", fromStatus: restart ? existing.status : "APPLYING", toStatus: "APPLYING", meta: { source: sourceLabelOf(job), resumeVersionId } });
  } else {
    return { application: existing, url, alreadyTracked: true as const };
  }
  await recordInteraction(userId, jobId, "APPLY_CLICK", { applicationId: app.id });
  return { application: app, url, alreadyTracked: false as const };
}

/** "Did you complete the application?" Yes → APPLIED (self-reported). No → stays APPLYING. */
export async function confirmExternalSubmission(userId: string, applicationId: string, submitted: boolean) {
  const app = await db.application.findFirst({ where: { id: applicationId, userId } });
  if (!app || !app.external) throw new ApplicationError("Application not found.");
  if (app.status !== "APPLYING") throw new ApplicationError("This application isn't waiting for confirmation.");
  const now = new Date();
  if (!submitted) {
    await db.application.update({ where: { id: app.id }, data: { lastActivityAt: now } });
    await addEvent(db, app.id, { type: "not_submitted", actorId: userId, actorRole: "CANDIDATE", note: "Not submitted yet" });
    return app;
  }
  const updated = await db.application.update({ where: { id: app.id }, data: { status: "APPLIED", appliedAt: now, lastActivityAt: now } });
  await addEvent(db, app.id, { type: "candidate_confirmed_submission", actorId: userId, actorRole: "CANDIDATE", fromStatus: "APPLYING", toStatus: "APPLIED", note: "Self-reported by the candidate" });
  await audit(userId, "application.status", "Application", app.id, { from: "APPLYING", to: "APPLIED", selfReported: true });
  return updated;
}

// ---- NATIVE applications ----------------------------------------------------------------------------------------

export type NativeApplyInput = { resumeVersionId: string; portfolioProjectIds?: string[]; portfolioItemIds?: string[]; coverNote?: string | null; origin?: string | null };

/** Apply to a job posted by an employer on CareerPoint. The employer receives the application immediately. */
export async function applyNative(userId: string, jobId: string, input: NativeApplyInput) {
  const job = await db.job.findFirst({ where: { id: jobId, status: "ACTIVE", canonicalJobId: null }, include: { company: true } });
  if (!job || !isNativeJob(job) || !job.companyId) throw new ApplicationError("This job is not open for applications on CareerPoint.");
  const resumeVersionId = await ownedResumeVersion(userId, input.resumeVersionId);
  if (!resumeVersionId) throw new ApplicationError("Choose a resume to send.");
  const portfolio = await ownedPortfolio(userId, input.portfolioProjectIds ?? [], input.portfolioItemIds ?? []);
  const now = new Date();
  const note = input.coverNote?.trim().slice(0, 2000) || null;

  const existing = await db.application.findUnique({ where: { userId_jobId: { userId, jobId } } });
  if (existing && !(existing.status === "WITHDRAWN" || existing.status === "EXPIRED" || existing.status === "APPLYING")) throw new ApplicationError("You have already applied to this job.");

  const data = { external: false, status: "APPLIED" as const, resumeVersionId, coverNote: note, portfolioProjectIds: portfolio.projectIds, portfolioItemIds: portfolio.itemIds, origin: input.origin ?? "direct", sourceLabel: "CareerPoint", appliedAt: now, lastActivityAt: now, viewedByEmployerAt: null };
  let app: Application;
  try {
    app = existing ? await db.application.update({ where: { id: existing.id }, data }) : await db.application.create({ data: { userId, jobId, ...data } });
  } catch (e) {
    // Double-click / two tabs: the unique (userId, jobId) index makes the second insert fail; that is "already applied", not an error page.
    if ((e as { code?: string }).code === "P2002") throw new ApplicationError("You have already applied to this job.");
    throw e;
  }
  await addEvent(db, app.id, { type: "applied", actorId: userId, actorRole: "CANDIDATE", fromStatus: existing?.status ?? null, toStatus: "APPLIED", meta: { resumeVersionId, projects: portfolio.projectIds.length, items: portfolio.itemIds.length } });
  await audit(userId, "application.created", "Application", app.id, { jobId, external: false });
  const who = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  await notifyCompany(job.companyId, "application.submitted", { title: `New application: ${job.title}`, body: `${who?.name ?? "A candidate"} applied.`, href: `/employer/applications/${app.id}` });
  return app;
}

// ---- candidate-driven moves -----------------------------------------------------------------------------------

/** Withdraw, accept an offer, or (external only) self-report progress. Legality comes from the lifecycle rules. */
export async function candidateMove(userId: string, applicationId: string, to: ApplicationStatus, note?: string | null) {
  const app = await db.application.findFirst({ where: { id: applicationId, userId }, include: { job: { select: { title: true, companyId: true } } } });
  if (!app) throw new ApplicationError("Application not found.");
  if (!canMove(app, "CANDIDATE", to)) throw new ApplicationError(`You can't move this application from ${STAGE_LABEL[app.status]} to ${STAGE_LABEL[to]}.`);
  const self = isSelfReported(app, "CANDIDATE", to);
  const text = (note?.trim() || (self ? "Self-reported by the candidate" : null))?.slice(0, 500) ?? null;
  // Optimistic concurrency: only move from the status we validated against (a concurrent change makes this a no-op).
  const moved = await db.application.updateMany({ where: { id: app.id, status: app.status }, data: { status: to, lastActivityAt: new Date(), ...(to === "APPLIED" && !app.appliedAt ? { appliedAt: new Date() } : {}) } });
  if (moved.count === 0) throw new ApplicationError("This application just changed. Refresh and try again.");
  const updated = await db.application.findUniqueOrThrow({ where: { id: app.id } });
  await addEvent(db, app.id, { type: to === "WITHDRAWN" ? "withdrawn" : "status_changed", actorId: userId, actorRole: "CANDIDATE", fromStatus: app.status, toStatus: to, note: text });
  await audit(userId, "application.status", "Application", app.id, { from: app.status, to, selfReported: self });
  if (!app.external && app.job.companyId) {
    if (to === "WITHDRAWN") await notifyCompany(app.job.companyId, "application.withdrawn", { title: `Application withdrawn: ${app.job.title}`, href: `/employer/applications/${app.id}` });
    if (to === "ACCEPTED") await notifyCompany(app.job.companyId, "offer.response", { title: `Offer accepted: ${app.job.title}`, href: `/employer/applications/${app.id}` });
  }
  return updated;
}

export async function respondToInterview(userId: string, interviewId: string, accept: boolean) {
  const iv = await db.interview.findFirst({ where: { id: interviewId, application: { userId } }, include: { application: { include: { job: { select: { title: true, companyId: true } } } } } });
  if (!iv) throw new ApplicationError("Interview not found.");
  if (iv.status !== "SCHEDULED") throw new ApplicationError("This interview is no longer scheduled.");
  await db.interview.update({ where: { id: iv.id }, data: { candidateResponse: accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() } });
  await db.application.update({ where: { id: iv.applicationId }, data: { lastActivityAt: new Date() } });
  if (iv.application.job.companyId) await notifyCompany(iv.application.job.companyId, "interview.response", { title: `${accept ? "Interview confirmed" : "Interview declined"}: ${iv.application.job.title}`, href: `/employer/applications/${iv.applicationId}` });
}

export async function sendCandidateMessage(userId: string, applicationId: string, body: string) {
  const text = body.trim();
  if (!text || text.length > 3000) throw new ApplicationError("Write a message up to 3,000 characters.");
  const app = await db.application.findFirst({ where: { id: applicationId, userId, external: false }, include: { job: { select: { title: true, companyId: true } } } });
  if (!app) throw new ApplicationError("Messaging is available for applications made on CareerPoint.");
  if (isTerminal(app.status)) throw new ApplicationError("This application is closed.");
  const m = await db.applicationMessage.create({ data: { applicationId, senderId: userId, senderRole: "CANDIDATE", body: text } });
  await db.application.update({ where: { id: app.id }, data: { lastActivityAt: new Date() } });
  if (app.job.companyId) await notifyCompany(app.job.companyId, "message.received.employer", { title: `Message about ${app.job.title}`, body: text.slice(0, 140), href: `/employer/applications/${app.id}` });
  return m;
}

// ---- reads ------------------------------------------------------------------------------------------------------

/** One of the caller's applications with everything the candidate may see. Recruiter notes are never selected. */
export async function getCandidateApplication(userId: string, applicationId: string) {
  const app = await db.application.findFirst({
    where: { id: applicationId, userId },
    include: {
      job: { include: { company: { select: { slug: true, name: true, verified: true } }, source: { select: { name: true } } } },
      events: { where: { visibleToCandidate: true }, orderBy: { createdAt: "asc" } },
      interviews: { orderBy: { scheduledAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" } },
      resumeVersion: { select: { id: true, version: true, resume: { select: { id: true, title: true } } } },
    },
  });
  if (!app) return null;
  const interactions = await db.jobInteraction.findMany({ where: { userId, jobId: app.jobId }, orderBy: { createdAt: "asc" } });
  return { app, interactions };
}

export type TrackerFilters = { q?: string; status?: ApplicationStatus; origin?: "native" | "external"; active?: boolean };

export async function listCandidateApplications(userId: string, f: TrackerFilters = {}) {
  const where: Prisma.ApplicationWhereInput = {
    userId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.origin ? { external: f.origin === "external" } : {}),
    ...(f.active ? { status: { in: ["APPLYING", "APPLIED", "RECRUITER_REVIEW", "SHORTLISTED", "ASSESSMENT", "INTERVIEW", "OFFER"] } } : {}),
    ...(f.q?.trim() ? { job: { OR: [{ title: { contains: f.q.trim(), mode: "insensitive" } }, { companyName: { contains: f.q.trim(), mode: "insensitive" } }] } } : {}),
  };
  return db.application.findMany({ where, orderBy: { lastActivityAt: "desc" }, take: 300, include: { job: { select: { id: true, slug: true, title: true, companyName: true, location: true, status: true } }, interviews: { where: { status: "SCHEDULED", scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: "asc" }, take: 1 }, _count: { select: { messages: true } } } });
}

/** Saved and pinned jobs the candidate has not applied to yet (the "Saved" kanban column). */
export async function listSavedForTracker(userId: string, q?: string) {
  const jobFilter: Prisma.JobWhereInput = { applications: { none: { userId } }, ...(q?.trim() ? { OR: [{ title: { contains: q.trim(), mode: "insensitive" } }, { companyName: { contains: q.trim(), mode: "insensitive" } }] } : {}) };
  const [saved, pinned] = await Promise.all([
    db.savedJob.findMany({ where: { userId, job: jobFilter }, include: { job: { select: { id: true, slug: true, title: true, companyName: true, location: true, status: true, expiresAt: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.pinnedJob.findMany({ where: { userId }, select: { jobId: true } }),
  ]);
  const pins = new Set(pinned.map((p) => p.jobId));
  return saved.map((s) => ({ ...s.job, stage: (pins.has(s.jobId) ? "PINNED" : "SAVED") as ApplicationStatus, savedAt: s.createdAt })).sort((a, b) => Number(b.stage === "PINNED") - Number(a.stage === "PINNED"));
}

/** Applications still APPLYING after two weeks were never confirmed: close them (history is kept). */
export async function expireUnconfirmed(now = new Date(), days = 14) {
  const stale = await db.application.findMany({ where: { status: "APPLYING", lastActivityAt: { lt: new Date(now.getTime() - days * 86400_000) } }, select: { id: true } });
  for (const a of stale) {
    await db.application.update({ where: { id: a.id }, data: { status: "EXPIRED" } });
    await addEvent(db, a.id, { type: "expired", actorRole: "SYSTEM", fromStatus: "APPLYING", toStatus: "EXPIRED", note: "The application was never marked as submitted." });
  }
  return stale.length;
}

export { isOpen };
