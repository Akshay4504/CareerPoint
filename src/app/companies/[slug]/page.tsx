import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/rbac";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { JobCard } from "@/components/job-card";
import { activeJobWhere } from "@/lib/services/jobs";
import { safeUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = await db.company.findUnique({ where: { slug }, select: { name: true, verified: true, description: true } });
  if (!c?.verified) return { title: "Company", robots: { index: false, follow: false } };
  return pageMeta({ title: `${c.name} · BIM jobs and company profile`, description: c.description ?? `Open BIM roles and company information for ${c.name}.`, path: `/companies/${slug}` });
}

export default async function CompanyPage({ params }: Props) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const company = await db.company.findUnique({ where: { slug } });
  if (!company) notFound();
  const isMember = !!user && user.employerUsers.some((m) => m.companyId === company.id);
  if (!company.verified && !isMember && !(user && isStaff(user.role))) notFound();
  const jobs = await db.job.findMany({ where: { companyId: company.id, ...activeJobWhere() }, orderBy: { postedAt: "desc" }, take: 50, include: { company: { select: { slug: true, verified: true } } } });
  const site = safeUrl(company.website);

  return (
    <>
      <PageHeader title={company.name} eyebrow="Employer" description={[company.location, company.verified ? null : "Pending verification"].filter(Boolean).join(" · ")} actions={<>{company.verified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Unverified</Badge>}{site && <a href={site} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-secondary btn-sm">Website ↗</a>}</>} />
      {company.description && <p className="prose-plain mb-8 max-w-[68ch] text-[14.5px] leading-relaxed text-ink-2">{company.description}</p>}
      <h2 className="eyebrow mb-2">Open roles · {jobs.length}</h2>
      {jobs.length === 0 ? <EmptyState title="No open roles" description="This employer has no active job postings right now." /> : <div className="space-y-2.5">{jobs.map((j) => <JobCard key={j.id} job={j} />)}</div>}
    </>
  );
}
