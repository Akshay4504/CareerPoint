import "server-only";
import { getScoringConfig } from "@/lib/scoring/store";
import type { BIMProfessionalProfile, Prisma, SkillLevel } from "@prisma/client";
import { db } from "@/lib/db";
import { slugify, toMonthDate, toYm, uniqueSuffix } from "@/lib/utils";
import { BIM_SKILLS, BIM_SOFTWARE, canonicalize } from "@/lib/taxonomy";
import { emptyResume, type ResumeContent } from "@/lib/resume/types";
import { scoreResume } from "@/lib/resume/score";
import { notifyEvent } from "@/lib/notifications/service";

export async function ensureProfile(user: { id: string; name: string }): Promise<BIMProfessionalProfile> {
  const existing = await db.bIMProfessionalProfile.findUnique({ where: { userId: user.id } });
  if (existing) return existing;
  const slug = `${slugify(user.name, 40)}-${uniqueSuffix(4)}`;
  return db.bIMProfessionalProfile.create({ data: { userId: user.id, slug } });
}

/** Profile → structured resume content (the profile is the source of truth). */
export async function profileToContent(profileId: string): Promise<ResumeContent> {
  const p = await db.bIMProfessionalProfile.findUniqueOrThrow({
    where: { id: profileId },
    include: {
      user: true,
      experiences: { orderBy: [{ current: "desc" }, { startDate: "desc" }] },
      educations: { orderBy: { endYear: "desc" } },
      skills: { include: { skill: true } },
      softwareSkills: true,
      certifications: true,
      projects: true,
      languages: true,
      portfolioItems: { orderBy: { sortOrder: "desc" }, take: 12 },
    },
  });
  const c = emptyResume();
  c.languages = p.languages.map((l) => ({ name: l.name, level: l.level ?? undefined }));
  c.portfolio = p.portfolioItems.map((i) => ({ id: i.id, title: i.title, description: i.description ?? undefined, url: i.url ?? undefined }));
  c.name = p.user.name;
  c.email = p.user.email;
  c.location = p.location ?? undefined;
  c.headline = p.headline ?? undefined;
  c.summary = p.summary ?? undefined;
  c.yearsExperience = p.yearsExperience ?? undefined;
  c.discipline = p.discipline ?? undefined;
  c.software = p.softwareSkills.map((s) => s.software);
  c.skills = p.skills.map((s) => s.skill.name);
  c.certifications = p.certifications.map((x) => x.name);
  c.experiences = p.experiences.map((e) => ({
    title: e.title,
    company: e.company,
    location: e.location ?? undefined,
    startDate: toYm(e.startDate) || undefined,
    endDate: toYm(e.endDate) || undefined,
    current: e.current,
    description: e.description ?? undefined,
  }));
  c.educations = p.educations.map((e) => ({ school: e.school, degree: e.degree ?? undefined, field: e.field ?? undefined, startYear: e.startYear ?? undefined, endYear: e.endYear ?? undefined }));
  c.projects = p.projects.map((x) => ({ name: x.name, role: x.role ?? undefined, sector: x.sector ?? undefined, lod: x.lod ?? undefined, software: x.software, year: x.year ?? undefined, description: x.description ?? undefined, scale: x.scale ?? undefined, outcomes: x.outcomes ?? undefined }));
  return c;
}

async function upsertSkillNames(profileId: string, names: string[], tx: Prisma.TransactionClient) {
  for (const raw of names) {
    const name = canonicalize(raw, BIM_SKILLS);
    const category = BIM_SKILLS.find((s) => s.name === name)?.category ?? null;
    const skill = await tx.skill.upsert({ where: { name }, update: {}, create: { name, category } });
    await tx.profileSkill.upsert({ where: { profileId_skillId: { profileId, skillId: skill.id } }, update: {}, create: { profileId, skillId: skill.id } });
  }
}

async function upsertSoftwareNames(profileId: string, names: string[], tx: Prisma.TransactionClient) {
  for (const raw of names) {
    const software = canonicalize(raw, BIM_SOFTWARE);
    await tx.softwareSkill.upsert({ where: { profileId_software: { profileId, software } }, update: {}, create: { profileId, software } });
  }
}

/**
 * Apply parsed resume content to the profile.
 * "fill" only fills empty scalar fields and adds missing items; "replace" overwrites collections too.
 */
export async function applyContentToProfile(profileId: string, c: ResumeContent, mode: "fill" | "replace") {
  const profile = await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profileId } });
  await db.$transaction(async (tx) => {
    const data: Prisma.BIMProfessionalProfileUpdateInput = {};
    const take = <T>(cur: T | null | undefined, next: T | undefined | null) => (mode === "replace" ? (next ?? cur) : (cur ?? next));
    data.headline = take(profile.headline, c.headline) ?? null;
    data.summary = take(profile.summary, c.summary) ?? null;
    data.location = take(profile.location, c.location) ?? null;
    data.yearsExperience = take(profile.yearsExperience, c.yearsExperience) ?? null;
    data.discipline = take(profile.discipline, c.discipline) ?? null;
    await tx.bIMProfessionalProfile.update({ where: { id: profileId }, data });

    if (mode === "replace") {
      await tx.experience.deleteMany({ where: { profileId } });
      await tx.education.deleteMany({ where: { profileId } });
      await tx.project.deleteMany({ where: { profileId } });
      await tx.certification.deleteMany({ where: { profileId } });
    }
    const [haveExp, haveEdu, haveProj, haveCert] = await Promise.all([
      tx.experience.count({ where: { profileId } }),
      tx.education.count({ where: { profileId } }),
      tx.project.count({ where: { profileId } }),
      tx.certification.findMany({ where: { profileId }, select: { name: true } }),
    ]);
    if (!haveExp && c.experiences.length) {
      await tx.experience.createMany({
        data: c.experiences.map((e, i) => ({
          profileId,
          title: e.title.slice(0, 160),
          company: e.company.slice(0, 160),
          location: e.location?.slice(0, 120),
          startDate: toMonthDate(e.startDate),
          endDate: toMonthDate(e.endDate),
          current: !!e.current,
          description: e.description?.slice(0, 4000),
          sortOrder: i,
        })),
      });
    }
    if (!haveEdu && c.educations.length) {
      await tx.education.createMany({ data: c.educations.map((e) => ({ profileId, school: e.school.slice(0, 200), degree: e.degree?.slice(0, 120), field: e.field?.slice(0, 120), startYear: e.startYear, endYear: e.endYear })) });
    }
    if (!haveProj && c.projects.length) {
      await tx.project.createMany({ data: c.projects.slice(0, 20).map((x) => ({ profileId, name: x.name.slice(0, 160), role: x.role, sector: x.sector, lod: x.lod, software: x.software ?? [], year: x.year, description: x.description?.slice(0, 3000) })) });
    }
    const haveNames = new Set(haveCert.map((x) => x.name.toLowerCase()));
    const newCerts = c.certifications.filter((n) => !haveNames.has(n.toLowerCase()));
    if (newCerts.length) await tx.certification.createMany({ data: newCerts.map((name) => ({ profileId, name: name.slice(0, 200) })) });

    await upsertSkillNames(profileId, c.skills, tx);
    await upsertSoftwareNames(profileId, c.software, tx);
  });
}

/** Items a candidate can point to as proof of work: published projects plus standalone portfolio items. */
export async function portfolioCount(profileId: string) {
  const [projects, items] = await Promise.all([
    db.project.count({ where: { profileId, published: true } }),
    db.portfolioItem.count({ where: { profileId, projectId: null } }),
  ]);
  return projects + items;
}

/** Persist a new ResumeVersion, make it current, and store its deterministic score. */
export async function saveResumeVersion(resumeId: string, content: ResumeContent, source: string, rawText?: string, opts: { label?: string } = {}) {
  const resume = await db.resume.findUniqueOrThrow({ where: { id: resumeId }, select: { profileId: true, targetRole: true, title: true, currentVersionId: true, profile: { select: { userId: true } } } });
  const before = resume.currentVersionId ? await db.resumeScore.findFirst({ where: { resumeVersionId: resume.currentVersionId }, orderBy: { createdAt: "desc" }, select: { total: true } }) : null;
  const pc = await portfolioCount(resume.profileId);
  const active = await getScoringConfig();
  const s = scoreResume({ content, rawText, portfolioCount: pc, targetRole: resume.targetRole }, active.config);
  return db.$transaction(async (tx) => {
    const last = await tx.resumeVersion.findFirst({ where: { resumeId }, orderBy: { version: "desc" } });
    const version = await tx.resumeVersion.create({
      data: { resumeId, version: (last?.version ?? 0) + 1, content: content as unknown as Prisma.InputJsonValue, rawText: rawText?.slice(0, 200_000), source, label: opts.label },
    });
    await tx.resumeScore.create({
      data: { resumeVersionId: version.id, total: s.total, breakdown: { groups: s.breakdown, dimensions: s.dimensions, configVersion: active.version } as unknown as Prisma.InputJsonValue, suggestions: s.suggestions as unknown as Prisma.InputJsonValue, rubricVersion: s.rubricVersion },
    });
    await tx.resume.update({ where: { id: resumeId }, data: { currentVersionId: version.id } });
    return { version, score: s };
  }).then(async (r) => {
    // Celebrate real progress only: a measurable improvement over the previous version of the same resume.
    if (before && r.score.total >= before.total + 3) await notifyEvent(resume.profile.userId, "resume.score_improved", { title: `Resume score improved to ${r.score.total}`, body: `${resume.title}: up from ${before.total}.`, href: `/resume/score?resume=${resumeId}` });
    return r;
  });
}

export const LEVELS: SkillLevel[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"];

export { loadJobScoreProfile, matchJobForProfiles, recomputeMatches } from "./matching";

export async function profileCompleteness(profileId: string) {
  const p = await db.bIMProfessionalProfile.findUniqueOrThrow({
    where: { id: profileId },
    include: { _count: { select: { experiences: true, educations: true, skills: true, softwareSkills: true, certifications: true, projects: true, portfolioItems: true, resumes: true } } },
  });
  const checks = [
    { key: "headline", label: "Headline", done: !!p.headline, href: "/profile" },
    { key: "summary", label: "Summary", done: (p.summary?.length ?? 0) >= 80, href: "/profile" },
    { key: "location", label: "Location", done: !!p.location, href: "/profile" },
    { key: "discipline", label: "Discipline", done: !!p.discipline, href: "/profile" },
    { key: "experience", label: "Experience", done: p._count.experiences > 0, href: "/profile#experience" },
    { key: "software", label: "BIM software (3+)", done: p._count.softwareSkills >= 3, href: "/profile#software" },
    { key: "skills", label: "Skills (5+)", done: p._count.skills >= 5, href: "/profile#skills" },
    { key: "education", label: "Education", done: p._count.educations > 0, href: "/profile#education" },
    { key: "projects", label: "Projects", done: p._count.projects > 0, href: "/profile#projects" },
    { key: "resume", label: "Resume uploaded", done: p._count.resumes > 0, href: "/resume" },
    { key: "portfolio", label: "Portfolio item", done: p._count.portfolioItems > 0, href: "/portfolio" },
    { key: "photo", label: "Profile photo", done: !!p.avatarFileId, href: "/profile" },
  ];
  const done = checks.filter((c) => c.done).length;
  return { percent: Math.round((done / checks.length) * 100), checks, profile: p };
}
