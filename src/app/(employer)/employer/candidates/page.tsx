import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployerCtx } from "@/lib/auth/guards";
import { can } from "@/lib/employer/permissions";
import { listContactRequests, searchCandidates } from "@/lib/employer/candidates";
import { ROLE_RULES } from "@/lib/jobs/classify";
import { Avatar, Badge, Chip, EmptyState, PageHeader, Pagination, Panel } from "@/components/ui";
import { DISCIPLINES } from "@/lib/taxonomy";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Candidates" };
export const dynamic = "force-dynamic";

type SP = { q?: string; role?: string; discipline?: string; software?: string; expMin?: string; expMax?: string; location?: string; availability?: string; certification?: string; project?: string; open?: string; portfolio?: string; page?: string; contacts?: string };
const num = (v?: string) => (v && /^\d{1,2}$/.test(v) ? Number(v) : undefined);

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx } = await requireEmployerCtx();

  // The directory is only available to verified companies — enforced in the service, not just hidden in the UI.
  if (!ctx.verified || !can(ctx.role, "candidates.search")) {
    return (
      <>
        <PageHeader title="Candidates" />
        <EmptyState title={ctx.verified ? "Not available for your role" : "Available after verification"} description={ctx.verified ? "Ask a company admin or recruiter to search candidates." : "To protect members, the candidate directory unlocks once our team has verified your company. You can still post jobs and review applicants meanwhile."} action={<Link href="/employer/company" className="btn btn-secondary btn-sm">Company profile</Link>} />
      </>
    );
  }

  if (sp.contacts === "1") {
    const reqs = await listContactRequests(ctx);
    return (
      <>
        <PageHeader title="Contact requests" description="Candidates decide whether to share their contact details. Email appears only after they accept." actions={<Link href="/employer/candidates" className="btn btn-ghost btn-sm">← Search</Link>} />
        {reqs.length === 0 ? <EmptyState title="No requests yet" description="Contact a candidate from their profile." /> : (
          <ul className="panel divide-y divide-line">
            {reqs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13.5px]">
                <span className="min-w-0"><Link href={`/professionals/${r.slug}`} className="font-medium hover:underline">{r.name}</Link><span className="block truncate text-[12.5px] text-muted">{r.message}</span></span>
                <span className="flex items-center gap-2 text-[12.5px] text-muted">{r.email && <a className="underline" href={`mailto:${r.email}`}>{r.email}</a>}<Badge tone={r.status === "ACCEPTED" ? "ok" : r.status === "DECLINED" ? "bad" : "neutral"}>{r.status.toLowerCase()}</Badge>{timeAgo(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  const page = Math.max(1, Number(sp.page) || 1);
  const res = await searchCandidates(ctx, {
    q: sp.q, role: sp.role, discipline: sp.discipline, software: sp.software?.split(",").map((s) => s.trim()).filter(Boolean), expMin: num(sp.expMin), expMax: num(sp.expMax),
    location: sp.location, availability: sp.availability, certification: sp.certification, projectExperience: sp.project, openToWork: sp.open === "1", hasPortfolio: sp.portfolio === "1", page,
  });

  return (
    <>
      <PageHeader title="Candidates" description={`${res.total} public ${res.total === 1 ? "profile" : "profiles"} match. Only information candidates chose to make public is shown, and every profile view is visible to them.`} actions={<Link href="/employer/candidates?contacts=1" className="btn btn-secondary btn-sm">Contact requests</Link>} />
      <form className="panel mb-5 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Name or headline" className="field" aria-label="Search" />
        <select name="role" defaultValue={sp.role ?? ""} className="field" aria-label="BIM role"><option value="">Any BIM role</option>{ROLE_RULES.map((r) => <option key={r.role}>{r.role}</option>)}</select>
        <select name="discipline" defaultValue={sp.discipline ?? ""} className="field" aria-label="Discipline"><option value="">Any discipline</option>{DISCIPLINES.map((d) => <option key={d}>{d}</option>)}</select>
        <input name="software" defaultValue={sp.software} placeholder="Software (Revit, Navisworks)" className="field" aria-label="Software" />
        <input name="expMin" defaultValue={sp.expMin} inputMode="numeric" placeholder="Min years" className="field" aria-label="Minimum years" />
        <input name="expMax" defaultValue={sp.expMax} inputMode="numeric" placeholder="Max years" className="field" aria-label="Maximum years" />
        <input name="location" defaultValue={sp.location} placeholder="Country or city" className="field" aria-label="Location" />
        <input name="availability" defaultValue={sp.availability} placeholder="Availability" className="field" aria-label="Availability" />
        <input name="certification" defaultValue={sp.certification} placeholder="Certification" className="field" aria-label="Certification" />
        <input name="project" defaultValue={sp.project} placeholder="Project sector / type" className="field" aria-label="Project experience" />
        <div className="flex flex-wrap items-center gap-4 text-[13px] text-ink-2">
          <label className="flex items-center gap-1.5"><input type="checkbox" name="open" value="1" defaultChecked={sp.open === "1"} /> Open to work</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" name="portfolio" value="1" defaultChecked={sp.portfolio === "1"} /> Has portfolio</label>
        </div>
        <button className="btn btn-primary btn-sm">Search</button>
      </form>
      {res.rows.length === 0 ? (
        <EmptyState title="No candidates match" description="Try widening your filters. Only candidates with public profiles appear here." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {res.rows.map((p) => (
            <li key={p.id}>
              <Link href={`/professionals/${p.slug}`} className="panel flex h-full flex-col gap-2 p-4 transition-colors hover:border-line-strong">
                <div className="flex items-center gap-3">
                  <Avatar name={p.name} src={p.avatarFileId ? `/api/files/${p.avatarFileId}` : null} size={40} />
                  <div className="min-w-0"><p className="truncate font-medium">{p.name}</p><p className="truncate text-[12.5px] text-muted">{p.headline ?? "BIM professional"}</p></div>
                </div>
                <p className="text-[12.5px] text-muted">{[p.location, p.discipline, p.yearsExperience != null ? `${p.yearsExperience}y` : null, p.publishedProjects ? `${p.publishedProjects} project${p.publishedProjects > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ")}</p>
                <div className="mt-auto flex flex-wrap gap-1">{p.openToWork && <Badge tone="ok">Open to work</Badge>}{p.software.map((s) => <Chip key={s}>{s}</Chip>)}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={res.page} pages={res.pages} basePath="/employer/candidates" params={{ ...sp, page: undefined, contacts: undefined }} />
      <Panel className="mt-8" title="How this works"><p className="text-[13px] text-muted">Opening a profile records a view that the candidate can see (&ldquo;a verified employer viewed your profile&rdquo;). Use <strong>Contact</strong> on a profile to send a request — the candidate chooses whether to reply.</p></Panel>
    </>
  );
}
