"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { JobStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth/guards";
import { audit, notify } from "@/lib/audit";
import { ALL_ROLES } from "@/lib/auth/rbac";
import { assertPublicHttpUrl } from "@/lib/jobs/http";
import { DEFAULT_RELIABILITY } from "@/lib/jobs/connectors";
import { QUEUES, enqueue } from "@/lib/queue/queue";
import { matchJobForProfiles } from "@/lib/services/profile";
import type { ActionState } from "@/components/forms";

/** Moderators and admins. */
const staff = () => actionUser("admin");
/** Admins only (a moderator calling these gets nothing, regardless of what the UI shows). */
const adminOnly = () => actionUser("admin-users");

export async function moderateJob(jobId: string, status: JobStatus): Promise<void> {
  const user = await staff();
  if (!user || !["ACTIVE", "REJECTED", "CLOSED", "PENDING"].includes(status)) return;
  const current = await db.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!current || current.status === "DRAFT") return; // employers' drafts are not for staff to publish
  const job = await db.job.update({ where: { id: jobId }, data: { status } });
  await audit(user.id, `job.${status.toLowerCase()}`, "Job", jobId);
  if (status === "ACTIVE") await matchJobForProfiles(jobId);
  if (job.postedByUserId && (status === "ACTIVE" || status === "REJECTED")) {
    await notify(job.postedByUserId, "job.moderated", status === "ACTIVE" ? `Job approved: ${job.title}` : `Job rejected: ${job.title}`, undefined, "/employer/jobs");
  }
  revalidatePath("/admin/jobs");
  revalidatePath("/admin");
  revalidatePath("/jobs");
}

export async function setCompanyVerified(companyId: string, verified: boolean): Promise<void> {
  const user = await staff();
  if (!user) return;
  const company = await db.company.update({ where: { id: companyId }, data: { verified } }).catch(() => null);
  if (!company) return;
  await audit(user.id, verified ? "company.verify" : "company.unverify", "Company", companyId);
  if (verified) {
    // Verification clears the moderation queue for that company.
    const pending = await db.job.findMany({ where: { companyId, status: "PENDING" }, select: { id: true } });
    await db.job.updateMany({ where: { companyId, status: "PENDING" }, data: { status: "ACTIVE" } });
    for (const j of pending) await matchJobForProfiles(j.id);
    const members = await db.employerUser.findMany({ where: { companyId }, select: { userId: true } });
    await Promise.all(members.map((m) => notify(m.userId, "company.verified", `${company.name} is now verified`, "Your jobs are live and the candidate directory is unlocked.", "/employer")));
  }
  revalidatePath("/admin/employers");
  revalidatePath("/jobs");
}

const roleSchema = z.enum(ALL_ROLES as [Role, ...Role[]]);

export async function setUserRole(userId: string, fd: FormData): Promise<void> {
  const admin = await adminOnly();
  if (!admin || admin.id === userId) return; // cannot change your own role
  const role = roleSchema.safeParse(fd.get("role"));
  if (!role.success) return;
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) return;
  if (target.role === "ADMIN" && role.data !== "ADMIN" && (await db.user.count({ where: { role: "ADMIN", status: "ACTIVE" } })) <= 1) return; // keep one admin
  await db.user.update({ where: { id: userId }, data: { role: role.data } });
  await db.session.deleteMany({ where: { userId } }); // force re-auth with the new role
  await audit(admin.id, "user.role", "User", userId, { from: target.role, to: role.data });
  revalidatePath("/admin/users");
}

export async function setUserStatus(userId: string, suspend: boolean): Promise<void> {
  const admin = await adminOnly();
  if (!admin || admin.id === userId) return;
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target || (target.role === "ADMIN" && suspend)) return;
  await db.user.update({ where: { id: userId }, data: { status: suspend ? "SUSPENDED" : "ACTIVE" } });
  if (suspend) await db.session.deleteMany({ where: { userId } });
  await audit(admin.id, suspend ? "user.suspend" : "user.reinstate", "User", userId);
  revalidatePath("/admin/users");
}

const sourceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(["GREENHOUSE", "LEVER", "ASHBY", "RSS", "JSON", "CAREER_PAGE"]),
  value: z.string().trim().min(2).max(500),
  company: z.string().trim().max(120).optional(),
});

/** `value` means: board token (Greenhouse/Ashby), company slug (Lever), feed URL (RSS/JSON), or sitemap URL (career page). */
export async function createSource(_p: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await adminOnly();
  if (!admin) return { error: "Not authorised." };
  const parsed = sourceSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, type, value, company } = parsed.data;
  let url: string | null = null;
  let config: Record<string, unknown> = {};
  try {
    if (type === "GREENHOUSE" || type === "ASHBY") {
      if (!/^[A-Za-z0-9_.-]+$/.test(value)) return { error: "Enter the board token only (e.g. the part after /boards/ or ashbyhq.com/)." };
      config = { board: value, ...(company ? { company } : {}) };
    } else if (type === "LEVER") {
      if (!/^[A-Za-z0-9_-]+$/.test(value)) return { error: "Enter the Lever company slug only." };
      config = { company: value, ...(company ? { display: company } : {}) };
    } else {
      await assertPublicHttpUrl(value);
      if (type === "CAREER_PAGE") {
        if (!company) return { error: "Career pages need the employer name." };
        config = { company, sitemaps: [value] };
      } else url = value;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid value" };
  }
  const s = await db.jobSource.create({ data: { name, type, url, config: config as never, reliability: DEFAULT_RELIABILITY[type] ?? 70 } });
  await audit(admin.id, "source.create", "JobSource", s.id);
  await enqueue(QUEUES.health, { sourceId: s.id }, { dedupeKey: `health:${s.id}` });
  revalidatePath("/admin/sources");
  return { ok: "Source added. A health check is queued; use “Run now” to start the first ingestion." };
}

export async function toggleSource(id: string, active: boolean): Promise<void> {
  const admin = await adminOnly();
  if (!admin) return;
  await db.jobSource.update({ where: { id }, data: { active } }).catch(() => {});
  await audit(admin.id, active ? "source.enable" : "source.disable", "JobSource", id);
  revalidatePath("/admin/sources");
}

export async function deleteSource(id: string): Promise<void> {
  const admin = await adminOnly();
  if (!admin) return;
  await db.jobSource.delete({ where: { id } }).catch(() => {});
  await audit(admin.id, "source.delete", "JobSource", id);
  revalidatePath("/admin/sources");
}

/** Queues a discovery run. The worker does the actual fetching — never the HTTP request. */
export async function runSource(id: string): Promise<void> {
  const admin = await adminOnly();
  if (!admin) return;
  await enqueue(QUEUES.discover, { sourceId: id }, { dedupeKey: `discover:${id}`, maxAttempts: 3 });
  await audit(admin.id, "source.run_queued", "JobSource", id);
  revalidatePath("/admin/sources");
}

export async function checkSourceNow(id: string): Promise<void> {
  const admin = await adminOnly();
  if (!admin) return;
  await enqueue(QUEUES.health, { sourceId: id }, { dedupeKey: `health:${id}` });
  revalidatePath("/admin/sources");
}


// ---- resume scoring weights + benchmark (admin only; every save is a new audited version) -------------------------

export async function saveScoringAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await adminOnly();
  if (!user) return { error: "Not allowed." };
  const { DIMENSION_KEYS } = await import("@/lib/scoring/config");
  const { ROLE_BENCHMARKS } = await import("@/lib/scoring/benchmark");
  const { saveScoringConfig, ScoringConfigError } = await import("@/lib/scoring/store");
  const weights: Record<string, FormDataEntryValue | null> = {};
  for (const k of DIMENSION_KEYS) weights[k] = fd.get(`w:${k}`);
  const benchmark: Record<string, unknown> = {};
  for (const r of ROLE_BENCHMARKS) {
    benchmark[r.id] = { expectedQuantified: fd.get(`b:${r.id}:q`), expectedProjects: fd.get(`b:${r.id}:p`), expectedCertifications: fd.get(`b:${r.id}:c`), typicalYears: [fd.get(`b:${r.id}:y0`), fd.get(`b:${r.id}:y1`)] };
  }
  try {
    const r = await saveScoringConfig(user.id, weights, String(fd.get("note") ?? ""), benchmark);
    await audit(user.id, "scoring.config_saved", "ScoringConfigVersion", String(r.version), { version: r.version });
    revalidatePath("/admin/scoring");
    return { ok: `Saved as version ${r.version}. New and re-scored resumes use it immediately; stored scores keep the version they were computed with.` };
  } catch (e) {
    if (e instanceof ScoringConfigError) return { error: e.message };
    throw e;
  }
}

export async function restoreScoringAction(version: number): Promise<void> {
  const user = await adminOnly();
  if (!user) return;
  const { saveScoringConfig } = await import("@/lib/scoring/store");
  const old = await db.scoringConfigVersion.findUnique({ where: { version } });
  if (!old) return;
  const r = await saveScoringConfig(user.id, old.weights as Record<string, unknown>, `Restored from version ${version}`, old.benchmark);
  await audit(user.id, "scoring.config_restored", "ScoringConfigVersion", String(r.version), { from: version });
  revalidatePath("/admin/scoring");
}


// ---- operations: dead letters, email outbox, job reports ------------------------------------------------------------

export async function retryDeadLetterAction(id: string): Promise<void> {
  const user = await adminOnly();
  if (!user) return;
  const { retryDeadLetter } = await import("@/lib/queue/queue");
  if (await retryDeadLetter(id)) await audit(user.id, "queue.retry", "QueueJob", id);
  revalidatePath("/admin/system");
}

export async function retryEmailAction(id: string): Promise<void> {
  const user = await adminOnly();
  if (!user) return;
  const row = await db.emailOutbox.findUnique({ where: { id }, select: { status: true } });
  if (!row || row.status === "SENT") return;
  await db.emailOutbox.update({ where: { id }, data: { status: "PENDING", error: null } });
  await enqueue(QUEUES.email, { outboxId: id }, { dedupeKey: `email:${id}:retry:${Date.now()}`, maxAttempts: 4 });
  await audit(user.id, "email.retry", "EmailOutbox", id);
  revalidatePath("/admin/system");
}

const REPORT_REASONS = ["scam", "expired", "not_bim", "misleading", "duplicate", "other"] as const;

/** A candidate reports a job posting. One report per user per job; moderators triage them in /admin/reports. */
export async function reportJobAction(jobId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await actionUser();
  if (!user) return { error: "Please sign in to report a job." };
  const reason = REPORT_REASONS.find((r) => r === fd.get("reason"));
  if (!reason) return { error: "Choose a reason." };
  const details = String(fd.get("details") ?? "").trim().slice(0, 1000) || null;
  const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true } });
  if (!job) return { error: "Job not found." };
  await db.jobReport.upsert({ where: { userId_jobId: { userId: user.id, jobId } }, create: { userId: user.id, jobId, reason, details }, update: { reason, details, status: "OPEN", handledAt: null, handledById: null } });
  await audit(user.id, "job.reported", "Job", jobId, { reason });
  revalidatePath("/admin/reports");
  return { ok: "Thanks. A moderator will review this posting." };
}

export async function resolveJobReportAction(reportId: string, outcome: "ACTIONED" | "DISMISSED", closeJob: boolean): Promise<void> {
  const user = await staff();
  if (!user) return;
  const report = await db.jobReport.findUnique({ where: { id: reportId }, select: { jobId: true } });
  if (!report) return;
  await db.jobReport.updateMany({ where: { jobId: report.jobId, status: "OPEN" }, data: { status: outcome, handledById: user.id, handledAt: new Date() } });
  if (outcome === "ACTIONED" && closeJob) {
    await db.job.update({ where: { id: report.jobId }, data: { status: "REJECTED" } });
    await audit(user.id, "job.rejected", "Job", report.jobId, { via: "report" });
  }
  await audit(user.id, `report.${outcome.toLowerCase()}`, "Job", report.jobId);
  revalidatePath("/admin/reports");
  revalidatePath("/jobs");
}
