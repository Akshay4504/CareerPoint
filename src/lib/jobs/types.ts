import type { SourceType } from "@prisma/client";

/** A listing entry found on a source (may already carry the full payload, e.g. ATS APIs). */
export type DiscoveredJob = { sourceJobId: string; url: string; payload?: unknown };

/** What a connector's normalizeJob() returns. Still unvalidated and unclassified. */
export type NormalizedJobInput = {
  sourceJobId: string;
  title: string;
  companyName: string;
  description: string;
  responsibilities?: string;
  requirements?: string;
  location?: string;
  city?: string;
  country?: string;
  remoteType?: "ONSITE" | "HYBRID" | "REMOTE" | "UNKNOWN";
  employmentType?: string;
  experienceMin?: number;
  experienceMax?: number;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  postedAt?: Date;
  expiresAt?: Date;
  applyUrl: string;
  canonicalUrl: string;
};

export type DiscoverResult = {
  jobs: DiscoveredJob[];
  /** True only when the full listing was retrieved. Partial results never trigger expiry. */
  complete: boolean;
  warnings: string[];
};

export type HealthResult = { ok: boolean; message: string; latencyMs?: number };

export type ConnectorContext = {
  sourceId: string;
  config: Record<string, unknown>;
  url?: string | null;
  http: HttpLike;
  now?: Date;
};

export interface HttpLike {
  getText(url: string, opts?: { accept?: string }): Promise<{ status: number; text: string; url: string }>;
  getJson<T = unknown>(url: string): Promise<{ status: number; json: T }>;
}

/** Contract every source implements. Connectors are independent and know nothing about the database. */
export interface JobSourceConnector {
  readonly type: SourceType;
  /** Lists the openings currently published by the source. */
  discoverJobs(ctx: ConnectorContext): Promise<DiscoverResult>;
  /** Fetches one opening's raw payload. Returns null when the source says it no longer exists (404/410). */
  fetchJob(ctx: ConnectorContext, ref: DiscoveredJob): Promise<unknown | null>;
  /** Maps a raw payload to the common shape. Returns null if the payload is not a usable job. */
  normalizeJob(ctx: ConnectorContext, raw: unknown, ref: DiscoveredJob): NormalizedJobInput | null;
  /** Cheap probe used by the health dashboard. Must not scrape the whole source. */
  healthCheck(ctx: ConnectorContext): Promise<HealthResult>;
}

export class SourceError extends Error {
  constructor(message: string, readonly retryable = true, readonly status?: number) {
    super(message);
    this.name = "SourceError";
  }
}
