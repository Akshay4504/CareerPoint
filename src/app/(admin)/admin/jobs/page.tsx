import type { Metadata } from "next";
import Link from "next/link";
import type { JobStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { Badge, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { moderateJob } from "@/app/actions/admin";
import { humanize, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Jobs" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;
const STATUSES: JobStatus[] = ["PENDING", "ACTIVE", "DRAFT", "CLOSED", "REJECTED"];

export default async function AdminJobs({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  await requireArea("admin");
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.JobWhereInput = {};
  if (sp.status && STATUSES.includes(sp.status as JobStatus)) where.status = sp.status as JobStatus;
  if (sp.q?.trim()) where.OR = [{ title: { contains: sp.q.trim(), mode: "insensitive" } }, { companyName: { contains: sp.q.trim(), mode: "insensitive" } }];
  const [jobs, total] = await Promise.all([
    db.job.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { company: { select: { verified: true } }, source: { select: { name: true } } } }),
    db.job.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Jobs" description={`${total} matching`} />
      <form className="panel mb-5 grid gap-3 p-3 sm:grid-cols-[2fr_1fr_auto]">
        <input name="q" defaultValue={sp.q} placeholder="Title or company" className="field" aria-label="Search" />
        <select name="status" defaultValue={sp.status ?? ""} className="field" aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
        <button className="btn btn-primary btn-sm">Filter</button>
      </form>
      {jobs.length === 0 ? <EmptyState title="No jobs" /> : (
        <Table>
          <thead><tr><Th>Job</Th><Th>Origin</Th><Th>Status</Th><Th>Created</Th><Th /></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <Td><Link className="font-medium hover:underline" href={`/jobs/${j.slug}`}>{j.title}</Link><br /><span className="text-[12.5px] text-muted">{j.companyName}</span></Td>
                <Td className="text-[12.5px] text-muted">{j.source ? `Feed: ${j.source.name}` : j.company?.verified ? "Verified employer" : "Unverified employer"}</Td>
                <Td><Badge tone={j.status === "ACTIVE" ? "ok" : j.status === "PENDING" ? "warn" : j.status === "REJECTED" ? "bad" : "neutral"}>{humanize(j.status)}</Badge></Td>
                <Td className="text-muted">{timeAgo(j.createdAt)}</Td>
                <Td>
                  <div className="flex justify-end gap-1.5">
                    {j.status !== "ACTIVE" && j.status !== "DRAFT" && <form action={moderateJob.bind(null, j.id, "ACTIVE")}><button className="btn btn-secondary btn-sm">Approve</button></form>}
                    {j.status === "PENDING" && <form action={moderateJob.bind(null, j.id, "REJECTED")}><button className="btn btn-danger btn-sm">Reject</button></form>}
                    {j.status === "ACTIVE" && <form action={moderateJob.bind(null, j.id, "CLOSED")}><button className="btn btn-secondary btn-sm">Close</button></form>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pages={Math.ceil(total / PAGE_SIZE)} basePath="/admin/jobs" params={{ status: sp.status, q: sp.q }} />
    </>
  );
}
