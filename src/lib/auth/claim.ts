import { createHmac, timingSafeEqual } from "crypto";
import { signingSecret } from "@/lib/files/signed";

// A "claim" is a short-lived, signed statement stored in an httpOnly cookie: "this browser proved control of <email>
// for <subject>". Used after an email code is verified (community invite links, private profile shares).
// It is bound to one subject and one email, expires, and cannot be forged without AUTH_SECRET.

export type Claim = { kind: "invite" | "share"; subjectId: string; email: string; exp: number };

const sig = (payload: string) => createHmac("sha256", signingSecret()).update(payload).digest("base64url");

export const claimCookieName = (kind: Claim["kind"], subjectId: string) => `careerpoint_${kind}_${subjectId.slice(-12)}`;

export function signClaim(kind: Claim["kind"], subjectId: string, email: string, ttlSec: number, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ k: kind, s: subjectId, e: email.toLowerCase(), x: Math.floor(now / 1000) + ttlSec })).toString("base64url");
  return `${payload}.${sig(payload)}`;
}

export function verifyClaim(value: string | undefined, kind: Claim["kind"], subjectId: string, now = Date.now()): Claim | null {
  if (!value) return null;
  const [payload, given] = value.split(".");
  if (!payload || !given) return null;
  const expected = Buffer.from(sig(payload));
  const g = Buffer.from(given);
  if (expected.length !== g.length || !timingSafeEqual(expected, g)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString()) as { k: string; s: string; e: string; x: number };
    if (d.k !== kind || d.s !== subjectId || d.x * 1000 < now) return null;
    return { kind, subjectId, email: d.e, exp: d.x };
  } catch {
    return null;
  }
}
