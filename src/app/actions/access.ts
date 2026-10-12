"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { actionUser } from "@/lib/auth/guards";
import { clientInfo } from "@/lib/auth/session";
import { ChallengeError, checkChallenge, isEmail, normalizeEmail, sendChallenge } from "@/lib/auth/challenge";
import { claimCookieName, signClaim, verifyClaim } from "@/lib/auth/claim";
import { CommunityError, acceptInvite, createInvite, decideJoinRequest, cancelJoinRequest, inviteByToken, leaveCommunity, requestToJoin, revokeInvite } from "@/lib/communities/service";
import { ShareError, createShare, emailAllowed, recordShareAccess, revokeShare, shareByToken } from "@/lib/profile-share";
import { appUrl } from "@/lib/mail";
import { log } from "@/lib/log";
import type { ActionState } from "@/components/forms";

// Email-gated access: community invite links and private-profile share links.
// Flow: type email -> receive a one-time code -> enter it -> a signed, short-lived cookie records that this browser
// proved control of that address for exactly this link.

export type StepResult = { ok: boolean; error?: string; redirectTo?: string };

const CLAIM_INVITE_SEC = 30 * 60;
const CLAIM_SHARE_SEC = 6 * 3600;

async function setClaim(kind: "invite" | "share", subjectId: string, email: string, ttl: number) {
  (await cookies()).set(claimCookieName(kind, subjectId), signClaim(kind, subjectId, email, ttl), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ttl });
}

const fail = (e: unknown): StepResult => {
  if (e instanceof ChallengeError || e instanceof CommunityError || e instanceof ShareError) return { ok: false, error: e.message };
  log.error("access.action_failed", { err: e });
  return { ok: false, error: "Something went wrong. Please try again." };
};

// ---- community invite links ---------------------------------------------------------------------------------------

export async function sendInviteCodeAction(token: string, email: string): Promise<StepResult> {
  try {
    const inv = await inviteByToken(token);
    if (!inv) return { ok: false, error: "This invitation is invalid, expired or has been used up." };
    const { ip } = await clientInfo();
    await sendChallenge({ purpose: "community_invite", subjectId: inv.id, email, ip, subject: `Your CareerPoint code to join ${inv.community.name}`, intro: `You asked to join the ${inv.community.name} community on CareerPoint.` });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function verifyInviteCodeAction(token: string, email: string, code: string): Promise<StepResult> {
  try {
    const inv = await inviteByToken(token);
    if (!inv) return { ok: false, error: "This invitation is invalid, expired or has been used up." };
    if (!(await checkChallenge({ purpose: "community_invite", subjectId: inv.id, email, code }))) return { ok: false, error: "That code is wrong or has expired. Request a new one." };
    await setClaim("invite", inv.id, normalizeEmail(email), CLAIM_INVITE_SEC);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Final step: the signed-in account must own the email that was verified for this invitation. */
export async function acceptCommunityInviteAction(token: string, _p: ActionState, _fd: FormData): Promise<ActionState> {
  const user = await actionUser();
  if (!user) return { error: "Please sign in first." };
  try {
    const inv = await inviteByToken(token);
    if (!inv) return { error: "This invitation is invalid, expired or has been used up." };
    const claim = verifyClaim((await cookies()).get(claimCookieName("invite", inv.id))?.value, "invite", inv.id);
    if (!claim) return { error: "Verify your email address first." };
    const c = await acceptInvite(user, token, claim.email);
    (await cookies()).delete(claimCookieName("invite", inv.id));
    revalidatePath("/communities");
    return { ok: `You joined ${c.name}.`, redirectTo: `/communities/${c.slug}` };
  } catch (e) {
    return { error: e instanceof CommunityError ? e.message : (log.error("access.accept_failed", { err: e }), "Something went wrong. Please try again.") };
  }
}

// ---- community membership requests / invites management ---------------------------------------------------------------

export async function requestJoinAction(slug: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await actionUser();
  if (!user) return { error: "Please sign in first." };
  try {
    await requestToJoin(user, slug, String(fd.get("message") ?? ""));
    revalidatePath(`/communities/${slug}`);
    revalidatePath("/communities");
    return { ok: "Request sent. A moderator will review it." };
  } catch (e) {
    return { error: e instanceof CommunityError ? e.message : (log.error("access.request_failed", { err: e }), "Something went wrong. Please try again.") };
  }
}

export async function cancelJoinRequestAction(slug: string): Promise<void> {
  const user = await actionUser();
  if (!user) return;
  await cancelJoinRequest(user, slug);
  revalidatePath(`/communities/${slug}`);
  revalidatePath("/communities");
}

export async function leaveCommunityAction(slug: string): Promise<void> {
  const user = await actionUser();
  if (!user) return;
  await leaveCommunity(user, slug);
  revalidatePath(`/communities/${slug}`);
  revalidatePath("/communities");
}

export async function createInviteAction(slug: string): Promise<{ ok: boolean; url?: string; expiresAt?: string; error?: string }> {
  const user = await actionUser();
  if (!user) return { ok: false, error: "Please sign in first." };
  try {
    const r = await createInvite(user, slug);
    revalidatePath(`/communities/${slug}`);
    return { ok: true, url: `${appUrl()}/communities/join/${r.token}`, expiresAt: r.expiresAt.toISOString() };
  } catch (e) {
    return { ok: false, error: fail(e).error };
  }
}

export async function revokeInviteAction(slug: string, inviteId: string): Promise<void> {
  const user = await actionUser();
  if (!user) return;
  await revokeInvite(user, inviteId);
  revalidatePath(`/communities/${slug}`);
}

export async function decideJoinRequestAction(requestId: string, approve: boolean): Promise<void> {
  const user = await actionUser("admin");
  if (!user) return;
  try {
    await decideJoinRequest(user, requestId, approve);
  } catch (e) {
    if (!(e instanceof CommunityError)) log.error("access.decide_failed", { err: e });
  }
  revalidatePath("/admin/reports");
}

// ---- private profile share links ---------------------------------------------------------------------------------

export async function createShareAction(input: { recipientEmail?: string; label?: string; days?: number }): Promise<{ ok: boolean; url?: string; emailed?: boolean; error?: string }> {
  const user = await actionUser("app");
  if (!user) return { ok: false, error: "Please sign in first." };
  try {
    const r = await createShare(user.id, input);
    revalidatePath("/profile");
    return { ok: true, url: r.url, emailed: r.emailed };
  } catch (e) {
    return { ok: false, error: fail(e).error };
  }
}

export async function revokeShareAction(shareId: string): Promise<void> {
  const user = await actionUser("app");
  if (!user) return;
  await revokeShare(user.id, shareId);
  revalidatePath("/profile");
}

export async function sendShareCodeAction(token: string, email: string): Promise<StepResult> {
  try {
    const share = await shareByToken(token);
    if (!share) return { ok: false, error: "This link is invalid, expired or has been revoked." };
    const clean = normalizeEmail(email);
    if (!isEmail(clean)) return { ok: false, error: "Enter a valid email address." };
    // Identical response whether or not the address is allowed, so the checkpoint never reveals who the link was meant for.
    if (emailAllowed(share, clean)) {
      const { ip } = await clientInfo();
      await sendChallenge({ purpose: "profile_share", subjectId: share.id, email: clean, ip, subject: `Your CareerPoint code to view ${share.profile.user.name}'s profile`, intro: `Someone shared ${share.profile.user.name}'s private CareerPoint profile with you.` });
    }
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function verifyShareCodeAction(token: string, email: string, code: string): Promise<StepResult> {
  try {
    const share = await shareByToken(token);
    if (!share) return { ok: false, error: "This link is invalid, expired or has been revoked." };
    const clean = normalizeEmail(email);
    if (!emailAllowed(share, clean) || !(await checkChallenge({ purpose: "profile_share", subjectId: share.id, email: clean, code }))) return { ok: false, error: "That code is wrong or has expired. Request a new one." };
    await setClaim("share", share.id, clean, CLAIM_SHARE_SEC);
    await recordShareAccess(share.id, clean);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
