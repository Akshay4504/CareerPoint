import { z } from "zod";
import { db } from "@/lib/db";
import { benchmarkById } from "@/lib/scoring/benchmark";
import { DEFAULT_ORDER, SECTION_KEYS, TEMPLATES, emptyResume, type ResumeContent } from "@/lib/resume/types";
import { profileToContent, saveResumeVersion } from "./profile";

const str = (max: number) => z.string().trim().max(max);
const optStr = (max: number) => str(max).optional().transform((v) => v || undefined);
const ym = z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal("").transform(() => undefined));

export const resumeContentSchema = z.object({
  name: optStr(100),
  email: optStr(254),
  phone: optStr(40),
  location: optStr(120),
  headline: optStr(140),
  summary: optStr(2000),
  yearsExperience: z.number().int().min(0).max(60).optional(),
  discipline: optStr(60),
  software: z.array(str(60)).max(40).default([]),
  skills: z.array(str(60)).max(60).default([]),
  certifications: z.array(str(200)).max(30).default([]),
  experiences: z.array(z.object({ title: str(160).min(1), company: str(160).min(1), location: optStr(120), startDate: ym, endDate: ym, current: z.boolean().optional(), description: optStr(4000) })).max(30).default([]),
  educations: z.array(z.object({ school: str(200).min(1), degree: optStr(120), field: optStr(120), startYear: z.number().int().optional(), endYear: z.number().int().optional() })).max(10).default([]),
  projects: z.array(z.object({ name: str(160).min(1), role: optStr(120), sector: optStr(60), lod: optStr(20), software: z.array(str(60)).max(15).optional(), year: z.number().int().optional(), description: optStr(3000), scale: optStr(120), outcomes: optStr(1000) })).max(20).default([]),
  links: z.array(str(300)).max(10).default([]),
  languages: z.array(z.object({ name: str(60).min(1), level: optStr(40) })).max(10).default([]),
  customSections: z.array(z.object({ id: str(40).min(1), title: str(80).min(1), body: str(4000) })).max(8).default([]),
  portfolio: z.array(z.object({ id: str(40), title: str(160), description: optStr(1000), url: optStr(300) })).max(24).default([]),
  layout: z
    .object({ template: z.enum(TEMPLATES.map((t) => t.id) as [string, ...string[]]).default("classic"), order: z.array(str(60)).max(30) })
    .optional(),
});

export function sanitizeContent(input: unknown): ResumeContent {
  const parsed = resumeContentSchema.parse(input);
  const customIds = new Set(parsed.customSections.map((c) => c.id));
  const layout = parsed.layout ?? { template: "classic", order: DEFAULT_ORDER };
  // Only known section keys and existing custom sections survive; duplicates collapse.
  const seen = new Set<string>();
  const order = layout.order.filter((k) => {
    const ok = ((SECTION_KEYS as readonly string[]).includes(k) || (k.startsWith("custom:") && customIds.has(k.slice(7)))) && !seen.has(k);
    seen.add(k);
    return ok;
  });
  return { ...emptyResume(), ...parsed, layout: { template: layout.template, order } } as ResumeContent;
}

export async function ownedResume(userId: string, resumeId: string) {
  return db.resume.findFirst({ where: { id: resumeId, profile: { userId } }, include: { profile: { select: { id: true } } } });
}

/**
 * Builds a targeted version from the MASTER PROFILE. The profile and any uploaded resume are never modified:
 * a new Resume record is created and ordering/selection is tuned to the target role's benchmark.
 */
export async function createTargetedResume(userId: string, opts: { title: string; targetRoleId: string }) {
  const profile = await db.bIMProfessionalProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error("Profile not found");
  const bench = benchmarkById(opts.targetRoleId);
  const c = await profileToContent(profile.id);
  const rank = (name: string, core: string[], common: string[]) => {
    const l = name.toLowerCase();
    return core.some((x) => x.toLowerCase() === l) ? 0 : common.some((x) => x.toLowerCase() === l) ? 1 : 2;
  };
  c.software = [...c.software].sort((a, b) => rank(a, bench.coreSoftware, bench.commonSoftware) - rank(b, bench.coreSoftware, bench.commonSoftware));
  const skillCore = [...bench.coreSkills, ...bench.standards];
  c.skills = [...c.skills].sort((a, b) => rank(a, skillCore, []) - rank(b, skillCore, []));
  const relevance = (p: ResumeContent["projects"][number]) => (p.software ?? []).filter((s) => [...bench.coreSoftware, ...bench.commonSoftware].map((x) => x.toLowerCase()).includes(s.toLowerCase())).length;
  c.projects = [...c.projects].sort((a, b) => relevance(b) - relevance(a));
  c.headline = c.headline ?? bench.label;
  c.layout = { template: "classic", order: bench.id === "manager" ? ["summary", "experience", "projects", "software", "skills", "certifications", "portfolio", "education", "languages"] : DEFAULT_ORDER };
  const resume = await db.resume.create({ data: { profileId: profile.id, title: opts.title.slice(0, 80), kind: "TARGETED", targetRole: bench.id } });
  await saveResumeVersion(resume.id, c, "targeted", undefined, { label: `Targeted: ${bench.label}` });
  return resume.id;
}

/** Saves editor output as a NEW version (history is kept; earlier versions are never overwritten). */
export async function saveResumeContent(userId: string, resumeId: string, input: unknown, label?: string) {
  const resume = await ownedResume(userId, resumeId);
  if (!resume) throw new Error("Resume not found");
  const content = sanitizeContent(input);
  await db.resume.update({ where: { id: resumeId }, data: { template: content.layout?.template ?? resume.template } });
  return saveResumeVersion(resumeId, content, "editor", undefined, { label });
}

export async function duplicateResume(userId: string, resumeId: string, title?: string) {
  const resume = await ownedResume(userId, resumeId);
  if (!resume?.currentVersionId) throw new Error("Resume not found");
  const v = await db.resumeVersion.findUniqueOrThrow({ where: { id: resume.currentVersionId } });
  const copy = await db.resume.create({ data: { profileId: resume.profileId, title: (title ?? `${resume.title} (copy)`).slice(0, 80), kind: "TARGETED", targetRole: resume.targetRole, template: resume.template } });
  await saveResumeVersion(copy.id, v.content as unknown as ResumeContent, "duplicate", v.rawText ?? undefined, { label: `Copied from ${resume.title}` });
  return copy.id;
}
