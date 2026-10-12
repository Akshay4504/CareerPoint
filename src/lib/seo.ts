import type { Metadata } from "next";

export const SITE_NAME = "CareerPoint";
export const SITE_TAGLINE = "The career operating system for BIM professionals";

/** Canonical origin of the site (no trailing slash). APP_URL must be the public https URL in production. */
export const siteUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
export const absoluteUrl = (path = "/") => `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** Complete metadata for an indexable public page: title, description, canonical, Open Graph and Twitter card. */
export function pageMeta(opts: { title: string; description: string; path: string; type?: "website" | "article" | "profile"; noindex?: boolean }): Metadata {
  const description = clip(opts.description.replace(/\s+/g, " ").trim(), 200);
  const url = absoluteUrl(opts.path);
  return {
    title: opts.title,
    description,
    alternates: { canonical: url },
    robots: opts.noindex ? { index: false, follow: false } : undefined,
    openGraph: { title: opts.title, description, url, siteName: SITE_NAME, type: opts.type ?? "website", locale: "en_US" },
    twitter: { card: "summary_large_image", title: opts.title, description },
  };
}

/** Safe JSON-LD serialisation: `<` is escaped so a value can never close the script tag. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

type JobLd = {
  title: string;
  description: string;
  slug: string;
  companyName: string;
  companySlug?: string | null;
  postedAt: Date;
  expiresAt?: Date | null;
  employmentType?: string | null;
  location?: string | null;
  city?: string | null;
  country?: string | null;
  remoteType?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
};

const EMPLOYMENT: Record<string, string> = { "Full-time": "FULL_TIME", "Part-time": "PART_TIME", Contract: "CONTRACTOR", Freelance: "CONTRACTOR", Internship: "INTERN" };

/** schema.org JobPosting, only with fields we actually have. */
export function jobPostingLd(j: JobLd) {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: j.title,
    description: j.description,
    datePosted: j.postedAt.toISOString(),
    hiringOrganization: { "@type": "Organization", name: j.companyName, ...(j.companySlug ? { sameAs: absoluteUrl(`/companies/${j.companySlug}`) } : {}) },
    url: absoluteUrl(`/jobs/${j.slug}`),
    directApply: false,
  };
  if (j.expiresAt) ld.validThrough = j.expiresAt.toISOString();
  const et = j.employmentType ? EMPLOYMENT[j.employmentType] : undefined;
  if (et) ld.employmentType = et;
  if (j.remoteType === "REMOTE") ld.jobLocationType = "TELECOMMUTE";
  if (j.city || j.country || j.location) ld.jobLocation = { "@type": "Place", address: { "@type": "PostalAddress", ...(j.city ? { addressLocality: j.city } : j.location ? { addressLocality: j.location } : {}), ...(j.country ? { addressCountry: j.country } : {}) } };
  if (j.salaryMin || j.salaryMax) {
    ld.baseSalary = { "@type": "MonetaryAmount", currency: j.salaryCurrency ?? "USD", value: { "@type": "QuantitativeValue", ...(j.salaryMin ? { minValue: j.salaryMin } : {}), ...(j.salaryMax ? { maxValue: j.salaryMax } : {}), unitText: "YEAR" } };
  }
  return ld;
}

export const organizationLd = () => ({ "@context": "https://schema.org", "@type": "Organization", name: SITE_NAME, url: siteUrl(), description: SITE_TAGLINE });
export const websiteLd = () => ({ "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: siteUrl(), potentialAction: { "@type": "SearchAction", target: `${siteUrl()}/jobs?q={search_term_string}`, "query-input": "required name=search_term_string" } });
