import type { Metadata } from "next";
import { requireEmployerCtx } from "@/lib/auth/guards";
import { require_ } from "@/lib/employer/permissions";
import { ROLE_RULES } from "@/lib/jobs/classify";
import { PageHeader } from "@/components/ui";
import { JobForm } from "../job-form";

export const metadata: Metadata = { title: "Post a job" };

export default async function NewJobPage() {
  const { ctx } = await requireEmployerCtx();
  require_(ctx, "jobs.manage");
  return (
    <>
      <PageHeader title="Post a job" description="Check the live preview, then publish. Applications arrive in CareerPoint with the candidate's resume and portfolio." />
      <JobForm verified={ctx.verified} companyName={ctx.companyName} bimRoles={ROLE_RULES.map((r) => r.role)} />
    </>
  );
}
