"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SkillLevel } from "@prisma/client";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { ensureProfile, recomputeMatches } from "@/lib/services/profile";
import { BIM_SKILLS, BIM_SOFTWARE, DISCIPLINES, REMOTE_PREFS, canonicalize } from "@/lib/taxonomy";
import { csvToList, slugify, toMonthDate, uniqueSuffix } from "@/lib/utils";
import { deleteStored, saveUpload } from "@/lib/files/storage";
import type { ActionState } from "@/components/forms";

async function ctx() {
  const user = await actionUser("app");
  if (!user) return null;
  const profile = await ensureProfile(user);
  return { user, profile };
}

const done = (paths: string[] = []) => {
  for (const p of ["/profile", "/dashboard", "/resume/score", "/portfolio", ...paths]) revalidatePath(p);
};

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const optInt = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().min(min).max(max).optional());

const LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"] as const;

const basicsSchema = z.object({
  headline: opt(140),
  summary: opt(2000),
  location: opt(120),
  city: opt(80),
  country: opt(80),
  discipline: z.enum(DISCIPLINES).optional().or(z.literal("").transform(() => undefined)),
  yearsExperience: optInt(0, 60),
  desiredRole: opt(120),
  remotePreference: z.enum(REMOTE_PREFS).optional().or(z.literal("").transform(() => undefined)),
});

export async function saveBasics(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const parsed = basicsSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const visibility = fd.get("visibility") === "PUBLIC" ? "PUBLIC" : "PRIVATE";
  await db.bIMProfessionalProfile.update({
    where: { id: c.profile.id },
    data: { headline: d.headline ?? null, summary: d.summary ?? null, location: d.location ?? null, city: d.city ?? null, country: d.country ?? null, discipline: d.discipline ?? null, yearsExperience: d.yearsExperience ?? null, desiredRole: d.desiredRole ?? null, openToWork: fd.get("openToWork") === "on", visibility },
  });
  await audit(c.user.id, "profile.update", "Profile", c.profile.id, { visibility });
  await recomputeMatches(c.profile.id);
  done(["/jobs"]);
  return { ok: "Profile saved." };
}

// ---- Software & skills -----------------------------------------------------

export async function saveSoftware(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const names = csvToList(fd.get("software"), 20);
  const level = (LEVELS as readonly string[]).includes(String(fd.get("level"))) ? (String(fd.get("level")) as SkillLevel) : "INTERMEDIATE";
  const years = fd.get("years") ? Math.max(0, Math.min(60, Number(fd.get("years")) || 0)) : null;
  if (!names.length) return { error: "Enter at least one software name." };
  for (const raw of names) {
    const software = canonicalize(raw, BIM_SOFTWARE).slice(0, 60);
    await db.softwareSkill.upsert({ where: { profileId_software: { profileId: c.profile.id, software } }, update: { level, years }, create: { profileId: c.profile.id, software, level, years } });
  }
  await recomputeMatches(c.profile.id);
  done(["/jobs"]);
  return { ok: "Software saved." };
}

export async function deleteSoftware(id: string): Promise<void> {
  const c = await ctx();
  if (!c) return;
  await db.softwareSkill.deleteMany({ where: { id, profileId: c.profile.id } });
  await recomputeMatches(c.profile.id);
  done(["/jobs"]);
}

export async function addSkills(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const names = csvToList(fd.get("skills"), 20);
  if (!names.length) return { error: "Enter at least one skill." };
  for (const raw of names) {
    const name = canonicalize(raw, BIM_SKILLS).slice(0, 60);
    const skill = await db.skill.upsert({ where: { name }, update: {}, create: { name, category: BIM_SKILLS.find((s) => s.name === name)?.category ?? null } });
    await db.profileSkill.upsert({ where: { profileId_skillId: { profileId: c.profile.id, skillId: skill.id } }, update: {}, create: { profileId: c.profile.id, skillId: skill.id } });
  }
  await recomputeMatches(c.profile.id);
  done(["/jobs"]);
  return { ok: "Skills added." };
}

export async function removeSkill(skillId: string): Promise<void> {
  const c = await ctx();
  if (!c) return;
  await db.profileSkill.deleteMany({ where: { skillId, profileId: c.profile.id } });
  await recomputeMatches(c.profile.id);
  done(["/jobs"]);
}

// ---- Experience --------------------------------------------------------------

const ymSchema = z.string().regex(/^\d{4}-\d{2}$/, "Use the month picker for dates").optional().or(z.literal("").transform(() => undefined));

const experienceSchema = z.object({ id: opt(40), title: z.string().trim().min(2, "Enter a job title").max(160), company: z.string().trim().min(1, "Enter a company").max(160), location: opt(120), startDate: ymSchema, endDate: ymSchema, description: opt(4000) });

export async function saveExperience(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const parsed = experienceSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, startDate, endDate, ...rest } = parsed.data;
  const current = fd.get("current") === "on";
  const start = toMonthDate(startDate);
  const end = current ? null : toMonthDate(endDate);
  if (start && end && end < start) return { error: "End date must be after the start date." };
  const data = { ...rest, location: rest.location ?? null, description: rest.description ?? null, startDate: start, endDate: end, current };
  if (id) {
    const r = await db.experience.updateMany({ where: { id, profileId: c.profile.id }, data });
    if (!r.count) return { error: "Experience not found." };
  } else {
    await db.experience.create({ data: { ...data, profileId: c.profile.id } });
  }
  await recomputeMatches(c.profile.id);
  done(["/jobs"]);
  return { ok: "Experience saved." };
}

export async function deleteExperience(id: string): Promise<void> {
  const c = await ctx();
  if (!c) return;
  await db.experience.deleteMany({ where: { id, profileId: c.profile.id } });
  done();
}

// ---- Education / Certification / Project ---------------------------------------

const educationSchema = z.object({ id: opt(40), school: z.string().trim().min(2, "Enter the institution").max(200), degree: opt(120), field: opt(120), startYear: optInt(1950, 2100), endYear: optInt(1950, 2100) });

export async function saveEducation(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const parsed = educationSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, ...rest } = parsed.data;
  const data = { school: rest.school, degree: rest.degree ?? null, field: rest.field ?? null, startYear: rest.startYear ?? null, endYear: rest.endYear ?? null };
  if (id) {
    if (!(await db.education.updateMany({ where: { id, profileId: c.profile.id }, data })).count) return { error: "Education not found." };
  } else await db.education.create({ data: { ...data, profileId: c.profile.id } });
  done();
  return { ok: "Education saved." };
}

export async function deleteEducation(id: string): Promise<void> {
  const c = await ctx();
  if (!c) return;
  await db.education.deleteMany({ where: { id, profileId: c.profile.id } });
  done();
}

const certSchema = z.object({ id: opt(40), name: z.string().trim().min(2, "Enter the certification name").max(200), issuer: opt(120), issuedAt: ymSchema, expiresAt: ymSchema, credentialUrl: opt(300) });

export async function saveCertification(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const parsed = certSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, issuedAt, expiresAt, credentialUrl, ...rest } = parsed.data;
  if (credentialUrl && !/^https?:\/\//i.test(credentialUrl)) return { error: "Credential link must start with http:// or https://" };
  const data = { name: rest.name, issuer: rest.issuer ?? null, issuedAt: toMonthDate(issuedAt), expiresAt: toMonthDate(expiresAt), credentialUrl: credentialUrl ?? null };
  if (id) {
    if (!(await db.certification.updateMany({ where: { id, profileId: c.profile.id }, data })).count) return { error: "Certification not found." };
  } else await db.certification.create({ data: { ...data, profileId: c.profile.id } });
  done();
  return { ok: "Certification saved." };
}

export async function deleteCertification(id: string): Promise<void> {
  const c = await ctx();
  if (!c) return;
  await db.certification.deleteMany({ where: { id, profileId: c.profile.id } });
  done();
}

const projectSchema = z.object({ id: opt(40), name: z.string().trim().min(2, "Enter the project name").max(160), role: opt(120), sector: opt(60), location: opt(120), lod: opt(20), year: optInt(1990, 2100), description: opt(3000) });

export async function saveProject(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const parsed = projectSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, ...rest } = parsed.data;
  const data = { name: rest.name, role: rest.role ?? null, sector: rest.sector ?? null, location: rest.location ?? null, lod: rest.lod ?? null, year: rest.year ?? null, description: rest.description ?? null, software: csvToList(fd.get("software"), 15).map((s) => canonicalize(s, BIM_SOFTWARE)) };
  if (id) {
    if (!(await db.project.updateMany({ where: { id, profileId: c.profile.id }, data })).count) return { error: "Project not found." };
  } else await db.project.create({ data: { ...data, profileId: c.profile.id } });
  done();
  return { ok: "Project saved." };
}

export async function deleteProject(id: string): Promise<void> {
  const c = await ctx();
  if (!c) return;
  await db.project.deleteMany({ where: { id, profileId: c.profile.id } });
  done();
}

// ---- Avatar ---------------------------------------------------------------------

export async function uploadAvatar(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const res = await saveUpload({ ownerId: c.user.id, kind: "PROFILE_IMAGE", file: fd.get("file") as File | null });
  if (!res.ok) return { error: res.error };
  const old = c.profile.avatarFileId;
  await db.bIMProfessionalProfile.update({ where: { id: c.profile.id }, data: { avatarFileId: res.fileId } });
  if (old) await deleteStored(old);
  await audit(c.user.id, "profile.avatar", "FileAsset", res.fileId);
  done();
  return { ok: "Photo updated." };
}

export async function removeAvatar(): Promise<void> {
  const c = await ctx();
  if (!c || !c.profile.avatarFileId) return;
  const id = c.profile.avatarFileId;
  await db.bIMProfessionalProfile.update({ where: { id: c.profile.id }, data: { avatarFileId: null } });
  await deleteStored(id);
  done();
}

/** Regenerates the public slug (e.g. after changing your name). */
export async function regenerateSlug(): Promise<void> {
  const c = await ctx();
  if (!c) return;
  await db.bIMProfessionalProfile.update({ where: { id: c.profile.id }, data: { slug: `${slugify(c.user.name, 40)}-${uniqueSuffix(4)}` } });
  done();
}
