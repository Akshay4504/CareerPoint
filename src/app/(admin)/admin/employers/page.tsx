import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { Badge, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { setCompanyVerified } from "@/app/actions/admin";
import { safeUrl, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Employers" };
export const dynamic = "force-dynamic";

export default async function AdminEmployers() {
  await requireArea("admin");
  const companies = await db.company.findMany({ orderBy: [{ verified: "asc" }, { createdAt: "desc" }], take: 200, include: { _count: { select: { jobs: true, members: true } }, members: { take: 1, include: { user: { select: { name: true, email: true, emailVerifiedAt: true } } } } } });
  return (
    <>
      <PageHeader title="Employers" description="Verify a company only after checking its website and a work email. Verification publishes its pending jobs and unlocks the candidate directory." />
      {companies.length === 0 ? <EmptyState title="No employers yet" /> : (
        <Table>
          <thead><tr><Th>Company</Th><Th>Contact</Th><Th>Jobs</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {companies.map((c) => {
              const owner = c.members[0]?.user;
              const site = safeUrl(c.website);
              return (
                <tr key={c.id}>
                  <Td><span className="font-medium">{c.name}</span><br />{site ? <a href={site} target="_blank" rel="noopener noreferrer nofollow" className="text-[12.5px] text-muted underline">{c.website}</a> : <span className="text-[12.5px] text-muted">No website</span>}<br /><span className="text-[12px] text-muted">Registered {timeAgo(c.createdAt)}</span></Td>
                  <Td className="text-[13px]">{owner?.name}<br /><span className="text-muted">{owner?.email}</span><br />{owner?.emailVerifiedAt ? <Badge tone="ok">Email verified</Badge> : <Badge tone="warn">Email unverified</Badge>}</Td>
                  <Td className="tabular-nums">{c._count.jobs}</Td>
                  <Td>{c.verified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Pending</Badge>}</Td>
                  <Td className="text-right"><form action={setCompanyVerified.bind(null, c.id, !c.verified)}><button className={c.verified ? "btn btn-secondary btn-sm" : "btn btn-accent btn-sm"}>{c.verified ? "Revoke" : "Verify"}</button></form></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
