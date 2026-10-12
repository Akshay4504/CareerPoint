"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/log";
import { inRequest } from "@/lib/request";
import { z } from "zod";
import type { ApplicationStatus } from "@prisma/client";
import { actionUser } from "@/lib/auth/guards";
import { rateLimitShared } from "@/lib/auth/rate-limit";
import { ApplicationError, applyNative, candidateMove, confirmExternalSubmission, respondToInterview, sendCandidateMessage, startExternalApply } from "@/lib/applications/candidate";
import { respondContactRequest } from "@/lib/employer/candidates";
import { STAGE_ORDER } from "@/lib/applications/lifecycle";
import { setPreferences } from "@/lib/notifications/service";
import { EVENTS } from "@/lib/notifications/events";
import type { ActionState } from "@/components/forms";

const candidate = () => actionUser("app");

function msg(e: unknown) {
  if (e instanceof ApplicationError) return e.message;
  log.error("action.failed", { err: e });
  return "Something went wrong. Please try again.";
}

const refresh = (id?: string) => {
  for (const p of ["/applications", "/jobs", "/jobs/saved", "/dashboard"]) revalidatePath(p);
  if (id) revalidatePath(`/applications/${id}`);
};

/** External job: record the click, hand back the official URL. The browser opens it; we then ask "Did you complete it?". */
export async function startExternalApplyAction(jobId: string, resumeVersionId: string | null, origin: string | null): Promise<{ ok: true; url: string; applicationId: string; alreadyTracked: boolean } | { ok: false; error: string }> {
  const user = await candidate();
  if (!user) return { ok: false, error: "Sign in as a candidate to apply." };
  if (!(await rateLimitShared(`apply-click:${user.id}`, 60, 3600_000)).ok) return { ok: false, error: "Too many applications started. Try again later." };
  try {
    const r = await inRequest("application.external_start", { userId: user.id, jobId }, () => startExternalApply(user.id, jobId, { resumeVersionId, origin }));
    refresh(r.application.id);
    return { ok: true, url: r.url, applicationId: r.application.id, alreadyTracked: r.alreadyTracked };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function confirmExternalAction(applicationId: string, submitted: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await candidate();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    await confirmExternalSubmission(user.id, applicationId, submitted);
    refresh(applicationId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

const nativeSchema = z.object({ jobId: z.string().min(1), resumeVersionId: z.string().min(1, "Choose a resume to send."), coverNote: z.string().trim().max(2000).optional(), origin: z.string().max(30).optional() });

export async function applyNativeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await candidate();
  if (!user) return { error: "Sign in as a candidate to apply." };
  const parsed = nativeSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const app = await inRequest("application.apply", { userId: user.id, jobId: parsed.data.jobId }, () => applyNative(user.id, parsed.data.jobId, { resumeVersionId: parsed.data.resumeVersionId, coverNote: parsed.data.coverNote, origin: parsed.data.origin, portfolioProjectIds: fd.getAll("projects").map(String), portfolioItemIds: fd.getAll("items").map(String) }));
    refresh(app.id);
    return { ok: "Application submitted. The employer has received it on CareerPoint.", redirectTo: `/applications/${app.id}` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function moveApplicationAsCandidate(applicationId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await candidate();
  if (!user) return { error: "Please sign in again." };
  const to = String(fd.get("status")) as ApplicationStatus;
  if (!STAGE_ORDER.includes(to)) return { error: "Unknown stage." };
  try {
    await candidateMove(user.id, applicationId, to, String(fd.get("note") ?? ""));
    refresh(applicationId);
    return { ok: "Updated." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function respondInterviewAction(interviewId: string, applicationId: string, accept: boolean): Promise<void> {
  const user = await candidate();
  if (!user) return;
  try {
    await respondToInterview(user.id, interviewId, accept);
  } catch {
    /* already answered */
  }
  refresh(applicationId);
}

export async function candidateMessageAction(applicationId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await candidate();
  if (!user) return { error: "Please sign in again." };
  if (!(await rateLimitShared(`msg:${user.id}`, 30, 3600_000)).ok) return { error: "Slow down a little — too many messages." };
  try {
    await sendCandidateMessage(user.id, applicationId, String(fd.get("body") ?? ""));
    refresh(applicationId);
    return { ok: "Sent." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function respondContactAction(requestId: string, accept: boolean): Promise<void> {
  const user = await candidate();
  if (!user) return;
  try {
    await respondContactRequest(user.id, requestId, accept);
  } catch {
    /* already answered */
  }
  revalidatePath("/notifications");
}

/** Notification preferences for the signed-in user (candidate or employer events, by role). */
export async function saveNotificationPrefs(audience: "candidate" | "employer", _p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await actionUser();
  if (!user) return { error: "Please sign in again." };
  const values: Record<string, { inApp: boolean; email: boolean }> = {};
  for (const e of EVENTS.filter((x) => x.audience === audience)) values[e.key] = { inApp: fd.get(`inapp:${e.key}`) === "on", email: fd.get(`email:${e.key}`) === "on" };
  await setPreferences(user.id, audience, values);
  revalidatePath("/settings");
  revalidatePath("/employer/settings");
  return { ok: "Notification preferences saved." };
}
