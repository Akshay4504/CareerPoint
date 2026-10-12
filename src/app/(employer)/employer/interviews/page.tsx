import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployerCtx } from "@/lib/auth/guards";
import { listInterviews } from "@/lib/applications/employer";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Interviews" };
export const dynamic = "force-dynamic";

export default async function InterviewsPage() {
  const { ctx } = await requireEmployerCtx();
  const all = await listInterviews(ctx);
  const now = new Date();
  const upcoming = all.filter((i) => i.status === "SCHEDULED" && i.scheduledAt >= now);
  const past = all.filter((i) => !upcoming.includes(i)).reverse();
  const row = (i: (typeof all)[number]) => (
    <li key={i.id}>
      <Link href={`/employer/applications/${i.application.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[13.5px] hover:bg-surface">
        <span><span className="font-medium">{i.application.user.name}</span> <span className="text-muted">· {i.application.job.title}</span><br /><span className="text-[12.5px] text-muted">{i.scheduledAt.toISOString().slice(0, 16).replace("T", " ")} UTC · {i.durationMin} min · {i.mode.toLowerCase()}</span></span>
        <span className="flex gap-1.5"><Badge tone={i.status === "CANCELLED" ? "bad" : i.status === "COMPLETED" ? "ok" : "accent"}>{i.status.toLowerCase()}</Badge>{i.status === "SCHEDULED" && <Badge tone={i.candidateResponse === "ACCEPTED" ? "ok" : i.candidateResponse ? "bad" : "neutral"}>{i.candidateResponse ? `candidate ${i.candidateResponse.toLowerCase()}` : "awaiting response"}</Badge>}</span>
      </Link>
    </li>
  );
  return (
    <>
      <PageHeader title="Interviews" description="Schedule interviews from an application. Candidates are notified and can confirm or decline." />
      {all.length === 0 ? <EmptyState title="No interviews yet" description="Open an application and use “Schedule interview”." action={<Link href="/employer/applications" className="btn btn-secondary btn-sm">Applications</Link>} /> : (
        <div className="space-y-6">
          <Panel title={`Upcoming (${upcoming.length})`} pad={false}>{upcoming.length ? <ul className="divide-y divide-line">{upcoming.map(row)}</ul> : <p className="p-4 text-[13.5px] text-muted">Nothing upcoming.</p>}</Panel>
          {past.length > 0 && <Panel title="Past & cancelled" pad={false}><ul className="divide-y divide-line">{past.map(row)}</ul></Panel>}
        </div>
      )}
    </>
  );
}
