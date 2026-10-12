import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { resolveJobReportAction } from "@/app/actions/admin";
import { resolveCommunityReportAction } from "@/app/actions/communities";
import { decideJoinRequestAction } from "@/app/actions/access";
import { listPendingJoinRequests } from "@/lib/communities/service";
import { humanize, msAgo, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Reports" };
export const dynamic = "force-dynamic";

export default async function AdminReports() {
  await requireArea("admin");
  const since = msAgo(30 * 86400_000);
  const [joinRequests, commReports, open, resolved, users, jobs, apps, signups, companies, sources] = await Promise.all([
    listPendingJoinRequests(50),
    db.communityReport.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 50, include: { post: { select: { id: true, title: true, community: { select: { slug: true, name: true } } } }, user: { select: { name: true } } } }),
    db.jobReport.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 100, include: { job: { select: { id: true, slug: true, title: true, companyName: true, status: true } }, user: { select: { name: true } } } }),
    db.jobReport.count({ where: { status: { not: "OPEN" } } }),
    db.user.groupBy({ by: ["role"], _count: true }),
    db.job.groupBy({ by: ["status"], _count: true }),
    db.application.groupBy({ by: ["external"], where: { status: { notIn: ["APPLYING"] }, createdAt: { gte: since } }, _count: true }),
    db.user.count({ where: { createdAt: { gte: since } } }),
    db.company.groupBy({ by: ["verified"], _count: true }),
    db.jobSource.groupBy({ by: ["health"], where: { active: true }, _count: true }),
  ]);
  // Group reports by job so a moderator decides once per posting.
  const byJob = new Map<string, { job: (typeof open)[number]["job"]; items: typeof open }>();
  for (const r of open) byJob.set(r.jobId, { job: r.job, items: [...(byJob.get(r.jobId)?.items ?? []), r] });
  const sum = <T extends { _count: number }>(rows: T[]) => rows.reduce((n, r) => n + r._count, 0);

  return (
    <>
      <PageHeader title="Reports" description="Candidate reports about job postings, and platform totals computed from live data." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open job reports" value={open.length} hint={`${resolved} handled so far`} />
        <Stat label="New accounts (30d)" value={signups} />
        <Stat label="Applications (30d)" value={sum(apps)} hint={`${apps.find((a) => !a.external)?._count ?? 0} on CareerPoint · ${apps.find((a) => a.external)?._count ?? 0} external, self-reported`} />
        <Stat label="Companies" value={sum(companies)} hint={`${companies.find((c) => c.verified)?._count ?? 0} verified`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="queue" className="min-w-0">
          <h2 id="queue" className="eyebrow mb-2">Moderation queue</h2>
          {byJob.size === 0 ? (
            <EmptyState title="No open reports" description="When a candidate reports a posting as a scam, expired or not BIM, it appears here for review." />
          ) : (
            <div className="space-y-3">
              {[...byJob.values()].map(({ job, items }) => (
                <article key={job.id} className="panel p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-[14.5px]"><Link href={`/jobs/${job.slug}`} className="hover:underline">{job.title}</Link> <span className="font-normal text-muted">· {job.companyName}</span> <Badge tone={job.status === "ACTIVE" ? "ok" : "neutral"}>{job.status.toLowerCase()}</Badge></h3>
                      <ul className="mt-2 space-y-1 text-[13px]">
                        {items.map((r) => <li key={r.id}><Badge tone="warn">{humanize(r.reason)}</Badge> <span className="text-ink-2">{r.details ?? "No details."}</span> <span className="text-muted">— {r.user.name}, {timeAgo(r.createdAt)}</span></li>)}
                      </ul>
                    </div>
                    <div className="flex gap-1.5">
                      <form action={resolveJobReportAction.bind(null, items[0].id, "ACTIONED", true)}><button className="btn btn-danger btn-sm">Remove posting</button></form>
                      <form action={resolveJobReportAction.bind(null, items[0].id, "DISMISSED", false)}><button className="btn btn-secondary btn-sm">Dismiss</button></form>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-4">
          <Panel title={`Community join requests (${joinRequests.length})`} description="Membership is by approval or invitation. Each person can be in 2 communities.">
            {joinRequests.length === 0 ? <p className="text-[13px] text-muted">No pending requests.</p> : (
              <ul className="space-y-3 text-[13px]">
                {joinRequests.map((r) => (
                  <li key={r.id}>
                    <p className="font-medium">{r.user.name} <span className="font-normal text-muted">→ {r.community.name}</span></p>
                    {r.message && <p className="text-ink-2">{r.message}</p>}
                    <p className="text-muted">{humanize(r.user.role)} · {timeAgo(r.createdAt)}</p>
                    <div className="mt-1 flex gap-1.5">
                      <form action={decideJoinRequestAction.bind(null, r.id, true)}><button className="btn btn-accent btn-sm">Approve</button></form>
                      <form action={decideJoinRequestAction.bind(null, r.id, false)}><button className="btn btn-secondary btn-sm">Decline</button></form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={`Community reports (${commReports.length})`} description="Reported posts. Actioning hides the post from the community.">
            {commReports.length === 0 ? <p className="text-[13px] text-muted">No open community reports.</p> : (
              <ul className="space-y-3 text-[13px]">
                {commReports.map((r) => (
                  <li key={r.id}>
                    <Link href={`/communities/${r.post.community.slug}/posts/${r.post.id}`} className="font-medium hover:underline">{r.post.title}</Link>
                    <p className="text-muted">{r.post.community.name} · {humanize(r.reason)} · {r.user.name}, {timeAgo(r.createdAt)}</p>
                    <div className="mt-1 flex gap-1.5">
                      <form action={resolveCommunityReportAction.bind(null, r.id, "ACTIONED")}><button className="btn btn-danger btn-sm">Hide post</button></form>
                      <form action={resolveCommunityReportAction.bind(null, r.id, "DISMISSED")}><button className="btn btn-secondary btn-sm">Dismiss</button></form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Accounts by role"><ul className="space-y-1 text-[13px]">{users.map((u) => <li key={u.role} className="flex justify-between"><span className="text-ink-2">{humanize(u.role)}</span><span className="tabular-nums text-muted">{u._count}</span></li>)}</ul></Panel>
          <Panel title="Jobs by status"><ul className="space-y-1 text-[13px]">{jobs.map((j) => <li key={j.status} className="flex justify-between"><span className="text-ink-2">{humanize(j.status)}</span><span className="tabular-nums text-muted">{j._count}</span></li>)}</ul></Panel>
          <Panel title="Active source health">{sources.length === 0 ? <p className="text-[13px] text-muted">No active sources.</p> : <ul className="space-y-1 text-[13px]">{sources.map((s) => <li key={s.health} className="flex justify-between"><span className="text-ink-2">{humanize(s.health)}</span><span className="tabular-nums text-muted">{s._count}</span></li>)}</ul>}</Panel>
        </div>
      </div>
    </>
  );
}
