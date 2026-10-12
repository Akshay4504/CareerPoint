import "server-only";
import { createHash, randomBytes } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import type { FileKind, Visibility } from "@prisma/client";
import { db } from "@/lib/db";
import { EXT_FOR_MIME, sanitizeFilename, validateUpload } from "./validate";

// Files live OUTSIDE /public and are only reachable through /api/files/[id], which enforces authorization.
const root = () => path.resolve(process.env.STORAGE_DIR ?? "./storage");

function resolveKey(key: string) {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export type SaveResult = { ok: true; fileId: string; buffer: Buffer; mime: string } | { ok: false; error: string };

export async function saveUpload(opts: { ownerId: string; kind: FileKind; file: File | null; visibility?: Visibility }): Promise<SaveResult> {
  const { ownerId, kind, file } = opts;
  if (!file || typeof file === "string" || file.size === 0) return { ok: false, error: "Choose a file to upload." };
  const buffer = Buffer.from(await file.arrayBuffer());
  const v = validateUpload(kind, buffer);
  if (!v.ok) return v;

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const key = `${kind.toLowerCase()}/${ownerId}/${randomBytes(16).toString("hex")}.${EXT_FOR_MIME[v.mime]}`;
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buffer, { mode: 0o600 });

  const asset = await db.fileAsset.create({
    data: {
      ownerId,
      kind,
      storageKey: key,
      originalName: sanitizeFilename(file.name),
      mime: v.mime,
      size: buffer.length,
      sha256,
      visibility: opts.visibility ?? (kind === "RESUME" ? "PRIVATE" : "PRIVATE"),
    },
  });
  return { ok: true, fileId: asset.id, buffer, mime: v.mime };
}

export async function readStored(storageKey: string): Promise<Buffer> {
  return readFile(resolveKey(storageKey));
}

export async function deleteStored(fileId: string) {
  const asset = await db.fileAsset.findUnique({ where: { id: fileId } });
  if (!asset) return;
  await db.fileAsset.delete({ where: { id: fileId } });
  await unlink(resolveKey(asset.storageKey)).catch(() => {});
}

/** Remove every stored file of a user (used before account deletion; DB rows cascade). */
export async function deleteAllUserFiles(ownerId: string) {
  const assets = await db.fileAsset.findMany({ where: { ownerId }, select: { storageKey: true } });
  await Promise.all(assets.map((a) => unlink(resolveKey(a.storageKey)).catch(() => {})));
}
