import { canonicalizeUrl, detectEmploymentType, detectRemoteType, parseExperience, parseLocation, parseSalary, splitSections } from "../normalize";
import type { NormalizedJobInput } from "../types";

const ISO: Record<string, string> = { US: "United States", GB: "United Kingdom", UK: "United Kingdom", IN: "India", CA: "Canada", AU: "Australia", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", NL: "Netherlands", IE: "Ireland", AE: "United Arab Emirates", SA: "Saudi Arabia", QA: "Qatar", SG: "Singapore", HK: "Hong Kong", CN: "China", JP: "Japan", ZA: "South Africa", NZ: "New Zealand", PL: "Poland", PT: "Portugal", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", CH: "Switzerland", BE: "Belgium", AT: "Austria", BR: "Brazil", MX: "Mexico", MY: "Malaysia", PH: "Philippines", EG: "Egypt", KW: "Kuwait", OM: "Oman", BH: "Bahrain", TR: "Turkey", RO: "Romania", CZ: "Czech Republic" };

export const countryFromCode = (c?: string | null) => (c ? (ISO[c.trim().toUpperCase()] ?? undefined) : undefined);

/** Shared normalization once a connector has extracted the basic fields. Never invents data. */
export function buildNormalized(base: {
  sourceJobId: string;
  title: string;
  companyName: string;
  description: string;
  url: string;
  applyUrl?: string;
  location?: string;
  country?: string;
  postedAt?: Date;
  expiresAt?: Date;
  remoteHint?: "ONSITE" | "HYBRID" | "REMOTE" | "UNKNOWN";
  employmentHint?: string;
  salary?: { min?: number; max?: number; currency?: string };
}): NormalizedJobInput {
  const description = base.description.trim();
  const loc = parseLocation(base.location);
  const sections = splitSections(description);
  const exp = parseExperience(description);
  const salary = base.salary?.min || base.salary?.max ? base.salary : parseSalary(description);
  const remote = base.remoteHint && base.remoteHint !== "UNKNOWN" ? base.remoteHint : detectRemoteType(base.location, base.title, description.slice(0, 800));
  return {
    sourceJobId: base.sourceJobId,
    title: base.title.replace(/\s+/g, " ").trim(),
    companyName: base.companyName.replace(/\s+/g, " ").trim(),
    description,
    responsibilities: sections.responsibilities,
    requirements: sections.requirements,
    location: loc.location,
    city: loc.city,
    country: base.country ?? loc.country,
    remoteType: remote,
    employmentType: base.employmentHint ?? detectEmploymentType(base.title, description.slice(0, 600)),
    experienceMin: exp.min,
    experienceMax: exp.max,
    salaryMin: salary?.min,
    salaryMax: salary?.max,
    currency: salary?.currency,
    postedAt: base.postedAt && !isNaN(base.postedAt.getTime()) ? base.postedAt : undefined,
    expiresAt: base.expiresAt && !isNaN(base.expiresAt.getTime()) ? base.expiresAt : undefined,
    applyUrl: base.applyUrl ?? base.url,
    canonicalUrl: canonicalizeUrl(base.url),
  };
}

export const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
export const cfgStr = (cfg: Record<string, unknown>, key: string): string | undefined => str(cfg[key]);
export const asDate = (v: unknown): Date | undefined => {
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string" && !isNaN(Date.parse(v))) return new Date(v);
  return undefined;
};
