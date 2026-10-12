import { afterAll, describe, expect, it } from "vitest";
import { cleanup, makeUser, SAMPLE, txtFile } from "./helpers";
import { db } from "@/lib/db";
import { saveUpload } from "@/lib/files/storage";
import { extractText } from "@/lib/resume/extract";
import { applyImport, createImport, diffScalars, discardImport, type ImportSelection } from "@/lib/services/imports";
import { emptyResume, type ResumeContent } from "@/lib/resume/types";
import { parseResumeText } from "@/lib/resume/parse";
import { readFile } from "node:fs/promises";
import path from "node:path";

afterAll(cleanup);

const select = (c: ResumeContent, over: Partial<ImportSelection> = {}): ImportSelection => ({ scalars: {}, experiences: c.experiences, educations: c.educations, projects: c.projects, certifications: c.certifications, software: c.software, skills: c.skills, languages: c.languages ?? [], ...over });

describe("resume upload", () => {
  it("stores accepted files privately, outside any public path, and records metadata", async () => {
    const { user } = await makeUser("upload");
    const r = await saveUpload({ ownerId: user.id, kind: "RESUME", file: txtFile("cv.txt", SAMPLE) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const asset = await db.fileAsset.findUniqueOrThrow({ where: { id: r.fileId } });
    expect(asset.visibility).toBe("PRIVATE");
    expect(asset.mime).toBe("text/plain");
    expect(asset.storageKey).toMatch(/^resume\/.+\.txt$/);
    expect(asset.storageKey).not.toMatch(/\.\./);
    const onDisk = await readFile(path.join(process.env.STORAGE_DIR!, asset.storageKey), "utf8");
    expect(onDisk).toBe(SAMPLE);
    expect(await extractText(r.buffer, r.mime)).toContain("Senior BIM Coordinator");
  });

  it("rejects executables, empty files and oversize uploads", async () => {
    const { user } = await makeUser("upload-bad");
    const exe = new File([Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 1)])], "cv.pdf", { type: "application/pdf" });
    expect((await saveUpload({ ownerId: user.id, kind: "RESUME", file: exe })).ok).toBe(false);
    expect((await saveUpload({ ownerId: user.id, kind: "RESUME", file: new File([], "empty.txt") })).ok).toBe(false);
    expect((await saveUpload({ ownerId: user.id, kind: "RESUME", file: new File(["a".repeat(6 * 1024 * 1024)], "big.txt", { type: "text/plain" }) })).ok).toBe(false);
    expect(await db.fileAsset.count({ where: { ownerId: user.id } })).toBe(0);
  });
});

describe("resume extraction → review → profile", () => {
  it("extracts structured data (contact, roles, dates, software, certifications, education, languages, projects)", () => {
    const c = parseResumeText(SAMPLE);
    expect(c.name).toBe("Jane Doe");
    expect(c.email).toBe("jane.doe@example.com");
    expect(c.experiences.map((e) => e.company)).toEqual(["Alpha Engineering", "Beta Consultants"]);
    expect(c.experiences[0]).toMatchObject({ startDate: "2019-03", current: true });
    expect(c.software).toEqual(expect.arrayContaining(["Revit", "Navisworks", "Dynamo", "Solibri"]));
    expect(c.certifications).toContain("Autodesk Certified Professional: Revit");
    expect(c.educations[0].endYear).toBe(2015);
    expect(c.languages).toEqual(expect.arrayContaining([{ name: "English", level: "native" }, { name: "Hindi", level: "fluent" }]));
    expect(c.projects[0].lod).toBe("LOD 400");
  });

  it("stages the extraction and leaves the profile untouched until approval", async () => {
    const { user, profile } = await makeUser("stage");
    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { headline: "My own headline", location: "Paris, France" } });
    const imp = await createImport(profile.id, SAMPLE);
    expect(imp.status).toBe("PENDING");
    const after = await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profile.id }, include: { experiences: true, softwareSkills: true } });
    expect(after.headline).toBe("My own headline");
    expect(after.experiences).toHaveLength(0);
    expect(after.softwareSkills).toHaveLength(0);
    expect(await db.resume.count({ where: { profileId: profile.id } })).toBe(0);

    // The review UI flags conflicts instead of overwriting.
    const diff = diffScalars(imp.extracted as unknown as ResumeContent, { headline: after.headline, summary: after.summary, location: after.location, yearsExperience: after.yearsExperience, discipline: after.discipline });
    expect(diff.scalars.find((s) => s.key === "headline")?.status).toBe("different");
    expect(diff.scalars.find((s) => s.key === "summary")?.status).toBe("new");
    void user;
  });

  it("applies only what the user selected and never overwrites unselected data", async () => {
    const { user, profile } = await makeUser("apply");
    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { headline: "Keep me", summary: "Old summary" } });
    await db.softwareSkill.create({ data: { profileId: profile.id, software: "Revit", level: "EXPERT", years: 9 } });
    const imp = await createImport(profile.id, SAMPLE);
    const c = imp.extracted as unknown as ResumeContent;
    // User ticks the new summary only (edited), skips headline, and approves one role.
    const resumeId = await applyImport(user.id, imp.id, select(c, { scalars: { summary: "Edited summary by user" }, experiences: [c.experiences[0]], projects: [], educations: [], languages: [] }));

    const p = await db.bIMProfessionalProfile.findUniqueOrThrow({ where: { id: profile.id }, include: { experiences: true, softwareSkills: true, educations: true } });
    expect(p.headline).toBe("Keep me");
    expect(p.summary).toBe("Edited summary by user");
    expect(p.experiences).toHaveLength(1);
    expect(p.educations).toHaveLength(0);
    // Existing proficiency is preserved; new tools are added with defaults.
    expect(p.softwareSkills.find((s) => s.software === "Revit")).toMatchObject({ level: "EXPERT", years: 9 });
    expect(p.softwareSkills.map((s) => s.software)).toContain("Navisworks");

    const resume = await db.resume.findUniqueOrThrow({ where: { id: resumeId }, include: { versions: { include: { scores: true } } } });
    expect(resume.kind).toBe("UPLOADED");
    expect((resume.versions[0].content as unknown as ResumeContent).experiences).toHaveLength(1); // exactly what was approved
    expect(resume.versions[0].scores[0].total).toBeGreaterThan(0);
    expect((await db.resumeImport.findUniqueOrThrow({ where: { id: imp.id } })).status).toBe("APPLIED");
  });

  it("skips duplicates when applied twice and rejects re-use of a processed import", async () => {
    const { user, profile } = await makeUser("dupe");
    const first = await createImport(profile.id, SAMPLE);
    const c = first.extracted as unknown as ResumeContent;
    await applyImport(user.id, first.id, select(c));
    const second = await createImport(profile.id, SAMPLE);
    await applyImport(user.id, second.id, select(second.extracted as unknown as ResumeContent));
    expect(await db.experience.count({ where: { profileId: profile.id } })).toBe(2);
    expect(await db.certification.count({ where: { profileId: profile.id } })).toBe(1);
    expect(await db.language.count({ where: { profileId: profile.id } })).toBe(2);
    await expect(applyImport(user.id, first.id, select(c))).rejects.toThrow();
  });

  it("does not let another user apply or discard someone else's import", async () => {
    const a = await makeUser("owner-imp");
    const b = await makeUser("intruder-imp");
    const imp = await createImport(a.profile.id, SAMPLE);
    await expect(applyImport(b.user.id, imp.id, select(emptyResume()))).rejects.toThrow();
    expect(await discardImport(b.user.id, imp.id)).toBe(false);
    expect((await db.resumeImport.findUniqueOrThrow({ where: { id: imp.id } })).status).toBe("PENDING");
    expect(await discardImport(a.user.id, imp.id)).toBe(true);
  });
});
