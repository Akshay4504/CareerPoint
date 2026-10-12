import { describe, expect, it } from "vitest";
import { allowedMoves, buildTimeline, canMove, isNativeJob, isSelfReported, STAGE_LABEL, APPLICATION_STAGES } from "@/lib/applications/lifecycle";
import { CAPABILITIES, can, require_, Forbidden, type EmployerCtx } from "@/lib/employer/permissions";
import { signFileUrl, verifyFileSignature } from "@/lib/files/signed";
import { EVENTS, resolvePrefs } from "@/lib/notifications/events";

const d = (s: string) => new Date(s);

describe("application lifecycle rules", () => {
  it("lets candidates only withdraw/accept on NATIVE applications", () => {
    expect(allowedMoves({ status: "APPLIED", external: false }, "CANDIDATE")).toEqual(["WITHDRAWN"]);
    expect(canMove({ status: "INTERVIEW", external: false }, "CANDIDATE", "OFFER")).toBe(false); // can't promote themselves
    expect(canMove({ status: "OFFER", external: false }, "CANDIDATE", "ACCEPTED")).toBe(true);
  });

  it("lets candidates self-report progress on EXTERNAL applications, flagged as self-reported", () => {
    expect(canMove({ status: "APPLIED", external: true }, "CANDIDATE", "INTERVIEW")).toBe(true);
    expect(isSelfReported({ external: true }, "CANDIDATE", "INTERVIEW")).toBe(true);
    expect(isSelfReported({ external: false }, "CANDIDATE", "WITHDRAWN")).toBe(false);
  });

  it("never lets employers move external applications", () => {
    for (const s of APPLICATION_STAGES) expect(allowedMoves({ status: s, external: true }, "EMPLOYER")).toEqual([]);
  });

  it("does not allow employers to accept on the candidate's behalf or revive closed applications", () => {
    for (const s of ["APPLIED", "RECRUITER_REVIEW", "SHORTLISTED", "ASSESSMENT", "INTERVIEW", "OFFER"] as const) expect(allowedMoves({ status: s, external: false }, "EMPLOYER")).not.toContain("ACCEPTED");
    for (const s of ["REJECTED", "WITHDRAWN", "ACCEPTED", "EXPIRED"] as const) expect(allowedMoves({ status: s, external: false }, "EMPLOYER")).toEqual([]);
  });

  it("labels every stage", () => {
    for (const s of APPLICATION_STAGES) expect(STAGE_LABEL[s]).toBeTruthy();
  });

  it("treats a job as native only when a company posted it without an external URL", () => {
    expect(isNativeJob({ companyId: "c1", applyUrl: null })).toBe(true);
    expect(isNativeJob({ companyId: "c1", applyUrl: "https://x.test/apply" })).toBe(false);
    expect(isNativeJob({ companyId: null, applyUrl: null })).toBe(false);
  });
});

describe("candidate timeline", () => {
  const ev = (o: Partial<Parameters<typeof buildTimeline>[0]["events"][number]> & { id: string; type: string; createdAt: Date }) => ({ actorRole: "CANDIDATE", fromStatus: null, toStatus: null, note: null, visibleToCandidate: true, ...o });

  it("contains only recorded events, in order, and hides internal ones", () => {
    const t = buildTimeline({
      external: false,
      interactions: [{ id: "i1", type: "VIEWED", createdAt: d("2026-01-01T10:00:00Z") }],
      events: [
        ev({ id: "e1", type: "applied", createdAt: d("2026-01-02T10:00:00Z"), toStatus: "APPLIED" }),
        ev({ id: "e2", type: "note_added", createdAt: d("2026-01-03T10:00:00Z"), actorRole: "EMPLOYER", visibleToCandidate: false }),
        ev({ id: "e3", type: "status_changed", createdAt: d("2026-01-04T10:00:00Z"), actorRole: "EMPLOYER", toStatus: "SHORTLISTED" }),
      ],
    });
    expect(t.map((x) => x.label)).toEqual(["Job discovered", "Applied on CareerPoint", "Shortlisted"]);
    expect(t.some((x) => x.key.includes("e2"))).toBe(false);
  });

  it("marks external progress as self-reported and never claims employer receipt", () => {
    const t = buildTimeline({
      external: true,
      interactions: [{ id: "c1", type: "APPLY_CLICK", createdAt: d("2026-01-01T10:00:00Z") }],
      events: [
        ev({ id: "e1", type: "candidate_confirmed_submission", createdAt: d("2026-01-01T10:05:00Z"), toStatus: "APPLIED" }),
        ev({ id: "e2", type: "status_changed", createdAt: d("2026-01-09T10:00:00Z"), toStatus: "INTERVIEW" }),
      ],
    });
    expect(t.every((x) => x.evidence !== "employer")).toBe(true);
    expect(t.find((x) => x.label === "Interview")?.evidence).toBe("self-reported");
    expect(JSON.stringify(t)).not.toMatch(/employer (received|viewed|processed)/i);
  });
});

describe("employer permissions", () => {
  const ctx = (role: EmployerCtx["role"]): EmployerCtx => ({ userId: "u", userName: "U", companyId: "c", companyName: "C", role, verified: true });

  it("keeps a strict capability ladder", () => {
    expect(can("EMPLOYER", "applications.shortlist")).toBe(true);
    expect(can("EMPLOYER", "applications.move")).toBe(false);
    expect(can("EMPLOYER", "jobs.manage")).toBe(false);
    expect(can("RECRUITER", "interviews.manage")).toBe(true);
    expect(can("RECRUITER", "team.manage")).toBe(false);
    expect(can("RECRUITER", "company.manage")).toBe(false);
    expect(can("EMPLOYER_ADMIN", "team.manage")).toBe(true);
    for (const cap of CAPABILITIES.EMPLOYER) expect(CAPABILITIES.EMPLOYER_ADMIN).toContain(cap);
  });

  it("require_ throws Forbidden", () => {
    expect(() => require_(ctx("EMPLOYER"), "jobs.manage")).toThrow(Forbidden);
    expect(() => require_(ctx("RECRUITER"), "jobs.manage")).not.toThrow();
  });
});

describe("signed file URLs", () => {
  const parse = (u: string) => {
    const url = new URL(u, "http://x.test");
    return { v: url.searchParams.get("v"), e: url.searchParams.get("e"), s: url.searchParams.get("s") };
  };

  it("verifies for the intended viewer and file only", () => {
    const p = parse(signFileUrl("file1", "viewerA"));
    expect(verifyFileSignature("file1", "viewerA", p)).toBe(true);
    expect(verifyFileSignature("file2", "viewerA", p)).toBe(false); // different file
    expect(verifyFileSignature("file1", "viewerB", p)).toBe(false); // forwarded link
  });

  it("expires and rejects tampering", () => {
    const now = Date.now();
    const p = parse(signFileUrl("f", "v", 60, now));
    expect(verifyFileSignature("f", "v", p, now + 30_000)).toBe(true);
    expect(verifyFileSignature("f", "v", p, now + 120_000)).toBe(false);
    expect(verifyFileSignature("f", "v", { ...p, e: String(Number(p.e) + 9999) })).toBe(false);
    expect(verifyFileSignature("f", "v", { ...p, s: "x" })).toBe(false);
    expect(verifyFileSignature("f", "v", {})).toBe(false);
  });
});

describe("notification preferences", () => {
  it("covers every required event", () => {
    const keys = EVENTS.map((e) => e.key);
    for (const k of ["application.submitted", "application.viewed", "application.shortlisted", "application.rejected", "interview.scheduled", "offer.received", "profile.viewed", "job.match", "job.expiring", "resume.score_improved"]) expect(keys).toContain(k);
  });

  it("stored preferences override defaults; unknown events default to in-app only", () => {
    expect(resolvePrefs([{ event: "application.viewed", inApp: false, email: true }], "application.viewed")).toMatchObject({ inApp: false, email: true });
    expect(resolvePrefs([], "something.unknown")).toEqual({ event: "something.unknown", inApp: true, email: false });
  });
});
