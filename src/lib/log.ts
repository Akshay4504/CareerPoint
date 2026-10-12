import { AsyncLocalStorage } from "node:async_hooks";

// Structured JSON logs (one object per line on stdout/stderr), ready for any log shipper.
// Every entry carries a timestamp, level, event name and — when known — the request id, user id, job id,
// application id, source and duration. Errors are categorised so they can be alerted on.

export type LogFields = {
  requestId?: string;
  userId?: string | null;
  jobId?: string | null;
  applicationId?: string | null;
  sourceId?: string | null;
  source?: string | null;
  queue?: string | null;
  durationMs?: number;
  errorCategory?: ErrorCategory;
  [k: string]: unknown;
};

export type ErrorCategory = "validation" | "auth" | "forbidden" | "not_found" | "rate_limit" | "database" | "external" | "timeout" | "internal";

const als = new AsyncLocalStorage<LogFields>();

/** Runs `fn` with fields attached to every log line emitted inside it (e.g. a request id, or a queue task's ids). */
export const withLogContext = <T>(fields: LogFields, fn: () => T): T => als.run({ ...als.getStore(), ...fields }, fn);

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
const threshold = () => LEVELS[(process.env.LOG_LEVEL as Level) in LEVELS ? (process.env.LOG_LEVEL as Level) : "info"];

export function categorize(e: unknown): ErrorCategory {
  const name = e instanceof Error ? e.name : "";
  const msg = e instanceof Error ? e.message : String(e);
  if (name === "Forbidden") return "forbidden";
  if (name === "ApplicationError" || name === "ZodError") return "validation";
  if (name === "TimeoutError" || /timed? ?out|aborted/i.test(msg)) return "timeout";
  if (/rate.?limit|too many/i.test(msg)) return "rate_limit";
  if (/prisma|database|P\d{4}/i.test(name + msg)) return "database";
  if (/fetch failed|ECONN|ENOTFOUND|provider error|HTTP \d{3}/i.test(msg)) return "external";
  if (/not found/i.test(msg)) return "not_found";
  if (/unauthor|sign in/i.test(msg)) return "auth";
  return "internal";
}

function emit(level: Level, event: string, fields: LogFields = {}) {
  if (LEVELS[level] < threshold()) return;
  const { err, ...rest } = fields as LogFields & { err?: unknown };
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, event, ...als.getStore(), ...rest };
  if (err !== undefined) {
    entry.errorCategory ??= categorize(err);
    entry.error = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    if (level === "error" && err instanceof Error && process.env.NODE_ENV !== "production") entry.stack = err.stack?.split("\n").slice(0, 6).join("\n");
  }
  const line = JSON.stringify(entry);
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
}

export const log = {
  debug: (event: string, fields?: LogFields & { err?: unknown }) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields & { err?: unknown }) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields & { err?: unknown }) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields & { err?: unknown }) => emit("error", event, fields),
};

/** Times an operation and logs its outcome (info on success, error with category on failure). Re-throws. */
export async function timed<T>(event: string, fields: LogFields, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    const r = await fn();
    log.info(event, { ...fields, durationMs: Math.round(performance.now() - t0), outcome: "ok" });
    return r;
  } catch (err) {
    log.error(event, { ...fields, durationMs: Math.round(performance.now() - t0), outcome: "error", err });
    throw err;
  }
}
