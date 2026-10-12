import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { Badge, EmptyState, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Source detail" };
export const dynamic = "force-dynamic";

export default async function SourceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireArea("admin-users");
  const source = await db.jobSource.findUnique({ where: { id } });
  if (!source) notFound();
  const [runs, logs, rejected, dupes] = await Promise.all([
    db.ingestionRun.findMany({ where: { sourceId: id }, orderBy: { startedAt: "desc" }, take: 15 }),
    db.ingestionLog.findMany({ where: { sourceId: id }, orderBy: { createdAt: "desc" }, take: 40 }),
    db.rawJob.groupBy({ by: ["reason"], where: { sourceId: id, status: "REJECTED" }, _count: true, orderBy: { _count: { reason: "desc" } }, take: 8 }),
    db.rawJob.count({ where: { sourceId: id, status: "DUPLICATE" } }),
  ]);
  return (
    <>
      <PageHeader title={source.name} description={`${source.type.replace("_", " ").toLowerCase()} · health ${source.health.toLowerCase()} · ${source.consecutiveFailures} consecutive failures`} actions={<Link href="/admin/sources" className="btn btn-ghost btn-sm">← Sources</Link>} />
      <div className="space-y-6">
        <Panel title="Run history" pad={false}>
          {runs.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No runs yet.</p> : (
            <Table className="border-0">
              <thead><tr><Th>Started</Th><Th>Status</Th><Th>Found</Th><Th>Accepted</Th><Th>Updated</Th><Th>Dupes</Th><Th>Rejected</Th><Th>Unchanged</Th><Th>Failures</Th><Th>Time</Th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <Td className="text-muted">{timeAgo(r.startedAt)}</Td>
                    <Td><Badge tone={r.status === "OK" ? "ok" : r.status === "FAILED" ? "bad" : "neutral"}>{r.status.toLowerCase()}</Badge>{r.error && <span className="ml-1 text-[12px] text-bad">{r.error}</span>}</Td>
                    {[r.found, r.accepted, r.updated, r.duplicates, r.rejected, r.unchanged, r.failures].map((v, i) => <Td key={i} className="tabular-nums">{v}</Td>)}
                    <Td className="tabular-nums text-muted">{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Why postings were rejected" description={`${dupes} merged as duplicates`}>
            {rejected.length === 0 ? <p className="text-[13.5px] text-muted">Nothing rejected.</p> : (
              <ul className="space-y-1.5 text-[13px]">{rejected.map((r, i) => <li key={i} className="flex justify-between gap-3"><span className="text-ink-2">{(r.reason ?? "unknown").replace(/\(relevance \d+\)/, "").slice(0, 90)}</span><span className="tabular-nums text-muted">{r._count}</span></li>)}</ul>
            )}
          </Panel>
          <Panel title="Error & event log" pad={false}>
            {logs.length === 0 ? <div className="p-4"><EmptyState title="No log entries" /></div> : (
              <ul className="max-h-96 divide-y divide-line overflow-y-auto text-[12.5px]">
                {logs.map((l) => <li key={l.id} className="flex gap-3 px-4 py-2"><Badge tone={l.level === "error" ? "bad" : l.level === "warn" ? "warn" : "neutral"}>{l.level}</Badge><span className="min-w-0 flex-1">{l.message}</span><span className="shrink-0 text-muted">{timeAgo(l.createdAt)}</span></li>)}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
