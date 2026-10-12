"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { ensureProfile, recomputeMatches } from "@/lib/services/profile";
import { applyImport, discardImport, SCALAR_KEYS, type ImportSelection } from "@/lib/services/imports";
import { createTargetedResume, duplicateResume, ownedResume, saveResumeContent } from "@/lib/services/resumes";
import { BENCHMARK_ROLES_FOR_TARGETING } from "@/lib/scoring/benchmark";
import { deleteStored } from "@/lib/files/storage";
import type { ActionState } from "@/components/forms";

async function ctx() {
  const user = await actionUser("app");
  if (!user) return null;
  return { user, profile: await ensureProfile(user) };
}

const refresh = () => {
  for (const p of ["/resume", "/resume/score", "/profile", "/dashboard", "/jobs", "/career-insights"]) revalidatePath(p);
};

// ---- Import review --------------------------------------------------------------------------------------

const indices = (fd: FormData, prefix: string) => {
  const n = Number(fd.get(`${prefix}_count`) ?? 0);
  const count = Number.isFinite(n) ? Math.min(n, 60) : 0;
  return Array.from({ length: count }, (_, i) => i).filter((i) => fd.get(`${prefix}_use_${i}`) === "on");
};
const val = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const num = (v: string) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);

export async function applyImportAction(importId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const sel: ImportSelection = { scalars: {}, experiences: [], educations: [], projects: [], certifications: [], software: [], skills: [], languages: [] };
  for (const k of SCALAR_KEYS) {
    if (fd.get(`use_${k}`) === "on" && val(fd, `val_${k}`)) sel.scalars[k] = k === "yearsExperience" ? Number(val(fd, `val_${k}`)) : val(fd, `val_${k}`);
  }
  for (const i of indices(fd, "exp")) {
    sel.experiences.push({ title: val(fd, `exp_title_${i}`), company: val(fd, `exp_company_${i}`), location: val(fd, `exp_location_${i}`) || undefined, startDate: val(fd, `exp_start_${i}`) || undefined, endDate: val(fd, `exp_end_${i}`) || undefined, current: fd.get(`exp_current_${i}`) === "on", description: val(fd, `exp_desc_${i}`) || undefined });
  }
  for (const i of indices(fd, "edu")) {
    sel.educations.push({ school: val(fd, `edu_school_${i}`), degree: val(fd, `edu_degree_${i}`) || undefined, field: val(fd, `edu_field_${i}`) || undefined, startYear: num(val(fd, `edu_start_${i}`)), endYear: num(val(fd, `edu_end_${i}`)) });
  }
  for (const i of indices(fd, "proj")) {
    sel.projects.push({ name: val(fd, `proj_name_${i}`), role: val(fd, `proj_role_${i}`) || undefined, sector: val(fd, `proj_sector_${i}`) || undefined, lod: val(fd, `proj_lod_${i}`) || undefined, year: num(val(fd, `proj_year_${i}`)), software: val(fd, `proj_software_${i}`).split(",").map((x) => x.trim()).filter(Boolean), description: val(fd, `proj_desc_${i}`) || undefined });
  }
  for (const i of indices(fd, "lang")) sel.languages.push({ name: val(fd, `lang_name_${i}`), level: val(fd, `lang_level_${i}`) || undefined });
  sel.certifications = fd.getAll("cert").map(String);
  sel.software = fd.getAll("software").map(String);
  sel.skills = fd.getAll("skill").map(String);

  let resumeId: string;
  try {
    resumeId = await applyImport(c.user.id, importId, sel);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save." };
  }
  await recomputeMatches(c.profile.id);
  await audit(c.user.id, "resume.import_applied", "ResumeImport", importId);
  refresh();
  return { redirectTo: `/resume/score?resume=${resumeId}&imported=1` };
}

export async function discardImportAction(importId: string): Promise<void> {
  const c = await ctx();
  if (!c) return;
  const imp = await db.resumeImport.findFirst({ where: { id: importId, profile: { userId: c.user.id }, status: "PENDING" } });
  if (imp && (await discardImport(c.user.id, importId)) && imp.fileId) await deleteStored(imp.fileId);
  redirect("/resume");
}

// ---- Builder ---------------------------------------------------------------------------------------------

export async function createTargetedAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const role = String(fd.get("role") ?? "");
  const bench = BENCHMARK_ROLES_FOR_TARGETING.find((r) => r.id === role);
  if (!bench) return { error: "Choose a target role." };
  if ((await db.resume.count({ where: { profileId: c.profile.id } })) >= 15) return { error: "You can keep up to 15 resumes." };
  const title = String(fd.get("title") ?? "").trim() || `${bench.label} Resume`;
  const id = await createTargetedResume(c.user.id, { title, targetRoleId: role });
  await audit(c.user.id, "resume.targeted", "Resume", id, { role });
  refresh();
  return { redirectTo: `/resume/${id}/edit` };
}

export async function saveResumeEditor(resumeId: string, payload: string, label?: string): Promise<{ ok: boolean; error?: string; score?: number }> {
  const c = await ctx();
  if (!c) return { ok: false, error: "Please sign in again." };
  if (payload.length > 300_000) return { ok: false, error: "Resume is too large." };
  try {
    const { score } = await saveResumeContent(c.user.id, resumeId, JSON.parse(payload), label);
    refresh();
    revalidatePath(`/resume/${resumeId}`);
    return { ok: true, score: score.total };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "ZodError" ? "Some fields are invalid. Check lengths and dates." : e.message) : "Could not save.";
    return { ok: false, error: msg };
  }
}

export async function duplicateResumeAction(resumeId: string): Promise<void> {
  const c = await ctx();
  if (!c) return;
  if ((await db.resume.count({ where: { profileId: c.profile.id } })) >= 15) return;
  const id = await duplicateResume(c.user.id, resumeId);
  refresh();
  redirect(`/resume/${id}/edit`);
}

export async function setPublicResume(resumeId: string | null): Promise<void> {
  const c = await ctx();
  if (!c) return;
  if (resumeId && !(await ownedResume(c.user.id, resumeId))) return;
  await db.bIMProfessionalProfile.update({ where: { id: c.profile.id }, data: { publicResumeId: resumeId } });
  revalidatePath("/resume");
  revalidatePath("/profile");
}
