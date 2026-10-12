import type { Metadata } from "next";
import Link from "next/link";
import type { ApplicationStatus } from "@prisma/client";
import { requireArea } from "@/lib/auth/guards";
import { ensureProfile } from "@/lib/services/profile";
import { listCandidateApplications, listSavedForTracker } from "@/lib/applications/candidate";
import { candidateAnalytics } from "@/lib/applications/analytics";
import { APPLICATION_STAGES, KANBAN_COLUMNS, STAGE_LABEL, ENGAGED_STAGES } from "@/lib/applications/lifecycle";
import { Badge, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Application tracker" };
export const dynamic = "force-dynamic";

type SP = { view?: string; q?: string; status?: string; type?: string };
const TONE: Partial<Record<ApplicationStatus, "neutral" | "accent" | "ok" | "warn" | "bad">> = { APPLYING: "warn", APPLIED: "neutral", RECRUITER_REVIEW: "accent", SHORTLISTED: "accent", ASSESSMENT: "accent", INTERVIEW: "warn", OFFER: "ok", ACCEPTED: "ok", REJECTED: "bad" };

export default async function TrackerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireArea("app");
  const profile = await ensureProfile(user);
  const view = sp.view === "list" ? "list" : "kanban";
  const status = APPLICATION_STAGES.find((s) => s === sp.status);
  const origin = sp.type === "native" || sp.type === "external" ? sp.type : undefined;

  const [apps, saved, stats] = await Promise.all([listCandidateApplications(user.id, { q: sp.q, status, origin }), status || origin ? [] : listSavedForTracker(user.id, sp.q), candidateAnalytics(user.id, profile.id)]);
  const hasAny = apps.length + saved.length > 0;
  const keep = (over: Partial<SP>) => `/applications?${new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v) as [string, string][])}`;

  const card = (a: (typeof apps)[number]) => {
    const selfReported = a.external && ENGAGED_STAGES.includes(a.status);
    return (
      <Link key={a.id} href={`/applications/${a.id}`} className="panel block p-3 transition-colors hover:border-line-strong">
        <p className="text-[13.5px] font-medium leading-snug">{a.job.title}</p>
        <p className="text-[12.5px] text-muted">{a.job.companyName}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone={TONE[a.status] ?? "neutral"}>{STAGE_LABEL[a.status]}</Badge>
          <Badge>{a.external ? "External" : "CareerPoint"}</Badge>
          {selfReported && <Badge tone="warn">Self-reported</Badge>}
          {a.interviews[0] && <Badge tone="ok">Interview {a.interviews[0].scheduledAt.toISOString().slice(5, 10)}</Badge>}
          {a._count.messages > 0 && <span className="text-[12px] text-muted">{a._count.messages} msg</span>}
        </div>
        <p className="mt-1.5 text-[12px] text-muted">{timeAgo(a.lastActivityAt)}</p>
      </Link>
    );
  };

  return (
    <>
      <PageHeader title="Application tracker" description="Everything you've saved, started and sent — in one place. Progress on external applications is recorded by you." actions={<Link href="/jobs" className="btn btn-secondary btn-sm">Find jobs</Link>} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Applications" value={stats.total} hint={`${stats.submitted} submitted`} />
        <Stat label="Active" value={stats.active} />
        <Stat label="Interviews" value={stats.interviews} />
        <Stat label="Offers" value={stats.offers} />
        <Stat label="Employer response rate" value={stats.responseRate == null ? "—" : `${stats.responseRate}%`} hint={stats.responseRate == null ? "Only applications made on CareerPoint can show this" : `of ${stats.nativeSubmitted} CareerPoint applications`} />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <form className="flex flex-1 flex-wrap items-center gap-2" role="search">
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={sp.q} placeholder="Search title or company…" className="field max-w-xs" aria-label="Search applications" />
          <select name="status" defaultValue={status ?? ""} className="field w-auto" aria-label="Stage"><option value="">All stages</option>{APPLICATION_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select>
          <select name="type" defaultValue={origin ?? ""} className="field w-auto" aria-label="Type"><option value="">CareerPoint + external</option><option value="native">CareerPoint only</option><option value="external">External only</option></select>
          <button className="btn btn-secondary btn-sm">Filter</button>
          {(sp.q || status || origin) && <Link href={keep({ q: "", status: "", type: "" })} className="btn btn-ghost btn-sm">Clear</Link>}
        </form>
        <div className="inline-flex overflow-hidden rounded-md border border-line-strong text-[13px]" role="group" aria-label="View">
          {(["kanban", "list"] as const).map((v) => <Link key={v} href={keep({ view: v })} aria-current={view === v ? "page" : undefined} className={`px-3 py-1.5 ${view === v ? "bg-ink text-white" : "bg-bg text-ink-2 hover:bg-sunken"}`}>{v === "kanban" ? "Board" : "List"}</Link>)}
        </div>
      </div>

      {!hasAny ? (
        <EmptyState title={sp.q || status || origin ? "No applications match" : "Nothing tracked yet"} description={sp.q || status || origin ? "Try clearing the filters." : "Save a job, or apply to one — it appears here and you can follow it through every stage."} action={<Link href="/jobs" className="btn btn-primary btn-sm">Browse BIM jobs</Link>} />
      ) : view === "kanban" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="grid min-w-[1100px] grid-cols-7 gap-3">
            {KANBAN_COLUMNS.map((col) => {
              const colApps = apps.filter((a) => col.statuses.includes(a.status));
              const colSaved = col.key === "saved" ? saved : [];
              return (
                <section key={col.key} aria-label={col.label} className="rounded-lg bg-surface p-2">
                  <h2 className="eyebrow mb-2 flex justify-between px-1">{col.label}<span className="tabular-nums">{colApps.length + colSaved.length}</span></h2>
                  <div className="space-y-2">
                    {colSaved.map((j) => (
                      <Link key={j.id} href={`/jobs/${j.slug}`} className="panel block p-3 transition-colors hover:border-line-strong">
                        <p className="text-[13.5px] font-medium leading-snug">{j.title}</p>
                        <p className="text-[12.5px] text-muted">{j.companyName}</p>
                        <div className="mt-2 flex gap-1.5"><Badge tone={j.stage === "PINNED" ? "warn" : "neutral"}>{STAGE_LABEL[j.stage]}</Badge>{j.status !== "ACTIVE" && <Badge tone="bad">No longer listed</Badge>}</div>
                      </Link>
                    ))}
                    {colApps.map(card)}
                    {colApps.length + colSaved.length === 0 && <p className="px-1 py-3 text-[12px] text-muted">Empty</p>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <Table>
          <thead><tr><Th>Job</Th><Th>Stage</Th><Th>Type</Th><Th>Last activity</Th></tr></thead>
          <tbody>
            {saved.map((j) => <tr key={j.id}><Td><Link href={`/jobs/${j.slug}`} className="font-medium hover:underline">{j.title}</Link><br /><span className="text-[12.5px] text-muted">{j.companyName}</span></Td><Td><Badge tone={j.stage === "PINNED" ? "warn" : "neutral"}>{STAGE_LABEL[j.stage]}</Badge></Td><Td className="text-muted">—</Td><Td className="text-muted">{timeAgo(j.savedAt)}</Td></tr>)}
            {apps.map((a) => (
              <tr key={a.id}>
                <Td><Link href={`/applications/${a.id}`} className="font-medium hover:underline">{a.job.title}</Link><br /><span className="text-[12.5px] text-muted">{[a.job.companyName, a.job.location].filter(Boolean).join(" · ")}</span></Td>
                <Td><Badge tone={TONE[a.status] ?? "neutral"}>{STAGE_LABEL[a.status]}</Badge>{a.external && ENGAGED_STAGES.includes(a.status) && <span className="ml-1.5 text-[11.5px] text-warn">self-reported</span>}</Td>
                <Td className="text-[13px] text-muted">{a.external ? "External" : "CareerPoint"}</Td>
                <Td className="text-muted">{timeAgo(a.lastActivityAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
