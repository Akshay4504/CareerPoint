import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { rateLimitShared } from "@/lib/auth/rate-limit";
import { signingSecret } from "@/lib/files/signed";
import { sendMail } from "@/lib/mail";

// Email ownership check: a 6-digit code that expires quickly, can be tried a handful of times, and is stored only as an HMAC.

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;

export class ChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChallengeError";
  }
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const isEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254;

const hash = (purpose: string, subjectId: string, email: string, code: string) => createHmac("sha256", signingSecret()).update(`${purpose}|${subjectId}|${email}|${code}`).digest("hex");

/** Creates and emails a fresh code (older unused codes for the same purpose/subject/email stop working). */
export async function sendChallenge(opts: { purpose: string; subjectId: string; email: string; ip: string; subject: string; intro: string }) {
  const email = normalizeEmail(opts.email);
  if (!isEmail(email)) throw new ChallengeError("Enter a valid email address.");
  if (!(await rateLimitShared(`challenge:${opts.purpose}:${email}`, 5, 3600_000)).ok || !(await rateLimitShared(`challenge-ip:${opts.ip}`, 30, 3600_000)).ok) {
    throw new ChallengeError("Too many codes requested. Try again in a little while.");
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.emailChallenge.updateMany({ where: { purpose: opts.purpose, subjectId: opts.subjectId, email, consumedAt: null }, data: { consumedAt: new Date() } });
  await db.emailChallenge.create({ data: { purpose: opts.purpose, subjectId: opts.subjectId, email, codeHash: hash(opts.purpose, opts.subjectId, email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
  await sendMail({ to: email, subject: opts.subject, text: `${opts.intro}\n\nYour verification code: ${code}\n\nIt expires in 10 minutes. If you didn't request it, you can ignore this email.` });
}

/** True only for the latest unexpired code, within the attempt budget. A successful check consumes the code. */
export async function checkChallenge(opts: { purpose: string; subjectId: string; email: string; code: string }): Promise<boolean> {
  const email = normalizeEmail(opts.email);
  const code = opts.code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  const row = await db.emailChallenge.findFirst({ where: { purpose: opts.purpose, subjectId: opts.subjectId, email, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!row || row.attempts >= MAX_ATTEMPTS) return false;
  const bumped = await db.emailChallenge.updateMany({ where: { id: row.id, attempts: row.attempts }, data: { attempts: { increment: 1 } } });
  if (bumped.count === 0) return false; // concurrent guess
  const a = Buffer.from(row.codeHash);
  const b = Buffer.from(hash(opts.purpose, opts.subjectId, email, code));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  await db.emailChallenge.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return true;
}

export const purgeChallenges = () => db.emailChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400_000) } } });
