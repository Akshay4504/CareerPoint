import { BIM_CERTIFICATIONS, BIM_SKILLS, BIM_SOFTWARE, findTaxonomyMatches } from "@/lib/taxonomy";

// Deterministic checks applied to every AI output BEFORE a user can approve it.
// The model is told not to invent facts; this guard verifies it didn't.

export type AiFlag = { severity: "block" | "warn"; message: string };

const NUM_RE = /\d[\d,.]*\s?(?:%|k|m|million|bn)?/g;

const numbers = (s: string) => new Set((s.match(NUM_RE) ?? []).map((n) => n.trim().toLowerCase().replace(/[,.]$/, "")));

/**
 * @param source  Everything the user supplied (original text + facts). Output may only use facts found here.
 * @param allowedTerms  Software/skills/certifications the user's profile already contains (these may be mentioned).
 */
export function validateAiOutput(source: string, output: string, allowedTerms: string[] = []): AiFlag[] {
  const flags: AiFlag[] = [];
  const allowed = new Set(allowedTerms.map((t) => t.toLowerCase()));
  const srcLower = source.toLowerCase();

  // 1. Numbers must come from the user's input.
  const srcNums = numbers(source);
  const invented = [...numbers(output)].filter((n) => n && !srcNums.has(n) && !srcLower.includes(n));
  if (invented.length) flags.push({ severity: "block", message: `Contains figures not found in your input: ${invented.slice(0, 5).join(", ")}. Remove them or add the real number to your source text.` });

  // 2. Tools / skills / certifications must already be in the user's input or profile.
  for (const [label, list] of [["software", BIM_SOFTWARE], ["skill", BIM_SKILLS], ["certification", BIM_CERTIFICATIONS]] as const) {
    const inSource = new Set(findTaxonomyMatches(source, list).map((x) => x.toLowerCase()));
    const extra = findTaxonomyMatches(output, list).filter((x) => !inSource.has(x.toLowerCase()) && !allowed.has(x.toLowerCase()));
    if (extra.length) flags.push({ severity: "block", message: `Mentions ${label} you did not provide: ${extra.slice(0, 5).join(", ")}.` });
  }

  // 3. Hard claims that cannot be checked.
  if (/\b(award[- ]winning|world[- ]class|best[- ]in[- ]class|industry[- ]leading|top \d+%)\b/i.test(output)) flags.push({ severity: "warn", message: "Contains superlative claims that you would need to be able to back up." });
  if (output.trim().length === 0) flags.push({ severity: "block", message: "Empty suggestion." });
  if (output.length > source.length * 4 + 400) flags.push({ severity: "warn", message: "Much longer than your original — check for padding." });
  return flags;
}

export const isBlocked = (flags: AiFlag[]) => flags.some((f) => f.severity === "block");
