import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { JobCard } from "@/components/job-card";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Saved jobs" };
export const dynamic = "force-dynamic";

export default async function SavedJobsPage() {
  const user = await requireArea("app");
  const [saved, pinned, profile] = await Promise.all([
    db.savedJob.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { job: { include: { company: { select: { slug: true, verified: true } } } } } }),
    db.pinnedJob.findMany({ where: { userId: user.id }, select: { jobId: true } }),
    db.bIMProfessionalProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
  ]);
  const pinnedSet = new Set(pinned.map((p) => p.jobId));
  const matches = profile ? new Map((await db.jobMatch.findMany({ where: { profileId: profile.id, jobId: { in: saved.map((s) => s.jobId) } } })).map((m) => [m.jobId, m.score])) : new Map<string, number>();
  const rows = [...saved].sort((a, b) => Number(pinnedSet.has(b.jobId)) - Number(pinnedSet.has(a.jobId)));

  return (
    <>
      <PageHeader title="Saved jobs" description="Pinned jobs stay at the top." actions={<Link href="/jobs" className="btn btn-secondary btn-sm">Browse jobs</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing saved yet" description="Save jobs from the job board to compare them and come back later." action={<Link href="/jobs" className="btn btn-primary btn-sm">Find BIM jobs</Link>} />
      ) : (
        <div className="space-y-2.5">
          {rows.map(({ job }) => (
            <div key={job.id} className={job.status !== "ACTIVE" ? "opacity-60" : undefined}>
              <JobCard job={job} score={matches.get(job.id)} saved pinned={pinnedSet.has(job.id)} interactive />
              {job.status !== "ACTIVE" && <p className="mt-1 px-1 text-[12px] text-warn">This job is no longer open.</p>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
