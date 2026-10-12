// Two limiters:
//  - rateLimit:       in-memory sliding window (single process; used by unit tests and as the fallback)
//  - rateLimitShared: Postgres-backed fixed window, correct across any number of app replicas. Used by every request path.
import { db } from "@/lib/db";
import { log } from "@/lib/log";

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return { ok: true, retryAfterSec: 0 };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}

/** Fixed-window limiter shared by all instances. If the database is unreachable it degrades to the in-memory limiter. */
export async function rateLimitShared(key: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfterSec: number }> {
  try {
    const rows = await db.$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "windowStart") VALUES (${key}, 1, now())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."windowStart" < now() - (${windowMs} * interval '1 millisecond') THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - (${windowMs} * interval '1 millisecond') THEN now() ELSE "RateLimitBucket"."windowStart" END
      RETURNING "count", "windowStart"`;
    const r = rows[0];
    if (r.count <= limit) return { ok: true, retryAfterSec: 0 };
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((r.windowStart.getTime() + windowMs - Date.now()) / 1000)) };
  } catch (err) {
    log.warn("ratelimit.db_unavailable", { err });
    return rateLimit(key, limit, windowMs);
  }
}

export async function resetRateLimitShared(key: string) {
  buckets.delete(key);
  await db.rateLimitBucket.deleteMany({ where: { key } }).catch(() => null);
}

/** Housekeeping for the maintenance task. */
export async function purgeRateLimits(olderThanMs = 86400_000) {
  return db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - olderThanMs) } } });
}
