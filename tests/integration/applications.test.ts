import { afterAll, describe, expect, it } from "vitest";
import type { EmployerRole } from "@prisma/client";
import { cleanup, makeEmployer, makeUser, RUN } from "./helpers";
import { db } from "@/lib/db";
import { saveResumeVersion } from "@/lib/services/profile";
import { emptyResume } from "@/lib/resume/types";
import { applyNative, candidateMove, confirmExternalSubmission, expireUnconfirmed, getCandidateApplication, listCandidateApplications, respondToInterview, sendCandidateMessage, startExternalApply, ApplicationError } from "@/lib/applications/candidate";
import { addNote, deleteNote, employerCtx, getEmployerApplication, listEmployerApplications, moveApplication, scheduleInterview, sendEmployerMessage, updateInterview } from "@/lib/applications/employer";
import { candidateAnalytics, employerAnalytics } from "@/lib/applications/analytics";
import { buildTimeline } from "@/lib/applications/lifecycle";
import { listContactRequests, respondContactRequest, searchCandidates, sendContactRequest } from "@/lib/employer/candidates";
import { acceptInvite, changeMemberRole, inviteMember, removeMember } from "@/lib/employer/team";
import { Forbidden } from "@/lib/employer/permissions";
import { notifyEvent, getPreferences, setPreferences } from "@/lib/notifications/service";
import { viewSummary } from "@/lib/services/profile-views";
import { canReadFile } from "@/lib/files/access";
import { hashToken } from "@/lib/auth/password";

afterAll(async () => {
  await db.queueJob.deleteMany({ where: { queue: "email", dedupeKey: { startsWith: "email:" }, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  await cleanup();
});

const future = (h = 48) => new Date(Date.now() + h * 3600_000);
let n = 0;

async function nativeJob(companyId: string, companyName: string, title = "BIM Coordinator") {
  n++;
  return db.job.create({ data: { slug: `${RUN}-native-${n}`, title, companyId, companyName, description: "Coordinate multidisciplinary models in Revit and Navisworks. ".repeat(3), status: "ACTIVE", software: ["Revit"], skills: ["Clash Detection"] } });
}
async function externalJob(title = "BIM Manager") {
  n++;
  return db.job.create({ data: { slug: `${RUN}-ext-${n}`, title, companyName: `${RUN} Outside Co`, description: "Lead BIM delivery. ".repeat(10), status: "ACTIVE", applyUrl: "https://careers.example.test/apply/1" } });
}
async function resumeFor(userId: string, profileId: string) {
  const r = await db.resume.create({ data: { profileId, title: "CV" } });
  const v = await saveResumeVersion(r.id, { ...emptyResume(), summary: "BIM coordinator with hospital experience." }, "test");
  void userId;
  return v.version;
}
async function team(label: string, verified = true) {
  const { user, company } = await makeEmployer(label, verified);
  const add = async (role: EmployerRole) => {
    const { user: u } = await makeUser(`${label}-${role.toLowerCase()}`, role, { profile: false });
    await db.employerUser.create({ data: { userId: u.id, companyId: company.id, role } });
    return (await employerCtx(u.id))!;
  };
  return { admin: (await employerCtx(user.id))!, company, recruiter: await add("RECRUITER"), manager: await add("EMPLOYER") };
}
/** Candidate who applied natively; returns everything needed by the tests. */
async function applied(label: string, t: Awaited<ReturnType<typeof team>>, job?: { id: string }) {
  const { user, profile } = await makeUser(label);
  const j = job ?? (await nativeJob(t.company.id, t.company.name));
  const v = await resumeFor(user.id, profile.id);
  const app = await applyNative(user.id, j.id, { resumeVersionId: v.id, coverNote: "Hello" });
  return { user, profile, job: j, app, version: v };
}

describe("external applications", () => {
  it("apply click → APPLYING (nothing claimed) → confirmed → APPLIED self-reported", async () => {
    const { user } = await makeUser("ext1");
    const job = await externalJob();
    const r = await startExternalApply(user.id, job.id, { origin: "feed" });
    expect(r.url).toBe("https://careers.example.test/apply/1");
    expect(r.application.status).toBe("APPLYING");
    expect(r.application.external).toBe(true);
    expect(r.application.appliedAt).toBeNull();
    expect(await db.jobInteraction.count({ where: { userId: user.id, jobId: job.id, type: "APPLY_CLICK" } })).toBe(1);

    // "No, not yet" keeps APPLYING
    await confirmExternalSubmission(user.id, r.application.id, false);
    expect((await db.application.findUniqueOrThrow({ where: { id: r.application.id } })).status).toBe("APPLYING");

    const done = await confirmExternalSubmission(user.id, r.application.id, true);
    expect(done.status).toBe("APPLIED");
    expect(done.appliedAt).not.toBeNull();
    const data = await getCandidateApplication(user.id, r.application.id);
    const tl = buildTimeline({ external: true, interactions: data!.interactions, events: data!.app.events, interviews: data!.app.interviews });
    expect(tl.find((e) => e.label === "Applied")?.evidence).toBe("self-reported");
    expect(await db.auditLog.count({ where: { actorId: user.id, action: "application.status", entityId: r.application.id } })).toBeGreaterThan(0);
  });

  it("is idempotent, refuses native jobs, and cannot be confirmed twice", async () => {
    const { user } = await makeUser("ext2");
    const job = await externalJob();
    const a = await startExternalApply(user.id, job.id);
    const b = await startExternalApply(user.id, job.id);
    expect(b.application.id).toBe(a.application.id);
    expect(await db.application.count({ where: { userId: user.id, jobId: job.id } })).toBe(1);
    await confirmExternalSubmission(user.id, a.application.id, true);
    await expect(confirmExternalSubmission(user.id, a.application.id, true)).rejects.toThrow(ApplicationError);
    const t = await team("ext2co");
    const native = await nativeJob(t.company.id, t.company.name);
    await expect(startExternalApply(user.id, native.id)).rejects.toThrow(/on CareerPoint/);
  });

  it("lets the candidate self-report progress, and expires unconfirmed clicks", async () => {
    const { user } = await makeUser("ext3");
    const job = await externalJob();
    const a = (await startExternalApply(user.id, job.id)).application;
    await confirmExternalSubmission(user.id, a.id, true);
    await candidateMove(user.id, a.id, "INTERVIEW", "Phone screen done");
    const ev = await db.applicationEvent.findFirst({ where: { applicationId: a.id, toStatus: "INTERVIEW" } });
    expect(ev?.actorRole).toBe("CANDIDATE");

    const { user: u2 } = await makeUser("ext3b");
    const j2 = await externalJob("Stale job");
    const stale = (await startExternalApply(u2.id, j2.id)).application;
    await db.application.update({ where: { id: stale.id }, data: { lastActivityAt: new Date(Date.now() - 20 * 86400_000) } });
    expect(await expireUnconfirmed()).toBeGreaterThanOrEqual(1);
    expect((await db.application.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("EXPIRED");
  });

  it("never exposes external applications to employers", async () => {
    const t = await team("ext4co");
    const { user } = await makeUser("ext4");
    const job = await db.job.create({ data: { slug: `${RUN}-ext-own`, title: "Own external", companyId: t.company.id, companyName: t.company.name, description: "x".repeat(100), status: "ACTIVE", applyUrl: "https://careers.example.test/own" } });
    const a = (await startExternalApply(user.id, job.id)).application;
    await confirmExternalSubmission(user.id, a.id, true);
    expect((await listEmployerApplications(t.admin)).rows.map((r) => r.id)).not.toContain(a.id);
    expect(await getEmployerApplication(t.admin, a.id)).toBeNull();
    await expect(moveApplication(t.admin, a.id, "SHORTLISTED")).rejects.toThrow();
    expect((await employerAnalytics(t.admin, 30)).applications).toBe(0);
  });
});

describe("native applications", () => {
  it("delivers resume + selected portfolio to the employer and notifies the team", async () => {
    const t = await team("nat1co");
    const { user, profile } = await makeUser("nat1");
    const project = await db.project.create({ data: { profileId: profile.id, name: "Hospital Tower", published: true } });
    const other = await makeUser("nat1-other");
    const foreign = await db.project.create({ data: { profileId: other.profile.id, name: "Not mine" } });
    const job = await nativeJob(t.company.id, t.company.name);
    const v = await resumeFor(user.id, profile.id);
    await expect(applyNative(user.id, job.id, { resumeVersionId: v.id, portfolioProjectIds: [foreign.id] })).rejects.toThrow(ApplicationError);
    const app = await applyNative(user.id, job.id, { resumeVersionId: v.id, portfolioProjectIds: [project.id], coverNote: "Keen to join" });
    expect(app.status).toBe("APPLIED");
    expect(app.external).toBe(false);
    await expect(applyNative(user.id, job.id, { resumeVersionId: v.id })).rejects.toThrow(/already applied/);

    const pkg = await getEmployerApplication(t.recruiter, app.id);
    expect(pkg?.projects.map((p) => p.name)).toEqual(["Hospital Tower"]);
    expect(pkg?.app.coverNote).toBe("Keen to join");
    expect(await db.notification.count({ where: { userId: t.admin.userId, type: "application.submitted" } })).toBeGreaterThan(0);
  });

  it("rejects someone else's resume and closed jobs", async () => {
    const t = await team("nat2co");
    const a = await makeUser("nat2a");
    const b = await makeUser("nat2b");
    const vb = await resumeFor(b.user.id, b.profile.id);
    const job = await nativeJob(t.company.id, t.company.name);
    await expect(applyNative(a.user.id, job.id, { resumeVersionId: vb.id })).rejects.toThrow(/resume/i);
    await db.job.update({ where: { id: job.id }, data: { status: "CLOSED" } });
    const va = await resumeFor(a.user.id, a.profile.id);
    await expect(applyNative(a.user.id, job.id, { resumeVersionId: va.id })).rejects.toThrow(/not open/);
  });

  it("lets a candidate withdraw, then re-apply", async () => {
    const t = await team("nat3co");
    const c = await applied("nat3", t);
    await candidateMove(c.user.id, c.app.id, "WITHDRAWN");
    await expect(candidateMove(c.user.id, c.app.id, "INTERVIEW")).rejects.toThrow(ApplicationError);
    const again = await applyNative(c.user.id, c.job.id, { resumeVersionId: c.version.id });
    expect(again.id).toBe(c.app.id);
    expect(again.status).toBe("APPLIED");
  });
});

describe("lifecycle + recruiter workflow", () => {
  it("first view notifies the candidate once, records first-party views and audits", async () => {
    const t = await team("wf1co");
    const c = await applied("wf1", t);
    await getEmployerApplication(t.recruiter, c.app.id);
    await getEmployerApplication(t.recruiter, c.app.id);
    expect(await db.notification.count({ where: { userId: c.user.id, type: "application.viewed" } })).toBe(1);
    expect(await db.applicationEvent.count({ where: { applicationId: c.app.id, type: "recruiter_viewed" } })).toBe(1);
    const s = await viewSummary(c.profile.id);
    expect(s.byKind.APPLICATION).toBe(1); // collapsed within a day
    expect(s.byKind.RESUME).toBe(1);
    expect(await db.auditLog.count({ where: { actorId: t.recruiter.userId, action: "resume.accessed" } })).toBe(1);
  });

  it("walks stages, validates transitions, notifies the candidate and keeps an audit trail", async () => {
    const t = await team("wf2co");
    const c = await applied("wf2", t);
    await expect(moveApplication(t.recruiter, c.app.id, "ACCEPTED")).rejects.toThrow(); // employers can't accept for the candidate
    await expect(moveApplication(t.recruiter, c.app.id, "OFFER")).rejects.toThrow(); // not reachable from APPLIED
    await moveApplication(t.recruiter, c.app.id, "RECRUITER_REVIEW");
    await moveApplication(t.recruiter, c.app.id, "SHORTLISTED", "Strong coordination background");
    expect(await db.notification.count({ where: { userId: c.user.id, type: "application.shortlisted" } })).toBe(1);
    expect(await db.auditLog.count({ where: { actorId: t.recruiter.userId, action: "candidate.shortlisted" } })).toBe(1);
    expect((await viewSummary(c.profile.id)).byKind.SHORTLIST).toBe(1);

    await moveApplication(t.recruiter, c.app.id, "OFFER");
    expect(await db.notification.count({ where: { userId: c.user.id, type: "offer.received" } })).toBe(1);
    await candidateMove(c.user.id, c.app.id, "ACCEPTED");
    expect((await db.application.findUniqueOrThrow({ where: { id: c.app.id } })).status).toBe("ACCEPTED");
    await expect(moveApplication(t.recruiter, c.app.id, "REJECTED")).rejects.toThrow(); // closed
    expect(await db.notification.count({ where: { userId: t.admin.userId, type: "offer.response" } })).toBe(1);
  });

  it("rejection is audited and visible to the candidate as a status change", async () => {
    const t = await team("wf3co");
    const c = await applied("wf3", t);
    await moveApplication(t.recruiter, c.app.id, "REJECTED", "Position filled");
    expect(await db.auditLog.count({ where: { actorId: t.recruiter.userId, action: "candidate.rejected" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: c.user.id, type: "application.rejected" } })).toBe(1);
    const data = await getCandidateApplication(c.user.id, c.app.id);
    expect(data!.app.status).toBe("REJECTED");
  });

  it("keeps internal notes private from the candidate in every candidate-facing read", async () => {
    const t = await team("wf4co");
    const c = await applied("wf4", t);
    const secret = `SECRET-NOTE-${RUN}`;
    await addNote(t.manager, c.app.id, secret);
    const tl = await getCandidateApplication(c.user.id, c.app.id);
    expect(JSON.stringify(tl)).not.toContain(secret);
    expect(JSON.stringify(buildTimeline({ external: false, interactions: tl!.interactions, events: tl!.app.events, interviews: tl!.app.interviews }))).not.toMatch(/note/i);
    expect(JSON.stringify(await listCandidateApplications(c.user.id))).not.toContain(secret);
    const ev = await db.applicationEvent.findFirstOrThrow({ where: { applicationId: c.app.id, type: "note_added" } });
    expect(ev.visibleToCandidate).toBe(false);
    expect(await db.notification.count({ where: { userId: c.user.id, title: { contains: "note" } } })).toBe(0);
    // Employer side sees it; only author or admin may delete.
    const pkg = await getEmployerApplication(t.recruiter, c.app.id);
    expect(pkg?.app.notes.map((x) => x.body)).toContain(secret);
    await expect(deleteNote(t.recruiter, pkg!.app.notes[0].id)).rejects.toThrow(Forbidden);
    await deleteNote(t.admin, pkg!.app.notes[0].id);
  });

  it("schedules, reschedules, cancels and completes interviews; candidate confirms", async () => {
    const t = await team("wf5co");
    const c = await applied("wf5", t);
    await expect(scheduleInterview(t.recruiter, c.app.id, { scheduledAt: new Date(Date.now() - 86400_000) })).rejects.toThrow(/future/);
    await expect(scheduleInterview(t.recruiter, c.app.id, { scheduledAt: future() })).rejects.toThrow(/can't be scheduled from Applied/); // must be reviewed first
    await moveApplication(t.recruiter, c.app.id, "RECRUITER_REVIEW");
    const iv = await scheduleInterview(t.recruiter, c.app.id, { scheduledAt: future(), durationMin: 30, mode: "VIDEO", locationOrLink: "https://meet.example.test/x", message: "Bring a portfolio walkthrough" });
    expect((await db.application.findUniqueOrThrow({ where: { id: c.app.id } })).status).toBe("INTERVIEW");
    expect(await db.notification.count({ where: { userId: c.user.id, type: "interview.scheduled" } })).toBe(1);

    await respondToInterview(c.user.id, iv.id, true);
    expect(await db.notification.count({ where: { userId: t.admin.userId, type: "interview.response" } })).toBe(1);
    const data = await getCandidateApplication(c.user.id, c.app.id);
    expect(data!.app.interviews[0].candidateResponse).toBe("ACCEPTED");

    await updateInterview(t.recruiter, iv.id, { reschedule: future(72) });
    expect((await db.interview.findUniqueOrThrow({ where: { id: iv.id } })).candidateResponse).toBeNull(); // must confirm again
    await updateInterview(t.recruiter, iv.id, "COMPLETE");
    await expect(updateInterview(t.recruiter, iv.id, "CANCEL")).rejects.toThrow(/closed/);
  });

  it("messages flow both ways and notify the other side", async () => {
    const t = await team("wf6co");
    const c = await applied("wf6", t);
    await sendEmployerMessage(t.recruiter, c.app.id, "Could you share availability?");
    await sendCandidateMessage(c.user.id, c.app.id, "Next week works.");
    expect(await db.notification.count({ where: { userId: c.user.id, type: "message.received" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: t.admin.userId, type: "message.received.employer" } })).toBe(1);
    await expect(sendCandidateMessage(c.user.id, c.app.id, "   ")).rejects.toThrow(ApplicationError);
  });
});

describe("authorization (IDOR)", () => {
  it("employers can only reach their own company's applications", async () => {
    const a = await team("idor-a");
    const b = await team("idor-b");
    const c = await applied("idor1", a);
    expect(await getEmployerApplication(b.admin, c.app.id)).toBeNull();
    expect((await listEmployerApplications(b.admin)).rows.map((r) => r.id)).not.toContain(c.app.id);
    await expect(moveApplication(b.admin, c.app.id, "SHORTLISTED")).rejects.toThrow(ApplicationError);
    await expect(addNote(b.admin, c.app.id, "x")).rejects.toThrow(ApplicationError);
    await expect(scheduleInterview(b.admin, c.app.id, { scheduledAt: future() })).rejects.toThrow(ApplicationError);
    await expect(sendEmployerMessage(b.admin, c.app.id, "hi")).rejects.toThrow(ApplicationError);
    await moveApplication(a.recruiter, c.app.id, "RECRUITER_REVIEW");
    const iv = await scheduleInterview(a.recruiter, c.app.id, { scheduledAt: future() });
    await expect(updateInterview(b.admin, iv.id, "CANCEL")).rejects.toThrow(ApplicationError);
    const note = await addNote(a.admin, c.app.id, "mine");
    await expect(deleteNote(b.admin, note.id)).rejects.toThrow(ApplicationError);
    expect((await employerAnalytics(b.admin, 30)).applications).toBe(0);
  });

  it("enforces role capabilities on the server", async () => {
    const t = await team("role-co");
    const c = await applied("role1", t);
    await expect(moveApplication(t.manager, c.app.id, "REJECTED")).rejects.toThrow(Forbidden);
    await expect(moveApplication(t.manager, c.app.id, "RECRUITER_REVIEW")).resolves.toBeTruthy(); // hiring managers may review…
    await moveApplication(t.manager, c.app.id, "SHORTLISTED"); // …and shortlist
    await expect(moveApplication(t.manager, c.app.id, "INTERVIEW")).rejects.toThrow(Forbidden);
    await expect(scheduleInterview(t.manager, c.app.id, { scheduledAt: future() })).rejects.toThrow(Forbidden);
    await expect(sendEmployerMessage(t.manager, c.app.id, "hello")).rejects.toThrow(Forbidden);
    await expect(inviteMember(t.recruiter, "x@y.test", "RECRUITER")).rejects.toThrow(Forbidden);
    await expect(changeMemberRole(t.recruiter, t.manager.userId, "RECRUITER")).rejects.toThrow(Forbidden);
    await expect(addNote(t.manager, c.app.id, "ok")).resolves.toBeTruthy();
  });

  it("candidates can't read or change each other's applications", async () => {
    const t = await team("idor-c");
    const c1 = await applied("idorc1", t);
    const other = await makeUser("idorc2");
    expect(await getCandidateApplication(other.user.id, c1.app.id)).toBeNull();
    await expect(candidateMove(other.user.id, c1.app.id, "WITHDRAWN")).rejects.toThrow(ApplicationError);
    await expect(sendCandidateMessage(other.user.id, c1.app.id, "hi")).rejects.toThrow(ApplicationError);
    await expect(confirmExternalSubmission(other.user.id, c1.app.id, true)).rejects.toThrow(ApplicationError);
    expect(await listCandidateApplications(other.user.id)).toHaveLength(0);
    await moveApplication(t.recruiter, c1.app.id, "RECRUITER_REVIEW");
    const iv = await scheduleInterview(t.recruiter, c1.app.id, { scheduledAt: future() });
    await expect(respondToInterview(other.user.id, iv.id, true)).rejects.toThrow(ApplicationError);
  });

  it("resume files are readable by the applied-to company only", async () => {
    const a = await team("file-a");
    const b = await team("file-b");
    const c = await applied("file1", a);
    const up = await db.fileAsset.create({ data: { ownerId: c.user.id, kind: "RESUME", storageKey: `${RUN}/cv.pdf`, originalName: "cv.pdf", mime: "application/pdf", size: 1, sha256: "x" } });
    await db.resume.update({ where: { id: c.version.resumeId }, data: { sourceFileId: up.id } });
    const viewer = async (u: string) => db.user.findUniqueOrThrow({ where: { id: u }, include: { employerUsers: { include: { company: true } } } });
    expect((await canReadFile(await viewer(a.recruiter.userId), up)).allowed).toBe(true);
    expect((await canReadFile(await viewer(b.admin.userId), up)).allowed).toBe(false);
    // External applications never grant file access, even to the company that owns the (external) job.
    const x = await makeUser("file-ext");
    const xv = await resumeFor(x.user.id, x.profile.id);
    const xf = await db.fileAsset.create({ data: { ownerId: x.user.id, kind: "RESUME", storageKey: `${RUN}/cv2.pdf`, originalName: "cv2.pdf", mime: "application/pdf", size: 1, sha256: "y" } });
    await db.resume.update({ where: { id: xv.resumeId }, data: { sourceFileId: xf.id } });
    const extJob = await db.job.create({ data: { slug: `${RUN}-file-ext`, title: "External", companyId: a.company.id, companyName: a.company.name, description: "x".repeat(100), status: "ACTIVE", applyUrl: "https://careers.example.test/f" } });
    await startExternalApply(x.user.id, extJob.id, { resumeVersionId: xv.id });
    expect((await canReadFile(await viewer(a.recruiter.userId), xf)).allowed).toBe(false);
  });
});

describe("notifications", () => {
  it("honours preferences and dedupes", async () => {
    const { user } = await makeUser("np1");
    await setPreferences(user.id, "candidate", { "profile.viewed": { inApp: false, email: false } });
    expect(await notifyEvent(user.id, "profile.viewed", { title: "x" })).toEqual({ inApp: false, email: false });
    await setPreferences(user.id, "candidate", { "job.match": { inApp: true, email: true } });
    const r = await notifyEvent(user.id, "job.match", { title: "Match", dedupeKey: `/jobs/${RUN}-dedupe` });
    expect(r).toEqual({ inApp: true, email: true });
    expect(await notifyEvent(user.id, "job.match", { title: "Match again", dedupeKey: `/jobs/${RUN}-dedupe` })).toEqual({ inApp: false, email: false });
    expect(await db.emailOutbox.count({ where: { userId: user.id } })).toBe(1);
    expect((await getPreferences(user.id, "candidate")).find((p) => p.key === "profile.viewed")?.inApp).toBe(false);
  });

  it("emails only verified addresses and ignores events outside the audience", async () => {
    const { user } = await makeUser("np2");
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    await setPreferences(user.id, "candidate", { "application.shortlisted": { inApp: true, email: true }, "application.submitted": { inApp: false, email: true } });
    const r = await notifyEvent(user.id, "application.shortlisted", { title: "Shortlisted" });
    expect(r).toEqual({ inApp: true, email: false });
    expect(await db.notificationPreference.count({ where: { userId: user.id, event: "application.submitted" } })).toBe(0); // employer event can't be set by a candidate
  });

  it("notifies when a new resume version scores meaningfully higher", async () => {
    const { user, profile } = await makeUser("np3");
    const r = await db.resume.create({ data: { profileId: profile.id, title: "CV" } });
    await saveResumeVersion(r.id, { ...emptyResume(), summary: "BIM." }, "test");
    const richer = { ...emptyResume(), summary: "BIM coordinator with 8 years across healthcare projects, ISO 19650 certified, Revit and Navisworks specialist leading clash resolution.", software: ["Revit", "Navisworks", "Dynamo"], skills: ["Clash Detection", "ISO 19650", "COBie"], experiences: [{ title: "BIM Coordinator", company: "Alpha", startDate: "2019-01", current: true, bullets: ["Resolved 4,200 clashes across 6 disciplines", "Saved 120 hours per project with Dynamo"] }] } as never;
    await saveResumeVersion(r.id, richer, "test");
    expect(await db.notification.count({ where: { userId: user.id, type: "resume.score_improved" } })).toBe(1);
  });
});

describe("profile views, candidate search and contact requests", () => {
  it("only verified companies can search; results are public-only and privacy-respecting", async () => {
    const t = await team("srch-co");
    const unverified = await team("srch-unv", false);
    const pub = await makeUser("srch-pub");
    const priv = await makeUser("srch-priv");
    const hidden = await makeUser("srch-hide");
    const tag = `Zorbax${RUN.replace(/\W/g, "")}`;
    await db.bIMProfessionalProfile.update({ where: { id: pub.profile.id }, data: { visibility: "PUBLIC", headline: `${tag} BIM Coordinator`, location: "Dubai, UAE", country: "UAE", yearsExperience: 6, openToWork: true, minSalary: 99999, privacy: {} } });
    await db.bIMProfessionalProfile.update({ where: { id: priv.profile.id }, data: { visibility: "PRIVATE", headline: `${tag} secret` } });
    await db.bIMProfessionalProfile.update({ where: { id: hidden.profile.id }, data: { visibility: "PUBLIC", headline: `${tag} hidden loc`, location: "Secretville", country: "UAE", privacy: { hideLocation: true } } });
    await db.softwareSkill.create({ data: { profileId: pub.profile.id, software: "Revit", level: "ADVANCED" } });

    await expect(searchCandidates(unverified.admin, { q: tag })).rejects.toThrow(Forbidden);
    const res = await searchCandidates(t.recruiter, { q: tag });
    expect(res.rows.map((r) => r.name).sort()).toEqual([hidden.user.name, pub.user.name].sort());
    expect(JSON.stringify(res)).not.toMatch(/99999|@test\.local|minSalary|Secretville/);
    expect((await searchCandidates(t.recruiter, { q: tag, software: ["Revit"] })).rows).toHaveLength(1);
    expect((await searchCandidates(t.recruiter, { q: tag, location: "Secretville" })).rows).toHaveLength(0); // hidden locations can't be probed
    expect((await searchCandidates(t.recruiter, { q: tag, location: "UAE" })).rows).toHaveLength(2);
    expect((await searchCandidates(t.recruiter, { q: tag, expMin: 5, expMax: 8 })).rows).toHaveLength(1);
  });

  it("contact requests: candidate decides, email is shared only after acceptance, abuse is limited", async () => {
    const t = await team("cr-co");
    const unv = await team("cr-unv", false);
    const cand = await makeUser("cr1");
    await db.bIMProfessionalProfile.update({ where: { id: cand.profile.id }, data: { visibility: "PUBLIC" } });
    const msg = "Hello! We're hiring a BIM Lead on a hospital programme and your portfolio stood out.";
    await expect(sendContactRequest(unv.admin, cand.profile.id, { message: msg })).rejects.toThrow(Forbidden);
    await expect(sendContactRequest(t.recruiter, cand.profile.id, { message: "too short" })).rejects.toThrow(ApplicationError);
    const req = await sendContactRequest(t.recruiter, cand.profile.id, { message: msg });
    await expect(sendContactRequest(t.recruiter, cand.profile.id, { message: msg })).rejects.toThrow(/pending/);
    expect((await listContactRequests(t.recruiter))[0].email).toBeNull();
    expect(await db.notification.count({ where: { userId: cand.user.id, type: "contact.request" } })).toBe(1);
    expect((await viewSummary(cand.profile.id)).byKind.CONTACT_REQUEST).toBe(1);

    const stranger = await makeUser("cr-stranger");
    await expect(respondContactRequest(stranger.user.id, req.id, true)).rejects.toThrow(ApplicationError);
    await respondContactRequest(cand.user.id, req.id, true);
    expect((await listContactRequests(t.recruiter))[0].email).toBe(cand.user.email);
    await expect(respondContactRequest(cand.user.id, req.id, false)).rejects.toThrow(ApplicationError); // already answered
  });

  it("a declined request never reveals contact details", async () => {
    const t = await team("cr2-co");
    const cand = await makeUser("cr2");
    await db.bIMProfessionalProfile.update({ where: { id: cand.profile.id }, data: { visibility: "PUBLIC" } });
    const req = await sendContactRequest(t.recruiter, cand.profile.id, { message: "We'd like to discuss a BIM manager opening with you." });
    await respondContactRequest(cand.user.id, req.id, false);
    const [row] = await listContactRequests(t.recruiter);
    expect(row.status).toBe("DECLINED");
    expect(row.email).toBeNull();
  });

  it("private profiles can't be contacted", async () => {
    const t = await team("cr3-co");
    const cand = await makeUser("cr3");
    await expect(sendContactRequest(t.recruiter, cand.profile.id, { message: "We'd like to discuss a BIM manager opening with you." })).rejects.toThrow(/not found/i);
  });
});

describe("analytics honesty", () => {
  it("returns no rates when there is no data", async () => {
    const t = await team("an-empty");
    const a = await employerAnalytics(t.admin, 30);
    expect(a.applications).toBe(0);
    expect(a.shortlistRate).toBeNull();
    expect(a.interviewRate).toBeNull();
    expect(a.medianHoursToShortlist).toBeNull();
    const { user, profile } = await makeUser("an-empty-c");
    const c = await candidateAnalytics(user.id, profile.id);
    expect(c.total).toBe(0);
    expect(c.responseRate).toBeNull();
    expect(c.resumeScore).toBeNull();
  });

  it("counts only what happened", async () => {
    const t = await team("an-data");
    const c1 = await applied("an1", t);
    const c2 = await applied("an2", t);
    await moveApplication(t.recruiter, c1.app.id, "SHORTLISTED");
    await scheduleInterview(t.recruiter, c1.app.id, { scheduledAt: future() });
    await getEmployerApplication(t.recruiter, c2.app.id);
    const a = await employerAnalytics(t.admin, 30);
    expect(a.applications).toBe(2);
    expect(a.shortlisted).toBe(1);
    expect(a.interviewed).toBe(1);
    expect(a.viewed).toBe(1); // only c2 was opened by the team
    expect(a.shortlistRate).toBe(50);
    expect(a.medianHoursToShortlist).not.toBeNull();
    const ca = await candidateAnalytics(c1.user.id, c1.profile.id);
    expect(ca.total).toBe(1);
    expect(ca.interviews).toBe(1);
  });
});

describe("team management", () => {
  it("invite → accept grants the invited role; wrong email, reuse and last-admin removal are blocked", async () => {
    const t = await team("tm-co");
    const invitee = await makeUser("tm-new", "EMPLOYER", { profile: false });
    const { token } = await inviteMember(t.admin, invitee.user.email, "RECRUITER");
    const stranger = await makeUser("tm-stranger", "EMPLOYER", { profile: false });
    await expect(acceptInvite(stranger.user.id, token)).rejects.toThrow(/different email/);
    expect(await acceptInvite(invitee.user.id, token)).toBe(t.company.name);
    expect((await employerCtx(invitee.user.id))?.role).toBe("RECRUITER");
    await expect(acceptInvite(invitee.user.id, token)).rejects.toThrow(/invalid|expired/);
    expect(await db.employerInvite.findFirst({ where: { tokenHash: hashToken(token) } })).toMatchObject({ acceptedAt: expect.any(Date) });

    await expect(removeMember(t.admin, (await db.employerUser.findFirstOrThrow({ where: { userId: t.admin.userId } })).id)).rejects.toThrow(Forbidden); // can't remove yourself
    await expect(changeMemberRole(t.admin, (await db.employerUser.findFirstOrThrow({ where: { userId: t.admin.userId } })).id, "RECRUITER")).rejects.toThrow(/at least one admin/);
    await changeMemberRole(t.admin, (await db.employerUser.findFirstOrThrow({ where: { userId: invitee.user.id } })).id, "EMPLOYER");
    expect((await employerCtx(invitee.user.id))?.role).toBe("EMPLOYER");
  });

  it("candidate accounts can't be invited or join a company", async () => {
    const t = await team("tm2-co");
    const cand = await makeUser("tm2-cand");
    await expect(inviteMember(t.admin, cand.user.email, "RECRUITER")).rejects.toThrow(/candidate/i);
  });
});
