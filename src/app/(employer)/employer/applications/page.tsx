import type { Metadata } from "next";
import Link from "next/link";
import type { ApplicationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireEmployerCtx } from "@/lib/auth/guards";
import { listEmployerApplications } from "@/lib/applications/employer";
import { APPLICATION_STAGES, STAGE_LABEL } from "@/lib/applications/lifecycle";
import { Avatar, Badge, Chip, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Applications" };
export const dynamic = "force-dynamic";

const COLUMNS: { key: string; label: string; statuses: ApplicationStatus[] }[] = [
  { key: "new", label: "Applied", statuses: ["APPLIED"] },
  { key: "review", label: "Review", statuses: ["RECRUITER_REVIEW"] },
  { key: "short", label: "Shortlisted", statuses: ["SHORTLISTED"] },
  { key: "assess", label: "Assessment", statuses: ["ASSESSMENT"] },
  { key: "interview", label: "Interview", statuses: ["INTERVIEW"] },
  { key: "offer", label: "Offer", statuses: ["OFFER", "ACCEPTED"] },
  { key: "closed", label: "Closed", statuses: ["REJECTED", "WITHDRAWN"] },
];
const SHOWN = APPLICATION_STAGES.filter((s) => s !== "APPLYING" && s !== "EXPIRED");

export default async function EmployerApplications({ searchParams }: { searchParams: Promise<{ job?: string; status?: string; q?: string; view?: string; page?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireEmployerCtx();
  const view = sp.view === "list" ? "list" : "board";
  const status = SHOWN.find((s) => s === sp.status);
  const page = Math.max(1, Number(sp.page) || 1);
  const [jobs, res] = await Promise.all([
    db.job.findMany({ where: { companyId: ctx.companyId }, select: { id: true, title: true }, orderBy: { createdAt: "desc" } }),
    listEmployerApplications(ctx, { jobId: sp.job, status, q: sp.q, page, pageSize: view === "board" ? 100 : 30 }),
  ]);
  const keep = (over: Record<string, string>) => `/employer/applications?${new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v) as [string, string][])}`;

  const card = (a: (typeof res.rows)[number]) => (
    <Link key={a.id} href={`/employer/applications/${a.id}`} className="panel block p-3 transition-colors hover:border-line-strong">
      <div className="flex items-center gap-2.5">
        <Avatar name={a.user.name} size={28} />
        <div className="min-w-0"><p className="truncate text-[13.5px] font-medium">{a.user.name}</p><p className="truncate text-[12px] text-muted">{a.job.title}</p></div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {(a.user.profile?.softwareSkills ?? []).slice(0, 3).map((s) => <Chip key={s.software}>{s.software}</Chip>)}
      </div>
      <div className="mt-2 flex items-center justify-between text-[12px] text-muted"><span>{timeAgo(a.lastActivityAt)}</span><span className="flex gap-1.5">{!a.viewedByEmployerAt && a.status === "APPLIED" && <Badge tone="accent">New</Badge>}{a.interviews[0] && <Badge tone="ok">Interview</Badge>}{a._count.notes > 0 && <span>{a._count.notes} note</span>}</span></div>
    </Link>
  );

  return (
    <>
      <PageHeader title="Applications" description="Candidates who applied through CareerPoint. Their stage changes are shared with them; your notes never are." />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <form className="flex flex-1 flex-wrap items-center gap-2" role="search">
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={sp.q} placeholder="Search candidates…" className="field max-w-xs" aria-label="Search candidates" />
          <select name="job" defaultValue={sp.job ?? ""} className="field w-auto" aria-label="Job"><option value="">All jobs</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
          <select name="status" defaultValue={status ?? ""} className="field w-auto" aria-label="Stage"><option value="">All stages</option>{SHOWN.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select>
          <button className="btn btn-secondary btn-sm">Filter</button>
        </form>
        <div className="inline-flex overflow-hidden rounded-md border border-line-strong text-[13px]" role="group" aria-label="View">
          {(["board", "list"] as const).map((v) => <Link key={v} href={keep({ view: v })} aria-current={view === v ? "page" : undefined} className={`px-3 py-1.5 ${view === v ? "bg-ink text-white" : "bg-bg text-ink-2 hover:bg-sunken"}`}>{v === "board" ? "Board" : "List"}</Link>)}
        </div>
      </div>

      {res.rows.length === 0 ? (
        <EmptyState title="No applications" description={sp.q || status || sp.job ? "Nothing matches these filters." : "When candidates apply to your jobs, you'll review them here."} />
      ) : view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="grid min-w-[1100px] grid-cols-7 gap-3">
            {COLUMNS.map((col) => {
              const items = res.rows.filter((a) => col.statuses.includes(a.status));
              return (
                <section key={col.key} aria-label={col.label} className="rounded-lg bg-surface p-2">
                  <h2 className="eyebrow mb-2 flex justify-between px-1">{col.label}<span className="tabular-nums">{items.length}</span></h2>
                  <div className="space-y-2">{items.map(card)}{items.length === 0 && <p className="px-1 py-3 text-[12px] text-muted">Empty</p>}</div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <ul className="panel divide-y divide-line">
            {res.rows.map((a) => (
              <li key={a.id}>
                <Link href={`/employer/applications/${a.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-surface">
                  <span className="flex min-w-0 items-center gap-3"><Avatar name={a.user.name} size={32} /><span className="min-w-0"><span className="block truncate font-medium">{a.user.name}</span><span className="block truncate text-[12.5px] text-muted">{a.user.profile?.headline ?? "BIM professional"} · {a.job.title}</span></span></span>
                  <span className="flex items-center gap-2 text-[12.5px] text-muted">{!a.viewedByEmployerAt && a.status === "APPLIED" && <Badge tone="accent">New</Badge>}<Badge tone={a.status === "REJECTED" ? "bad" : "accent"}>{STAGE_LABEL[a.status]}</Badge>{timeAgo(a.lastActivityAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={res.page} pages={res.pages} basePath="/employer/applications" params={{ job: sp.job, status, q: sp.q, view: "list" }} />
        </>
      )}
    </>
  );
}
