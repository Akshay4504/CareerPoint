"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { ensureProfile, recomputeMatches } from "@/lib/services/profile";
import { privacySchema } from "@/lib/services/public-profile";
import { DISCIPLINES, EMPLOYMENT_TYPES, LOD_LEVELS, REMOTE_PREFS } from "@/lib/taxonomy";
import { csvToList } from "@/lib/utils";
import type { ActionState } from "@/components/forms";

async function ctx() {
  const user = await actionUser("app");
  if (!user) return null;
  return { user, profile: await ensureProfile(user) };
}

const done = () => {
  for (const p of ["/profile", "/dashboard", "/jobs", "/resume/score", "/career-insights"]) revalidatePath(p);
};

const only = <T extends string>(values: FormDataEntryValue[], allowed: readonly T[]) => values.map(String).filter((v): v is T => (allowed as readonly string[]).includes(v));
const optInt = (v: FormDataEntryValue | null, min: number, max: number) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const lines = (v: FormDataEntryValue | null, max: number, each = 300) =>
  typeof v === "string" ? v.split("\n").map((l) => l.trim().replace(/^[•\-*]\s*/, "").slice(0, each)).filter(Boolean).slice(0, max) : [];
const text = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function saveIdentity(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  await db.bIMProfessionalProfile.update({ where: { id: c.profile.id }, data: { city: text(fd.get("city"), 80) } });
  done();
  return { ok: "Saved." };
}

export async function saveCareer(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  await db.bIMProfessionalProfile.update({
    where: { id: c.profile.id },
    data: { currentRole: text(fd.get("currentRole"), 120), industries: csvToList(fd.get("industries"), 15), projectTypes: csvToList(fd.get("projectTypes"), 15), achievements: lines(fd.get("achievements"), 10, 240) },
  });
  await recomputeMatches(c.profile.id);
  done();
  return { ok: "Career details saved." };
}

export async function saveBimProfile(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  await db.bIMProfessionalProfile.update({
    where: { id: c.profile.id },
    data: {
      bimDisciplines: only(fd.getAll("bimDisciplines"), DISCIPLINES),
      bimRoles: csvToList(fd.get("bimRoles"), 12),
      bimResponsibilities: lines(fd.get("bimResponsibilities"), 15, 200),
      bimStandards: csvToList(fd.get("bimStandards"), 20),
      lodLevels: only(fd.getAll("lodLevels"), LOD_LEVELS),
      infoMgmtYears: optInt(fd.get("infoMgmtYears"), 0, 60),
      coordinationYears: optInt(fd.get("coordinationYears"), 0, 60),
      modelingYears: optInt(fd.get("modelingYears"), 0, 60),
      vdcYears: optInt(fd.get("vdcYears"), 0, 60),
    },
  });
  await recomputeMatches(c.profile.id);
  done();
  return { ok: "BIM profile saved." };
}

const langSchema = z.object({ name: z.string().trim().min(2, "Enter a language").max(60), level: z.string().trim().max(40).optional() });

export async function saveLanguage(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const parsed = langSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if ((await db.language.count({ where: { profileId: c.profile.id } })) >= 12) return { error: "Up to 12 languages." };
  await db.language.upsert({ where: { profileId_name: { profileId: c.profile.id, name: parsed.data.name } }, update: { level: parsed.data.level || null }, create: { profileId: c.profile.id, name: parsed.data.name, level: parsed.data.level || null } });
  done();
  return { ok: "Language saved." };
}

export async function deleteLanguage(id: string): Promise<void> {
  const c = await ctx();
  if (!c) return;
  await db.language.deleteMany({ where: { id, profileId: c.profile.id } });
  done();
}

export async function savePreferences(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const remote = String(fd.get("remotePreference") ?? "");
  await db.bIMProfessionalProfile.update({
    where: { id: c.profile.id },
    data: {
      preferredRoles: csvToList(fd.get("preferredRoles"), 10),
      preferredLocations: csvToList(fd.get("preferredLocations"), 10),
      remotePreference: (REMOTE_PREFS as readonly string[]).includes(remote) ? remote : null,
      employmentTypes: only(fd.getAll("employmentTypes"), EMPLOYMENT_TYPES),
      minSalary: optInt(fd.get("minSalary"), 0, 100_000_000),
      salaryCurrency: text(fd.get("salaryCurrency"), 3)?.toUpperCase() ?? null,
      availability: text(fd.get("availability"), 60),
    },
  });
  await recomputeMatches(c.profile.id);
  done();
  return { ok: "Preferences saved. Minimum salary is private and never shown on your public profile." };
}

export async function savePrivacy(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const privacy = privacySchema.parse({ hideLocation: fd.get("hideLocation") === "on", showResume: fd.get("showResume") === "on", showAchievements: fd.get("showAchievements") === "on", showPreferences: fd.get("showPreferences") === "on" });
  const publicResumeId = text(fd.get("publicResumeId"), 40);
  if (publicResumeId && !(await db.resume.findFirst({ where: { id: publicResumeId, profileId: c.profile.id }, select: { id: true } }))) return { error: "Resume not found." };
  await db.bIMProfessionalProfile.update({ where: { id: c.profile.id }, data: { privacy, publicResumeId } });
  await audit(c.user.id, "profile.privacy", "Profile", c.profile.id, privacy);
  done();
  return { ok: "Privacy settings saved." };
}
