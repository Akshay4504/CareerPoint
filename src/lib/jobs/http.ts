import dns from "dns/promises";
import net from "net";
import { SourceError, type HttpLike } from "./types";
import { USER_AGENT, isAllowed, parseRobots, type RobotsPolicy } from "./robots";

// Polite HTTP client for source connectors.
//  - per-host throttling (min interval between requests; robots Crawl-delay raises it)
//  - timeout, retries with exponential backoff + jitter for 5xx/network errors
//  - 429/503 honour Retry-After and back off (we slow down; we never rotate identity or evade limits)
//  - robots.txt is fetched and obeyed; disallowed URLs are refused, not worked around
//  - SSRF guard: public http(s) hosts only, redirects re-validated

function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d) addresses are judged by their IPv4 part.
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    // WHATWG URL normalises ::ffff:127.0.0.1 to ::ffff:7f00:1, so the hex form must be decoded too.
    const hex = l.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return l === "::1" || l === "::" || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith("ff");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SourceError("Only http(s) URLs are allowed", false);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new SourceError("Private hosts are not allowed", false);
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new SourceError("Private network addresses are not allowed", false);
  return url;
}

export type HttpOptions = {
  minIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBytes?: number;
  respectRobots?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Skip DNS/SSRF resolution (tests with fake fetch). */
  skipUrlCheck?: boolean;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PoliteHttpClient implements HttpLike {
  private lastRequestAt = new Map<string, number>();
  private robots = new Map<string, RobotsPolicy | null>();
  private o: Required<Omit<HttpOptions, "fetchImpl" | "sleep">> & { fetchImpl: typeof fetch; sleep: (ms: number) => Promise<void> };
  requests = 0;
  retries = 0;

  constructor(opts: HttpOptions = {}) {
    this.o = {
      minIntervalMs: opts.minIntervalMs ?? 1500,
      timeoutMs: opts.timeoutMs ?? 15_000,
      maxRetries: opts.maxRetries ?? 3,
      baseBackoffMs: opts.baseBackoffMs ?? 800,
      maxBytes: opts.maxBytes ?? 8_000_000,
      respectRobots: opts.respectRobots ?? true,
      skipUrlCheck: opts.skipUrlCheck ?? false,
      fetchImpl: opts.fetchImpl ?? fetch,
      sleep: opts.sleep ?? realSleep,
    };
  }

  private async throttle(host: string, extraDelay = 0) {
    const gap = Math.max(this.o.minIntervalMs, extraDelay);
    const last = this.lastRequestAt.get(host) ?? 0;
    const wait = last + gap - Date.now();
    if (wait > 0) await this.o.sleep(wait);
    this.lastRequestAt.set(host, Date.now());
  }

  private async policyFor(url: URL): Promise<RobotsPolicy | null> {
    if (!this.o.respectRobots) return null;
    if (this.robots.has(url.origin)) return this.robots.get(url.origin)!;
    let policy: RobotsPolicy | null = null;
    try {
      await this.throttle(url.host);
      const res = await this.o.fetchImpl(`${url.origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(this.o.timeoutMs), redirect: "follow" });
      // 4xx (no robots.txt) means unrestricted; 5xx means we cannot tell, so be conservative and treat as disallow-all.
      if (res.status >= 500) policy = { rules: [{ allow: false, path: "/" }], crawlDelayMs: null };
      else if (res.ok) policy = parseRobots((await res.text()).slice(0, 200_000));
    } catch {
      policy = { rules: [{ allow: false, path: "/" }], crawlDelayMs: null };
    }
    this.robots.set(url.origin, policy);
    return policy;
  }

  async request(rawUrl: string, accept: string, depth = 0): Promise<{ status: number; text: string; url: string }> {
    if (depth > 3) throw new SourceError("Too many redirects", false);
    const url = this.o.skipUrlCheck ? new URL(rawUrl) : await assertPublicHttpUrl(rawUrl);
    const policy = await this.policyFor(url);
    if (policy && !isAllowed(policy, url.pathname + url.search)) throw new SourceError(`Blocked by robots.txt: ${url.pathname}`, false, 403);

    let attempt = 0;
    for (;;) {
      await this.throttle(url.host, policy?.crawlDelayMs ?? 0);
      this.requests++;
      let retryAfterMs = 0;
      try {
        const res = await this.o.fetchImpl(url, { headers: { "user-agent": USER_AGENT, accept }, signal: AbortSignal.timeout(this.o.timeoutMs), redirect: "manual" });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) throw new SourceError(`Redirect without location (${res.status})`, false, res.status);
          // Redirects are followed manually (max 3) so every hop is re-validated: public host, robots-permitted path.
          return this.request(new URL(loc, url).toString(), accept, depth + 1);
        }
        if (res.status === 429 || res.status === 503) {
          const ra = Number(res.headers.get("retry-after"));
          retryAfterMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60_000) : 0;
          throw new SourceError(`Rate limited (${res.status})`, true, res.status);
        }
        if (res.status >= 500) throw new SourceError(`Server error ${res.status}`, true, res.status);
        if (res.status === 404 || res.status === 410) return { status: res.status, text: "", url: url.toString() };
        if (res.status >= 400) throw new SourceError(`HTTP ${res.status}`, false, res.status);
        const len = Number(res.headers.get("content-length") ?? 0);
        if (len > this.o.maxBytes) throw new SourceError("Response too large", false);
        const text = await res.text();
        if (text.length > this.o.maxBytes) throw new SourceError("Response too large", false);
        return { status: res.status, text, url: url.toString() };
      } catch (e) {
        const err = e instanceof SourceError ? e : new SourceError(e instanceof Error ? e.message : "Network error", true);
        if (!err.retryable || attempt >= this.o.maxRetries) throw err;
        attempt++;
        this.retries++;
        const backoff = this.o.baseBackoffMs * 2 ** (attempt - 1);
        await this.o.sleep(Math.max(retryAfterMs, backoff + Math.floor(Math.random() * backoff * 0.25)));
      }
    }
  }

  getText(url: string, opts?: { accept?: string }) {
    return this.request(url, opts?.accept ?? "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.5");
  }

  async getJson<T = unknown>(url: string) {
    const r = await this.request(url, "application/json");
    if (r.status === 404 || r.status === 410) return { status: r.status, json: null as T };
    try {
      return { status: r.status, json: JSON.parse(r.text) as T };
    } catch {
      throw new SourceError("Source returned invalid JSON", false);
    }
  }
}
