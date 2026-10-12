import { afterAll, describe, expect, it } from "vitest";
import { cleanup, makeUser, RUN } from "./helpers";
import { db } from "@/lib/db";
import { ChallengeError, checkChallenge, sendChallenge, MAX_ATTEMPTS } from "@/lib/auth/challenge";
import { claimCookieName, signClaim, verifyClaim } from "@/lib/auth/claim";
import { MAX_COMMUNITIES, CommunityError, acceptInvite, createInvite, decideJoinRequest, inviteByToken, leaveCommunity, requestToJoin, revokeInvite } from "@/lib/communities/service";
import { ShareError, createShare, emailAllowed, listShares, recordShareAccess, revokeShare, shareByToken } from "@/lib/profile-share";
import { getPublicProfile } from "@/lib/services/public-profile";
import { hashToken } from "@/lib/auth/password";

afterAll(async () => {
  await db.rateLimitBucket.deleteMany({ where: { key: { contains: RUN } } });
  await db.emailChallenge.deleteMany({ where: { email: { contains: RUN } } });
  await cleanup();
});

type U = Awaited<ReturnType<typeof makeUser>>["user"];
const actor = (u: U) => ({ id: u.id, role: u.role, emailVerifiedAt: u.emailVerifiedAt, email: u.email });

/** Capture the code that sendMail would deliver by reading the dev mail log line. */
async function issueCode(purpose: string, subjectId: string, email: string) {
  const lines: string[] = [];
  const orig = console.info;
  console.info = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    await sendChallenge({ purpose, subjectId, email, ip: `ip-${RUN}`, subject: "code", intro: "intro" });
  } finally {
    console.info = orig;
  }
  const m = lines.join("\n").match(/verification code: (\d{6})/);
  if (!m) throw new Error("no code captured");
  return m[1];
}

describe("email code challenge", () => {
  it("accepts the right code once, rejects wrong/old/expired codes, and limits guesses", async () => {
    const email = `${RUN}.chal@test.local`;
    const code = await issueCode("t", "subj1", email);
    expect(await checkChallenge({ purpose: "t", subjectId: "subj1", email, code: "000000" === code ? "111111" : "000000" })).toBe(false);
    expect(await checkChallenge({ purpose: "t", subjectId: "other", email, code })).toBe(false); // bound to the subject
    expect(await checkChallenge({ purpose: "t", subjectId: "subj1", email: `x${email}`, code })).toBe(false); // bound to the email
    expect(await checkChallenge({ purpose: "t", subjectId: "subj1", email: email.toUpperCase(), code })).toBe(true); // case-insensitive address
    expect(await checkChallenge({ purpose: "t", subjectId: "subj1", email, code })).toBe(false); // single use

    const code2 = await issueCode("t", "subj2", email);
    const code3 = await issueCode("t", "subj2", email); // newer code supersedes
    expect(await checkChallenge({ purpose: "t", subjectId: "subj2", email, code: code2 === code3 ? "x" : code2 })).toBe(code2 === code3);
    const wrong = code3 === "123456" ? "654321" : "123456";
    for (let i = 0; i < MAX_ATTEMPTS; i++) await checkChallenge({ purpose: "t", subjectId: "subj2", email, code: wrong });
    expect(await checkChallenge({ purpose: "t", subjectId: "subj2", email, code: code3 })).toBe(false); // attempt budget exhausted, even for the right code

    const code4 = await issueCode("t", "subj3", email);
    await db.emailChallenge.updateMany({ where: { subjectId: "subj3", email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await checkChallenge({ purpose: "t", subjectId: "subj3", email, code: code4 })).toBe(false);
  });

  it("validates addresses and rate-limits requests", async () => {
    await expect(sendChallenge({ purpose: "t", subjectId: "s", email: "not-an-email", ip: `ip2-${RUN}`, subject: "s", intro: "i" })).rejects.toBeInstanceOf(ChallengeError);
    const email = `${RUN}.rl@test.local`;
    for (let i = 0; i < 5; i++) await issueCode("rl", "s", email);
    await expect(sendChallenge({ purpose: "rl", subjectId: "s", email, ip: `ip3-${RUN}`, subject: "s", intro: "i" })).rejects.toThrow(/Too many/);
  });
});

describe("signed claim cookies", () => {
  it("bind to one subject, kind and email, expire, and cannot be forged", () => {
    const v = signClaim("invite", "inv1", "A@B.com", 60);
    expect(verifyClaim(v, "invite", "inv1")).toMatchObject({ email: "a@b.com" });
    expect(verifyClaim(v, "invite", "inv2")).toBeNull();
    expect(verifyClaim(v, "share", "inv1")).toBeNull();
    expect(verifyClaim(v, "invite", "inv1", Date.now() + 120_000)).toBeNull();
    const [payload] = v.split(".");
    expect(verifyClaim(`${payload}.forged`, "invite", "inv1")).toBeNull();
    expect(verifyClaim(undefined, "invite", "inv1")).toBeNull();
    expect(claimCookieName("share", "abcdefghijklmnopqrstuvwxyz")).toBe("careerpoint_share_opqrstuvwxyz");
  });
});

describe("community membership: no instant joining, 2-community cap", () => {
  it("joining happens only via approved request or verified invite, never directly", async () => {
    const { user } = await makeUser("mem1");
    const staff = await makeUser("mem-staff", "MODERATOR", { profile: false });
    const req = await requestToJoin(actor(user), "revit", "I model hospitals");
    expect(req.status).toBe("PENDING");
    expect(await db.communityMember.count({ where: { userId: user.id } })).toBe(0); // requesting is not joining
    await expect(decideJoinRequest(actor(user), req.id, true)).rejects.toBeInstanceOf(CommunityError); // members can't approve themselves
    await decideJoinRequest(actor(staff.user), req.id, true);
    expect(await db.communityMember.count({ where: { userId: user.id } })).toBe(1);
    await expect(decideJoinRequest(actor(staff.user), req.id, true)).rejects.toThrow(/already handled/);
    await expect(requestToJoin(actor(staff.user), "revit")).rejects.toBeInstanceOf(CommunityError); // staff don't join
  });

  it("enforces the cap across requests and invites", async () => {
    const { user } = await makeUser("cap1");
    const staff = await makeUser("cap-staff", "ADMIN", { profile: false });
    for (const slug of ["navisworks", "dynamo"]) {
      const r = await requestToJoin(actor(user), slug);
      await decideJoinRequest(actor(staff.user), r.id, true);
    }
    expect(await db.communityMember.count({ where: { userId: user.id } })).toBe(MAX_COMMUNITIES);
    await expect(requestToJoin(actor(user), "solibri")).rejects.toThrow(/at most 2/);
    const inviter = await makeUser("cap-inviter");
    await db.communityMember.create({ data: { communityId: (await db.community.findUniqueOrThrow({ where: { slug: "solibri" } })).id, userId: inviter.user.id } });
    const inv = await createInvite(actor(inviter.user), "solibri");
    await expect(acceptInvite(actor(user), inv.token, user.email)).rejects.toThrow(/at most 2/);
    await leaveCommunity(actor(user), "dynamo");
    await expect(acceptInvite(actor(user), inv.token, user.email)).resolves.toMatchObject({ slug: "solibri" });
  });

  it("a pending request that would exceed the cap is declined on approval", async () => {
    const { user } = await makeUser("cap2");
    const staff = await makeUser("cap2-staff", "ADMIN", { profile: false });
    const pending = await requestToJoin(actor(user), "tekla");
    for (const slug of ["synchro", "bentley"]) await db.communityMember.create({ data: { communityId: (await db.community.findUniqueOrThrow({ where: { slug } })).id, userId: user.id } });
    await expect(decideJoinRequest(actor(staff.user), pending.id, true)).rejects.toThrow(/at most 2/);
    expect((await db.communityJoinRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("DECLINED");
    expect(await db.communityMember.count({ where: { userId: user.id } })).toBe(2);
  });
});

describe("community invite links", () => {
  it("only members can invite; links are stored hashed, expire, revoke and cap their uses", async () => {
    const member = await makeUser("inv-member");
    const outsider = await makeUser("inv-outsider");
    await db.communityMember.create({ data: { communityId: (await db.community.findUniqueOrThrow({ where: { slug: "grasshopper" } })).id, userId: member.user.id } });
    await expect(createInvite(actor(outsider.user), "grasshopper")).rejects.toThrow(/Only members/);
    const { token } = await createInvite(actor(member.user), "grasshopper");
    const row = await db.communityInvite.findFirstOrThrow({ where: { tokenHash: hashToken(token) } });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await inviteByToken(token)).not.toBeNull();
    expect(await inviteByToken("nonsense-token")).toBeNull();

    // joining requires the verified email to match the signed-in account
    const guest = await makeUser("inv-guest");
    await expect(acceptInvite(actor(guest.user), token, "someone.else@test.local")).rejects.toThrow(/Sign in with/);
    await db.user.update({ where: { id: guest.user.id }, data: { emailVerifiedAt: null } });
    const c = await acceptInvite({ ...actor(guest.user), emailVerifiedAt: null }, token, guest.user.email.toUpperCase());
    expect(c.slug).toBe("grasshopper");
    expect((await db.user.findUniqueOrThrow({ where: { id: guest.user.id } })).emailVerifiedAt).not.toBeNull(); // code proved the address
    expect((await db.communityInvite.findUniqueOrThrow({ where: { id: row.id } })).uses).toBe(1);
    await acceptInvite(actor(guest.user), token, guest.user.email); // idempotent: already a member, no extra use
    expect((await db.communityInvite.findUniqueOrThrow({ where: { id: row.id } })).uses).toBe(1);

    await db.communityInvite.update({ where: { id: row.id }, data: { maxUses: 1 } });
    expect(await inviteByToken(token)).toBeNull(); // used up
    await db.communityInvite.update({ where: { id: row.id }, data: { maxUses: 20 } });
    await expect(revokeInvite(actor(outsider.user), row.id)).resolves.toBeUndefined();
    expect(await inviteByToken(token)).not.toBeNull(); // others can't revoke it
    await revokeInvite(actor(member.user), row.id);
    expect(await inviteByToken(token)).toBeNull();
    await db.communityInvite.update({ where: { id: row.id }, data: { revokedAt: null, expiresAt: new Date(Date.now() - 1000) } });
    expect(await inviteByToken(token)).toBeNull(); // expired
  });
});

describe("private profile sharing", () => {
  it("public profiles need no share link; private ones get checkpoint links with owner visibility and revocation", async () => {
    const { user, profile } = await makeUser("shr1");
    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { visibility: "PUBLIC" } });
    await expect(createShare(user.id, {})).rejects.toBeInstanceOf(ShareError);
    expect(await getPublicProfile(profile.slug, null)).not.toBeNull(); // public: directly viewable

    await db.bIMProfessionalProfile.update({ where: { id: profile.id }, data: { visibility: "PRIVATE" } });
    expect(await getPublicProfile(profile.slug, null)).toBeNull(); // private: not viewable without the checkpoint
    const open = await createShare(user.id, { label: "Anyone", days: 7 });
    const token = open.url.split("/shared/")[1];
    const share = await shareByToken(token);
    expect(share).not.toBeNull();
    expect(JSON.stringify(await db.profileShare.findUniqueOrThrow({ where: { id: open.id } }))).not.toContain(token); // only a hash is stored
    expect(emailAllowed(share!, "anyone@x.test")).toBe(true);
    const view = await getPublicProfile(profile.slug, null, { viaShare: true });
    expect(view).not.toBeNull();
    expect(JSON.stringify(view)).not.toContain(user.email); // contact details stay out of the shared view
    await recordShareAccess(open.id, "Viewer@X.test");
    await recordShareAccess(open.id, "viewer@x.test"); // same address within the hour: counted once
    const listed = (await listShares(user.id)).find((s) => s.id === open.id)!;
    expect(listed.viewCount).toBe(1);
    expect(listed.accesses[0].email).toBe("viewer@x.test");

    await revokeShare(user.id, open.id);
    expect(await shareByToken(token)).toBeNull();
    const stranger = await makeUser("shr-stranger");
    const other = await createShare(user.id, {});
    await revokeShare(stranger.user.id, other.id); // someone else's link cannot be revoked
    expect(await shareByToken(other.url.split("/shared/")[1])).not.toBeNull();
  });

  it("a link restricted to one recipient only admits that address, and expired links stop working", async () => {
    const { user } = await makeUser("shr2");
    const r = await createShare(user.id, { recipientEmail: `Recruiter.${RUN}@Acme.test`, days: 1 });
    expect(r.emailed).toBe(true);
    const share = (await shareByToken(r.url.split("/shared/")[1]))!;
    expect(emailAllowed(share, `recruiter.${RUN}@acme.test`)).toBe(true);
    expect(emailAllowed(share, "someone.else@acme.test")).toBe(false);
    await expect(createShare(user.id, { recipientEmail: "bad" })).rejects.toBeInstanceOf(ShareError);
    await db.profileShare.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await shareByToken(r.url.split("/shared/")[1])).toBeNull();
  });
});
