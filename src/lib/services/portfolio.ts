import { z } from "zod";
import { db } from "@/lib/db";
import { deleteStored, saveUpload } from "@/lib/files/storage";
import { BIM_SOFTWARE, DISCIPLINES, LOD_LEVELS, SECTORS, canonicalize } from "@/lib/taxonomy";

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

export const projectSchema = z.object({
  name: z.string().trim().min(2, "Enter the project name").max(160),
  client: opt(160),
  clientPublic: z.boolean().default(false),
  sector: z.enum(SECTORS).optional().or(z.literal("").transform(() => undefined)),
  discipline: z.enum(DISCIPLINES).optional().or(z.literal("").transform(() => undefined)),
  role: opt(120),
  software: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  lod: z.enum(LOD_LEVELS).optional().or(z.literal("").transform(() => undefined)),
  scale: opt(160),
  location: opt(120),
  year: z.number().int().min(1990).max(2100).optional(),
  responsibilities: opt(3000),
  challenges: opt(3000),
  solutions: opt(3000),
  outcomes: opt(3000),
  description: opt(3000),
});
export type ProjectInput = z.input<typeof projectSchema>;

const MAX_PROJECTS = 30;
const MAX_IMAGES_PER_PROJECT = 8;

async function profileOf(userId: string) {
  const p = await db.bIMProfessionalProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!p) throw new Error("Profile not found");
  return p;
}

function toData(parsed: z.output<typeof projectSchema>) {
  return {
    name: parsed.name,
    client: parsed.client ?? null,
    clientPublic: parsed.clientPublic && !!parsed.client,
    sector: parsed.sector ?? null,
    discipline: parsed.discipline ?? null,
    role: parsed.role ?? null,
    software: parsed.software.map((s) => canonicalize(s, BIM_SOFTWARE)),
    lod: parsed.lod ?? null,
    scale: parsed.scale ?? null,
    location: parsed.location ?? null,
    year: parsed.year ?? null,
    responsibilities: parsed.responsibilities ?? null,
    challenges: parsed.challenges ?? null,
    solutions: parsed.solutions ?? null,
    outcomes: parsed.outcomes ?? null,
    description: parsed.description ?? null,
  };
}

/** A project can go public only when it says something substantive. */
export function publishBlockers(p: { name: string; role: string | null; description: string | null; responsibilities: string | null; outcomes: string | null }): string[] {
  const out: string[] = [];
  if (!p.role) out.push("Add your role");
  if (!(p.description || p.responsibilities || p.outcomes)) out.push("Add a description, responsibilities or outcomes");
  return out;
}

export async function createProject(userId: string, input: unknown) {
  const profile = await profileOf(userId);
  if ((await db.project.count({ where: { profileId: profile.id } })) >= MAX_PROJECTS) throw new Error(`Projects are limited to ${MAX_PROJECTS}.`);
  return db.project.create({ data: { ...toData(projectSchema.parse(input)), profileId: profile.id } });
}

export async function updateProject(userId: string, id: string, input: unknown) {
  const profile = await profileOf(userId);
  const r = await db.project.updateMany({ where: { id, profileId: profile.id }, data: toData(projectSchema.parse(input)) });
  if (!r.count) throw new Error("Project not found");
  // Edits to a published project that make it unpublishable pull it back to draft.
  const p = await db.project.findUniqueOrThrow({ where: { id } });
  if (p.published && publishBlockers(p).length) await db.project.update({ where: { id }, data: { published: false } });
}

export async function setProjectPublished(userId: string, id: string, published: boolean) {
  const profile = await profileOf(userId);
  const p = await db.project.findFirst({ where: { id, profileId: profile.id } });
  if (!p) throw new Error("Project not found");
  if (published) {
    const blockers = publishBlockers(p);
    if (blockers.length) throw new Error(`Can't publish yet: ${blockers.join("; ")}.`);
  }
  await db.project.update({ where: { id }, data: { published } });
}

export async function deleteProject(userId: string, id: string) {
  const profile = await profileOf(userId);
  const p = await db.project.findFirst({ where: { id, profileId: profile.id }, include: { portfolio: true } });
  if (!p) throw new Error("Project not found");
  const fileIds = p.portfolio.map((i) => i.fileId).filter((x): x is string => !!x);
  await db.project.delete({ where: { id } });
  for (const f of fileIds) await deleteStored(f);
}

export async function addProjectImage(userId: string, projectId: string, file: File | null, title?: string) {
  const profile = await profileOf(userId);
  const p = await db.project.findFirst({ where: { id: projectId, profileId: profile.id }, include: { _count: { select: { portfolio: true } } } });
  if (!p) throw new Error("Project not found");
  if (p._count.portfolio >= MAX_IMAGES_PER_PROJECT) throw new Error(`Up to ${MAX_IMAGES_PER_PROJECT} images per project.`);
  const res = await saveUpload({ ownerId: userId, kind: "PORTFOLIO_IMAGE", file });
  if (!res.ok) throw new Error(res.error);
  return db.portfolioItem.create({ data: { profileId: profile.id, projectId, kind: "IMAGE", title: (title || p.name).slice(0, 120), fileId: res.fileId, sortOrder: Date.now() % 2_000_000_000 } });
}

export async function removeProjectImage(userId: string, itemId: string) {
  const profile = await profileOf(userId);
  const item = await db.portfolioItem.findFirst({ where: { id: itemId, profileId: profile.id } });
  if (!item) throw new Error("Image not found");
  await db.portfolioItem.delete({ where: { id: itemId } });
  if (item.fileId) await deleteStored(item.fileId);
}
