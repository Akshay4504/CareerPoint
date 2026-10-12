import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireEmployerCtx } from "@/lib/auth/guards";
import { require_ } from "@/lib/employer/permissions";
import { employerAnalytics } from "@/lib/applications/analytics";
import { STAGE_LABEL } from "@/lib/applications/lifecycle";
import { EmptyState, PageHeader, Panel, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireEmployerCtx();
  require_(ctx, "analytics.view");
  const days = [30, 90, 365].includes(Number(sp.days)) ? Number(sp.days) : 90;
  const a = await employerAnalytics(ctx, days);
  const jobs = await db.job.findMany({ where: { id: { in: [...a.perJob.keys()] }, companyId: ctx.companyId }, select: { id: true, title: true } });
  const title = new Map(jobs.map((j) => [j.id, j.title]));
  const max = Math.max(1, ...a.funnel.map((f) => f.count));

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Computed from applications received through CareerPoint. External apply clicks aren't included — we can't see what happens on other sites."
        actions={<div className="inline-flex overflow-hidden rounded-md border border-line-strong text-[13px]">{[30, 90, 365].map((d) => <a key={d} href={`?days=${d}`} aria-current={d === days ? "page" : undefined} className={`px-3 py-1.5 ${d === days ? "bg-ink text-white" : "bg-bg hover:bg-sunken"}`}>{d}d</a>)}</div>}
      />
      {a.applications === 0 ? (
        <EmptyState title="Not enough data yet" description="Metrics appear once candidates apply to your jobs. We don't show placeholder numbers." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Applications" value={a.applications} hint={`${a.viewed} viewed by your team`} />
            <Stat label="Shortlist rate" value={pct(a.shortlistRate)} hint={`${a.shortlisted} shortlisted`} />
            <Stat label="Interview rate" value={pct(a.interviewRate)} hint={`${a.interviewed} interviewed`} />
            <Stat label="Median time to shortlist" value={a.medianHoursToShortlist == null ? "—" : `${a.medianHoursToShortlist} h`} hint={a.medianHoursToShortlist == null ? "No shortlists yet" : undefined} />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel title="Pipeline now">
              <ul className="space-y-2.5">
                {a.funnel.map((f) => (
                  <li key={f.status} className="text-[13px]">
                    <div className="mb-1 flex justify-between"><span>{STAGE_LABEL[f.status]}</span><span className="tabular-nums text-muted">{f.count}</span></div>
                    <div className="h-1.5 rounded bg-sunken"><div className="h-full rounded bg-accent" style={{ width: `${(f.count / max) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            </Panel>
            <div className="space-y-6">
              <Panel title="Applications per job">
                <ul className="space-y-1.5 text-[13.5px]">{[...a.perJob.entries()].sort((x, y) => y[1] - x[1]).map(([id, n]) => <li key={id} className="flex justify-between gap-3"><span className="truncate">{title.get(id) ?? "Job"}</span><span className="tabular-nums text-muted">{n}</span></li>)}</ul>
              </Panel>
              <Panel title="Where candidates came from">
                <ul className="space-y-1.5 text-[13.5px]">{a.bySource.map((s) => <li key={s.source} className="flex justify-between"><span>{s.source === "unknown" ? "Direct" : s.source}</span><span className="tabular-nums text-muted">{s.count}</span></li>)}</ul>
              </Panel>
            </div>
          </div>
        </>
      )}
    </>
  );
}
