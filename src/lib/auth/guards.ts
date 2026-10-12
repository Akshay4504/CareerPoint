import "server-only";
import { notFound, redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getCurrentUser, type SessionUser } from "./session";
import { canAccess, homeFor, type Area } from "./rbac";
import { db } from "@/lib/db";

/** Any signed-in user. Redirects to login otherwise. */
export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return user;
}

/** Signed-in user allowed in an area. Wrong-role users are sent to their own home, never shown the page. */
export async function requireArea(area: Area): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAccess(user.role, area)) redirect(homeFor(user.role));
  return user;
}

export async function requireRoles(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

/** Candidate with a profile (created on demand). */
export async function requireCandidate() {
  const user = await requireArea("app");
  const profile = await db.bIMProfessionalProfile.findUnique({ where: { userId: user.id } });
  return { user, profile };
}

/** Employer user plus their company membership. Throws 404 if the account has no company. */
export async function requireEmployer() {
  const user = await requireArea("employer");
  const membership = user.employerUsers[0];
  if (!membership) notFound();
  return { user, membership, company: membership.company };
}

/** Server-action variants return a result instead of redirecting. */
export async function actionUser(area?: Area): Promise<SessionUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (area && !canAccess(user.role, area)) return null;
  return user;
}

/** Employer user plus their resolved company context (role, capabilities, verification). 404 if they have no company. */
export async function requireEmployerCtx() {
  const user = await requireArea("employer");
  const { employerCtx } = await import("@/lib/applications/employer");
  const ctx = await employerCtx(user.id);
  if (!ctx) notFound();
  return { user, ctx };
}
