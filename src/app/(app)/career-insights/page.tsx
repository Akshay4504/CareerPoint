import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/lib/auth/guards";
import { ensureProfile } from "@/lib/services/profile";
import { computeInsights, type DemandRow } from "@/lib/services/insights";
import { Badge, EmptyState, Meter, PageHeader, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Career insights" };
export const dynamic = "force-dynamic";

function Demand({ rows, total }: { rows: DemandRow[]; total: number }) {
  if (rows.length === 0) return <p className="text-[13.5px] text-muted">No data yet.</p>;
  return (
    <ul className="space-y-3">
      {rows.slice(0, 10).map((r) => (
        <li key={r.name}>
          <div className="mb-1 flex items-center justify-between gap-2 text-[13.5px]">
            <span className="flex items-center gap-2">{r.name} {r.have ? <Badge tone="ok">You have this</Badge> : <Badge tone="warn">Gap</Badge>}</span>
            <span className="font-mono text-[12.5px] tabular-nums text-muted">{r.jobs} / {total} jobs</span>
          </div>
          <Meter value={r.jobs} max={Math.max(total, 1)} label={`${r.name} demand`} tone={r.have ? undefined : "warn"} />
        </li>
      ))}
    </ul>
  );
}

export default async function InsightsPage() {
  const user = await requireArea("app");
  const profile = await ensureProfile(user);
  const ins = await computeInsights(profile.id);

  return (
    <>
      <PageHeader title="Career insights" description={ins.poolSize ? `Based on ${ins.poolSize} open ${ins.scope} on CareerPoint right now. Nothing here is estimated — it's counted from live postings.` : "Insights are computed from open jobs on CareerPoint."} />
      {ins.poolSize === 0 ? (
        <EmptyState title="No open jobs to analyse yet" description="Once jobs are available, you'll see which software and skills are most in demand and which gaps matter for you." action={<Link href="/jobs" className="btn btn-secondary btn-sm">Browse jobs</Link>} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Software demand" description="Share of jobs that list each tool."><Demand rows={ins.software} total={ins.poolSize} /></Panel>
          <Panel title="Skill demand" description="Share of jobs that list each skill."><Demand rows={ins.skills} total={ins.poolSize} /></Panel>
          <Panel title="Fastest way to open more roles" className="lg:col-span-2">
            {ins.oneAway === 0 ? (
              <p className="text-[13.5px] text-muted">No jobs are exactly one skill or tool away from a full match right now.</p>
            ) : (
              <>
                <p className="mb-3 text-[13.5px]"><strong>{ins.oneAway}</strong> open {ins.oneAway === 1 ? "job is" : "jobs are"} missing just one requirement from your profile.</p>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {ins.unlockList.map((u) => <li key={u.name} className="rounded-md border border-line bg-surface px-3 py-2 text-[13.5px]"><span className="font-medium">{u.name}</span><span className="block text-[12.5px] text-muted">would complete {u.jobs} {u.jobs === 1 ? "job" : "jobs"}</span></li>)}
                </ul>
              </>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
