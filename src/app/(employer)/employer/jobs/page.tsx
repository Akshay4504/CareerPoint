import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireEmployerCtx } from "@/lib/auth/guards";
import { Badge, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { setJobOpen } from "@/app/actions/employer";
import { ConfirmButton } from "@/components/forms";
import { humanize, timeAgo } from "@/lib/utils";
import type { JobStatus } from "@prisma/client";

export const metadata: Metadata = { title: "Employer jobs" };
export const dynamic = "force-dynamic";

const TONE: Record<JobStatus, "neutral" | "ok" | "warn" | "bad"> = { ACTIVE: "ok", PENDING: "warn", DRAFT: "neutral", INACTIVE: "neutral", CLOSED: "neutral", REJECTED: "bad" };

export default async function EmployerJobs({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await requireEmployerCtx();
  const jobs = await db.job.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 300, include: { _count: { select: { applications: true } } } });
  return (
    <>
      <PageHeader title="Jobs" actions={<Link href="/employer/jobs/new" className="btn btn-primary btn-sm">Post a job</Link>} />
      {sp.saved && <p role="status" className="mb-5 rounded-md border border-[#b9dcc6] bg-ok-soft px-3 py-2 text-[13px] text-ok">{sp.saved === "PENDING" ? "Job submitted. It will go live after moderation." : sp.saved === "ACTIVE" ? "Job is live." : "Job saved."}</p>}
      {jobs.length === 0 ? (
        <EmptyState title="No jobs yet" description="Post your first BIM role. Jobs from verified companies go live immediately; others are reviewed first." action={<Link href="/employer/jobs/new" className="btn btn-primary btn-sm">Post a job</Link>} />
      ) : (
        <Table>
          <thead><tr><Th>Title</Th><Th>Status</Th><Th>Applicants</Th><Th>Posted</Th><Th /></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <Td><Link href={`/employer/jobs/${j.id}`} className="font-medium hover:underline">{j.title}</Link><br /><span className="text-[12.5px] text-muted">{j.location ?? "—"}</span></Td>
                <Td><Badge tone={TONE[j.status]}>{humanize(j.status)}</Badge></Td>
                <Td className="tabular-nums">{j._count.applications}</Td>
                <Td className="text-muted">{timeAgo(j.createdAt)}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    {j.status === "ACTIVE" && j.slug && <Link href={`/jobs/${j.slug}`} className="btn btn-ghost btn-sm">View</Link>}
                    {j.status === "CLOSED" || j.status === "DRAFT" ? <form action={setJobOpen.bind(null, j.id, true)}><button className="btn btn-secondary btn-sm">{j.status === "DRAFT" ? "Publish" : "Reopen"}</button></form> : j.status !== "REJECTED" ? <form action={setJobOpen.bind(null, j.id, false)}><ConfirmButton message="Close this job? Candidates will no longer be able to apply." className="btn btn-secondary btn-sm">Close</ConfirmButton></form> : null}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
