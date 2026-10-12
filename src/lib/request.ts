import "server-only";
import { headers } from "next/headers";
import { timed, withLogContext, type LogFields } from "./log";

/** The id assigned to this request by the proxy (also returned to clients as the x-request-id response header). */
export async function requestId(): Promise<string | undefined> {
  try {
    return (await headers()).get("x-request-id") ?? undefined;
  } catch {
    return undefined; // outside a request (worker, scripts)
  }
}

/** Runs `fn` as a logged, timed operation whose log lines all carry the request id and the given ids. */
export async function inRequest<T>(event: string, fields: LogFields, fn: () => Promise<T>): Promise<T> {
  const id = await requestId();
  return withLogContext({ requestId: id }, () => timed(event, fields, fn));
}
