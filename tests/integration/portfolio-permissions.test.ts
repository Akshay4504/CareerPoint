import { afterAll, describe, expect, it } from "vitest";
import { asViewer, cleanup, makeEmployer, makeUser } from "./helpers";
import { db } from "@/lib/db";
import { addProjectImage, createProject, deleteProject, publishBlockers, removeProjectImage, setProjectPublished, updateProject } from "@/lib/services/portfolio";
import { canReadFile } from "@/lib/files/access";
import { saveUpload } from "@/lib/files/storage";
import { getPublicProfile } from "@/lib/services/public-profile";
import { ownedResume } from "@/lib/services/resumes";
import { saveResumeVersion } from "@/lib/services/profile";
import { emptyResume } from "@/lib/resume/types";
import { readFile } from "node:fs/promises";
import path from "node:path";

afterAll(cleanup);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const png = (n = "p.png") => new File([PNG], n, { type: "image/png" });

const goodProject = { name: "Hospital Tower", role: "BIM Coordinator", sector: "Healthcare", discipline: "MEP", software: ["revit", "Navisworks"], lod: "LOD 400", scale: "85,000 m²", description: "Coordinated 9 trades.", outcomes: "Zero clashes at handover", client: "NHS Trust", clientPublic: false };

describe("portfolio projects", () => {
  it("creates, edits and canonicalises software", async () => {
    const { user } = await makeUser("pf1");
    const p = await createProject(user.id, goodProject);
    expect(p.software).toEqual(["Revit", "Navisworks"]);
    expect(p.published).toBe(false);
    await updateProject(user.id, p.id, { ...goodProject, name: "Hospital Tower B" });
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).name).toBe("Hospital Tower B");
  });

  it("validates input", async () => {
    const { user } = await makeUser("pf-val");
    await expect(createProject(user.id, { name: "x" })).rejects.toThrow();
    await expect(createProject(user.id, { ...goodProject, lod: "LOD 999" })).rejects.toThrow();
  });

  it("only publishes substantive projects and unpublishes them if edits remove the substance", async () => {
    const { user } = await makeUser("pf-pub");
    const empty = await createProject(user.id, { name: "Bare project" });
    expect(publishBlockers(empty).length).toBeGreaterThan(0);
    await expect(setProjectPublished(user.id, empty.id, true)).rejects.toThrow(/Can't publish/);
    const p = await createProject(user.id, goodProject);
    await setProjectPublished(user.id, p.id, true);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).published).toBe(true);
    await updateProject(user.id, p.id, { name: "Hospital Tower" }); // strips role/description/outcomes
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).published).toBe(false);
    await setProjectPublished(user.id, p.id, false); // unpublish is always allowed
  });

  it("never exposes the client unless clientPublic is set", async () => {
    const { user, profile } = await makeUser("pf-client");
    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { visibility: "PUBLIC" } });
    const p = await createProject(user.id, goodProject);
    await setProjectPublished(user.id, p.id, true);
    let v = await getPublicProfile(profile.slug, null);
    expect(v!.projects[0].client).toBeNull();
    await updateProject(user.id, p.id, { ...goodProject, clientPublic: true });
    v = await getPublicProfile(profile.slug, null);
    expect(v!.projects[0].client).toBe("NHS Trust");
  });

  it("isolates projects between users", async () => {
    const a = await makeUser("pf-a");
    const b = await makeUser("pf-b");
    const p = await createProject(a.user.id, goodProject);
    await expect(updateProject(b.user.id, p.id, goodProject)).rejects.toThrow(/not found/);
    await expect(setProjectPublished(b.user.id, p.id, true)).rejects.toThrow(/not found/);
    await expect(deleteProject(b.user.id, p.id)).rejects.toThrow(/not found/);
    await expect(addProjectImage(b.user.id, p.id, png())).rejects.toThrow(/not found/);
    expect(await db.project.count({ where: { id: p.id } })).toBe(1);
  });

  it("stores project images privately, enforces limits, and deletes files with the project", async () => {
    const { user } = await makeUser("pf-img");
    const p = await createProject(user.id, goodProject);
    const item = await addProjectImage(user.id, p.id, png(), "Render");
    const asset = await db.fileAsset.findUniqueOrThrow({ where: { id: item.fileId! } });
    expect(asset.kind).toBe("PORTFOLIO_IMAGE");
    expect(asset.visibility).toBe("PRIVATE");
    await expect(addProjectImage(user.id, p.id, new File([Buffer.from("MZ" + "x".repeat(100))], "a.png", { type: "image/png" }))).rejects.toThrow(/Unsupported/);
    await removeProjectImage(user.id, item.id);
    expect(await db.fileAsset.count({ where: { id: asset.id } })).toBe(0);
    const again = await addProjectImage(user.id, p.id, png());
    const key = (await db.fileAsset.findUniqueOrThrow({ where: { id: again.fileId! } })).storageKey;
    await deleteProject(user.id, p.id);
    await expect(readFile(path.join(process.env.STORAGE_DIR!, key))).rejects.toThrow();
  });
});

describe("private file access", () => {
  it("resume files: owner only; employers only for applicants to their jobs; everyone else denied", async () => {
    const owner = await makeUser("rf-owner");
    const stranger = await makeUser("rf-stranger");
    const { user: emp, company } = await makeEmployer("rf-emp", true);
    const { user: otherEmp } = await makeEmployer("rf-emp2", true);
    const up = await saveUpload({ ownerId: owner.user.id, kind: "RESUME", file: new File(["%PDF-1.4\nhello resume text content for testing purposes only"], "cv.pdf", { type: "application/pdf" }) });
    if (!up.ok) throw new Error(up.error);
    const resume = await db.resume.create({ data: { profileId: owner.profile.id, title: "CV", sourceFileId: up.fileId } });
    const { version } = await saveResumeVersion(resume.id, emptyResume(), "test");
    const asset = await db.fileAsset.findUniqueOrThrow({ where: { id: up.fileId } });

    const v = async (id: string) => asViewer(id);
    expect((await canReadFile(null, asset)).allowed).toBe(false);
    expect((await canReadFile(await v(owner.user.id), asset)).allowed).toBe(true);
    expect((await canReadFile(await v(stranger.user.id), asset)).allowed).toBe(false);
    expect((await canReadFile(await v(emp.id), asset)).allowed).toBe(false); // has not applied yet

    const job = await db.job.create({ data: { slug: `${company.slug}-job`, title: "BIM Coordinator", companyId: company.id, companyName: company.name, description: "x".repeat(100), status: "ACTIVE" } });
    await db.application.create({ data: { userId: owner.user.id, jobId: job.id, resumeVersionId: version.id } });
    expect((await canReadFile(await v(emp.id), asset)).allowed).toBe(true);
    expect((await canReadFile(await v(emp.id), asset)).public).toBe(false);
    expect((await canReadFile(await v(otherEmp.id), asset)).allowed).toBe(false); // different company

    const admin = await makeUser("rf-admin", "ADMIN");
    const mod = await makeUser("rf-mod", "MODERATOR");
    expect((await canReadFile(await v(admin.user.id), asset)).allowed).toBe(false); // staff do not get private resumes
    expect((await canReadFile(await v(mod.user.id), asset)).allowed).toBe(false);
  });

  it("images become readable only while published AND the profile is public", async () => {
    const { user, profile } = await makeUser("img-vis");
    const p = await createProject(user.id, goodProject);
    const item = await addProjectImage(user.id, p.id, png());
    const asset = await db.fileAsset.findUniqueOrThrow({ where: { id: item.fileId! } });
    const anon = async () => (await canReadFile(null, asset)).allowed;
    expect(await anon()).toBe(false); // unpublished + private profile
    await setProjectPublished(user.id, p.id, true);
    expect(await anon()).toBe(false); // published but profile private
    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { visibility: "PUBLIC" } });
    expect(await anon()).toBe(true);
    expect((await canReadFile(null, asset)).public).toBe(true);
    await setProjectPublished(user.id, p.id, false);
    expect(await anon()).toBe(false);
  });

  it("avatar is public only for public profiles", async () => {
    const { user, profile } = await makeUser("avatar");
    const up = await saveUpload({ ownerId: user.id, kind: "PROFILE_IMAGE", file: png("me.png") });
    if (!up.ok) throw new Error(up.error);
    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { avatarFileId: up.fileId } });
    const asset = await db.fileAsset.findUniqueOrThrow({ where: { id: up.fileId } });
    expect((await canReadFile(null, asset)).allowed).toBe(false);
    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { visibility: "PUBLIC" } });
    expect((await canReadFile(null, asset)).allowed).toBe(true);
  });

  it("resume ownership helper rejects other users", async () => {
    const a = await makeUser("own-a");
    const b = await makeUser("own-b");
    const r = await db.resume.create({ data: { profileId: a.profile.id, title: "mine" } });
    expect(await ownedResume(a.user.id, r.id)).not.toBeNull();
    expect(await ownedResume(b.user.id, r.id)).toBeNull();
  });
});

describe("public profile and privacy", () => {
  it("private profiles 404 for everyone but the owner; staff see only public ones", async () => {
    const { user, profile } = await makeUser("pp-private");
    const other = await makeUser("pp-other");
    const admin = await makeUser("pp-admin", "ADMIN");
    expect(await getPublicProfile(profile.slug, null)).toBeNull();
    expect(await getPublicProfile(profile.slug, await asViewer(other.user.id))).toBeNull();
    expect((await getPublicProfile(profile.slug, await asViewer(user.id)))?.isOwner).toBe(true);
    expect((await getPublicProfile(profile.slug, await asViewer(admin.user.id)))).not.toBeNull();
  });

  it("honours privacy toggles and never exposes contact details or salary", async () => {
    const { user, profile } = await makeUser("pp-priv");
    const r = await db.resume.create({ data: { profileId: profile.id, title: "R" } });
    await saveResumeVersion(r.id, { ...emptyResume(), name: "Test pp", email: "secret@example.com", phone: "+1 555 0100", summary: "Hello", links: ["https://linkedin.com/in/x"] }, "test");
    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { visibility: "PUBLIC", location: "London, UK", country: "UK", city: "London", achievements: ["Saved 120 hours"], preferredRoles: ["BIM Manager"], availability: "Immediately", minSalary: 90000, publicResumeId: r.id, privacy: {} } });

    let v = await getPublicProfile(profile.slug, null);
    expect(v!.location).toBe("London, UK");
    expect(v!.achievements).toEqual(["Saved 120 hours"]); // default on
    expect(v!.preferences).toBeNull(); // default off
    expect(v!.resume).toBeNull(); // default off
    expect(JSON.stringify(v)).not.toContain("90000"); // minSalary is never returned publicly

    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { privacy: { hideLocation: true, showAchievements: false, showPreferences: true, showResume: true } } });
    v = await getPublicProfile(profile.slug, null);
    expect(v!.location).toBe("UK");
    expect(v!.achievements).toEqual([]);
    expect(v!.preferences?.preferredRoles).toEqual(["BIM Manager"]);
    expect(v!.resume?.summary).toBe("Hello");
    expect(v!.resume?.email).toBeUndefined();
    expect(v!.resume?.phone).toBeUndefined();
    expect(v!.resume?.links).toEqual([]);
    expect(JSON.stringify(v)).not.toContain("secret@example.com");
    expect(JSON.stringify(v)).not.toContain("90000"); // salary stays private even for the owner's public view
    void user;
  });

  it("open-to-work is visible to verified employers and the owner only", async () => {
    const { user, profile } = await makeUser("pp-otw");
    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { visibility: "PUBLIC", openToWork: true } });
    const verified = await makeEmployer("pp-verified", true);
    const unverified = await makeEmployer("pp-unverified", false);
    expect((await getPublicProfile(profile.slug, null))!.canSeeOpenToWork).toBe(false);
    expect((await getPublicProfile(profile.slug, await asViewer(unverified.user.id)))!.canSeeOpenToWork).toBe(false);
    expect((await getPublicProfile(profile.slug, await asViewer(verified.user.id)))!.canSeeOpenToWork).toBe(true);
    expect((await getPublicProfile(profile.slug, await asViewer(user.id)))!.canSeeOpenToWork).toBe(true);
  });
});
