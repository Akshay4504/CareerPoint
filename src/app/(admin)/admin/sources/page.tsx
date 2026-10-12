import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, Field, PageHeader, Panel, Stat } from "@/components/ui";
import { checkSourceNow, createSource, deleteSource, runSource, toggleSource } from "@/app/actions/admin";
import { queueStats } from "@/lib/queue/queue";
import { isPast, minutesFromNow, msAgo, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Job sources" };
export const dynamic = "force-dynamic";

const HEALTH = { HEALTHY: "ok", DEGRADED: "warn", UNHEALTHY: "bad", UNKNOWN: "neutral" } as const;

export default async function AdminSources() {
  await requireArea("admin-users");
  const [sources, queue, activeJobs, latency] = await Promise.all([
    db.jobSource.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { refs: true } }, runs: { orderBy: { startedAt: "desc" }, take: 1 } } }),
    queueStats(),
    db.job.count({ where: { status: "ACTIVE", canonicalJobId: null } }),
    db.ingestionRun.groupBy({ by: ["sourceId"], where: { startedAt: { gte: msAgo(7 * 86400_000) }, durationMs: { not: null } }, _avg: { durationMs: true }, _count: true }),
  ]);
  const avgMs = new Map(latency.map((l) => [l.sourceId, l._avg.durationMs]));
  const pending = queue.rows.filter((r) => r.status === "PENDING").reduce((n, r) => n + r._count, 0);
  const running = queue.rows.filter((r) => r.status === "RUNNING").reduce((n, r) => n + r._count, 0);
  const failed = queue.rows.filter((r) => r.status === "FAILED").reduce((n, r) => n + r._count, 0);

  return (
    <>
      <PageHeader title="Job ingestion" description="Public sources are polled by background workers (never in a web request). Each opening is normalized, validated, classified for BIM relevance, de-duplicated across sources and quality-scored before it is shown." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Live jobs" value={activeJobs} />
        <Stat label="Queue: waiting" value={pending} hint={queue.oldestPending ? `oldest due ${timeAgo(queue.oldestPending)}` : "idle"} />
        <Stat label="Queue: running" value={running} />
        <Stat label="Queue: failed" value={failed} hint="after all retries" />
      </div>
      {pending > 0 && running === 0 && queue.oldestPending && isPast(new Date(queue.oldestPending.getTime() + 5 * 60_000)) && (
        <p role="alert" className="mb-6 rounded-md border border-[#e9b9b5] bg-bad-soft px-4 py-3 text-[13px] text-bad">Tasks have been waiting for over 5 minutes and nothing is running. Start the worker: <code className="font-mono">npm run worker</code>.</p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          {sources.length === 0 ? (
            <EmptyState title="No sources yet" description="Add a public Greenhouse, Lever or Ashby job board, an RSS/JSON feed, or an employer career site that publishes schema.org JobPosting data." />
          ) : (
            sources.map((s) => {
              const r = s.runs[0];
              return (
                <article key={s.id} className="panel p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-[15px]">
                        <Link href={`/admin/sources/${s.id}`} className="hover:underline">{s.name}</Link> <Badge>{s.type.replace("_", " ").toLowerCase()}</Badge> <Badge tone={HEALTH[s.health]}>{s.health.toLowerCase()}</Badge>
                        {!s.active && <> <Badge tone="warn">disabled</Badge></>}
                      </h2>
                      <p className="mt-0.5 break-all font-mono text-[12px] text-muted">{s.url ?? JSON.stringify(s.config)}</p>
                      <p className="mt-1 text-[12.5px] text-muted">
                        reliability {s.reliability} · {s._count.refs} openings tracked · {s.lastRunAt ? `last run ${timeAgo(s.lastRunAt)}` : "never run"}{s.lastSuccessAt ? ` · last success ${timeAgo(s.lastSuccessAt)}` : s.lastRunAt ? " · never succeeded" : ""}{avgMs.get(s.id) != null ? ` · avg latency ${(avgMs.get(s.id)! / 1000).toFixed(1)}s (7d)` : ""}
                        {s.nextRunAt && s.active && ` · next ${!isPast(s.nextRunAt) ? "in " + Math.max(1, minutesFromNow(s.nextRunAt)) + " min" : "due"}`}
                      </p>
                      {s.lastStatus === "ERROR" && <p className="mt-1 text-[12.5px] text-bad">{s.lastError}</p>}
                      {r && (
                        <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-6">
                          {([["Found", r.found], ["Accepted", r.accepted], ["Updated", r.updated], ["Duplicates", r.duplicates], ["Rejected", r.rejected], ["Failures", r.failures]] as const).map(([k, v]) => <div key={k}><dt className="text-muted">{k}</dt><dd className="tabular-nums font-medium">{v}</dd></div>)}
                          <div className="col-span-3 sm:col-span-6 text-muted">Last run: {r.status.toLowerCase()}{r.durationMs != null ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ""}{r.complete ? " · complete listing" : ""}</div>
                        </dl>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <form action={runSource.bind(null, s.id)}><button className="btn btn-secondary btn-sm" disabled={!s.active}>Queue run</button></form>
                      <form action={checkSourceNow.bind(null, s.id)}><button className="btn btn-ghost btn-sm">Health check</button></form>
                      <form action={toggleSource.bind(null, s.id, !s.active)}><button className="btn btn-ghost btn-sm">{s.active ? "Disable" : "Enable"}</button></form>
                      <form action={deleteSource.bind(null, s.id)}><ConfirmButton message="Delete this source and its raw data? Jobs it created stay (as historical records).">Delete</ConfirmButton></form>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
        <Panel title="Add source" description="Respects robots.txt and rate limits. No login, CAPTCHA or anti-bot workarounds.">
          <ActionForm action={createSource} className="space-y-3" resetOnSuccess>
            <Field label="Name" htmlFor="sn"><input id="sn" name="name" required className="field" placeholder="e.g. Acme Engineering careers" /></Field>
            <Field label="Type" htmlFor="st"><select id="st" name="type" className="field"><option value="GREENHOUSE">Greenhouse board</option><option value="LEVER">Lever company</option><option value="ASHBY">Ashby board</option><option value="CAREER_PAGE">Career site (JobPosting sitemap)</option><option value="RSS">RSS feed</option><option value="JSON">JSON feed</option></select></Field>
            <Field label="Board token / slug / URL" htmlFor="sv" hint="Greenhouse &amp; Ashby: board token. Lever: company slug. Others: public https URL (sitemap for career sites)."><input id="sv" name="value" required className="field" placeholder="e.g. acme" /></Field>
            <Field label="Employer name" htmlFor="sc" hint="Required for career sites; optional display name otherwise."><input id="sc" name="company" className="field" /></Field>
            <SubmitButton className="btn btn-primary w-full" pendingText="Adding…">Add source</SubmitButton>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
