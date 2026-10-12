import type { ApplicationStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyEvent } from "@/lib/notifications/service";
import { recordView } from "@/lib/services/profile-views";
import { Forbidden, require_, type EmployerCtx, can } from "@/lib/employer/permissions";
import { STAGE_LABEL, EMPLOYER_MOVE_EVENT, canMove, allowedMoves, isTerminal } from "./lifecycle";
import { ApplicationError, addEvent } from "./candidate";

// Employer side. Rules enforced here (not in the UI):
//  - an employer only ever reaches applications whose job belongs to ITS company (queried with job.companyId);
//  - only NATIVE applications are visible: external applications are the candidate's private tracking and never reach employers;
//  - every action checks the member's role capabilities;
//  - recruiter notes live in their own table and are never selected by any candidate-facing query.

export async function employerCtx(userId: string): Promise<EmployerCtx | null> {
  const m = await db.employerUser.findFirst({ where: { userId }, include: { company: true, user: { select: { name: true, status: true, role: true } } }, orderBy: { createdAt: "asc" } });
  if (!m || m.user.status !== "ACTIVE") return null;
  return { userId, userName: m.user.name, companyId: m.companyId, companyName: m.company.name, role: m.role, verified: m.company.verified };
}

const ownApplication = (ctx: EmployerCtx, id: string): Prisma.ApplicationWhereInput => ({ id, external: false, job: { companyId: ctx.companyId } });

export type EmployerAppFilters = { jobId?: string; status?: ApplicationStatus; q?: string; page?: number; pageSize?: number };

export async function listEmployerApplications(ctx: EmployerCtx, f: EmployerAppFilters = {}) {
  require_(ctx, "applications.view");
  const where: Prisma.ApplicationWhereInput = {
    external: false,
    job: { companyId: ctx.companyId, ...(f.jobId ? { id: f.jobId } : {}) },
    status: f.status ?? { notIn: ["APPLYING", "DISCOVERED", "SAVED", "PINNED"] },
    ...(f.q?.trim() ? { user: { OR: [{ name: { contains: f.q.trim(), mode: "insensitive" } }, { profile: { headline: { contains: f.q.trim(), mode: "insensitive" } } }] } } : {}),
  };
  const pageSize = Math.min(100, f.pageSize ?? 30);
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.application.findMany({ where, orderBy: { lastActivityAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { job: { select: { id: true, title: true, slug: true } }, user: { select: { name: true, profile: { select: { headline: true, location: true, yearsExperience: true, softwareSkills: { select: { software: true }, take: 4 } } } } }, interviews: { where: { status: "SCHEDULED", scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: "asc" }, take: 1 }, _count: { select: { notes: true, messages: true } } } }),
    db.application.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * The candidate package for one application, with first-party view tracking.
 * The first time anyone at the company opens it, the candidate is told (a fact the platform witnessed).
 */
export async function getEmployerApplication(ctx: EmployerCtx, applicationId: string) {
  require_(ctx, "applications.view");
  const app = await db.application.findFirst({
    where: ownApplication(ctx, applicationId),
    include: {
      job: { select: { id: true, title: true, slug: true } },
      user: { select: { id: true, name: true, email: true, profile: { include: { experiences: { orderBy: [{ current: "desc" }, { startDate: "desc" }] }, educations: true, skills: { include: { skill: true } }, softwareSkills: true, certifications: true, languages: true } } } },
      resumeVersion: { include: { resume: { select: { id: true, title: true, sourceFileId: true } } } },
      events: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      interviews: { orderBy: { scheduledAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!app) return null;

  const now = new Date();
  if (!app.viewedByEmployerAt) {
    await db.application.update({ where: { id: app.id }, data: { viewedByEmployerAt: now } });
    await addEvent(db, app.id, { type: "recruiter_viewed", actorId: ctx.userId, actorRole: "EMPLOYER" });
    await notifyEvent(app.user.id, "application.viewed", { title: `${ctx.companyName} viewed your application`, body: app.job.title, href: `/applications/${app.id}` });
    app.viewedByEmployerAt = now;
  }
  const profileId = app.user.profile?.id;
  if (profileId) {
    await recordView({ profileId, kind: "APPLICATION", viewerUserId: ctx.userId, viewerCompanyId: ctx.companyId, meta: { applicationId: app.id }, dedupeHours: 24 });
    if (app.resumeVersion && (await recordView({ profileId, kind: "RESUME", viewerUserId: ctx.userId, viewerCompanyId: ctx.companyId, meta: { applicationId: app.id }, dedupeHours: 24 }))) await audit(ctx.userId, "resume.accessed", "Application", app.id, { companyId: ctx.companyId, via: "application" });
    if (app.portfolioProjectIds.length || app.portfolioItemIds.length) await recordView({ profileId, kind: "PORTFOLIO", viewerUserId: ctx.userId, viewerCompanyId: ctx.companyId, meta: { applicationId: app.id }, dedupeHours: 24 });
  }
  await audit(ctx.userId, "application.viewed", "Application", app.id, { companyId: ctx.companyId });

  // Only what the candidate chose to share with this employer.
  const [projects, items] = await Promise.all([
    app.portfolioProjectIds.length ? db.project.findMany({ where: { id: { in: app.portfolioProjectIds }, profile: { userId: app.user.id } }, include: { portfolio: { orderBy: { sortOrder: "asc" } } } }) : [],
    app.portfolioItemIds.length ? db.portfolioItem.findMany({ where: { id: { in: app.portfolioItemIds }, profile: { userId: app.user.id } } }) : [],
  ]);
  return { app, projects, items, caps: { move: can(ctx.role, "applications.move"), shortlist: can(ctx.role, "applications.shortlist"), notes: can(ctx.role, "applications.notes"), interviews: can(ctx.role, "interviews.manage"), messages: can(ctx.role, "messages.send") }, allowed: employerAllowed(ctx, { status: app.status, external: false }) };
}

/** Stages this member may move an application to (lifecycle rules ∩ role capabilities). */
export function employerAllowed(ctx: EmployerCtx, app: { status: ApplicationStatus; external: boolean }): ApplicationStatus[] {
  const base = allowedMoves(app, "EMPLOYER");
  if (can(ctx.role, "applications.move")) return base;
  if (can(ctx.role, "applications.shortlist")) return base.filter((s) => s === "SHORTLISTED" || s === "RECRUITER_REVIEW");
  return [];
}

export async function moveApplication(ctx: EmployerCtx, applicationId: string, to: ApplicationStatus, note?: string | null) {
  const app = await db.application.findFirst({ where: ownApplication(ctx, applicationId), include: { job: { select: { title: true } } } });
  if (!app) throw new ApplicationError("Application not found.");
  if (!canMove(app, "EMPLOYER", to)) throw new ApplicationError(`Can't move an application from ${STAGE_LABEL[app.status]} to ${STAGE_LABEL[to]}.`);
  if (!employerAllowed(ctx, app).includes(to)) throw new Forbidden(`Your role can't move applications to ${STAGE_LABEL[to]}.`);
  const text = note?.trim().slice(0, 500) || null;
  // Optimistic concurrency: two recruiters acting on the same card cannot both succeed from the same starting stage.
  const moved = await db.application.updateMany({ where: { id: app.id, status: app.status }, data: { status: to, lastActivityAt: new Date() } });
  if (moved.count === 0) throw new ApplicationError("This application was just updated by someone else. Refresh and try again.");
  await addEvent(db, app.id, { type: "status_changed", actorId: ctx.userId, actorRole: "EMPLOYER", fromStatus: app.status, toStatus: to, note: text });
  await audit(ctx.userId, "application.status", "Application", app.id, { from: app.status, to, companyId: ctx.companyId });
  if (to === "SHORTLISTED") {
    await audit(ctx.userId, "candidate.shortlisted", "Application", app.id, { companyId: ctx.companyId });
    const p = await db.bIMProfessionalProfile.findUnique({ where: { userId: app.userId }, select: { id: true } });
    if (p) await recordView({ profileId: p.id, kind: "SHORTLIST", viewerUserId: ctx.userId, viewerCompanyId: ctx.companyId, meta: { applicationId: app.id }, dedupeHours: 0 });
  }
  if (to === "REJECTED") await audit(ctx.userId, "candidate.rejected", "Application", app.id, { companyId: ctx.companyId });
  const event = EMPLOYER_MOVE_EVENT[to];
  if (event) await notifyEvent(app.userId, event, { title: `${ctx.companyName}: ${app.job.title}`, body: `${STAGE_LABEL[to]}${text ? ` — ${text}` : ""}`, href: `/applications/${app.id}` });
  return to;
}

/** Internal note. Stored separately, never visible to the candidate (not even as a timeline event). */
export async function addNote(ctx: EmployerCtx, applicationId: string, body: string) {
  require_(ctx, "applications.notes");
  const text = body.trim();
  if (!text || text.length > 4000) throw new ApplicationError("Write a note up to 4,000 characters.");
  const app = await db.application.findFirst({ where: ownApplication(ctx, applicationId), select: { id: true } });
  if (!app) throw new ApplicationError("Application not found.");
  const note = await db.applicationNote.create({ data: { applicationId, authorId: ctx.userId, body: text } });
  await addEvent(db, applicationId, { type: "note_added", actorId: ctx.userId, actorRole: "EMPLOYER", visibleToCandidate: false });
  await audit(ctx.userId, "application.note_added", "Application", applicationId, { companyId: ctx.companyId });
  return note;
}

export async function deleteNote(ctx: EmployerCtx, noteId: string) {
  require_(ctx, "applications.notes");
  const note = await db.applicationNote.findFirst({ where: { id: noteId, application: { external: false, job: { companyId: ctx.companyId } } } });
  if (!note) throw new ApplicationError("Note not found.");
  if (note.authorId !== ctx.userId && ctx.role !== "EMPLOYER_ADMIN") throw new Forbidden("Only the author or an admin can delete a note.");
  await db.applicationNote.delete({ where: { id: noteId } });
}

export type InterviewInput = { scheduledAt: Date; durationMin?: number; mode?: "VIDEO" | "PHONE" | "ONSITE"; locationOrLink?: string | null; message?: string | null };

export async function scheduleInterview(ctx: EmployerCtx, applicationId: string, input: InterviewInput) {
  require_(ctx, "interviews.manage");
  if (!(input.scheduledAt instanceof Date) || isNaN(input.scheduledAt.getTime()) || input.scheduledAt.getTime() < Date.now() - 60_000) throw new ApplicationError("Pick a time in the future.");
  const duration = Math.max(10, Math.min(480, Math.round(input.durationMin ?? 45)));
  const app = await db.application.findFirst({ where: ownApplication(ctx, applicationId), include: { job: { select: { title: true } } } });
  if (!app) throw new ApplicationError("Application not found.");
  if (isTerminal(app.status) || app.status === "APPLYING") throw new ApplicationError("This application is closed.");
  if (app.status !== "INTERVIEW") {
    if (!canMove(app, "EMPLOYER", "INTERVIEW")) throw new ApplicationError(`An interview can't be scheduled from ${STAGE_LABEL[app.status]}.`);
    require_(ctx, "applications.move");
    await db.application.update({ where: { id: app.id }, data: { status: "INTERVIEW" } });
    await addEvent(db, app.id, { type: "status_changed", actorId: ctx.userId, actorRole: "EMPLOYER", fromStatus: app.status, toStatus: "INTERVIEW" });
  }
  const link = input.locationOrLink?.trim().slice(0, 300) || null;
  const iv = await db.interview.create({ data: { applicationId, scheduledAt: input.scheduledAt, durationMin: duration, mode: input.mode ?? "VIDEO", locationOrLink: link, messageToCandidate: input.message?.trim().slice(0, 1000) || null, createdById: ctx.userId } });
  await db.application.update({ where: { id: app.id }, data: { lastActivityAt: new Date() } });
  await audit(ctx.userId, "interview.scheduled", "Interview", iv.id, { applicationId, companyId: ctx.companyId });
  await notifyEvent(app.userId, "interview.scheduled", { title: `Interview scheduled: ${app.job.title}`, body: `${ctx.companyName} · ${input.scheduledAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, href: `/applications/${app.id}` });
  return iv;
}

export async function updateInterview(ctx: EmployerCtx, interviewId: string, action: "CANCEL" | "COMPLETE" | { reschedule: Date }) {
  require_(ctx, "interviews.manage");
  const iv = await db.interview.findFirst({ where: { id: interviewId, application: { external: false, job: { companyId: ctx.companyId } } }, include: { application: { include: { job: { select: { title: true } } } } } });
  if (!iv) throw new ApplicationError("Interview not found.");
  if (iv.status !== "SCHEDULED") throw new ApplicationError("This interview is already closed.");
  if (typeof action === "object") {
    if (action.reschedule.getTime() < Date.now() - 60_000) throw new ApplicationError("Pick a time in the future.");
    await db.interview.update({ where: { id: iv.id }, data: { scheduledAt: action.reschedule, candidateResponse: null, respondedAt: null } });
  } else await db.interview.update({ where: { id: iv.id }, data: { status: action === "CANCEL" ? "CANCELLED" : "COMPLETED" } });
  await audit(ctx.userId, `interview.${typeof action === "object" ? "rescheduled" : action.toLowerCase()}`, "Interview", iv.id, { companyId: ctx.companyId });
  if (action === "CANCEL" || typeof action === "object") await notifyEvent(iv.application.userId, "interview.scheduled", { title: `${action === "CANCEL" ? "Interview cancelled" : "Interview rescheduled"}: ${iv.application.job.title}`, body: ctx.companyName, href: `/applications/${iv.applicationId}` });
}

export async function sendEmployerMessage(ctx: EmployerCtx, applicationId: string, body: string) {
  require_(ctx, "messages.send");
  const text = body.trim();
  if (!text || text.length > 3000) throw new ApplicationError("Write a message up to 3,000 characters.");
  const app = await db.application.findFirst({ where: ownApplication(ctx, applicationId), include: { job: { select: { title: true } } } });
  if (!app) throw new ApplicationError("Application not found.");
  const m = await db.applicationMessage.create({ data: { applicationId, senderId: ctx.userId, senderRole: "EMPLOYER", body: text } });
  await db.application.update({ where: { id: app.id }, data: { lastActivityAt: new Date() } });
  await audit(ctx.userId, "application.message", "Application", app.id, { companyId: ctx.companyId });
  await notifyEvent(app.userId, "message.received", { title: `${ctx.companyName}: message about ${app.job.title}`, body: text.slice(0, 140), href: `/applications/${app.id}` });
  return m;
}

export async function listInterviews(ctx: EmployerCtx) {
  require_(ctx, "applications.view");
  return db.interview.findMany({ where: { application: { external: false, job: { companyId: ctx.companyId } } }, orderBy: { scheduledAt: "asc" }, take: 200, include: { application: { select: { id: true, user: { select: { name: true } }, job: { select: { title: true } } } } } });
}
