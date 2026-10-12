import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireEmployerCtx } from "@/lib/auth/guards";
import { require_ } from "@/lib/employer/permissions";
import { ROLE_RULES } from "@/lib/jobs/classify";
import { Badge, PageHeader } from "@/components/ui";
import { JobForm } from "../job-form";

export const metadata: Metadata = { title: "Edit job" };
export const dynamic = "force-dynamic";

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireEmployerCtx();
  require_(ctx, "jobs.manage");
  // Tenant isolation: only this company's jobs are reachable.
  const job = await db.job.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!job) notFound();
  return (
    <>
      <PageHeader title="Edit job" actions={<Badge>{job.status.toLowerCase()}</Badge>} />
      <JobForm job={job} verified={ctx.verified} companyName={ctx.companyName} bimRoles={ROLE_RULES.map((r) => r.role)} />
    </>
  );
}
