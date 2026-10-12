import { z } from "zod";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { isEmployerRole, isStaff } from "@/lib/auth/rbac";
import type { ResumeContent } from "@/lib/resume/types";

export const privacySchema = z.object({
  hideLocation: z.boolean().default(false), // show country only, not city/region
  showResume: z.boolean().default(false), // expose the chosen resume's content (never contact details)
  showAchievements: z.boolean().default(true),
  showPreferences: z.boolean().default(false), // preferred roles / locations / availability (salary is never public)
});
export type Privacy = z.infer<typeof privacySchema>;

export const readPrivacy = (raw: unknown): Privacy => privacySchema.parse(raw && typeof raw === "object" ? raw : {});

export type Viewer = { id: string; role: Role; employerUsers: { companyId: string; company: { verified: boolean } }[] } | null;

/**
 * Single place that decides what a viewer may see of a profile.
 * Returns null when the viewer must get a 404 (private profile, not owner/staff).
 */
export async function getPublicProfile(slug: string, viewer: Viewer, opts: { viaShare?: boolean } = {}) {
  const p = await db.bIMProfessionalProfile.findUnique({
    where: { slug },
    include: {
      user: { select: { name: true } },
      experiences: { orderBy: [{ current: "desc" }, { startDate: "desc" }] },
      educations: { orderBy: { endYear: "desc" } },
      skills: { include: { skill: true } },
      softwareSkills: { orderBy: [{ years: "desc" }, { software: "asc" }] },
      certifications: true,
      languages: true,
      projects: { where: { published: true }, orderBy: [{ year: "desc" }, { createdAt: "desc" }], include: { portfolio: { orderBy: { sortOrder: "asc" } } } },
      portfolioItems: { where: { projectId: null }, orderBy: { sortOrder: "desc" } },
    },
  });
  if (!p) return null;
  const isOwner = viewer?.id === p.userId;
  const staff = !!viewer && isStaff(viewer.role);
  // A private profile is reachable only by its owner, staff, or through a share link the caller has already verified.
  if (p.visibility !== "PUBLIC" && !isOwner && !staff && !opts.viaShare) return null;

  const privacy = readPrivacy(p.privacy);
  const verifiedEmployer = !!viewer && isEmployerRole(viewer.role) && viewer.employerUsers.some((m) => m.company.verified);
  const seesPrivate = isOwner; // owner sees everything, staff see what the public sees

  let resume: ResumeContent | null = null;
  if (p.publicResumeId && (privacy.showResume || seesPrivate)) {
    const r = await db.resume.findFirst({ where: { id: p.publicResumeId, profileId: p.id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    const content = r?.versions[0]?.content as unknown as ResumeContent | undefined;
    if (content) resume = { ...content, email: undefined, phone: undefined, links: [] }; // contact details are never public
  }

  // Private fields never leave this service, not even for the owner's public view.
  const { minSalary: _minSalary, salaryCurrency: _salaryCurrency, ...safe } = p;
  return {
    isOwner,
    profile: safe,
    privacy,
    canSeeOpenToWork: isOwner || verifiedEmployer || staff,
    verifiedCompanyId: verifiedEmployer ? viewer!.employerUsers.find((m) => m.company.verified)!.companyId : null,
    location: privacy.hideLocation && !seesPrivate ? (p.country ?? null) : (p.location ?? ([p.city, p.country].filter(Boolean).join(", ") || null)),
    achievements: privacy.showAchievements || seesPrivate ? p.achievements : [],
    preferences: privacy.showPreferences || seesPrivate ? { preferredRoles: p.preferredRoles, preferredLocations: p.preferredLocations, employmentTypes: p.employmentTypes, remotePreference: p.remotePreference, availability: p.availability } : null,
    resume,
    projects: p.projects.map((x) => ({ ...x, client: x.clientPublic ? x.client : null })),
  };
}
