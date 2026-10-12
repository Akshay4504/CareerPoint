import { afterAll, describe, expect, it } from "vitest";
import { cleanup, makeUser, SAMPLE } from "./helpers";
import { db } from "@/lib/db";
import { decideSuggestion, requestSuggestion } from "@/lib/services/ai";
import { validateAiOutput } from "@/lib/ai/guard";
import type { AiProvider } from "@/lib/ai/provider";
import { createImport, applyImport } from "@/lib/services/imports";
import { createTargetedResume, duplicateResume, sanitizeContent, saveResumeContent } from "@/lib/services/resumes";
import { privacySchema } from "@/lib/services/public-profile";
import { emptyResume, type ResumeContent } from "@/lib/resume/types";

afterAll(cleanup);

const fake = (reply: string): AiProvider & { calls: { system: string; user: string }[] } => {
  const calls: { system: string; user: string }[] = [];
  return { name: "fake", model: "fake-1", calls, complete: async (system, user) => (calls.push({ system, user }), reply) };
};

async function candidateWithResume(label: string) {
  const { user, profile } = await makeUser(label);
  const imp = await createImport(profile.id, SAMPLE);
  const c = imp.extracted as unknown as ResumeContent;
  const resumeId = await applyImport(user.id, imp.id, { scalars: { summary: c.summary ?? "" }, experiences: c.experiences, educations: c.educations, projects: c.projects, certifications: c.certifications, software: c.software, skills: c.skills, languages: c.languages ?? [] });
  return { user, profile, resumeId, content: c };
}

describe("AI guard (deterministic fabrication checks)", () => {
  const source = "Coordinated 6 disciplines on 3 hospitals using Navisworks; resolved 4,200 clashes.";
  it("passes output that only reuses the user's facts", () => {
    expect(validateAiOutput(source, "Coordinated 6 disciplines across 3 hospitals in Navisworks, resolving 4,200 clashes.")).toEqual([]);
  });
  it("blocks invented numbers, tools, skills and certifications", () => {
    const f = validateAiOutput(source, "Coordinated 12 disciplines on 3 hospitals using Navisworks and Solibri, reducing cost by 30% with ISO 19650 certified COBie delivery.");
    const msgs = f.map((x) => x.message).join(" ");
    expect(f.every((x) => x.severity === "block" || x.severity === "warn")).toBe(true);
    expect(msgs).toMatch(/12/);
    expect(msgs).toMatch(/30%/);
    expect(msgs).toMatch(/Solibri/);
    expect(msgs).toMatch(/ISO 19650/);
    expect(f.some((x) => x.severity === "block")).toBe(true);
  });
  it("allows tools already on the profile", () => {
    expect(validateAiOutput(source, "Coordinated 6 disciplines in Navisworks, with Revit models.", ["Revit"])).toEqual([]);
  });
});

describe("AI approval flow", () => {
  it("creates a pending suggestion and changes NOTHING until approved", async () => {
    const { user, resumeId } = await candidateWithResume("ai-pending");
    const before = await db.resumeVersion.count({ where: { resumeId } });
    const provider = fake("Coordinated six disciplines across 3 hospital projects.");
    const s = await requestSuggestion(user.id, provider, { kind: "improve-bullet", text: "Led coordination of 6 disciplines across 3 hospital projects, resolving 4,200 clashes", target: { type: "resume.bullet", resumeId, experienceIndex: 0, original: "Led coordination of 6 disciplines across 3 hospital projects, resolving 4,200 clashes" } });
    expect(s.status).toBe("PENDING");
    expect(s.model).toBe("fake-1");
    expect(await db.resumeVersion.count({ where: { resumeId } })).toBe(before);
    // The prompt contains only the user's text and tells the model not to invent anything.
    expect(provider.calls[0].system).toMatch(/Never add/i);
    expect(provider.calls[0].user).toContain("4,200 clashes");
  });

  it("approval applies the text as a NEW version; the previous version stays intact", async () => {
    const { user, resumeId } = await candidateWithResume("ai-approve");
    const original = "Led coordination of 6 disciplines across 3 hospital projects, resolving 4,200 clashes";
    const s = await requestSuggestion(user.id, fake("Led coordination of 6 disciplines across 3 hospital projects, resolving 4,200 clashes in Navisworks."), { kind: "improve-bullet", text: original, target: { type: "resume.bullet", resumeId, experienceIndex: 0, original } });
    const v1 = await db.resumeVersion.findFirstOrThrow({ where: { resumeId }, orderBy: { version: "desc" } });
    const r = await decideSuggestion(user.id, s.id, "approve");
    expect(r.applied).toBe(true);
    const versions = await db.resumeVersion.findMany({ where: { resumeId }, orderBy: { version: "asc" } });
    expect(versions.length).toBe(v1.version + 1);
    expect(JSON.stringify(versions[versions.length - 2].content)).toBe(JSON.stringify(v1.content)); // untouched
    expect((versions[versions.length - 1].content as unknown as ResumeContent).experiences[0].description).toContain("in Navisworks.");
    expect(versions[versions.length - 1].label).toMatch(/approved by you/);
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("APPROVED");
    await expect(decideSuggestion(user.id, s.id, "approve")).rejects.toThrow(/already decided/); // cannot apply twice
  });

  it("rejection discards the suggestion and leaves data untouched", async () => {
    const { user, profile } = await candidateWithResume("ai-reject");
    const before = (await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profile.id } })).summary;
    const s = await requestSuggestion(user.id, fake("A brand new summary."), { kind: "rewrite-summary", text: before ?? "BIM coordinator with 8+ years of experience.", target: { type: "profile.summary" } });
    await decideSuggestion(user.id, s.id, "reject");
    expect((await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profile.id } })).summary).toBe(before);
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("REJECTED");
  });

  it("outputs that fabricate facts are flagged and CANNOT be approved; editing them out unblocks approval", async () => {
    const { user, profile } = await candidateWithResume("ai-block");
    const s = await requestSuggestion(user.id, fake("Coordinated 40 disciplines and cut costs by 35% using Tekla Structures."), { kind: "achievement-from-facts", text: "I coordinated disciplines on hospital projects", target: { type: "profile.summary" } });
    const flags = s.flags as unknown as { severity: string; message: string }[];
    expect(flags.some((f) => f.severity === "block")).toBe(true);
    const before = (await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profile.id } })).summary;
    await expect(decideSuggestion(user.id, s.id, "approve")).rejects.toThrow(/Cannot approve/);
    await expect(decideSuggestion(user.id, s.id, "approve", "Coordinated 40 disciplines.")).rejects.toThrow(/Cannot approve/); // still invented
    expect((await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profile.id } })).summary).toBe(before);
    const ok = await decideSuggestion(user.id, s.id, "approve", "Coordinated disciplines on hospital projects.");
    expect(ok.applied).toBe(true);
    expect((await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profile.id } })).summary).toBe("Coordinated disciplines on hospital projects.");
  });

  it("advice kinds never modify the resume or profile", async () => {
    const { user, profile } = await candidateWithResume("ai-advice");
    const company = await db.company.create({ data: { name: `adv-${Date.now()}`, slug: `adv-${Date.now()}`, verified: true } });
    const job = await db.job.create({ data: { slug: `adv-job-${Date.now()}`, title: "BIM Manager", companyName: company.name, companyId: company.id, description: "Needs ISO 19650 and Civil 3D. ".repeat(5), software: ["Civil 3D"], skills: ["ISO 19650"], status: "ACTIVE" } });
    const versionsBefore = await db.resumeVersion.count({ where: { resume: { profileId: profile.id } } });
    const s = await requestSuggestion(user.id, fake("ISO 19650 matters because clients require it. Consider a short course."), { kind: "explain-missing", jobId: job.id });
    expect(s.targetType).toBe("advice");
    const r = await decideSuggestion(user.id, s.id, "approve");
    expect(r.applied).toBe(false);
    expect(await db.resumeVersion.count({ where: { resume: { profileId: profile.id } } })).toBe(versionsBefore);
    await db.job.delete({ where: { id: job.id } });
    await db.company.delete({ where: { id: company.id } });
  });

  it("users cannot decide each other's suggestions", async () => {
    const a = await candidateWithResume("ai-own-a");
    const b = await makeUser("ai-own-b");
    const s = await requestSuggestion(a.user.id, fake("Fine summary."), { kind: "rewrite-summary", text: "BIM coordinator with 8+ years.", target: { type: "profile.summary" } });
    await expect(decideSuggestion(b.user.id, s.id, "approve")).rejects.toThrow();
    await expect(decideSuggestion(b.user.id, s.id, "reject")).rejects.toThrow();
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("PENDING");
  });
});

describe("resume builder", () => {
  it("creates targeted versions from the master profile without touching it or the original resume", async () => {
    const { user, profile, resumeId } = await candidateWithResume("bld-target");
    const profileBefore = JSON.stringify(await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profile.id }, include: { experiences: { orderBy: { id: "asc" } }, softwareSkills: { orderBy: { id: "asc" } } } }));
    const originalBefore = JSON.stringify((await db.resumeVersion.findMany({ where: { resumeId } })).map((v) => v.content));
    const id = await createTargetedResume(user.id, { title: "BIM Manager Resume", targetRoleId: "manager" });
    const r = await db.resume.findUniqueOrThrow({ where: { id }, include: { versions: true } });
    expect(r.kind).toBe("TARGETED");
    expect(r.targetRole).toBe("manager");
    const c = r.versions[0].content as unknown as ResumeContent;
    expect(c.layout?.order.indexOf("projects")).toBeLessThan(c.layout!.order.indexOf("software")); // manager layout leads with projects
    // Only things from the master profile appear — nothing invented.
    const master = await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profile.id }, include: { softwareSkills: true } });
    expect(c.software.every((s) => master.softwareSkills.some((m) => m.software === s))).toBe(true);
    expect(JSON.stringify(await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profile.id }, include: { experiences: { orderBy: { id: "asc" } }, softwareSkills: { orderBy: { id: "asc" } } } }))).toBe(profileBefore);
    expect(JSON.stringify((await db.resumeVersion.findMany({ where: { resumeId } })).map((v) => v.content))).toBe(originalBefore);
  });

  it("saves editor output as a new version with a fresh score; history is kept", async () => {
    const { user, resumeId, content } = await candidateWithResume("bld-edit");
    const edited: ResumeContent = { ...content, headline: "Edited headline", customSections: [{ id: "c1", title: "Publications", body: "Paper on federated models." }], layout: { template: "modern", order: ["summary", "experience", "custom:c1", "skills", "bogus", "summary"] } };
    const { version, score } = await saveResumeContent(user.id, resumeId, edited, "Editor save");
    expect(version.version).toBe(2);
    expect(score.total).toBeGreaterThan(0);
    const saved = version.content as unknown as ResumeContent;
    expect(saved.layout?.template).toBe("modern");
    expect(saved.layout?.order).toEqual(["summary", "experience", "custom:c1", "skills"]); // unknown + duplicate keys removed
    expect((await db.resume.findUniqueOrThrow({ where: { id: resumeId } })).template).toBe("modern");
    const first = await db.resumeVersion.findFirstOrThrow({ where: { resumeId, version: 1 } });
    expect((first.content as unknown as ResumeContent).headline).not.toBe("Edited headline");
  });

  it("rejects invalid editor payloads and other users' resumes", async () => {
    const a = await candidateWithResume("bld-a");
    const b = await makeUser("bld-b");
    await expect(saveResumeContent(a.user.id, a.resumeId, { ...a.content, summary: "x".repeat(3000) })).rejects.toThrow();
    await expect(saveResumeContent(a.user.id, a.resumeId, { ...a.content, layout: { template: "neon", order: [] } })).rejects.toThrow();
    await expect(saveResumeContent(b.user.id, a.resumeId, a.content)).rejects.toThrow(/not found/);
    await expect(duplicateResume(b.user.id, a.resumeId)).rejects.toThrow(/not found/);
  });

  it("duplicates a version into an independent resume", async () => {
    const { user, resumeId, content } = await candidateWithResume("bld-dup");
    const copyId = await duplicateResume(user.id, resumeId, "Copy for Dubai");
    expect(copyId).not.toBe(resumeId);
    await saveResumeContent(user.id, copyId, { ...content, headline: "Dubai headline" });
    const orig = await db.resume.findUniqueOrThrow({ where: { id: resumeId }, include: { versions: true } });
    expect(orig.versions.every((v) => (v.content as unknown as ResumeContent).headline !== "Dubai headline")).toBe(true);
  });

  it("sanitizeContent strips unknown keys and enforces limits", () => {
    const c = sanitizeContent({ ...emptyResume(), name: "A", evil: "<script>", layout: { template: "classic", order: ["summary", "custom:nope"] } }) as unknown as Record<string, unknown>;
    expect(c.evil).toBeUndefined();
    expect((c.layout as { order: string[] }).order).toEqual(["summary"]);
  });
});

describe("profile editing", () => {
  it("persists expanded profile fields, languages and privacy", async () => {
    const { profile } = await makeUser("edit-profile");
    await db.bIMProfessionalProfile.update({
      where: { id: profile.id },
      data: { city: "Dubai", currentRole: "BIM Manager", industries: ["Healthcare"], projectTypes: ["Hospitals"], bimDisciplines: ["MEP"], bimRoles: ["BIM Coordinator"], bimResponsibilities: ["Ran clash workshops"], bimStandards: ["ISO 19650"], lodLevels: ["LOD 350"], infoMgmtYears: 3, coordinationYears: 5, modelingYears: 4, vdcYears: 1, achievements: ["Saved 120 hours"], preferredRoles: ["BIM Manager"], preferredLocations: ["Dubai"], employmentTypes: ["Full-time"], minSalary: 90000, salaryCurrency: "USD", availability: "Immediately", privacy: { hideLocation: true } },
    });
    await db.language.create({ data: { profileId: profile.id, name: "English", level: "Native" } });
    const p = await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profile.id }, include: { languages: true } });
    expect(p).toMatchObject({ city: "Dubai", currentRole: "BIM Manager", coordinationYears: 5, minSalary: 90000 });
    expect(p.bimStandards).toEqual(["ISO 19650"]);
    expect(p.languages[0].name).toBe("English");
    expect(privacySchema.parse(p.privacy)).toEqual({ hideLocation: true, showResume: false, showAchievements: true, showPreferences: false });
  });
});
