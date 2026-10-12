// Liveness: the process is up and serving. Cheap, no dependencies — use for container "is it alive" probes.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
