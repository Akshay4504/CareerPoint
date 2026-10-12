import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { Badge, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { humanize, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Applications" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

// Oversight view: metadata only. Staff do not see resumes or candidate contact details here.
export default async function AdminApplications({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  await requireArea("admin");
  const page = Math.max(1, Number(sp.page) || 1);
  const [apps, total] = await Promise.all([
    db.application.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { job: { select: { title: true, companyName: true } }, user: { select: { name: true } } } }),
    db.application.count(),
  ]);
  return (
    <>
      <PageHeader title="Applications" description={`${total} total · metadata only`} />
      {apps.length === 0 ? <EmptyState title="No applications yet" /> : (
        <Table>
          <thead><tr><Th>Candidate</Th><Th>Job</Th><Th>Type</Th><Th>Status</Th><Th>Applied</Th></tr></thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <Td>{a.user.name}</Td>
                <Td>{a.job.title}<br /><span className="text-[12.5px] text-muted">{a.job.companyName}</span></Td>
                <Td className="text-[12.5px] text-muted">{a.external ? "Tracked externally" : "On platform"}</Td>
                <Td><Badge>{humanize(a.status)}</Badge></Td>
                <Td className="text-muted">{timeAgo(a.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pages={Math.ceil(total / PAGE_SIZE)} basePath="/admin/applications" />
    </>
  );
}
