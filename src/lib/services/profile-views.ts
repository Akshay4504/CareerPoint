import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { msAgo } from "@/lib/utils";
import { notifyEvent } from "@/lib/notifications/service";

// First-party engagement analytics ONLY: views and actions that happen inside CareerPoint.
// We never track a candidate's activity on other websites.

export type ViewKind = "PROFILE" | "RESUME" | "PORTFOLIO" | "APPLICATION" | "SHORTLIST" | "CONTACT_REQUEST";

export const VIEW_LABEL: Record<ViewKind, string> = { PROFILE: "Profile views", RESUME: "Resume views", PORTFOLIO: "Portfolio views", APPLICATION: "Application views", SHORTLIST: "Shortlists", CONTACT_REQUEST: "Contact requests" };

/**
 * Records one view/action. Repeats by the same viewer (or company) within `dedupeHours` are collapsed so counts stay honest.
 * Returns true if a new row was written.
 */
export async function recordView(args: { profileId: string; kind: ViewKind; viewerUserId?: string | null; viewerCompanyId?: string | null; meta?: Prisma.InputJsonValue; dedupeHours?: number; dedupeBy?: "user" | "company" }): Promise<boolean> {
  const hours = args.dedupeHours ?? 12;
  const by = args.dedupeBy ?? (args.viewerCompanyId ? "company" : "user");
  const where: Prisma.ProfileViewWhereInput = { profileId: args.profileId, kind: args.kind, createdAt: { gt: msAgo(hours * 3600_000) }, ...(by === "company" ? { viewerCompanyId: args.viewerCompanyId ?? undefined } : { viewerUserId: args.viewerUserId ?? undefined }) };
  if (hours > 0 && (await db.profileView.findFirst({ where, select: { id: true } }))) return false;
  await db.profileView.create({ data: { profileId: args.profileId, kind: args.kind, viewerUserId: args.viewerUserId ?? null, viewerCompanyId: args.viewerCompanyId ?? null, meta: args.meta } });
  return true;
}

/** Records a verified-employer profile view and (at most once per company per day) tells the candidate. */
export async function recordEmployerProfileView(args: { profileId: string; candidateUserId: string; companyId: string; companyName: string; viewerUserId: string }) {
  const wrote = await recordView({ profileId: args.profileId, kind: "PROFILE", viewerUserId: args.viewerUserId, viewerCompanyId: args.companyId, dedupeHours: 24, dedupeBy: "company" });
  if (wrote) await notifyEvent(args.candidateUserId, "profile.viewed", { title: `${args.companyName} viewed your profile`, body: "A verified employer viewed your public BIM profile.", href: "/dashboard" });
  return wrote;
}

export async function viewSummary(profileId: string, days = 30) {
  const since = msAgo(days * 86400_000);
  const rows = await db.profileView.findMany({ where: { profileId, createdAt: { gte: since } }, select: { kind: true, viewerCompanyId: true, viewerCompany: { select: { verified: true, name: true } } } });
  const byKind: Record<string, number> = {};
  const verified = new Map<string, string>();
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    if (r.viewerCompanyId && r.viewerCompany?.verified) verified.set(r.viewerCompanyId, r.viewerCompany.name);
  }
  return { total: rows.length, byKind, verifiedEmployers: verified.size, employerNames: [...verified.values()].slice(0, 5), days };
}
