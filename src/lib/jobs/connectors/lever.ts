import { htmlToText } from "../normalize";
import { SourceError, type ConnectorContext, type DiscoveredJob, type JobSourceConnector } from "../types";
import { asDate, buildNormalized, cfgStr, countryFromCode, str } from "./common";

// Lever public postings API: https://api.lever.co/v0/postings/{company}?mode=json
// config: { company: "slug", display?: "Display name" }

type LeverList = { text?: string; content?: string };
type LeverPosting = { id: string; text?: string; hostedUrl?: string; applyUrl?: string; createdAt?: number; country?: string; workplaceType?: string; categories?: { location?: string; commitment?: string; allLocations?: string[] }; descriptionPlain?: string; description?: string; lists?: LeverList[]; additionalPlain?: string; salaryRange?: { min?: number; max?: number; currency?: string; interval?: string } };

const API = "https://api.lever.co/v0/postings";
const company = (ctx: ConnectorContext) => {
  const c = cfgStr(ctx.config, "company");
  if (!c || !/^[A-Za-z0-9_-]+$/.test(c)) throw new SourceError("Lever source needs a valid `company` slug", false);
  return c;
};

export const leverConnector: JobSourceConnector = {
  type: "LEVER",

  async discoverJobs(ctx) {
    const { json, status } = await ctx.http.getJson<LeverPosting[]>(`${API}/${company(ctx)}?mode=json`);
    if (status === 404) throw new SourceError(`Lever company "${company(ctx)}" not found`, false, 404);
    const arr = Array.isArray(json) ? json : [];
    const jobs = arr.filter((p) => p.id && p.hostedUrl).map((p): DiscoveredJob => ({ sourceJobId: p.id, url: p.hostedUrl!, payload: p }));
    return { jobs, complete: true, warnings: [] };
  },

  async fetchJob(ctx, ref) {
    const { json, status } = await ctx.http.getJson<LeverPosting>(`${API}/${company(ctx)}/${encodeURIComponent(ref.sourceJobId)}`);
    return status === 404 || status === 410 ? null : json;
  },

  normalizeJob(ctx, raw, ref) {
    const p = raw as LeverPosting;
    const title = str(p.text);
    if (!title) return null;
    // Rebuild the description with the posting's own list headings so responsibilities/requirements can be split.
    const body = [str(p.descriptionPlain) ?? htmlToText(p.description ?? ""), ...(p.lists ?? []).map((l) => `${l.text ?? ""}\n${htmlToText(l.content ?? "")}`), str(p.additionalPlain) ?? ""].filter(Boolean).join("\n\n");
    if (body.length < 40) return null;
    const wt = (p.workplaceType ?? "").toLowerCase();
    const sr = p.salaryRange;
    return buildNormalized({
      sourceJobId: ref.sourceJobId,
      title,
      companyName: cfgStr(ctx.config, "display") ?? company(ctx),
      description: body,
      url: str(p.hostedUrl) ?? ref.url,
      applyUrl: str(p.applyUrl),
      location: str(p.categories?.location) ?? p.categories?.allLocations?.[0],
      country: countryFromCode(p.country),
      postedAt: asDate(p.createdAt),
      remoteHint: wt === "remote" ? "REMOTE" : wt === "hybrid" ? "HYBRID" : wt === "on-site" || wt === "onsite" ? "ONSITE" : undefined,
      employmentHint: str(p.categories?.commitment),
      salary: sr && sr.interval && /year|annual/i.test(sr.interval) ? { min: sr.min, max: sr.max, currency: sr.currency } : undefined,
    });
  },

  async healthCheck(ctx) {
    const t = Date.now();
    const { status } = await ctx.http.getJson(`${API}/${company(ctx)}?mode=json&limit=1`);
    return status === 200 ? { ok: true, message: "Postings API reachable", latencyMs: Date.now() - t } : { ok: false, message: `Postings API returned HTTP ${status}` };
  },
};
