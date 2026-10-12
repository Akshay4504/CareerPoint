import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { readStored } from "@/lib/files/storage";
import { canReadFile } from "@/lib/files/access";
import { verifyFileSignature } from "@/lib/files/signed";
import { audit } from "@/lib/audit";
import { EXT_FOR_MIME } from "@/lib/files/validate";

export const dynamic = "force-dynamic";

const deny = () => new NextResponse("Not found", { status: 404 });

/**
 * Authorised file delivery. Files are never served statically.
 *  - Owner: always.
 *  - Employers: a candidate's resume file only when that candidate applied to one of the employer's jobs with it.
 *  - Anyone: profile/portfolio images only while the owner's profile is PUBLIC.
 * Everything else is a 404 (not 403) so file ids cannot be probed.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await db.fileAsset.findUnique({ where: { id } });
  if (!asset) return deny();
  const user = await getCurrentUser();

  const { allowed, public: isPublic } = await canReadFile(user, asset);
  if (!allowed) return deny();

  // Private resumes opened by anyone other than their owner need a fresh, viewer-bound signed link (see lib/files/signed.ts).
  if (asset.kind === "RESUME" && user && user.id !== asset.ownerId) {
    const q = new URL(req.url).searchParams;
    if (!verifyFileSignature(asset.id, user.id, { v: q.get("v"), e: q.get("e"), s: q.get("s") })) return deny();
    await audit(user.id, "resume.accessed", "FileAsset", asset.id, { companyId: user.employerUsers[0]?.companyId ?? null, via: "download" });
  }

  let buf: Buffer;
  try {
    buf = await readStored(asset.storageKey);
  } catch {
    return deny();
  }
  const inline = asset.kind !== "RESUME";
  const ext = EXT_FOR_MIME[asset.mime] ?? "bin";
  const filename = asset.originalName.replace(/"/g, "");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": asset.mime,
      "Content-Length": String(buf.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.endsWith(`.${ext}`) ? filename : `${filename}.${ext}`}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": isPublic ? "public, max-age=300" : "private, no-store",
    },
  });
}
