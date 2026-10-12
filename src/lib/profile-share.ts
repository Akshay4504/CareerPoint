import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { generateToken, hashToken } from "@/lib/auth/password";
import { rateLimitShared } from "@/lib/auth/rate-limit";
import { appUrl, sendMail } from "@/lib/mail";
import { isEmail, normalizeEmail } from "@/lib/auth/challenge";

// Sharing a profile.
//  - PUBLIC profile: share /professionals/<slug> directly, no checkpoint.
//  - PRIVATE profile: the owner creates a share link. Whoever opens it must verify an email address with a one-time
//    code first (and, if the owner named a recipient, it must be that address). The owner can see who got in and revoke.

export class ShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareError";
  }
}

export const SHARE_DEFAULT_DAYS = 30;
export const SHARE_MAX_DAYS = 90;

export async function createShare(userId: string, input: { recipientEmail?: string; label?: string; days?: number }) {
  const profile = await db.bIMProfessionalProfile.findUnique({ where: { userId }, select: { id: true, visibility: true, user: { select: { name: true } } } });
  if (!profile) throw new ShareError("Profile not found.");
  if (profile.visibility === "PUBLIC") throw new ShareError("Your profile is public. Share its public link directly; no checkpoint is needed.");
  if (!(await rateLimitShared(`profile-share:${userId}`, 20, 86400_000)).ok) throw new ShareError("You have created many share links today. Try again tomorrow.");
  const recipient = input.recipientEmail?.trim() ? normalizeEmail(input.recipientEmail) : null;
  if (recipient && !isEmail(recipient)) throw new ShareError("Enter a valid recipient email address.");
  const days = Math.max(1, Math.min(SHARE_MAX_DAYS, Math.round(input.days ?? SHARE_DEFAULT_DAYS)));
  const token = generateToken(24);
  const share = await db.profileShare.create({ data: { profileId: profile.id, tokenHash: hashToken(token), recipientEmail: recipient, label: input.label?.trim().slice(0, 80) || null, expiresAt: new Date(Date.now() + days * 86400_000) } });
  await audit(userId, "profile.share_created", "ProfileShare", share.id, { restricted: !!recipient });
  const url = `${appUrl()}/shared/${token}`;
  if (recipient) {
    await sendMail({ to: recipient, subject: `${profile.user.name} shared their BIM profile with you`, text: `${profile.user.name} shared a private CareerPoint profile with you.\n\nOpen it here: ${url}\n\nYou'll be asked to confirm this email address with a one-time code before you can view it. The link expires in ${days} days.` });
  }
  return { url, id: share.id, expiresAt: share.expiresAt, emailed: !!recipient };
}

export async function listShares(userId: string) {
  const profile = await db.bIMProfessionalProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return [];
  return db.profileShare.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, label: true, recipientEmail: true, expiresAt: true, revokedAt: true, viewCount: true, createdAt: true, accesses: { orderBy: { createdAt: "desc" }, take: 5, select: { email: true, createdAt: true } } },
  });
}

export async function revokeShare(userId: string, shareId: string) {
  const r = await db.profileShare.updateMany({ where: { id: shareId, revokedAt: null, profile: { userId } }, data: { revokedAt: new Date() } });
  if (r.count) await audit(userId, "profile.share_revoked", "ProfileShare", shareId);
}

export async function shareByToken(token: string) {
  const s = await db.profileShare.findUnique({ where: { tokenHash: hashToken(token) }, include: { profile: { select: { slug: true, visibility: true, user: { select: { name: true } } } } } });
  if (!s || s.revokedAt || (s.expiresAt && s.expiresAt < new Date())) return null;
  return s;
}

/** Whether this address may pass the checkpoint for this share. */
export const emailAllowed = (share: { recipientEmail: string | null }, email: string) => !share.recipientEmail || share.recipientEmail === normalizeEmail(email);

/** Records that a verified address viewed the profile (at most once per address per hour). */
export async function recordShareAccess(shareId: string, email: string) {
  const e = normalizeEmail(email);
  const recent = await db.profileShareAccess.findFirst({ where: { shareId, email: e, createdAt: { gt: new Date(Date.now() - 3600_000) } }, select: { id: true } });
  if (recent) return;
  await db.$transaction([db.profileShareAccess.create({ data: { shareId, email: e } }), db.profileShare.update({ where: { id: shareId }, data: { viewCount: { increment: 1 } } })]);
}
