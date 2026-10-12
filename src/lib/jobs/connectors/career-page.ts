import { htmlToText } from "../normalize";
import { SourceError, type ConnectorContext, type DiscoveredJob, type JobSourceConnector } from "../types";
import { asDate, buildNormalized, cfgStr, str } from "./common";

// Official employer career pages that publish schema.org JobPosting JSON-LD (the format search engines use).
// config: {
//   company: "Employer name",
//   sitemaps?: ["https://example.com/jobs-sitemap.xml"],   // discovery via sitemap <loc> entries
//   urlPattern?: "/jobs/",                                  // only sitemap URLs containing this are job pages
//   urls?: ["https://example.com/careers/123"]              // or an explicit list of job pages
// }
// robots.txt is enforced by the HTTP client; pages that disallow us are skipped, never worked around.

type LdNode = Record<string, unknown>;

export function extractJobPostings(html: string): LdNode[] {
  const out: LdNode[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const n = stack.pop();
      if (Array.isArray(n)) stack.push(...n);
      else if (n && typeof n === "object") {
        const o = n as LdNode;
        const t = o["@type"];
        if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) out.push(o);
        if (o["@graph"]) stack.push(o["@graph"]);
      }
    }
  }
  return out;
}

const sitemapLocs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

const MAX_URLS = 400;

function listOf(cfg: Record<string, unknown>, key: string): string[] {
  const v = cfg[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export const careerPageConnector: JobSourceConnector = {
  type: "CAREER_PAGE",

  async discoverJobs(ctx) {
    const urls = new Set<string>(listOf(ctx.config, "urls"));
    const warnings: string[] = [];
    let complete = true;
    const pattern = cfgStr(ctx.config, "urlPattern");
    for (const sm of listOf(ctx.config, "sitemaps")) {
      try {
        const { text, status } = await ctx.http.getText(sm, { accept: "application/xml,text/xml" });
        if (status !== 200) throw new SourceError(`Sitemap HTTP ${status}`, false);
        const locs = sitemapLocs(text);
        // A sitemap index points at child sitemaps; follow one level.
        const children = locs.filter((l) => /sitemap.*\.xml(\.gz)?$/i.test(l));
        const pages = locs.filter((l) => !children.includes(l));
        for (const child of children.slice(0, 5)) {
          const c = await ctx.http.getText(child, { accept: "application/xml,text/xml" });
          if (c.status === 200) pages.push(...sitemapLocs(c.text));
        }
        for (const p of pages) if (!pattern || p.includes(pattern)) urls.add(p);
      } catch (e) {
        complete = false;
        warnings.push(`Sitemap ${sm}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    if (urls.size > MAX_URLS) {
      warnings.push(`Truncated ${urls.size} URLs to ${MAX_URLS}`);
      complete = false;
    }
    const jobs = [...urls].slice(0, MAX_URLS).map((u): DiscoveredJob => ({ sourceJobId: u, url: u }));
    if (!jobs.length) throw new SourceError("No job page URLs configured or discovered", false);
    return { jobs, complete, warnings };
  },

  async fetchJob(ctx, ref) {
    const { text, status } = await ctx.http.getText(ref.url);
    if (status === 404 || status === 410) return null;
    const postings = extractJobPostings(text);
    return postings[0] ?? null; // a live page without a JobPosting block means the opening has been taken down
  },

  normalizeJob(ctx, raw, ref) {
    const p = raw as LdNode;
    const title = str(p.title);
    const desc = typeof p.description === "string" ? htmlToText(p.description) : undefined;
    if (!title || !desc || desc.length < 40) return null;
    const org = p.hiringOrganization as LdNode | string | undefined;
    const company = (typeof org === "string" ? org : str((org as LdNode | undefined)?.name)) ?? cfgStr(ctx.config, "company");
    if (!company) return null;
    const locNode = (Array.isArray(p.jobLocation) ? p.jobLocation[0] : p.jobLocation) as LdNode | undefined;
    const addr = locNode?.address as LdNode | undefined;
    const country = addr?.addressCountry;
    const countryName = typeof country === "string" ? country : str((country as LdNode | undefined)?.name);
    const location = [str(addr?.addressLocality), str(addr?.addressRegion), countryName].filter(Boolean).join(", ");
    const sal = (p.baseSalary as LdNode | undefined)?.value as LdNode | undefined;
    const salary = sal && /year/i.test(String(sal.unitText ?? "")) ? { min: Number(sal.minValue) || undefined, max: Number(sal.maxValue) || undefined, currency: str((p.baseSalary as LdNode).currency) } : undefined;
    const et = p.employmentType;
    return buildNormalized({
      sourceJobId: ref.sourceJobId,
      title,
      companyName: company,
      description: desc,
      url: str(p.url) ?? ref.url,
      applyUrl: ref.url,
      location,
      country: countryName && countryName.length > 2 ? countryName : undefined,
      postedAt: asDate(p.datePosted),
      expiresAt: asDate(p.validThrough),
      remoteHint: String(p.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE" ? "REMOTE" : undefined,
      employmentHint: typeof et === "string" ? et.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()).replace("Full time", "Full-time").replace("Part time", "Part-time") : undefined,
      salary,
    });
  },

  async healthCheck(ctx: ConnectorContext) {
    const t = Date.now();
    const sm = listOf(ctx.config, "sitemaps")[0] ?? listOf(ctx.config, "urls")[0];
    if (!sm) return { ok: false, message: "No sitemap or URL configured" };
    const { status } = await ctx.http.getText(sm);
    return status === 200 ? { ok: true, message: "Career site reachable", latencyMs: Date.now() - t } : { ok: false, message: `HTTP ${status}` };
  },
};
