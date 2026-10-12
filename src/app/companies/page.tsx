import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import { db } from "@/lib/db";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { activeJobWhere } from "@/lib/services/jobs";

export const metadata: Metadata = pageMeta({ title: "BIM employers", description: "Verified architecture, engineering and construction employers hiring BIM talent.", path: "/companies" });
export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const companies = await db.company.findMany({ where: { verified: true }, orderBy: { name: "asc" }, take: 200, include: { _count: { select: { jobs: { where: activeJobWhere() } } } } });
  return (
    <>
      <PageHeader title="Employers" description="Companies verified by CareerPoint. Unverified employers are not listed." />
      {companies.length === 0 ? (
        <EmptyState title="No verified employers yet" description="Employers appear here once our team has verified them." action={<Link href="/register?type=employer" className="btn btn-secondary btn-sm">Register your company</Link>} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map((c) => (
            <li key={c.id}>
              <Link href={`/companies/${c.slug}`} className="panel block h-full p-4 transition-colors hover:border-line-strong">
                <div className="flex items-center justify-between gap-2"><h2 className="truncate text-[15px]">{c.name}</h2><Badge tone="ok">Verified</Badge></div>
                <p className="mt-1 text-[12.5px] text-muted">{c.location ?? "Location not set"}</p>
                {c.description && <p className="mt-2 line-clamp-2 text-[13px] text-ink-2">{c.description}</p>}
                <p className="mt-3 text-[12.5px] text-muted">{c._count.jobs} open {c._count.jobs === 1 ? "job" : "jobs"}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
