"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/log";
import { inRequest } from "@/lib/request";
import { z } from "zod";
import type { ApplicationStatus, EmployerRole } from "@prisma/client";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { enrichNativeJob, uniqueJobSlug } from "@/lib/services/jobs";
import { matchJobForProfiles } from "@/lib/services/profile";
import { DISCIPLINES, EMPLOYMENT_TYPES, SENIORITY, SECTORS, BIM_SKILLS, BIM_SOFTWARE, canonicalize } from "@/lib/taxonomy";
import { ROLE_RULES } from "@/lib/jobs/classify";
import { csvToList, safeUrl } from "@/lib/utils";
import { saveUpload, deleteStored } from "@/lib/files/storage";
import { employerCtx, addNote, deleteNote, moveApplication, scheduleInterview, sendEmployerMessage, updateInterview } from "@/lib/applications/employer";
import { ApplicationError } from "@/lib/applications/candidate";
import { sendContactRequest } from "@/lib/employer/candidates";
import { changeMemberRole, inviteMember, removeMember } from "@/lib/employer/team";
import { Forbidden, require_, type EmployerCtx } from "@/lib/employer/permissions";
import type { ActionState } from "@/components/forms";

async function ctx(): Promise<EmployerCtx | null> {
  const user = await actionUser("employer");
  return user ? employerCtx(user.id) : null;
}

function msg(e: unknown) {
  if (e instanceof ApplicationError || e instanceof Forbidden) return e.message;
  log.error("action.failed", { err: e });
  return "Something went wrong. Please try again.";
}

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const optInt = (max = 10_000_000) => z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().min(0).max(max).optional());
const BIM_ROLES = ROLE_RULES.map((r) => r.role);

const jobSchema = z.object({
  id: opt(40),
  title: z.string().trim().min(4, "Enter a job title").max(160),
  location: opt(160),
  country: opt(80),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional().or(z.literal("").transform(() => undefined)),
  seniority: z.enum(SENIORITY).optional().or(z.literal("").transform(() => undefined)),
  discipline: z.enum(DISCIPLINES).optional().or(z.literal("").transform(() => undefined)),
  bimRole: z.string().refine((v) => !v || BIM_ROLES.includes(v), "Choose a BIM role from the list").optional(),
  remoteType: z.enum(["ONSITE", "HYBRID", "REMOTE", "UNKNOWN"]).optional().or(z.literal("").transform(() => undefined)),
  industry: z.enum(SECTORS).optional().or(z.literal("").transform(() => undefined)),
  description: z.string().trim().min(80, "Describe the role in at least 80 characters").max(20000),
  responsibilities: opt(10000),
  requirements: opt(10000),
  experienceMin: optInt(60),
  experienceMax: optInt(60),
  salaryMin: optInt(),
  salaryMax: optInt(),
  salaryCurrency: opt(3),
  applyUrl: opt(400),
});

export async function saveJob(_p: ActionState, fd: FormData): Promise<ActionState> {
  const e = await ctx();
  if (!e) return { error: "Please sign in again." };
  try {
    require_(e, "jobs.manage");
  } catch (x) {
    return { error: msg(x) };
  }
  const parsed = jobSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.salaryMin && d.salaryMax && d.salaryMin > d.salaryMax) return { error: "Minimum salary can't exceed maximum." };
  if (d.experienceMin != null && d.experienceMax != null && d.experienceMin > d.experienceMax) return { error: "Minimum experience can't exceed maximum." };
  if (d.applyUrl && !safeUrl(d.applyUrl)) return { error: "Enter a valid application URL." };

  const auto = enrichNativeJob({ title: d.title, description: d.description, companyName: e.companyName, location: d.location, country: d.country, remote: d.remoteType === "REMOTE", salaryMin: d.salaryMin, salaryMax: d.salaryMax });
  const software = csvToList(fd.get("software"), 20).map((s) => canonicalize(s, BIM_SOFTWARE));
  const skills = csvToList(fd.get("skills"), 20).map((s) => canonicalize(s, BIM_SKILLS));
  const wantsDraft = fd.get("intent") === "draft";
  const remoteType = d.remoteType ?? auto.remoteType;

  const data = {
    title: d.title,
    location: d.location ?? null,
    country: d.country ?? null,
    employmentType: d.employmentType ?? null,
    seniority: d.seniority ?? auto.seniority,
    discipline: d.discipline ?? auto.discipline,
    description: d.description,
    responsibilities: d.responsibilities ?? null,
    requirements: d.requirements ?? null,
    software: software.length ? software : auto.software,
    skills: skills.length ? skills : auto.skills,
    remote: remoteType === "REMOTE",
    remoteType,
    city: auto.city,
    bimRole: d.bimRole || auto.bimRole,
    industry: d.industry ?? auto.industry,
    experienceMin: d.experienceMin ?? null,
    experienceMax: d.experienceMax ?? null,
    bimRelevanceScore: auto.bimRelevanceScore,
    qualityScore: auto.qualityScore,
    companyKey: auto.companyKey,
    titleKey: auto.titleKey,
    salaryMin: d.salaryMin ?? null,
    salaryMax: d.salaryMax ?? null,
    salaryCurrency: d.salaryCurrency?.toUpperCase() ?? null,
    applyUrl: d.applyUrl ? safeUrl(d.applyUrl) : null,
  };

  let jobId = d.id;
  if (d.id) {
    // Tenant isolation: the job must belong to the employer's company.
    const existing = await db.job.findFirst({ where: { id: d.id, companyId: e.companyId } });
    if (!existing) return { error: "Job not found." };
    const status = wantsDraft ? "DRAFT" : existing.status === "ACTIVE" ? "ACTIVE" : e.verified ? "ACTIVE" : "PENDING";
    await db.job.update({ where: { id: d.id }, data: { ...data, status: existing.status === "CLOSED" || existing.status === "REJECTED" || existing.status === "INACTIVE" ? existing.status : status } });
    await audit(e.userId, "job.update", "Job", d.id, { companyId: e.companyId });
  } else {
    const job = await db.job.create({ data: { ...data, slug: await uniqueJobSlug(d.title, e.companyName), companyId: e.companyId, companyName: e.companyName, postedByUserId: e.userId, status: wantsDraft ? "DRAFT" : e.verified ? "ACTIVE" : "PENDING" } });
    jobId = job.id;
    await audit(e.userId, "job.create", "Job", job.id, { status: job.status, companyId: e.companyId });
  }
  const saved = await db.job.findUniqueOrThrow({ where: { id: jobId! } });
  if (saved.status === "ACTIVE") await matchJobForProfiles(saved.id);
  for (const p of ["/employer/jobs", "/employer", "/jobs"]) revalidatePath(p);
  return { redirectTo: `/employer/jobs?saved=${saved.status}` };
}

export async function setJobOpen(jobId: string, open: boolean): Promise<void> {
  const e = await ctx();
  if (!e) return;
  try {
    require_(e, "jobs.manage");
  } catch {
    return;
  }
  const job = await db.job.findFirst({ where: { id: jobId, companyId: e.companyId } });
  if (!job || job.status === "REJECTED") return;
  const status = open ? (e.verified ? "ACTIVE" : "PENDING") : "CLOSED";
  await db.job.update({ where: { id: job.id }, data: { status } });
  if (status === "ACTIVE") await matchJobForProfiles(job.id);
  await audit(e.userId, open ? "job.reopen" : "job.close", "Job", job.id, { companyId: e.companyId });
  revalidatePath("/employer/jobs");
  revalidatePath("/jobs");
}

// ---- applications ------------------------------------------------------------------------------------------------

const done = (id?: string) => {
  revalidatePath("/employer/applications");
  revalidatePath("/employer/interviews");
  revalidatePath("/employer");
  if (id) revalidatePath(`/employer/applications/${id}`);
};

export async function moveApplicationAction(applicationId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const e = await ctx();
  if (!e) return { error: "Please sign in again." };
  try {
    await inRequest("application.move", { userId: e.userId, applicationId }, () => moveApplication(e, applicationId, String(fd.get("status")) as ApplicationStatus, String(fd.get("note") ?? "")));
    done(applicationId);
    return { ok: "Stage updated. The candidate was notified." };
  } catch (x) {
    return { error: msg(x) };
  }
}

export async function addNoteAction(applicationId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const e = await ctx();
  if (!e) return { error: "Please sign in again." };
  try {
    await addNote(e, applicationId, String(fd.get("body") ?? ""));
    done(applicationId);
    return { ok: "Note saved — only your team can see it." };
  } catch (x) {
    return { error: msg(x) };
  }
}

export async function deleteNoteAction(applicationId: string, noteId: string): Promise<void> {
  const e = await ctx();
  if (!e) return;
  try {
    await deleteNote(e, noteId);
  } catch {
    /* not allowed or gone */
  }
  done(applicationId);
}

export async function scheduleInterviewAction(applicationId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const e = await ctx();
  if (!e) return { error: "Please sign in again." };
  const when = new Date(String(fd.get("scheduledAt") ?? ""));
  const mode = (["VIDEO", "PHONE", "ONSITE"] as const).find((m) => m === fd.get("mode")) ?? "VIDEO";
  try {
    await scheduleInterview(e, applicationId, { scheduledAt: when, durationMin: Number(fd.get("durationMin") || 45), mode, locationOrLink: String(fd.get("locationOrLink") ?? ""), message: String(fd.get("message") ?? "") });
    done(applicationId);
    return { ok: "Interview scheduled and the candidate was notified." };
  } catch (x) {
    return { error: msg(x) };
  }
}

export async function updateInterviewAction(applicationId: string, interviewId: string, action: "CANCEL" | "COMPLETE"): Promise<void> {
  const e = await ctx();
  if (!e) return;
  try {
    await updateInterview(e, interviewId, action);
  } catch {
    /* ignore */
  }
  done(applicationId);
}

export async function employerMessageAction(applicationId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const e = await ctx();
  if (!e) return { error: "Please sign in again." };
  try {
    await sendEmployerMessage(e, applicationId, String(fd.get("body") ?? ""));
    done(applicationId);
    return { ok: "Sent." };
  } catch (x) {
    return { error: msg(x) };
  }
}

// ---- candidates ----------------------------------------------------------------------------------------------------

export async function contactCandidateAction(profileId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const e = await ctx();
  if (!e) return { error: "Please sign in again." };
  try {
    await sendContactRequest(e, profileId, { message: String(fd.get("message") ?? ""), jobId: String(fd.get("jobId") ?? "") || null });
    revalidatePath("/employer/candidates");
    return { ok: "Request sent. The candidate decides whether to share their contact details." };
  } catch (x) {
    return { error: msg(x) };
  }
}

// ---- company & team -----------------------------------------------------------------------------------------------

const companySchema = z.object({ name: z.string().trim().min(2).max(120), website: opt(300), industry: z.enum(SECTORS).optional().or(z.literal("").transform(() => undefined)), size: z.enum(["1-10", "11-50", "51-200", "201-1000", "1000+"]).optional().or(z.literal("").transform(() => undefined)), description: opt(3000) });

export async function saveCompany(_p: ActionState, fd: FormData): Promise<ActionState> {
  const e = await ctx();
  if (!e) return { error: "Please sign in again." };
  try {
    require_(e, "company.manage");
  } catch (x) {
    return { error: msg(x) };
  }
  const parsed = companySchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const website = parsed.data.website ? safeUrl(parsed.data.website) : null;
  if (parsed.data.website && !website) return { error: "Enter a valid website URL." };
  let logoFileId: string | undefined;
  const logo = fd.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const res = await saveUpload({ ownerId: e.userId, kind: "COMPANY_LOGO", file: logo });
    if (!res.ok) return { error: res.error };
    logoFileId = res.fileId;
  }
  const before = await db.company.findUniqueOrThrow({ where: { id: e.companyId }, select: { logoFileId: true } });
  await db.job.updateMany({ where: { companyId: e.companyId }, data: { companyName: parsed.data.name } });
  await db.company.update({ where: { id: e.companyId }, data: { name: parsed.data.name, website, industry: parsed.data.industry ?? null, size: parsed.data.size ?? null, description: parsed.data.description ?? null, locations: csvToList(fd.get("locations"), 10), ...(logoFileId ? { logoFileId } : {}) } });
  if (logoFileId && before.logoFileId) await deleteStored(before.logoFileId);
  await audit(e.userId, "company.update", "Company", e.companyId);
  revalidatePath("/employer/company");
  return { ok: "Company updated." };
}

export async function inviteMemberAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const e = await ctx();
  if (!e) return { error: "Please sign in again." };
  const role = (["EMPLOYER", "RECRUITER", "EMPLOYER_ADMIN"] as EmployerRole[]).find((r) => r === fd.get("role")) ?? "RECRUITER";
  try {
    await inviteMember(e, String(fd.get("email") ?? ""), role);
    revalidatePath("/employer/settings");
    return { ok: "Invitation sent." };
  } catch (x) {
    return { error: msg(x) };
  }
}

export async function changeRoleAction(memberId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const e = await ctx();
  if (!e) return { error: "Please sign in again." };
  const role = (["EMPLOYER", "RECRUITER", "EMPLOYER_ADMIN"] as EmployerRole[]).find((r) => r === fd.get("role"));
  if (!role) return { error: "Choose a role." };
  try {
    await changeMemberRole(e, memberId, role);
    revalidatePath("/employer/settings");
    return { ok: "Role updated." };
  } catch (x) {
    return { error: msg(x) };
  }
}

export async function removeMemberAction(memberId: string): Promise<void> {
  const e = await ctx();
  if (!e) return;
  try {
    await removeMember(e, memberId);
  } catch {
    /* ignore */
  }
  revalidatePath("/employer/settings");
}

export async function acceptInviteAction(token: string, _p: ActionState, _fd: FormData): Promise<ActionState> {
  const user = await actionUser();
  if (!user) return { error: "Please sign in first." };
  try {
    const { acceptInvite } = await import("@/lib/employer/team");
    await acceptInvite(user.id, token);
    return { redirectTo: "/employer" };
  } catch (x) {
    return { error: msg(x) };
  }
}
