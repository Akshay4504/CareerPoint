import "server-only";
import type { Job, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scoreJobMatch, type JobScoreJob, type JobScoreProfile } from "@/lib/scoring/job";
import { activeJobWhere } from "./jobs";

// Candidate ↔ job compatibility, stored in JobMatch so feeds and search can sort by it.
// The score is a compatibility diagnostic only — it is never presented as a hiring probability.

const profileInclude = { skills: { include: { skill: true } }, softwareSkills: true, experiences: { select: { title: true } }, projects: true } satisfies Prisma.BIMProfessionalProfileInclude;
type LoadedProfile = Prisma.BIMProfessionalProfileGetPayload<{ include: typeof profileInclude }>;

export function snapshotFromProfile(p: LoadedProfile): JobScoreProfile {
  return {
    software: p.softwareSkills.map((s) => s.software),
    softwareYears: Object.fromEntries(p.softwareSkills.map((s) => [s.software, s.years])),
    skills: [...p.skills.map((s) => s.skill.name), ...p.bimStandards],
    titles: [p.headline, p.currentRole, p.desiredRole, ...p.preferredRoles, ...p.experiences.map((e) => e.title)].filter((x): x is string => !!x),
    yearsExperience: p.yearsExperience,
    discipline: p.discipline,
    location: p.location ?? ([p.city, p.country].filter(Boolean).join(", ") || null),
    country: p.country,
    remotePreference: p.remotePreference,
    industries: p.industries,
    preferredRoles: p.preferredRoles,
    preferredLocations: p.preferredLocations,
    employmentTypes: p.employmentTypes,
    minSalary: p.minSalary,
    salaryCurrency: p.salaryCurrency,
    projects: p.projects.map((x) => ({ name: x.name, sector: x.sector, software: x.software, description: x.description, discipline: x.discipline })),
  };
}

export const jobForScoring = (j: Pick<Job, "title" | "description" | "software" | "skills" | "seniority" | "discipline" | "location" | "city" | "country" | "remote" | "remoteType" | "bimRole" | "employmentType" | "experienceMin" | "experienceMax" | "industry" | "salaryMin" | "salaryMax" | "salaryCurrency">): JobScoreJob => j;

const JOB_SELECT = { id: true, title: true, description: true, software: true, skills: true, seniority: true, discipline: true, location: true, city: true, country: true, remote: true, remoteType: true, bimRole: true, employmentType: true, experienceMin: true, experienceMax: true, industry: true, salaryMin: true, salaryMax: true, salaryCurrency: true } satisfies Prisma.JobSelect;

const hasSignal = (s: JobScoreProfile) => s.software.length > 0 || s.skills.length > 0 || s.titles.length > 0;

export async function loadJobScoreProfile(profileId: string): Promise<JobScoreProfile> {
  return snapshotFromProfile(await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profileId }, include: profileInclude }));
}

const reasonsJson = (r: ReturnType<typeof scoreJobMatch>) => ({ components: r.components, matched: r.matched, missing: r.missing, reasons: r.reasons, gaps: r.gaps }) as unknown as Prisma.InputJsonValue;

/** Recompute stored matches for one profile against every live job (called when the profile changes). */
export async function recomputeMatches(profileId: string) {
  const p = await db.bIMProfessionalProfile.findUnique({ where: { id: profileId }, include: profileInclude });
  if (!p) return 0;
  const snap = snapshotFromProfile(p);
  if (!hasSignal(snap)) {
    await db.jobMatch.deleteMany({ where: { profileId } });
    return 0;
  }
  const jobs = await db.job.findMany({ where: activeJobWhere(), select: JOB_SELECT, orderBy: { postedAt: "desc" }, take: 5000 });
  const rows = jobs.map((j) => {
    const r = scoreJobMatch(snap, jobForScoring(j));
    return { profileId, jobId: j.id, score: r.total, reasons: reasonsJson(r) };
  });
  await db.$transaction([db.jobMatch.deleteMany({ where: { profileId } }), db.jobMatch.createMany({ data: rows })]);
  return rows.length;
}

/** Score one (new or changed) job against all candidate profiles, in batches. */
export async function matchJobForProfiles(jobId: string, batchSize = 200) {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { ...JOB_SELECT, status: true, canonicalJobId: true } });
  if (!job || job.status !== "ACTIVE" || job.canonicalJobId) {
    await db.jobMatch.deleteMany({ where: { jobId } });
    return 0;
  }
  let cursor: string | undefined;
  let total = 0;
  const rows: { profileId: string; jobId: string; score: number; reasons: Prisma.InputJsonValue }[] = [];
  for (;;) {
    const batch = await db.bIMProfessionalProfile.findMany({ include: profileInclude, orderBy: { id: "asc" }, take: batchSize, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (!batch.length) break;
    cursor = batch[batch.length - 1].id;
    for (const p of batch) {
      const snap = snapshotFromProfile(p);
      if (!hasSignal(snap)) continue;
      const r = scoreJobMatch(snap, jobForScoring(job));
      rows.push({ profileId: p.id, jobId, score: r.total, reasons: reasonsJson(r) });
      total++;
    }
  }
  await db.$transaction([db.jobMatch.deleteMany({ where: { jobId } }), db.jobMatch.createMany({ data: rows })]);
  return total;
}
