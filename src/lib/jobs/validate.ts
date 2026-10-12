import type { NormalizedJobInput } from "./types";

export type ValidationResult = { ok: true } | { ok: false; reasons: string[] };

const NOT_AN_OPENING = /\b(open|general|speculative|spontaneous|unsolicited) application\b|\btalent (community|network|pool)\b|\bjoin our (talent|team) (network|pool|community)\b|\bfuture opportunities\b/i;

/** Structural validation of a normalized posting. Business relevance (is it BIM?) is decided later by classification. */
export function validateJob(j: NormalizedJobInput, now = new Date()): ValidationResult {
  const reasons: string[] = [];
  if (!j.title || j.title.length < 3 || j.title.length > 200) reasons.push("title missing or out of range");
  if (!j.companyName || j.companyName.length < 2) reasons.push("company missing");
  if (!j.description || j.description.trim().length < 80) reasons.push("description too short (<80 chars)");
  for (const [k, u] of [["applyUrl", j.applyUrl], ["canonicalUrl", j.canonicalUrl]] as const) {
    try {
      const p = new URL(u);
      if (p.protocol !== "https:" && p.protocol !== "http:") reasons.push(`${k} is not http(s)`);
    } catch {
      reasons.push(`${k} is not a valid URL`);
    }
  }
  if (NOT_AN_OPENING.test(j.title)) reasons.push("not a specific opening (open/general application)");
  if (j.postedAt && j.postedAt.getTime() > now.getTime() + 2 * 86400_000) reasons.push("posting date is in the future");
  if (j.expiresAt && j.expiresAt.getTime() < now.getTime()) reasons.push("posting has already expired");
  if (j.salaryMin && j.salaryMax && j.salaryMin > j.salaryMax) reasons.push("salary range inverted");
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
