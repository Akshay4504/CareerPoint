import { htmlToText, parseSalary } from "../normalize";
import { SourceError, type ConnectorContext, type DiscoveredJob, type JobSourceConnector } from "../types";
import { asDate, buildNormalized, cfgStr, str } from "./common";

// Ashby public job board API: https://api.ashbyhq.com/posting-api/job-board/{board}
// config: { board: "slug", company?: "Display name" }

type AshbyJob = { id: string; title?: string; location?: string; isListed?: boolean; isRemote?: boolean; workplaceType?: string; employmentType?: string; jobUrl?: string; applyUrl?: string; descriptionHtml?: string; descriptionPlain?: string; publishedAt?: string; address?: { postalAddress?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } }; compensation?: { compensationTierSummary?: string; scrapeableCompensationSalarySummary?: string } };

const API = "https://api.ashbyhq.com/posting-api/job-board";
const board = (ctx: ConnectorContext) => {
  const b = cfgStr(ctx.config, "board");
  if (!b || !/^[A-Za-z0-9_.-]+$/.test(b)) throw new SourceError("Ashby source needs a valid `board` name", false);
  return b;
};

const EMPLOYMENT: Record<string, string> = { FullTime: "Full-time", PartTime: "Part-time", Contract: "Contract", Intern: "Internship", Temporary: "Contract" };

export const ashbyConnector: JobSourceConnector = {
  type: "ASHBY",

  async discoverJobs(ctx) {
    const { json, status } = await ctx.http.getJson<{ jobs?: AshbyJob[] }>(`${API}/${board(ctx)}?includeCompensation=true`);
    if (status === 404) throw new SourceError(`Ashby board "${board(ctx)}" not found`, false, 404);
    const jobs = (json?.jobs ?? []).filter((j) => j.id && j.jobUrl && j.isListed !== false).map((j): DiscoveredJob => ({ sourceJobId: j.id, url: j.jobUrl!, payload: j }));
    return { jobs, complete: true, warnings: [] };
  },

  // The board API has no single-posting endpoint, so a recheck re-reads the (small) board and looks for the id.
  async fetchJob(ctx, ref) {
    const { json, status } = await ctx.http.getJson<{ jobs?: AshbyJob[] }>(`${API}/${board(ctx)}?includeCompensation=true`);
    if (status === 404) return null;
    return (json?.jobs ?? []).find((j) => j.id === ref.sourceJobId && j.isListed !== false) ?? null;
  },

  normalizeJob(ctx, raw, ref) {
    const j = raw as AshbyJob;
    const title = str(j.title);
    const desc = str(j.descriptionPlain) ?? (j.descriptionHtml ? htmlToText(j.descriptionHtml) : undefined);
    if (!title || !desc) return null;
    const addr = j.address?.postalAddress;
    const wt = (j.workplaceType ?? "").toLowerCase();
    const comp = parseSalary(`${j.compensation?.scrapeableCompensationSalarySummary ?? ""} ${j.compensation?.compensationTierSummary ?? ""}`);
    return buildNormalized({
      sourceJobId: ref.sourceJobId,
      title,
      companyName: cfgStr(ctx.config, "company") ?? board(ctx),
      description: desc,
      url: str(j.jobUrl) ?? ref.url,
      applyUrl: str(j.applyUrl) ?? str(j.jobUrl),
      location: str(j.location) ?? [addr?.addressLocality, addr?.addressRegion].filter(Boolean).join(", "),
      country: str(addr?.addressCountry),
      postedAt: asDate(j.publishedAt),
      remoteHint: j.isRemote || wt === "remote" ? "REMOTE" : wt === "hybrid" ? "HYBRID" : wt === "onsite" ? "ONSITE" : undefined,
      employmentHint: j.employmentType ? EMPLOYMENT[j.employmentType] : undefined,
      salary: comp,
    });
  },

  async healthCheck(ctx) {
    const t = Date.now();
    const { status } = await ctx.http.getJson(`${API}/${board(ctx)}`);
    return status === 200 ? { ok: true, message: "Board reachable", latencyMs: Date.now() - t } : { ok: false, message: `Board returned HTTP ${status}` };
  },
};
