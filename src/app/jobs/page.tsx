import Link from "next/link";
import { pageMeta } from "@/lib/seo";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { searchJobs, jobFacets, type JobFilters } from "@/lib/jobs/search";
import { buildFeed, FEED_VIEWS, type FeedView } from "@/lib/jobs/feed";
import { JobCard } from "@/components/job-card";
import { EmptyState, PageHeader, Pagination } from "@/components/ui";

export const metadata: Metadata = pageMeta({ title: "BIM jobs", description: "Search current BIM, VDC and digital construction jobs. Every listing is checked, classified for BIM relevance and de-duplicated across sources.", path: "/jobs" });
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const num = (v?: string) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined);

export default async function JobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const candidate = user?.role === "CANDIDATE" ? user : null;
  const profile = candidate ? await db.bIMProfessionalProfile.findUnique({ where: { userId: candidate.id }, select: { id: true } }) : null;
  const view = (FEED_VIEWS.find((v) => v.key === one(sp.view))?.key ?? "all") as FeedView | "all";
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const filters: JobFilters = {
    q: one(sp.q), role: one(sp.role), discipline: one(sp.discipline), country: one(sp.country), city: one(sp.city), company: one(sp.company), employmentType: one(sp.type),
    software: [one(sp.software)].filter((x): x is string => !!x),
    remote: (["REMOTE", "HYBRID", "ONSITE"] as const).find((r) => r === one(sp.remote)),
    experience: num(one(sp.exp)), salaryMin: num(one(sp.salary)), postedWithinDays: num(one(sp.posted)),
    sort: (["relevance", "newest", "quality", "match"] as const).find((s) => s === one(sp.sort)), page,
  };
  const hasFilter = !!(filters.q || filters.role || filters.discipline || filters.country || filters.city || filters.company || filters.employmentType || filters.software?.length || filters.remote || filters.experience != null || filters.salaryMin || filters.postedWithinDays);

  const [facets, feed, result] = await Promise.all([
    jobFacets(),
    candidate && profile && view !== "all" ? buildFeed(candidate.id, profile.id, view) : null,
    view === "all" ? searchJobs(filters, { profileId: profile?.id }) : null,
  ]);

  const ids = [...(result?.rows ?? []), ...(feed?.items ?? [])].map((r) => r.job.id);
  const [saved, pinned] = candidate ? await Promise.all([db.savedJob.findMany({ where: { userId: candidate.id, jobId: { in: ids } }, select: { jobId: true } }), db.pinnedJob.findMany({ where: { userId: candidate.id, jobId: { in: ids } }, select: { jobId: true } })]) : [[], []];
  const savedSet = new Set(saved.map((s) => s.jobId));
  const pinnedSet = new Set(pinned.map((s) => s.jobId));
  const items = feed ? feed.items : (result?.rows ?? []);
  const total = feed ? feed.total : (result?.total ?? 0);

  const keep = Object.fromEntries(Object.entries(sp).filter(([k]) => k !== "page" && k !== "view").map(([k, v]) => [k, one(v)]));
  const hint = feed?.hint ?? (candidate && !profile ? "Complete your BIM profile to improve recommendations." : null);

  return (
    <>
      <PageHeader
        title="BIM jobs"
        description={`${total.toLocaleString()} ${view === "all" ? "open" : FEED_VIEWS.find((v) => v.key === view)!.label.toLowerCase()} ${total === 1 ? "role" : "roles"}${profile ? " · scored against your profile" : ""}`}
        actions={candidate ? <><Link href="/jobs/alerts" className="btn btn-secondary btn-sm">Job alerts</Link><Link href="/jobs/saved" className="btn btn-ghost btn-sm">Saved</Link></> : undefined}
      />

      {candidate && (
        <nav aria-label="Feed" className="mb-4 flex flex-wrap gap-1.5 border-b border-line pb-3">
          {[{ key: "all" as const, label: "All jobs" }, ...FEED_VIEWS].map((v) => (
            <Link key={v.key} href={v.key === "all" ? "/jobs" : `/jobs?view=${v.key}`} aria-current={view === v.key ? "page" : undefined} className={`rounded-md px-2.5 py-1 text-[13px] ${view === v.key ? "bg-ink font-medium text-white" : "text-ink-2 hover:bg-sunken"}`}>
              {v.label}
              {v.key !== "all" && profile && <span className={`ml-1.5 text-[11.5px] ${view === v.key ? "text-white/70" : "text-muted"}`}>{feed?.counts[v.key as FeedView] ?? ""}</span>}
            </Link>
          ))}
        </nav>
      )}

      {hint && (
        <p role="note" className="mb-4 rounded-md border border-[#ecd29e] bg-warn-soft px-3 py-2 text-[13px] text-warn">
          {hint} <Link href="/profile" className="font-medium underline">Update profile</Link>
        </p>
      )}

      {view === "all" && (
        <form className="panel mb-5 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label="Filter jobs">
          <input name="q" defaultValue={filters.q} placeholder="Search title, company, skills…" className="field sm:col-span-2" aria-label="Search" />
          <select name="role" defaultValue={filters.role ?? ""} className="field" aria-label="BIM role"><option value="">Any BIM role</option>{facets.roles.map((r) => <option key={r.value} value={r.value}>{r.value} ({r.count})</option>)}</select>
          <select name="discipline" defaultValue={filters.discipline ?? ""} className="field" aria-label="Discipline"><option value="">Any discipline</option>{facets.disciplines.map((r) => <option key={r.value} value={r.value}>{r.value} ({r.count})</option>)}</select>
          <select name="software" defaultValue={filters.software?.[0] ?? ""} className="field" aria-label="Software"><option value="">Any software</option>{facets.software.map((s) => <option key={s}>{s}</option>)}</select>
          <select name="country" defaultValue={filters.country ?? ""} className="field" aria-label="Country"><option value="">Any country</option>{facets.countries.map((r) => <option key={r.value} value={r.value}>{r.value} ({r.count})</option>)}</select>
          <input name="city" defaultValue={filters.city} placeholder="City" className="field" aria-label="City" />
          <select name="remote" defaultValue={filters.remote ?? ""} className="field" aria-label="Work arrangement"><option value="">Any arrangement</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option><option value="ONSITE">On-site</option></select>
          <input name="exp" type="number" min={0} max={40} defaultValue={filters.experience} placeholder="My years of experience" className="field" aria-label="Years of experience" />
          <input name="salary" type="number" min={0} step={1000} defaultValue={filters.salaryMin} placeholder="Min salary (yearly)" className="field" aria-label="Minimum salary" />
          <select name="type" defaultValue={filters.employmentType ?? ""} className="field" aria-label="Employment type"><option value="">Any type</option>{facets.employmentTypes.map((r) => <option key={r.value} value={r.value}>{r.value}</option>)}</select>
          <select name="posted" defaultValue={filters.postedWithinDays ?? ""} className="field" aria-label="Posted"><option value="">Any date</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
          <input name="company" defaultValue={filters.company} placeholder="Company" className="field" aria-label="Company" />
          <select name="sort" defaultValue={filters.sort ?? ""} className="field" aria-label="Sort"><option value="">{filters.q ? "Best text match" : "Newest"}</option><option value="newest">Newest</option><option value="quality">Listing quality</option>{profile && <option value="match">Best match for me</option>}</select>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button className="btn btn-primary btn-sm">Search</button>
            {hasFilter && <Link href="/jobs" className="btn btn-ghost btn-sm">Clear filters</Link>}
            {candidate && hasFilter && <Link href={`/jobs/alerts?${new URLSearchParams({ ...(filters.q ? { keywords: filters.q } : {}), ...(filters.role ? { role: filters.role } : {}), ...(filters.country ? { country: filters.country } : {}), ...(filters.city ? { city: filters.city } : {}) })}`} className="btn btn-secondary btn-sm">Alert me about this search</Link>}
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <EmptyState
          title={view !== "all" ? "Nothing here yet" : hasFilter ? "No jobs match these filters" : "No jobs yet"}
          description={view !== "all" ? "New BIM jobs are scored against your profile as they are discovered." : hasFilter ? "Try removing a filter or broadening your search." : "BIM jobs appear here as employers post roles and our ingestion workers discover openings on public career sites."}
          action={hasFilter ? <Link href="/jobs" className="btn btn-secondary btn-sm">Clear filters</Link> : undefined}
        />
      ) : (
        <div className="space-y-2.5">
          {items.map(({ job, score, info }) => (
            <JobCard key={job.id} job={job} score={score} reasons={info?.reasons} gaps={info?.gaps} saved={savedSet.has(job.id)} pinned={pinnedSet.has(job.id)} interactive={!!candidate} />
          ))}
        </div>
      )}
      {view === "all" && result && <Pagination page={page} pages={result.pages} basePath="/jobs" params={keep as Record<string, string | undefined>} />}
      {!user && (
        <p className="mt-8 text-center text-[13px] text-muted">
          <Link href="/register" className="font-medium text-ink underline">Create a BIM profile</Link> to see how well each job matches you.
        </p>
      )}
    </>
  );
}
