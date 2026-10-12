"use server";

import { revalidatePath } from "next/cache";
import { actionUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { rateLimitShared } from "@/lib/auth/rate-limit";
import { inRequest } from "@/lib/request";
import { getProvider } from "@/lib/ai/provider";
import { AI_KINDS, decideSuggestion, requestSuggestion, type AiKind, type RequestInput } from "@/lib/services/ai";
import { ensureProfile } from "@/lib/services/profile";
import type { ActionState } from "@/components/forms";

export async function requestAiAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await actionUser("app");
  if (!user) return { error: "Please sign in again." };
  await ensureProfile(user);
  const provider = getProvider();
  const kind = String(fd.get("kind") ?? "") as AiKind;
  if (!(kind in AI_KINDS)) return { error: "Unknown action." };
  // Data-driven advice has a deterministic fallback, so it works even when no model is configured.
  if (!provider && !AI_KINDS[kind].fallback) return { error: "AI assistance is not configured on this server. Everything else works without it." };
  if (!(await rateLimitShared(`ai:${user.id}`, 20, 3600_000)).ok) return { error: "Too many requests in a short time. Try again in a few minutes." };
  const resumeId = String(fd.get("resumeId") ?? "");
  const experienceIndex = Number(fd.get("experienceIndex") ?? -1);
  const targetType = String(fd.get("targetType") ?? "");
  let target: RequestInput["target"];
  if (targetType === "profile.summary") target = { type: "profile.summary" };
  else if (targetType === "resume.summary" && resumeId) target = { type: "resume.summary", resumeId };
  else if (targetType === "resume.bullet" && resumeId && experienceIndex >= 0) target = { type: "resume.bullet", resumeId, experienceIndex, original: String(fd.get("text") ?? "") };
  else if (targetType === "resume.experience-bullet-add" && resumeId && experienceIndex >= 0) target = { type: "resume.experience-bullet-add", resumeId, experienceIndex };
  try {
    await inRequest("ai.request", { userId: user.id, kind }, () => requestSuggestion(user.id, provider, { kind, text: String(fd.get("text") ?? ""), jobId: String(fd.get("jobId") ?? "") || undefined, target }));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI request failed." };
  }
  await audit(user.id, "ai.request", "AiSuggestion", undefined, { kind });
  revalidatePath("/resume/assistant");
  return { ok: "Suggestion ready for your review below." };
}

export async function decideAiAction(id: string, decision: "approve" | "reject", _p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await actionUser("app");
  if (!user) return { error: "Please sign in again." };
  try {
    const edited = fd.get("edited");
    const r = await decideSuggestion(user.id, id, decision, typeof edited === "string" && edited.trim() ? edited : undefined);
    await audit(user.id, `ai.${decision}`, "AiSuggestion", id, { applied: r.applied });
    for (const p of ["/resume/assistant", "/resume", "/profile", "/resume/score"]) revalidatePath(p);
    return { ok: decision === "reject" ? "Suggestion discarded." : r.applied ? "Approved and saved as a new version." : "Noted." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not apply." };
  }
}
