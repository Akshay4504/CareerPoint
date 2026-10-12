import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireEmployerCtx } from "@/lib/auth/guards";
import { listInterviews } from "@/lib/applications/employer";
import { employerAnalytics } from "@/lib/applications/analytics";
import { STAGE_LABEL } from "@/lib/applications/lifecycle";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Employer overview" };
export const dynamic = "force-dynamic";

export default async function EmployerHome() {
  const { ctx } = await requireEmployerCtx();
  const [stats, recent, interviews, jobs] = await Promise.all([
    employerAnalytics(ctx, 30),
    db.application.findMany({ where: { external: false, status: { notIn: ["APPLYING"] }, job: { companyId: ctx.companyId } }, orderBy: { createdAt: "desc" }, take: 6, include: { job: { select: { title: true } }, user: { select: { name: true, profile: { select: { headline: true } } } } } }),
    listInterviews(ctx),
    db.job.groupBy({ by: ["status"], where: { companyId: ctx.companyId }, _count: true }),
  ]);
  const upcoming = interviews.filter((i) => i.status === "SCHEDULED" && i.scheduledAt > new Date()).slice(0, 4);
  const pending = jobs.find((j) => j.status === "PENDING")?._count ?? 0;
  const newApps = recent.filter((r) => r.status === "APPLIED" && !r.viewedByEmployerAt).length;

  return (
    <>
      <PageHeader title={ctx.companyName} description="Your hiring overview for the last 30 days." actions={<Link href="/employer/jobs/new" className="btn btn-primary btn-sm">Post a job</Link>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Live jobs" value={stats.jobsLive} href="/employer/jobs" hint={pending ? `${pending} awaiting review` : undefined} />
        <Stat label="Applications (30d)" value={stats.applications} href="/employer/applications" hint={newApps ? `${newApps} not yet viewed` : undefined} />
        <Stat label="Shortlisted" value={stats.shortlisted} hint={stats.shortlistRate == null ? undefined : `${stats.shortlistRate}% of applications`} href="/employer/applications?status=SHORTLISTED" />
        <Stat label="Interviews" value={upcoming.length} hint="upcoming" href="/employer/interviews" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Latest applications" pad={false} actions={<Link href="/employer/applications" className="text-[13px] text-muted hover:text-ink">All →</Link>}>
          {recent.length === 0 ? (
            <div className="p-4"><EmptyState title="No applications yet" description="Candidates who apply on CareerPoint arrive here with their structured profile, resume and portfolio." action={<Link href="/employer/jobs/new" className="btn btn-secondary btn-sm">Post a job</Link>} /></div>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link href={`/employer/applications/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface">
                    <span className="min-w-0"><span className="block truncate font-medium">{r.user.name}</span><span className="block truncate text-[12.5px] text-muted">{r.user.profile?.headline ?? "BIM professional"} · {r.job.title}</span></span>
                    <span className="shrink-0 text-right text-[12.5px] text-muted"><Badge tone={r.status === "REJECTED" ? "bad" : "accent"}>{STAGE_LABEL[r.status]}</Badge><br />{timeAgo(r.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Upcoming interviews" pad={false} actions={<Link href="/employer/interviews" className="text-[13px] text-muted hover:text-ink">All →</Link>}>
          {upcoming.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No interviews scheduled.</p> : (
            <ul className="divide-y divide-line text-[13.5px]">
              {upcoming.map((i) => <li key={i.id}><Link href={`/employer/applications/${i.application.id}`} className="block px-4 py-3 hover:bg-surface"><span className="font-medium">{i.application.user.name}</span> <span className="text-muted">· {i.application.job.title}</span><br /><span className="text-[12.5px] text-muted">{i.scheduledAt.toISOString().slice(0, 16).replace("T", " ")} UTC · {i.mode.toLowerCase()}{i.candidateResponse ? ` · candidate ${i.candidateResponse.toLowerCase()}` : " · awaiting response"}</span></Link></li>)}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
