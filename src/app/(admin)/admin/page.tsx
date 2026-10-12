import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { PageHeader, Panel, Stat } from "@/components/ui";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const user = await requireArea("admin");
  const [users, candidates, companies, pendingCompanies, jobsByStatus, apps, logs] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { role: "CANDIDATE" } }),
    db.company.count(),
    db.company.count({ where: { verified: false } }),
    db.job.groupBy({ by: ["status"], _count: true }),
    db.application.count(),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { actor: { select: { name: true } } } }),
  ]);
  const j = (s: string) => jobsByStatus.find((x) => x.status === s)?._count ?? 0;
  return (
    <>
      <PageHeader title="Administration" description={`Signed in as ${user.role.toLowerCase()}.`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Jobs awaiting review" value={j("PENDING")} href="/admin/jobs?status=PENDING" hint={`${j("ACTIVE")} live`} />
        <Stat label="Employers to verify" value={pendingCompanies} href="/admin/employers" hint={`${companies} total`} />
        <Stat label="Users" value={users} href={user.role === "ADMIN" ? "/admin/users" : undefined} hint={`${candidates} candidates`} />
        <Stat label="Applications" value={apps} href="/admin/applications" />
      </div>
      <div className="mt-6">
        <Panel title="Recent audit events" pad={false} actions={user.role === "ADMIN" ? <Link href="/admin/system" className="text-[13px] text-muted hover:text-ink">System →</Link> : undefined}>
          {logs.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No events yet.</p> : (
            <ul className="divide-y divide-line text-[13px]">
              {logs.map((l) => <li key={l.id} className="flex justify-between gap-3 px-4 py-2"><span><span className="font-mono text-[12px]">{l.action}</span> <span className="text-muted">{l.actor?.name ? `by ${l.actor.name}` : ""}</span></span><span className="shrink-0 text-muted">{timeAgo(l.createdAt)}</span></li>)}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
