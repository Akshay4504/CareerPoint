import type { EmployerRole } from "@prisma/client";

// Employer team permissions. One matrix, enforced server-side in every employer service function.
//   EMPLOYER        – hiring manager: reviews and comments, can shortlist, cannot change jobs or reject/offer.
//   RECRUITER       – runs the pipeline: jobs, stages, interviews, messages, candidate search.
//   EMPLOYER_ADMIN  – everything, plus company profile and team.

export type Capability = "jobs.manage" | "applications.view" | "applications.shortlist" | "applications.move" | "applications.notes" | "interviews.manage" | "messages.send" | "candidates.search" | "analytics.view" | "company.manage" | "team.manage";

const VIEWER: Capability[] = ["applications.view", "applications.shortlist", "applications.notes", "candidates.search", "analytics.view"];
const RECRUITER: Capability[] = [...VIEWER, "jobs.manage", "applications.move", "interviews.manage", "messages.send"];

export const CAPABILITIES: Record<EmployerRole, Capability[]> = {
  EMPLOYER: VIEWER,
  RECRUITER,
  EMPLOYER_ADMIN: [...RECRUITER, "company.manage", "team.manage"],
};

export const can = (role: EmployerRole, cap: Capability) => CAPABILITIES[role].includes(cap);

export type EmployerCtx = { userId: string; userName: string; companyId: string; companyName: string; role: EmployerRole; verified: boolean };

export class Forbidden extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "Forbidden";
  }
}

export function require_(ctx: EmployerCtx, cap: Capability) {
  if (!can(ctx.role, cap)) throw new Forbidden(`Your role (${ctx.role.toLowerCase().replace("_", " ")}) can't do this.`);
}

export const ROLE_LABEL: Record<EmployerRole, string> = { EMPLOYER: "Hiring manager", RECRUITER: "Recruiter", EMPLOYER_ADMIN: "Admin" };
