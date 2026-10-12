"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/log";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { rateLimitShared } from "@/lib/auth/rate-limit";
import { applyContentToProfile, ensureProfile, profileToContent, recomputeMatches, saveResumeVersion } from "@/lib/services/profile";
import { deleteStored, saveUpload } from "@/lib/files/storage";
import { extractText } from "@/lib/resume/extract";
import { createImport } from "@/lib/services/imports";
import type { ActionState } from "@/components/forms";

async function ctx() {
  const user = await actionUser("app");
  if (!user) return null;
  return { user, profile: await ensureProfile(user) };
}

const refresh = () => {
  for (const p of ["/resume", "/resume/score", "/profile", "/dashboard", "/jobs", "/career-insights"]) revalidatePath(p);
};

export async function uploadResume(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  if (!(await rateLimitShared(`resume-upload:${c.user.id}`, 10, 3600_000)).ok) return { error: "Upload limit reached. Try again in an hour." };
  if ((await db.resume.count({ where: { profileId: c.profile.id } })) >= 15) return { error: "You can keep up to 15 resumes. Delete one first." };

  const file = fd.get("file") as File | null;
  const res = await saveUpload({ ownerId: c.user.id, kind: "RESUME", file });
  if (!res.ok) return { error: res.error };

  let text = "";
  try {
    text = await extractText(res.buffer, res.mime);
  } catch (e) {
    log.error("resume.extract_failed", { err: e });
  }
  if (text.trim().length < 80) {
    await deleteStored(res.fileId);
    return { error: "We couldn't read any text in that file. Scanned/image-only PDFs aren't supported — export a text-based PDF or upload a DOCX." };
  }

  // Extraction is STAGED. The profile is not touched until the user reviews and approves the result.
  const imp = await createImport(c.profile.id, text, res.fileId);
  await audit(c.user.id, "resume.upload", "ResumeImport", imp.id);
  return { redirectTo: `/resume/import/${imp.id}` };
}

export async function generateFromProfile(): Promise<void> {
  const c = await ctx();
  if (!c) return;
  const content = await profileToContent(c.profile.id);
  let resume = await db.resume.findFirst({ where: { profileId: c.profile.id, kind: "GENERATED" } });
  resume ??= await db.resume.create({ data: { profileId: c.profile.id, title: "Resume from BIM profile", kind: "GENERATED" } });
  await saveResumeVersion(resume.id, content, "profile");
  await audit(c.user.id, "resume.generate", "Resume", resume.id);
  refresh();
  redirect(`/resume/score?resume=${resume.id}`);
}

/** Overwrite the BIM profile with the content of a resume version. */
export async function syncProfileFromResume(resumeId: string): Promise<void> {
  const c = await ctx();
  if (!c) return;
  const resume = await db.resume.findFirst({ where: { id: resumeId, profileId: c.profile.id } });
  if (!resume?.currentVersionId) return;
  const v = await db.resumeVersion.findUnique({ where: { id: resume.currentVersionId } });
  if (!v) return;
  await applyContentToProfile(c.profile.id, v.content as never, "replace");
  await recomputeMatches(c.profile.id);
  await audit(c.user.id, "resume.sync_profile", "Resume", resume.id);
  refresh();
}

export async function deleteResume(resumeId: string): Promise<void> {
  const c = await ctx();
  if (!c) return;
  const resume = await db.resume.findFirst({ where: { id: resumeId, profileId: c.profile.id } });
  if (!resume) return;
  await db.resume.delete({ where: { id: resume.id } });
  if (resume.sourceFileId) await deleteStored(resume.sourceFileId);
  await audit(c.user.id, "resume.delete", "Resume", resumeId);
  refresh();
}
