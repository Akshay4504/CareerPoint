import type { FileAsset, Role } from "@prisma/client";
import { db } from "@/lib/db";

export type FileViewer = { id: string; role: Role; employerUsers: { companyId: string }[] } | null;

/**
 * Authorisation for stored files (single source of truth, used by /api/files/[id]).
 *  - Owner: always.
 *  - Employers: a candidate's resume file only when the candidate applied to one of the employer's jobs with it.
 *  - Anyone: profile photo while the profile is PUBLIC; project/portfolio images only when the item is published
 *    (published project, or standalone item) AND the profile is PUBLIC.
 *  - Company logos: public once the company is verified; members can always see their own.
 *  - Everyone else (including staff and other candidates): denied.
 */
export async function canReadFile(viewer: FileViewer, asset: Pick<FileAsset, "id" | "ownerId" | "kind">): Promise<{ allowed: boolean; public: boolean }> {
  if (viewer?.id === asset.ownerId) return { allowed: true, public: false };

  if (asset.kind === "PROFILE_IMAGE") {
    const p = await db.bIMProfessionalProfile.findFirst({ where: { avatarFileId: asset.id, visibility: "PUBLIC" }, select: { id: true } });
    return { allowed: !!p, public: !!p };
  }
  if (asset.kind === "PORTFOLIO_IMAGE") {
    const item = await db.portfolioItem.findFirst({
      where: { fileId: asset.id, profile: { visibility: "PUBLIC" }, OR: [{ projectId: null }, { project: { published: true } }] },
      select: { id: true },
    });
    if (item) return { allowed: true, public: true };
    // Work a candidate explicitly attached to a native application is visible to that employer, even if unpublished.
    if (viewer?.employerUsers.length) {
      const it = await db.portfolioItem.findFirst({ where: { fileId: asset.id }, select: { id: true, projectId: true, profile: { select: { userId: true } } } });
      if (it) {
        const shared = await db.application.findFirst({
          where: { userId: it.profile.userId, external: false, job: { companyId: { in: viewer.employerUsers.map((m) => m.companyId) } }, OR: [{ portfolioItemIds: { has: it.id } }, ...(it.projectId ? [{ portfolioProjectIds: { has: it.projectId } }] : [])] },
          select: { id: true },
        });
        if (shared) return { allowed: true, public: false };
      }
    }
    return { allowed: false, public: false };
  }
  if (asset.kind === "COMPANY_LOGO") {
    const c = await db.company.findFirst({ where: { logoFileId: asset.id, OR: [{ verified: true }, ...(viewer?.employerUsers.length ? [{ id: { in: viewer.employerUsers.map((m) => m.companyId) } }] : [])] }, select: { id: true, verified: true } });
    return { allowed: !!c, public: !!c?.verified };
  }
  if (asset.kind === "RESUME" && viewer?.employerUsers.length) {
    const app = await db.application.findFirst({
      // Only NATIVE applications: an external application is the candidate's private tracking record.
      where: { external: false, job: { companyId: { in: viewer.employerUsers.map((m) => m.companyId) } }, resumeVersion: { resume: { sourceFileId: asset.id } } },
      select: { id: true },
    });
    return { allowed: !!app, public: false };
  }
  return { allowed: false, public: false };
}
