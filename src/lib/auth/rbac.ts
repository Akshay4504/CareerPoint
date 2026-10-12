// Pure role helpers (no I/O) so authorization rules are unit-testable.
import type { Role } from "@prisma/client";

export const ALL_ROLES: Role[] = ["CANDIDATE", "EMPLOYER", "RECRUITER", "EMPLOYER_ADMIN", "MODERATOR", "ADMIN"];

export const EMPLOYER_ROLES: Role[] = ["EMPLOYER", "RECRUITER", "EMPLOYER_ADMIN"];
export const STAFF_ROLES: Role[] = ["MODERATOR", "ADMIN"];

export const isEmployerRole = (r: Role) => EMPLOYER_ROLES.includes(r);
export const isStaff = (r: Role) => STAFF_ROLES.includes(r);
export const isAdmin = (r: Role) => r === "ADMIN";
export const isCandidate = (r: Role) => r === "CANDIDATE";

/** Roles that may self-register. Staff roles can only be granted by an admin. */
export const SELF_REGISTER_ROLES: Role[] = ["CANDIDATE", "EMPLOYER_ADMIN"];

export type Area = "app" | "employer" | "admin" | "admin-users";

const AREA_ROLES: Record<Area, Role[]> = {
  // Candidate workspace: candidates only (staff may preview via admin tools, not the candidate workspace).
  app: ["CANDIDATE"],
  employer: EMPLOYER_ROLES,
  admin: STAFF_ROLES,
  "admin-users": ["ADMIN"],
};

export function canAccess(role: Role, area: Area): boolean {
  return AREA_ROLES[area].includes(role);
}

/** Where a signed-in user lands by default. */
export function homeFor(role: Role): string {
  if (isStaff(role)) return "/admin";
  if (isEmployerRole(role)) return "/employer";
  return "/dashboard";
}

/** Admin-only actions need ADMIN; moderators handle jobs/employers/applications. */
export function canModerate(role: Role) {
  return isStaff(role);
}
