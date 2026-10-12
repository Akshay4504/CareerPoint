import Link from "next/link";
import { Badge, Chip, MatchBadge } from "./ui";
import { toggleSaveJob, togglePinJob } from "@/app/actions/jobs";
import { formatSalary, timeAgo } from "@/lib/utils";
import { isNativeJob } from "@/lib/applications/lifecycle";

export { isNativeJob };

export type JobCardData = {
  id: string;
  slug: string;
  title: string;
  companyName: string;
  company?: { slug: string; verified: boolean } | null;
  companyId?: string | null;
  applyUrl?: string | null;
  location: string | null;
  city?: string | null;
  country?: string | null;
  remote: boolean;
  remoteType?: string;
  seniority: string | null;
  discipline: string | null;
  bimRole?: string | null;
  employmentType: string | null;
  software: string[];
  experienceMin?: number | null;
  experienceMax?: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  postedAt: Date;
};

const REMOTE_LABEL: Record<string, string> = { REMOTE: "Remote", HYBRID: "Hybrid", ONSITE: "On-site" };

/** Native CareerPoint postings (employer account, no external link) are applied to in-app; everything else is external. */


const exp = (j: JobCardData) => (j.experienceMin != null ? (j.experienceMax != null ? `${j.experienceMin}–${j.experienceMax} yrs` : `${j.experienceMin}+ yrs`) : null);

export function JobCard({ job, score, saved, pinned, interactive, reasons, gaps }: { job: JobCardData; score?: number | null; saved?: boolean; pinned?: boolean; interactive?: boolean; reasons?: string[]; gaps?: string[] }) {
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);
  const place = [job.city ?? job.location, job.country && job.country !== job.city ? job.country : null].filter(Boolean).join(", ");
  const remote = job.remoteType && REMOTE_LABEL[job.remoteType] ? REMOTE_LABEL[job.remoteType] : job.remote ? "Remote" : null;
  const native = isNativeJob(job);
  return (
    <article className="panel flex flex-col gap-3 p-4 transition-all hover:border-line-strong hover:shadow-[0_4px_16px_-8px_rgba(47,60,120,0.25)] sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3.5">
      <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-accent-soft text-[16px] font-semibold text-accent">{job.companyName.trim().charAt(0).toUpperCase() || "?"}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] leading-snug">
            <Link href={`/jobs/${job.slug}`} className="hover:underline">
              {job.title}
            </Link>
          </h3>
          {score != null && <MatchBadge score={score} />}
          {pinned && <Badge tone="warn">Pinned</Badge>}
        </div>
        <p className="mt-0.5 text-[13.5px] text-ink-2">
          {job.company ? (
            <Link href={`/companies/${job.company.slug}`} className="hover:underline">
              {job.companyName}
            </Link>
          ) : (
            job.companyName
          )}
          {job.company?.verified && (
            <span className="ml-1.5 align-middle">
              <Badge tone="ok">Verified employer</Badge>
            </span>
          )}
        </p>
        <p className="mt-1 text-[12.5px] text-muted">
          {[place, remote, job.employmentType, job.bimRole ?? job.seniority, exp(job), salary].filter(Boolean).join(" · ")} · {timeAgo(job.postedAt)} · {native ? "Apply on CareerPoint" : "External application"}
        </p>
        {job.software.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {job.software.slice(0, 6).map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
            {job.software.length > 6 && <Chip>+{job.software.length - 6}</Chip>}
          </div>
        )}
        {score != null && ((reasons?.length ?? 0) > 0 || (gaps?.length ?? 0) > 0) && (
          <ul className="mt-2 space-y-0.5 text-[12.5px]" aria-label="Why this matches">
            {reasons?.slice(0, 3).map((r) => (
              <li key={r} className="text-ink-2">
                <span className="text-ok" aria-hidden>✓</span> {r}
              </li>
            ))}
            {gaps?.slice(0, 2).map((g) => (
              <li key={g} className="text-muted">
                <span className="text-warn" aria-hidden>⚠</span> {g}
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
      {interactive && (
        <div className="flex shrink-0 gap-2">
          <form action={toggleSaveJob.bind(null, job.id)}>
            <button className="btn btn-secondary btn-sm" aria-pressed={!!saved}>
              {saved ? "Saved" : "Save"}
            </button>
          </form>
          <form action={togglePinJob.bind(null, job.id)}>
            <button className="btn btn-ghost btn-sm" aria-pressed={!!pinned}>
              {pinned ? "Unpin" : "Pin"}
            </button>
          </form>
        </div>
      )}
    </article>
  );
}
