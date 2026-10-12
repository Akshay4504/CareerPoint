import { log } from "@/lib/log";
import type { EmployerRole } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { generateToken, hashToken } from "@/lib/auth/password";
import { sendMail, appUrl } from "@/lib/mail";
import { Forbidden, require_, type EmployerCtx } from "./permissions";
import { ApplicationError } from "@/lib/applications/candidate";

// Company team management: invitations by emailed link, role changes, removal. Admin-only.

const INVITE_DAYS = 7;

export async function inviteMember(ctx: EmployerCtx, email: string, role: EmployerRole) {
  require_(ctx, "team.manage");
  const addr = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new ApplicationError("Enter a valid email address.");
  const existing = await db.user.findUnique({ where: { email: addr }, include: { employerUsers: true } });
  if (existing?.employerUsers.length) throw new ApplicationError("That person already belongs to a company.");
  if (existing && existing.role === "CANDIDATE") throw new ApplicationError("That email belongs to a candidate account. Ask them to register an employer account with a different email.");
  await db.employerInvite.deleteMany({ where: { companyId: ctx.companyId, email: addr, acceptedAt: null } });
  const token = generateToken();
  const invite = await db.employerInvite.create({ data: { companyId: ctx.companyId, email: addr, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000), invitedById: ctx.userId } });
  await audit(ctx.userId, "team.invited", "EmployerInvite", invite.id, { companyId: ctx.companyId, role });
  await sendMail({ to: addr, subject: `${ctx.userName} invited you to ${ctx.companyName} on CareerPoint`, text: `Join ${ctx.companyName} as ${role.toLowerCase().replace("_", " ")}:\n${appUrl()}/invite/${token}\n\nThe link expires in ${INVITE_DAYS} days.` }).catch((err) => log.error("team.invite_mail_failed", { err }));
  return { inviteId: invite.id, token };
}

/** The signed-in employer-type user (matching email, not yet in a company) accepts an invitation. */
export async function acceptInvite(userId: string, token: string) {
  const inv = await db.employerInvite.findUnique({ where: { tokenHash: hashToken(token) }, include: { company: { select: { name: true } } } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw new ApplicationError("This invitation is invalid or has expired.");
  const user = await db.user.findUnique({ where: { id: userId }, include: { employerUsers: true } });
  if (!user || user.email.toLowerCase() !== inv.email) throw new ApplicationError("This invitation was sent to a different email address.");
  if (user.role === "CANDIDATE") throw new ApplicationError("Candidate accounts can't join a company.");
  if (user.employerUsers.length) throw new ApplicationError("You already belong to a company.");
  await db.$transaction([db.employerUser.create({ data: { userId, companyId: inv.companyId, role: inv.role } }), db.user.update({ where: { id: userId }, data: { role: inv.role } }), db.employerInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } })]);
  await audit(userId, "team.joined", "Company", inv.companyId, { role: inv.role });
  return inv.company.name;
}

async function adminCount(companyId: string) {
  return db.employerUser.count({ where: { companyId, role: "EMPLOYER_ADMIN" } });
}

export async function changeMemberRole(ctx: EmployerCtx, memberId: string, role: EmployerRole) {
  require_(ctx, "team.manage");
  const m = await db.employerUser.findFirst({ where: { id: memberId, companyId: ctx.companyId } });
  if (!m) throw new ApplicationError("Member not found.");
  if (m.role === "EMPLOYER_ADMIN" && role !== "EMPLOYER_ADMIN" && (await adminCount(ctx.companyId)) <= 1) throw new ApplicationError("A company needs at least one admin.");
  await db.$transaction([db.employerUser.update({ where: { id: m.id }, data: { role } }), db.user.update({ where: { id: m.userId }, data: { role } }), db.session.deleteMany({ where: { userId: m.userId } })]);
  await audit(ctx.userId, "team.role_changed", "EmployerUser", m.id, { companyId: ctx.companyId, from: m.role, to: role });
}

export async function removeMember(ctx: EmployerCtx, memberId: string) {
  require_(ctx, "team.manage");
  const m = await db.employerUser.findFirst({ where: { id: memberId, companyId: ctx.companyId } });
  if (!m) throw new ApplicationError("Member not found.");
  if (m.userId === ctx.userId) throw new Forbidden("You can't remove yourself.");
  if (m.role === "EMPLOYER_ADMIN" && (await adminCount(ctx.companyId)) <= 1) throw new ApplicationError("A company needs at least one admin.");
  await db.employerUser.delete({ where: { id: m.id } });
  await db.session.deleteMany({ where: { userId: m.userId } });
  await audit(ctx.userId, "team.removed", "EmployerUser", m.id, { companyId: ctx.companyId });
}

export async function listTeam(ctx: EmployerCtx) {
  const [members, invites] = await Promise.all([
    db.employerUser.findMany({ where: { companyId: ctx.companyId }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    require_and(ctx) ? db.employerInvite.findMany({ where: { companyId: ctx.companyId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }) : [],
  ]);
  return { members, invites };
}

const require_and = (ctx: EmployerCtx) => ctx.role === "EMPLOYER_ADMIN";
