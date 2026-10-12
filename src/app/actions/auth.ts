"use server";

import { redirect } from "next/navigation";
import { log } from "@/lib/log";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { createSession, destroySession, clientInfo, getCurrentUser, currentToken, destroyOtherSessions } from "@/lib/auth/session";
import { dummyHash, generateToken, hashPassword, hashToken, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { rateLimitShared, resetRateLimitShared } from "@/lib/auth/rate-limit";
import { homeFor } from "@/lib/auth/rbac";
import { safeNext } from "@/lib/auth/next";
import { deleteAllUserFiles } from "@/lib/files/storage";
import { appUrl, sendMail } from "@/lib/mail";
import { ensureProfile } from "@/lib/services/profile";
import { slugify, uniqueSuffix } from "@/lib/utils";
import type { ActionState } from "@/components/forms";

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

async function issueToken(userId: string, type: "VERIFY_EMAIL" | "RESET_PASSWORD", ttlMs: number) {
  const token = generateToken();
  await db.authToken.create({ data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) } });
  return token;
}

async function sendVerification(user: { id: string; email: string; name: string }) {
  const token = await issueToken(user.id, "VERIFY_EMAIL", 48 * 3600_000);
  await sendMail({
    to: user.email,
    subject: "Verify your CareerPoint email",
    text: `Hi ${user.name},\n\nConfirm your email to finish setting up CareerPoint:\n${appUrl()}/verify-email?token=${token}\n\nThe link expires in 48 hours.`,
  });
}

const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(100),
  email: emailSchema,
  password: passwordSchema,
  accountType: z.enum(["CANDIDATE", "EMPLOYER_ADMIN"]),
  companyName: z.string().trim().max(120).optional(),
});

export async function registerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ip } = await clientInfo();
  if (!(await rateLimitShared(`register:${ip}`, 8, 3600_000)).ok) return { error: "Too many sign-up attempts. Try again later." };

  const parsed = registerSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, email, password, accountType, companyName } = parsed.data;
  if (accountType === "EMPLOYER_ADMIN" && !companyName) return { error: "Enter your company name." };

  if (await db.user.findUnique({ where: { email } })) return { error: "An account with this email already exists. Try signing in." };

  const passwordHash = await hashPassword(password);
  const user = await db.user.create({ data: { name, email, passwordHash, role: accountType } });

  if (accountType === "CANDIDATE") {
    await ensureProfile(user);
  } else {
    const company = await db.company.create({ data: { name: companyName!, slug: `${slugify(companyName!, 50)}-${uniqueSuffix(4)}` } });
    await db.employerUser.create({ data: { userId: user.id, companyId: company.id, role: "EMPLOYER_ADMIN" } });
  }
  await audit(user.id, "auth.register", "User", user.id, { role: accountType });
  await sendVerification(user).catch((err) => log.error("auth.verification_mail_failed", { userId: user.id, err }));
  await createSession(user.id);
  redirect(safeNext(fd.get("next")) ?? homeFor(user.role));
}

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password").max(128) });

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, password } = parsed.data;
  const { ip } = await clientInfo();
  const key = `login:${ip}:${email}`;
  if (!(await rateLimitShared(key, 8, 15 * 60_000)).ok || !(await rateLimitShared(`login-ip:${ip}`, 40, 15 * 60_000)).ok) return { error: "Too many attempts. Wait a few minutes and try again." };

  const user = await db.user.findUnique({ where: { email } });
  const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !valid) {
    await audit(user?.id ?? null, "auth.login_failed", "User", user?.id, { email });
    return { error: "Incorrect email or password." };
  }
  if (user.status !== "ACTIVE") return { error: "This account has been suspended. Contact support." };

  await resetRateLimitShared(key);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id);
  await audit(user.id, "auth.login", "User", user.id);
  redirect(safeNext(fd.get("next")) ?? homeFor(user.role));
}

export async function logoutAction() {
  const user = await getCurrentUser();
  await destroySession();
  if (user) await audit(user.id, "auth.logout", "User", user.id);
  redirect("/");
}

export async function forgotPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = emailSchema.safeParse(fd.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  const { ip } = await clientInfo();
  if (!(await rateLimitShared(`forgot:${ip}`, 5, 3600_000)).ok) return { error: "Too many requests. Try again later." };
  const user = await db.user.findUnique({ where: { email: parsed.data } });
  if (user && user.status === "ACTIVE") {
    const token = await issueToken(user.id, "RESET_PASSWORD", 3600_000);
    await sendMail({ to: user.email, subject: "Reset your CareerPoint password", text: `Reset your password (valid for 1 hour):\n${appUrl()}/reset-password?token=${token}\n\nIf you did not request this, ignore this email.` }).catch((err) => log.error("auth.reset_mail_failed", { err }));
    await audit(user.id, "auth.reset_requested", "User", user.id);
  }
  // Identical response whether or not the account exists.
  return { ok: "If an account exists for that email, a reset link is on its way." };
}

export async function resetPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const token = String(fd.get("token") ?? "");
  const pw = passwordSchema.safeParse(fd.get("password"));
  if (!pw.success) return { error: pw.error.issues[0].message };
  if (fd.get("password") !== fd.get("confirm")) return { error: "Passwords do not match." };
  const rec = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!rec || rec.type !== "RESET_PASSWORD" || rec.usedAt || rec.expiresAt < new Date()) return { error: "This reset link is invalid or has expired. Request a new one." };
  await db.$transaction([
    db.user.update({ where: { id: rec.userId }, data: { passwordHash: await hashPassword(pw.data) } }),
    db.authToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    db.session.deleteMany({ where: { userId: rec.userId } }),
  ]);
  await audit(rec.userId, "auth.password_reset", "User", rec.userId);
  redirect("/login?reset=1");
}

export async function resendVerificationAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user || user.emailVerifiedAt) return;
  const { ip } = await clientInfo();
  if (!(await rateLimitShared(`resend:${user.id}`, 3, 3600_000)).ok || !(await rateLimitShared(`resend-ip:${ip}`, 10, 3600_000)).ok) return;
  await sendVerification(user);
}

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const next = passwordSchema.safeParse(fd.get("newPassword"));
  if (!next.success) return { error: next.error.issues[0].message };
  if (!(await rateLimitShared(`chpw:${user.id}`, 6, 15 * 60_000)).ok) return { error: "Too many attempts. Try later." };
  if (!(await verifyPassword(String(fd.get("currentPassword") ?? ""), user.passwordHash))) return { error: "Current password is incorrect." };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next.data) } });
  await destroyOtherSessions(user.id, await currentToken());
  await audit(user.id, "auth.password_changed", "User", user.id);
  return { ok: "Password updated. Other devices were signed out." };
}

export async function signOutOthersAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await destroyOtherSessions(user.id, await currentToken());
  await audit(user.id, "auth.sessions_revoked", "User", user.id);
}

export async function deleteAccountAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  if (user.role === "ADMIN") return { error: "Admin accounts cannot be self-deleted." };
  if (!(await verifyPassword(String(fd.get("password") ?? ""), user.passwordHash))) return { error: "Password is incorrect." };
  await audit(user.id, "auth.account_deleted", "User", user.id);
  await destroySession();
  await deleteAllUserFiles(user.id);
  await db.user.delete({ where: { id: user.id } });
  redirect("/?deleted=1");
}

const inviteRegisterSchema = z.object({ token: z.string().min(10).max(200), name: z.string().trim().min(2, "Enter your full name").max(100), password: passwordSchema });

/** Create an account from a team invitation. The invite email is the account email (and counts as verified: the invite reached that inbox). */
export async function registerInviteAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ip } = await clientInfo();
  if (!(await rateLimitShared(`register:${ip}`, 8, 3600_000)).ok) return { error: "Too many sign-up attempts. Try again later." };
  const parsed = inviteRegisterSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const inv = await db.employerInvite.findUnique({ where: { tokenHash: hashToken(parsed.data.token) } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) return { error: "This invitation is invalid or has expired." };
  if (await db.user.findUnique({ where: { email: inv.email } })) return { error: "An account with this email already exists. Sign in to accept the invitation." };
  const passwordHash = await hashPassword(parsed.data.password);
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { name: parsed.data.name, email: inv.email, passwordHash, role: inv.role, emailVerifiedAt: new Date() } });
    await tx.employerUser.create({ data: { userId: u.id, companyId: inv.companyId, role: inv.role } });
    await tx.employerInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    return u;
  });
  await audit(user.id, "team.joined", "Company", inv.companyId, { role: inv.role, viaInvite: true });
  await createSession(user.id);
  redirect(homeFor(user.role));
}
