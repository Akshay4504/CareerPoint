// Pure file validation: size limits + magic-byte sniffing (never trust the browser-supplied MIME or extension).
import type { FileKind } from "@prisma/client";

export type FileRule = { maxBytes: number; mimes: string[]; label: string };

export const FILE_RULES: Record<FileKind, FileRule> = {
  RESUME: {
    maxBytes: 5 * 1024 * 1024,
    mimes: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"],
    label: "PDF, DOCX or TXT up to 5 MB",
  },
  PORTFOLIO_IMAGE: { maxBytes: 5 * 1024 * 1024, mimes: ["image/png", "image/jpeg", "image/webp"], label: "PNG, JPG or WebP up to 5 MB" },
  PROFILE_IMAGE: { maxBytes: 2 * 1024 * 1024, mimes: ["image/png", "image/jpeg", "image/webp"], label: "PNG, JPG or WebP up to 2 MB" },
  COMPANY_LOGO: { maxBytes: 1024 * 1024, mimes: ["image/png", "image/jpeg", "image/webp"], label: "PNG, JPG or WebP up to 1 MB" },
};

export const EXT_FOR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  // DOCX is a ZIP container containing word/document.xml (checked loosely by the entry name in the central directory).
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)) {
    return buf.includes(Buffer.from("word/")) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : null;
  }
  // Plain text: no NUL bytes in the first 4 KB and valid-looking UTF-8.
  const head = buf.subarray(0, 4096);
  if (head.length && !head.includes(0)) {
    // Any control character other than tab/newline/carriage-return means this is binary, not text.
    const hasControl = head.some((b) => b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d);
    const s = head.toString("utf8");
    if (!hasControl && !s.includes("�")) return "text/plain";
  }
  return null;
}

export type ValidationResult = { ok: true; mime: string } | { ok: false; error: string };

export function validateUpload(kind: FileKind, buf: Buffer): ValidationResult {
  const rule = FILE_RULES[kind];
  if (buf.length === 0) return { ok: false, error: "The file is empty." };
  if (buf.length > rule.maxBytes) return { ok: false, error: `File is too large. Allowed: ${rule.label}.` };
  const mime = sniffMime(buf);
  if (!mime || !rule.mimes.includes(mime)) return { ok: false, error: `Unsupported file type. Allowed: ${rule.label}.` };
  return { ok: true, mime };
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/\0]/g, "_").replace(/[^\w.\- ()]/g, "").slice(0, 120) || "file";
}
