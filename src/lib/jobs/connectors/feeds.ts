import { htmlToText } from "../normalize";
import { SourceError, type ConnectorContext, type DiscoveredJob, type JobSourceConnector } from "../types";
import { asDate, buildNormalized, cfgStr, str } from "./common";

// Generic public feeds. RSS/Atom-style <item> feeds and JSON feeds ({ jobs: [...] } or [...]).
// config: { company?: "default company name" }

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? htmlToText(m[1]) : undefined;
}

export type RssItem = { id: string; title: string; link?: string; description: string; company?: string; location?: string; pubDate?: string };

export function parseRss(xml: string): RssItem[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const out: RssItem[] = [];
  for (const it of items) {
    const title = tag(it, "title");
    const link = tag(it, "link");
    const guid = tag(it, "guid") ?? link;
    if (!title || !guid) continue;
    out.push({ id: guid.slice(0, 300), title, link, description: tag(it, "description") ?? tag(it, "content:encoded") ?? "", company: tag(it, "company") ?? tag(it, "author"), location: tag(it, "location"), pubDate: tag(it, "pubDate") });
  }
  return out;
}

const urlOf = (ctx: ConnectorContext) => {
  if (!ctx.url) throw new SourceError("Feed source needs a URL", false);
  return ctx.url;
};

export const rssConnector: JobSourceConnector = {
  type: "RSS",
  async discoverJobs(ctx) {
    const { text, status } = await ctx.http.getText(urlOf(ctx), { accept: "application/rss+xml,application/xml,text/xml" });
    if (status === 404) throw new SourceError("Feed not found", false, 404);
    const items = parseRss(text);
    return { jobs: items.filter((i) => i.link).map((i): DiscoveredJob => ({ sourceJobId: i.id, url: i.link!, payload: i })), complete: items.length > 0, warnings: items.length ? [] : ["Feed contained no items"] };
  },
  async fetchJob(ctx, ref) {
    // Feeds have no per-item endpoint: re-read the feed and locate the item.
    const d = await rssConnector.discoverJobs(ctx);
    return d.jobs.find((j) => j.sourceJobId === ref.sourceJobId)?.payload ?? null;
  },
  normalizeJob(ctx, raw, ref) {
    const i = raw as RssItem;
    const dash = i.title.match(/^(.*?)\s+(?:at|@|-|–|—)\s+(.+)$/);
    const title = (i.company ? i.title : (dash?.[1] ?? i.title)).trim();
    const company = i.company ?? dash?.[2] ?? cfgStr(ctx.config, "company");
    if (!company || i.description.length < 40) return null;
    return buildNormalized({ sourceJobId: ref.sourceJobId, title, companyName: company, description: i.description, url: i.link ?? ref.url, location: i.location, postedAt: asDate(i.pubDate) });
  },
  async healthCheck(ctx) {
    const t = Date.now();
    const { status, text } = await ctx.http.getText(urlOf(ctx));
    return status === 200 && /<item[\s>]/i.test(text) ? { ok: true, message: "Feed reachable", latencyMs: Date.now() - t } : { ok: false, message: `Feed unusable (HTTP ${status})` };
  },
};

type JsonRow = Record<string, unknown>;

export function parseJsonFeed(text: string): JsonRow[] {
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : [];
}

const pick = (r: JsonRow, ...keys: string[]) => {
  for (const k of keys) {
    if (typeof r[k] === "number") return String(r[k]);
    const s = str(r[k]);
    if (s) return s;
  }
  return undefined;
};

export const jsonFeedConnector: JobSourceConnector = {
  type: "JSON",
  async discoverJobs(ctx) {
    const { text, status } = await ctx.http.getText(urlOf(ctx), { accept: "application/json" });
    if (status === 404) throw new SourceError("Feed not found", false, 404);
    let rows: JsonRow[];
    try {
      rows = parseJsonFeed(text);
    } catch {
      throw new SourceError("Feed is not valid JSON", false);
    }
    const jobs = rows.map((r): DiscoveredJob | null => {
      const id = pick(r, "id", "guid", "url", "link", "apply_url");
      const url = pick(r, "url", "link", "apply_url");
      return id && url ? { sourceJobId: id.slice(0, 300), url, payload: r } : null;
    }).filter((x): x is DiscoveredJob => !!x);
    return { jobs, complete: rows.length > 0, warnings: [] };
  },
  async fetchJob(ctx, ref) {
    const d = await jsonFeedConnector.discoverJobs(ctx);
    return d.jobs.find((j) => j.sourceJobId === ref.sourceJobId)?.payload ?? null;
  },
  normalizeJob(ctx, raw, ref) {
    const r = raw as JsonRow;
    const title = pick(r, "title", "position", "name");
    const desc = htmlToText(pick(r, "description", "summary", "content") ?? "");
    const company = pick(r, "company", "company_name", "employer") ?? cfgStr(ctx.config, "company");
    if (!title || !company || desc.length < 40) return null;
    return buildNormalized({ sourceJobId: ref.sourceJobId, title, companyName: company, description: desc, url: pick(r, "url", "link", "apply_url") ?? ref.url, location: pick(r, "location", "candidate_required_location"), country: pick(r, "country"), postedAt: asDate(pick(r, "date", "postedAt", "published", "publication_date")), employmentHint: pick(r, "type", "employmentType", "job_type") });
  },
  async healthCheck(ctx) {
    const t = Date.now();
    const { status, text } = await ctx.http.getText(urlOf(ctx), { accept: "application/json" });
    try {
      return status === 200 && parseJsonFeed(text).length > 0 ? { ok: true, message: "Feed reachable", latencyMs: Date.now() - t } : { ok: false, message: `Feed unusable (HTTP ${status})` };
    } catch {
      return { ok: false, message: "Feed is not valid JSON" };
    }
  },
};
