import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseResumeText } from "@/lib/resume/parse";
import { emptyResume, type ResumeContent, type ResumeExperience } from "@/lib/resume/types";
import { BIM_SKILLS, BIM_SOFTWARE, canonicalize } from "@/lib/taxonomy";
import { toMonthDate } from "@/lib/utils";
import { saveResumeVersion } from "./profile";

/**
 * Resume → extraction → STAGED import → user review → profile.
 * Nothing is written to the profile until the user approves a selection.
 */

export async function createImport(profileId: string, rawText: string, fileId?: string | null) {
  const extracted = parseResumeText(rawText);
  return db.resumeImport.create({ data: { profileId, fileId: fileId ?? null, rawText: rawText.slice(0, 200_000), extracted: extracted as unknown as Prisma.InputJsonValue } });
}

export type ScalarKey = "headline" | "summary" | "location" | "yearsExperience" | "discipline";
export const SCALAR_KEYS: ScalarKey[] = ["headline", "summary", "location", "yearsExperience", "discipline"];

export type ImportSelection = {
  /** Scalars the user chose to write (value already edited by the user). */
  scalars: Partial<Record<ScalarKey, string | number>>;
  experiences: ResumeExperience[];
  educations: ResumeContent["educations"];
  projects: ResumeContent["projects"];
  certifications: string[];
  software: string[];
  skills: string[];
  languages: { name: string; level?: string }[];
};

export type ProfileDiff = {
  scalars: { key: ScalarKey; label: string; current: string | null; found: string | null; status: "new" | "same" | "different" | "empty" }[];
};

const LABELS: Record<ScalarKey, string> = { headline: "Headline", summary: "Summary", location: "Location", yearsExperience: "Years of experience", discipline: "Discipline" };

/** Compares extracted scalars with what the profile already holds so the review UI can flag conflicts. */
export function diffScalars(extracted: ResumeContent, profile: Partial<Record<ScalarKey, string | number | null>>): ProfileDiff {
  return {
    scalars: SCALAR_KEYS.map((key) => {
      const found = extracted[key] != null && extracted[key] !== "" ? String(extracted[key]) : null;
      const current = profile[key] != null && profile[key] !== "" ? String(profile[key]) : null;
      const status = !found ? "empty" : !current ? "new" : current.trim() === found.trim() ? "same" : "different";
      return { key, label: LABELS[key], current, found, status };
    }),
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export async function applyImport(userId: string, importId: string, sel: ImportSelection) {
  // Ownership: the import must belong to this user's profile.
  const imp = await db.resumeImport.findFirst({ where: { id: importId, profile: { userId }, status: "PENDING" }, include: { profile: true } });
  if (!imp) throw new Error("Import not found or already processed");
  const profileId = imp.profileId;

  await db.$transaction(async (tx) => {
    const data: Prisma.BIMProfessionalProfileUpdateInput = {};
    if (sel.scalars.headline != null) data.headline = String(sel.scalars.headline).slice(0, 140);
    if (sel.scalars.summary != null) data.summary = String(sel.scalars.summary).slice(0, 2000);
    if (sel.scalars.location != null) data.location = String(sel.scalars.location).slice(0, 120);
    if (sel.scalars.discipline != null) data.discipline = String(sel.scalars.discipline).slice(0, 60);
    if (sel.scalars.yearsExperience != null && Number.isFinite(Number(sel.scalars.yearsExperience))) data.yearsExperience = Math.max(0, Math.min(60, Math.round(Number(sel.scalars.yearsExperience))));
    if (Object.keys(data).length) await tx.bIMProfessionalProfile.update({ where: { id: profileId }, data });

    // Collections are ADDED, never replaced; duplicates (by key fields) are skipped.
    const [exp, edu, proj, cert, lang] = await Promise.all([
      tx.experience.findMany({ where: { profileId }, select: { title: true, company: true } }),
      tx.education.findMany({ where: { profileId }, select: { school: true, degree: true } }),
      tx.project.findMany({ where: { profileId }, select: { name: true } }),
      tx.certification.findMany({ where: { profileId }, select: { name: true } }),
      tx.language.findMany({ where: { profileId }, select: { name: true } }),
    ]);
    const haveExp = new Set(exp.map((e) => norm(`${e.title}|${e.company}`)));
    const newExp = sel.experiences.filter((e) => e.title.trim() && e.company.trim() && !haveExp.has(norm(`${e.title}|${e.company}`)));
    if (newExp.length) {
      await tx.experience.createMany({ data: newExp.map((e, i) => ({ profileId, title: e.title.slice(0, 160), company: e.company.slice(0, 160), location: e.location?.slice(0, 120), startDate: toMonthDate(e.startDate), endDate: e.current ? null : toMonthDate(e.endDate), current: !!e.current, description: e.description?.slice(0, 4000), sortOrder: i })) });
    }
    const haveEdu = new Set(edu.map((e) => norm(`${e.school}|${e.degree ?? ""}`)));
    const newEdu = sel.educations.filter((e) => e.school.trim() && !haveEdu.has(norm(`${e.school}|${e.degree ?? ""}`)));
    if (newEdu.length) await tx.education.createMany({ data: newEdu.map((e) => ({ profileId, school: e.school.slice(0, 200), degree: e.degree?.slice(0, 120), field: e.field?.slice(0, 120), startYear: e.startYear, endYear: e.endYear })) });
    const haveProj = new Set(proj.map((p) => norm(p.name)));
    const newProj = sel.projects.filter((p) => p.name.trim() && !haveProj.has(norm(p.name)));
    if (newProj.length) await tx.project.createMany({ data: newProj.slice(0, 20).map((p) => ({ profileId, name: p.name.slice(0, 160), role: p.role, sector: p.sector, lod: p.lod, software: p.software ?? [], year: p.year, description: p.description?.slice(0, 3000) })) });
    const haveCert = new Set(cert.map((c) => norm(c.name)));
    const newCert = Array.from(new Set(sel.certifications.map((c) => c.trim()).filter(Boolean))).filter((c) => !haveCert.has(norm(c)));
    if (newCert.length) await tx.certification.createMany({ data: newCert.map((name) => ({ profileId, name: name.slice(0, 200) })) });
    const haveLang = new Set(lang.map((l) => norm(l.name)));
    const newLang = sel.languages.filter((l) => l.name.trim() && !haveLang.has(norm(l.name)));
    if (newLang.length) await tx.language.createMany({ data: newLang.map((l) => ({ profileId, name: l.name.slice(0, 60), level: l.level?.slice(0, 40) })) });

    for (const raw of sel.skills) {
      const name = canonicalize(raw, BIM_SKILLS).slice(0, 60);
      const skill = await tx.skill.upsert({ where: { name }, update: {}, create: { name, category: BIM_SKILLS.find((s) => s.name === name)?.category ?? null } });
      await tx.profileSkill.upsert({ where: { profileId_skillId: { profileId, skillId: skill.id } }, update: {}, create: { profileId, skillId: skill.id } });
    }
    for (const raw of sel.software) {
      const software = canonicalize(raw, BIM_SOFTWARE).slice(0, 60);
      // Existing proficiency is preserved; only missing tools are added.
      await tx.softwareSkill.upsert({ where: { profileId_software: { profileId, software } }, update: {}, create: { profileId, software } });
    }
  });

  // The Resume record keeps exactly what the user approved, plus the original file for download.
  const content: ResumeContent = { ...emptyResume(), ...(imp.extracted as unknown as ResumeContent), experiences: sel.experiences, educations: sel.educations, projects: sel.projects, certifications: sel.certifications, software: sel.software, skills: sel.skills, languages: sel.languages };
  for (const k of SCALAR_KEYS) if (sel.scalars[k] != null) (content as unknown as Record<string, unknown>)[k] = sel.scalars[k];
  const title = (await db.fileAsset.findUnique({ where: { id: imp.fileId ?? "" }, select: { originalName: true } }))?.originalName?.replace(/\.[^.]+$/, "") ?? "Imported resume";
  const resume = await db.resume.create({ data: { profileId, title: title.slice(0, 80), kind: "UPLOADED", sourceFileId: imp.fileId } });
  await saveResumeVersion(resume.id, content, "upload", imp.rawText);
  await db.resumeImport.update({ where: { id: imp.id }, data: { status: "APPLIED", appliedAt: new Date(), resumeId: resume.id } });
  return resume.id;
}

export async function discardImport(userId: string, importId: string) {
  const r = await db.resumeImport.updateMany({ where: { id: importId, profile: { userId }, status: "PENDING" }, data: { status: "DISCARDED" } });
  return r.count > 0;
}
