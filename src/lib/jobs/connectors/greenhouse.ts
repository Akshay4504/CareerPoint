import { htmlToText } from "../normalize";
import { SourceError, type ConnectorContext, type DiscoveredJob, type DiscoverResult, type JobSourceConnector } from "../types";
import { asDate, buildNormalized, cfgStr, str } from "./common";

// Greenhouse public job board API: https://boards-api.greenhouse.io/v1/boards/{board}/jobs
// Public, unauthenticated, intended for embedding boards. config: { board: "token", company?: "Display name" }

type GhJob = { id: number | string; title?: string; absolute_url?: string; location?: { name?: string }; content?: string; updated_at?: string; first_published?: string; company_name?: string };

const API = "https://boards-api.greenhouse.io/v1/boards";
const board = (ctx: ConnectorContext) => {
  const b = cfgStr(ctx.config, "board");
  if (!b || !/^[A-Za-z0-9_-]+$/.test(b)) throw new SourceError("Greenhouse source needs a valid `board` token", false);
  return b;
};

export const greenhouseConnector: JobSourceConnector = {
  type: "GREENHOUSE",

  async discoverJobs(ctx): Promise<DiscoverResult> {
    const { json, status } = await ctx.http.getJson<{ jobs?: GhJob[] }>(`${API}/${board(ctx)}/jobs?content=true`);
    if (status === 404) throw new SourceError(`Greenhouse board "${board(ctx)}" not found`, false, 404);
    const jobs = (json?.jobs ?? []).filter((j) => j.id != null && j.absolute_url).map((j): DiscoveredJob => ({ sourceJobId: String(j.id), url: j.absolute_url!, payload: j }));
    return { jobs, complete: true, warnings: [] };
  },

  async fetchJob(ctx, ref) {
    const { json, status } = await ctx.http.getJson<GhJob>(`${API}/${board(ctx)}/jobs/${encodeURIComponent(ref.sourceJobId)}`);
    return status === 404 || status === 410 ? null : json;
  },

  normalizeJob(ctx, raw, ref) {
    const j = raw as GhJob;
    const title = str(j.title);
    const content = str(j.content);
    if (!title || !content) return null;
    return buildNormalized({
      sourceJobId: ref.sourceJobId,
      title,
      companyName: str(j.company_name) ?? cfgStr(ctx.config, "company") ?? board(ctx),
      description: htmlToText(content),
      url: str(j.absolute_url) ?? ref.url,
      location: str(j.location?.name),
      postedAt: asDate(j.first_published) ?? asDate(j.updated_at),
    });
  },

  async healthCheck(ctx) {
    const t = Date.now();
    const { status } = await ctx.http.getJson(`${API}/${board(ctx)}`);
    return status === 200 ? { ok: true, message: "Board reachable", latencyMs: Date.now() - t } : { ok: false, message: `Board returned HTTP ${status}` };
  },
};
