import { checkHealth } from "@/lib/health";

// Readiness: database, queue, worker heartbeat, storage and external integrations.
// Returns 503 only when a hard dependency (database, storage) is down; optional integrations show as "degraded".
// Public output deliberately contains component statuses only — no hostnames, counts or error text.
export const dynamic = "force-dynamic";

export async function GET() {
  const h = await checkHealth();
  const body = { status: h.status, checkedAt: h.checkedAt, components: Object.fromEntries(Object.entries(h.components).map(([k, c]) => [k, c.status])) };
  const hard = h.components.database.status === "down" || h.components.storage.status === "down";
  return Response.json(body, { status: hard ? 503 : 200, headers: { "cache-control": "no-store" } });
}
