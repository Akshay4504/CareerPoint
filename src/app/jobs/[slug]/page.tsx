import Link from "next/link";
import { ReportJob } from "./report-job";
import { jobPostingLd, jsonLd, pageMeta } from "@/lib/seo";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/rbac";
import { Badge, Chip, MatchBadge, Meter, Panel } from "@/components/ui";
import { ApplyPanel } from "./apply-panel";
import { toggleSaveJob, togglePinJob } from "@/app/actions/jobs";
import { formatSalary, timeAgo } from "@/lib/utils";
import { loadJobScoreProfile } from "@/lib/services/profile";
import { recordInteraction } from "@/lib/applications/candidate";
import { isNativeJob } from "@/lib/applications/lifecycle";
import { scoreJobMatch } from "@/lib/scoring/job";
import type { ResumeContent } from "@/lib/resume/types";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams?: Promise<{ resume?: string; from?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const job = await db.job.findUnique({ where: { slug }, select: { title: true, companyName: true, status: true, location: true, description: true, canonicalJobId: true } });
  if (!job || job.status !== "ACTIVE" || job.canonicalJobId) return { title: "Job", robots: { index: false, follow: false } };
  return pageMeta({ title: `${job.title} at ${job.companyName}`, description: `${job.title} at ${job.companyName}${job.location ? ` in ${job.location}` : ""}. ${job.description}`, path: `/jobs/${slug}`, type: "article" });
}

export default async function JobPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const user = await getCurrentUser();
  const job = await db.job.findUnique({ where: { slug }, include: { company: true } });
  // A merged duplicate always redirects to its canonical opening.
  if (job?.canonicalJobId) {
    const canon = await db.job.findUnique({ where: { id: job.canonicalJobId }, select: { slug: true } });
    if (canon) redirect(`/jobs/${canon.slug}`);
  }
  if (!job) notFound();
  // Non-active jobs are visible only to staff and the owning company's members.
  const isOwner = !!user && !!job.companyId && user.employerUsers.some((m) => m.companyId === job.companyId);
  if (job.status !== "ACTIVE" && !(user && isStaff(user.role)) && !isOwner) notFound();

  const candidate = user?.role === "CANDIDATE" ? user : null;
  const profile = candidate
    ? await db.bIMProfessionalProfile.findUnique({ where: { userId: candidate.id }, include: { skills: { include: { skill: true } }, softwareSkills: true, resumes: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } } } })
    : null;

  // Job-specific diagnostic: master profile + (optionally) the chosen resume's evidence.
  const chosen = profile?.resumes.find((r) => r.id === sp.resume) ?? null;
  let diag = null as ReturnType<typeof scoreJobMatch> | null;
  if (profile) {
    const snap = await loadJobScoreProfile(profile.id);
    const rc = chosen?.versions[0]?.content as unknown as ResumeContent | undefined;
    if (rc) {
      snap.software = Array.from(new Set([...snap.software, ...rc.software]));
      snap.skills = Array.from(new Set([...snap.skills, ...rc.skills]));
      snap.titles = [...snap.titles, rc.headline ?? "", ...rc.experiences.map((e) => e.title)].filter(Boolean);
    }
    diag = scoreJobMatch(snap, job);
  }

  const [application, saved, pinned] = candidate
    ? await Promise.all([db.application.findUnique({ where: { userId_jobId: { userId: candidate.id, jobId: job.id } } }), db.savedJob.findUnique({ where: { userId_jobId: { userId: candidate.id, jobId: job.id } } }), db.pinnedJob.findUnique({ where: { userId_jobId: { userId: candidate.id, jobId: job.id } } })])
    : [null, null, null];

  const external = !isNativeJob(job);
  const resumeList = profile?.resumes ?? [];
  const [portfolioProjects, portfolioItems] = profile && !external
    ? await Promise.all([db.project.findMany({ where: { profileId: profile.id }, select: { id: true, name: true, published: true }, orderBy: { createdAt: "desc" }, take: 20 }), db.portfolioItem.findMany({ where: { profileId: profile.id, projectId: null }, select: { id: true, title: true }, take: 20 })])
    : [[], []];
  const origin = (["feed", "search", "alert", "profile"] as const).find((o) => o === sp.from) ?? "direct";
  // Record a real "viewed" interaction (collapsed to one per day) — this is what "Job discovered" on the timeline is based on.
  if (candidate && job.status === "ACTIVE") await recordInteraction(candidate.id, job.id, "VIEWED");
  const refs = await db.jobSourceRef.findMany({ where: { jobId: job.id }, include: { source: { select: { name: true, type: true } } }, orderBy: { firstSeenAt: "asc" } });
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);
  const resumes = profile?.resumes.filter((r) => r.versions[0]).map((r) => ({ resumeId: r.id, versionId: r.versions[0].id, label: `${r.title} (v${r.versions[0].version})` })) ?? [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {job.status === "ACTIVE" && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(jobPostingLd({ title: job.title, description: job.description.slice(0, 5000), slug: job.slug, companyName: job.companyName, companySlug: job.company?.verified ? job.company.slug : null, postedAt: job.postedAt, expiresAt: job.expiresAt, employmentType: job.employmentType, location: job.location, city: job.city, country: job.country, remoteType: job.remoteType, salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency })) }} />
      )}
      <div className="min-w-0">
        <Link href="/jobs" className="text-[13px] text-muted hover:text-ink">← All jobs</Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="text-[26px] leading-tight">{job.title}</h1>
          {job.status !== "ACTIVE" && <Badge tone="warn">{job.status}</Badge>}
        </div>
        <p className="mt-1 text-[15px] text-ink-2">
          {job.company ? <Link href={`/companies/${job.company.slug}`} className="hover:underline">{job.companyName}</Link> : job.companyName}
          {job.company?.verified && <span className="ml-2 align-middle"><Badge tone="ok">Verified employer</Badge></span>}
        </p>
        <p className="mt-1 text-[13px] text-muted">
          {[job.location, job.remote ? "Remote-friendly" : null, job.employmentType, job.seniority, job.discipline, salary].filter(Boolean).join(" · ")} · Posted {timeAgo(job.postedAt)}
        </p>

        {(job.software.length > 0 || job.skills.length > 0) && (
          <div className="mt-5 space-y-2">
            {job.software.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="eyebrow mr-1">Software</span>{job.software.map((s) => <Chip key={s}>{s}</Chip>)}</div>}
            {job.skills.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="eyebrow mr-1">Skills</span>{job.skills.map((s) => <Chip key={s}>{s}</Chip>)}</div>}
          </div>
        )}

        <dl className="mt-5 grid max-w-xl grid-cols-2 gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-3">
          {([["BIM role", job.bimRole], ["Discipline", job.discipline], ["Experience", job.experienceMin != null ? (job.experienceMax != null ? `${job.experienceMin}–${job.experienceMax} years` : `${job.experienceMin}+ years`) : null], ["Industry", job.industry], ["Work arrangement", job.remoteType !== "UNKNOWN" ? job.remoteType.charAt(0) + job.remoteType.slice(1).toLowerCase() : null], ["Salary", salary]] as const).map(([k, v]) => v ? <div key={k}><dt className="text-[12px] text-muted">{k}</dt><dd>{v}</dd></div> : null)}
        </dl>

        {job.responsibilities && <section className="mt-6 max-w-[68ch]"><h2 className="eyebrow mb-1.5">Responsibilities</h2><div className="prose-plain text-[14.5px] leading-relaxed text-ink-2">{job.responsibilities}</div></section>}
        {job.requirements && <section className="mt-6 max-w-[68ch]"><h2 className="eyebrow mb-1.5">Requirements</h2><div className="prose-plain text-[14.5px] leading-relaxed text-ink-2">{job.requirements}</div></section>}
        <section className="mt-6 max-w-[68ch]"><h2 className="eyebrow mb-1.5">{job.responsibilities || job.requirements ? "Full description" : "Description"}</h2><div className="prose-plain text-[14.5px] leading-relaxed text-ink-2">{job.description}</div></section>

        {external && <p className="mt-6 text-[12.5px] text-muted">External application — this opening is published by the employer elsewhere. CareerPoint does not verify external postings; you apply on the original site.</p>}
        {refs.length > 1 && (
          <p className="mt-2 text-[12.5px] text-muted">Also listed on: {refs.filter((r) => r.active).map((r) => r.source.name).join(", ")}. Duplicates are merged into this single listing.</p>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Panel title={external ? "Apply (external)" : "Apply on CareerPoint"}>
          {!user ? (
            <div className="space-y-3 text-[13.5px]">
              <p className="text-muted">Create a BIM profile to apply, save this job and see how well you match.</p>
              <Link href={`/login?next=/jobs/${job.slug}`} className="btn btn-primary w-full">Sign in to apply</Link>
              <Link href="/register" className="btn btn-secondary w-full">Create profile</Link>
            </div>
          ) : candidate && job.status === "ACTIVE" ? (
            <ApplyPanel jobId={job.id} native={!external} resumes={resumes} projects={portfolioProjects} items={portfolioItems} application={application ? { id: application.id, status: application.status, external: application.external } : null} origin={origin} jobRole={job.bimRole} />
          ) : (
            <p className="text-[13.5px] text-muted">{job.status !== "ACTIVE" ? "This job is not open for applications." : "Applying is available to candidate accounts."}</p>
          )}
          {candidate && (
            <div className="mt-3 flex gap-2">
              <form action={toggleSaveJob.bind(null, job.id)} className="flex-1"><button className="btn btn-secondary w-full btn-sm">{saved ? "Saved ✓" : "Save job"}</button></form>
              <form action={togglePinJob.bind(null, job.id)} className="flex-1"><button className="btn btn-secondary w-full btn-sm">{pinned ? "Unpin" : "Pin"}</button></form>
            </div>
          )}
        </Panel>

        {candidate && (
          <Panel title="Your fit for this job" actions={diag ? <MatchBadge score={diag.total} /> : undefined}>
            {!profile || (profile.softwareSkills.length === 0 && profile.skills.length === 0) ? (
              <p className="text-[13px] text-muted">Add software and skills to your <Link href="/profile" className="underline">profile</Link> to see a breakdown.</p>
            ) : (
              <div className="space-y-4">
                {resumeList.length > 0 && (
                  <form className="flex items-center gap-2">
                    <label className="sr-only" htmlFor="rs">Resume to check</label>
                    <select id="rs" name="resume" defaultValue={chosen?.id ?? ""} className="field py-1 text-[13px]">
                      <option value="">Profile only</option>
                      {profile.resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                    </select>
                    <button className="btn btn-secondary btn-sm">Check</button>
                  </form>
                )}
                <ul className="space-y-2.5">
                  {diag!.components.filter((c) => c.applicable).map((c) => (
                    <li key={c.key} className="text-[13px]">
                      <div className="flex justify-between gap-2"><span className="font-medium">{c.label}</span><span className="font-mono text-[12px] text-muted">{Math.round(c.score)}/{c.max}</span></div>
                      <Meter value={c.score} max={c.max} label={c.label} />
                      <p className="mt-0.5 text-[12.5px] text-muted">{c.evidence}</p>
                    </li>
                  ))}
                </ul>
                {diag!.matched.length > 0 && (
                  <div><p className="eyebrow mb-1">Matched</p><ul className="space-y-0.5 text-[13px]">{diag!.matched.map((m) => <li key={m}><span className="text-ok" aria-hidden>✓</span> {m}</li>)}</ul></div>
                )}
                {diag!.missing.length > 0 && (
                  <div><p className="eyebrow mb-1">Missing</p><ul className="space-y-0.5 text-[13px]">{diag!.missing.map((m) => <li key={m}><span className="text-warn" aria-hidden>⚠</span> {m}</li>)}</ul></div>
                )}
                <p className="text-[12px] text-muted">{diag!.disclaimer}</p>
                <Link href="/resume/assistant" className="text-[12.5px] underline">Get optional AI recommendations</Link>
              </div>
            )}
          </Panel>
        )}
        {user && job.status === "ACTIVE" && <ReportJob jobId={job.id} />}
      </aside>
    </div>
  );
}
