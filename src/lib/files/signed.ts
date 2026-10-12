import { createHmac, timingSafeEqual } from "crypto";

// Short-lived, viewer-bound signed links for private files shared with employers (e.g. an applicant's resume).
// A link is valid only for the user it was minted for, only for one file, and only until it expires — so a copied or
// forwarded link is useless to anyone else. The download route ALSO re-checks authorization on every request.

export function signingSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET (16+ chars) must be set in production");
  return "careerpoint-development-secret-not-for-production";
}

const mac = (fileId: string, viewerId: string, exp: number) => createHmac("sha256", signingSecret()).update(`${fileId}.${viewerId}.${exp}`).digest("base64url");

export function signFileUrl(fileId: string, viewerId: string, ttlSec = 300, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSec;
  return `/api/files/${fileId}?v=${encodeURIComponent(viewerId)}&e=${exp}&s=${mac(fileId, viewerId, exp)}`;
}

export function verifyFileSignature(fileId: string, viewerId: string, params: { v?: string | null; e?: string | null; s?: string | null }, now = Date.now()): boolean {
  if (!params.v || !params.e || !params.s || params.v !== viewerId) return false;
  const exp = Number(params.e);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = Buffer.from(mac(fileId, viewerId, exp));
  const given = Buffer.from(params.s);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
