import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyEvent } from "@/lib/notifications/service";
import { recordView } from "@/lib/services/profile-views";
import { readPrivacy } from "@/lib/services/public-profile";
import { Forbidden, require_, type EmployerCtx } from "./permissions";
import { ApplicationError } from "@/lib/applications/candidate";
import { msAgo } from "@/lib/utils";
import { notifyCompany } from "@/lib/applications/candidate";

// Structured candidate search for employers. Only PUBLIC profiles are searchable, only by verified companies, and only
// public fields are returned. Private data (email, phone, resume files, salary expectations, hidden location) never is.

export type CandidateFilters = {
  q?: string;
  role?: string;
  discipline?: string;
  software?: string[];
  expMin?: number;
  expMax?: number;
  location?: string;
  availability?: string;
  openToWork?: boolean;
  certification?: string;
  hasPortfolio?: boolean;
  projectExperience?: string;
  page?: number;
  pageSize?: number;
};

const clean = (s?: string) => (s ?? "").trim().slice(0, 80);

export function buildCandidateWhere(f: CandidateFilters): Prisma.BIMProfessionalProfileWhereInput {
  const and: Prisma.BIMProfessionalProfileWhereInput[] = [{ visibility: "PUBLIC" }];
  if (f.q?.trim()) and.push({ OR: [{ headline: { contains: clean(f.q), mode: "insensitive" } }, { user: { name: { contains: clean(f.q), mode: "insensitive" } } }, { currentRole: { contains: clean(f.q), mode: "insensitive" } }] });
  if (f.role) and.push({ OR: [{ bimRoles: { has: clean(f.role) } }, { currentRole: { contains: clean(f.role), mode: "insensitive" } }, { headline: { contains: clean(f.role), mode: "insensitive" } }, { desiredRole: { contains: clean(f.role), mode: "insensitive" } }] });
  if (f.discipline) and.push({ OR: [{ discipline: clean(f.discipline) }, { bimDisciplines: { has: clean(f.discipline) } }] });
  for (const sw of (f.software ?? []).map(clean).filter(Boolean)) and.push({ softwareSkills: { some: { software: { equals: sw, mode: "insensitive" } } } });
  if (f.expMin != null) and.push({ yearsExperience: { gte: f.expMin } });
  if (f.expMax != null) and.push({ yearsExperience: { lte: f.expMax } });
  if (f.location) {
    const loc = clean(f.location);
    // A candidate who hides their location can only be found by country.
    and.push({ OR: [{ country: { contains: loc, mode: "insensitive" } }, { AND: [{ OR: [{ location: { contains: loc, mode: "insensitive" } }, { city: { contains: loc, mode: "insensitive" } }] }, { NOT: { privacy: { path: ["hideLocation"], equals: true } } }] }] });
  }
  if (f.availability) and.push({ availability: { equals: clean(f.availability), mode: "insensitive" } });
  if (f.openToWork) and.push({ openToWork: true });
  if (f.certification) and.push({ certifications: { some: { name: { contains: clean(f.certification), mode: "insensitive" } } } });
  if (f.hasPortfolio) and.push({ OR: [{ projects: { some: { published: true } } }, { portfolioItems: { some: { projectId: null } } }] });
  if (f.projectExperience) and.push({ projects: { some: { published: true, OR: [{ sector: { contains: clean(f.projectExperience), mode: "insensitive" } }, { name: { contains: clean(f.projectExperience), mode: "insensitive" } }, { discipline: { contains: clean(f.projectExperience), mode: "insensitive" } }] } } });
  return { AND: and };
}

export async function searchCandidates(ctx: EmployerCtx, f: CandidateFilters) {
  require_(ctx, "candidates.search");
  if (!ctx.verified) throw new Forbidden("The candidate directory unlocks once your company is verified.");
  const pageSize = Math.min(48, f.pageSize ?? 18);
  const page = Math.max(1, f.page ?? 1);
  const where = buildCandidateWhere(f);
  const [rows, total] = await Promise.all([
    db.bIMProfessionalProfile.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, slug: true, headline: true, location: true, country: true, yearsExperience: true, discipline: true, openToWork: true, availability: true, privacy: true, avatarFileId: true, user: { select: { name: true } }, softwareSkills: { take: 5, select: { software: true } }, _count: { select: { projects: { where: { published: true } } } } } }),
    db.bIMProfessionalProfile.count({ where }),
  ]);
  const out = rows.map((r) => {
    const p = readPrivacy(r.privacy);
    return { id: r.id, slug: r.slug, name: r.user.name, headline: r.headline, location: p.hideLocation ? r.country : r.location, yearsExperience: r.yearsExperience, discipline: r.discipline, openToWork: r.openToWork, availability: p.showPreferences ? r.availability : null, avatarFileId: r.avatarFileId, software: r.softwareSkills.map((s) => s.software), publishedProjects: r._count.projects };
  });
  return { rows: out, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

// ---- contact requests -----------------------------------------------------------------------------------------

export async function sendContactRequest(ctx: EmployerCtx, profileId: string, input: { message: string; jobId?: string | null }) {
  require_(ctx, "candidates.search");
  if (!ctx.verified) throw new Forbidden("Only verified companies can contact candidates.");
  const message = input.message.trim();
  if (message.length < 20 || message.length > 1500) throw new ApplicationError("Write a message of 20–1,500 characters so the candidate knows who you are and why you're reaching out.");
  const profile = await db.bIMProfessionalProfile.findFirst({ where: { id: profileId, visibility: "PUBLIC" }, select: { id: true, userId: true, user: { select: { name: true } } } });
  if (!profile) throw new ApplicationError("Candidate not found.");
  if (await db.contactRequest.findFirst({ where: { companyId: ctx.companyId, profileId, status: "PENDING" }, select: { id: true } })) throw new ApplicationError("You already have a pending request to this candidate.");
  if ((await db.contactRequest.count({ where: { companyId: ctx.companyId, createdAt: { gt: msAgo(86400_000) } } })) >= 10) throw new ApplicationError("Daily contact request limit reached.");
  let jobId: string | null = null;
  if (input.jobId) jobId = (await db.job.findFirst({ where: { id: input.jobId, companyId: ctx.companyId }, select: { id: true } }))?.id ?? null;
  const req = await db.contactRequest.create({ data: { companyId: ctx.companyId, senderId: ctx.userId, profileId, jobId, message } });
  await recordView({ profileId, kind: "CONTACT_REQUEST", viewerUserId: ctx.userId, viewerCompanyId: ctx.companyId, meta: { requestId: req.id }, dedupeHours: 0 });
  await audit(ctx.userId, "contact.requested", "ContactRequest", req.id, { companyId: ctx.companyId, profileId });
  await notifyEvent(profile.userId, "contact.request", { title: `${ctx.companyName} would like to contact you`, body: message.slice(0, 160), href: "/notifications" });
  return req;
}

/** The candidate decides. Their email is only shared with the company if they accept. */
export async function respondContactRequest(userId: string, requestId: string, accept: boolean) {
  const req = await db.contactRequest.findFirst({ where: { id: requestId, profile: { userId }, status: "PENDING" }, include: { company: { select: { id: true, name: true } }, profile: { select: { user: { select: { name: true, email: true } } } } } });
  if (!req) throw new ApplicationError("Request not found or already answered.");
  await db.contactRequest.update({ where: { id: req.id }, data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() } });
  await audit(userId, accept ? "contact.accepted" : "contact.declined", "ContactRequest", req.id, { companyId: req.companyId });
  await notifyCompany(req.companyId, "contact.response", { title: `${req.profile.user.name} ${accept ? "accepted" : "declined"} your contact request`, body: accept ? `You can reach them at ${req.profile.user.email}.` : undefined, href: "/employer/candidates?contacts=1" });
}

export async function listContactRequests(ctx: EmployerCtx) {
  require_(ctx, "candidates.search");
  const rows = await db.contactRequest.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 100, include: { profile: { select: { slug: true, user: { select: { name: true, email: true } } } } } });
  // Email is included ONLY for requests the candidate accepted.
  return rows.map((r) => ({ id: r.id, status: r.status, message: r.message, createdAt: r.createdAt, name: r.profile.user.name, slug: r.profile.slug, email: r.status === "ACCEPTED" ? r.profile.user.email : null }));
}
