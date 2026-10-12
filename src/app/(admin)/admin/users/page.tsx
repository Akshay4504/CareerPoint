import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { Badge, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { setUserRole, setUserStatus } from "@/app/actions/admin";
import { ALL_ROLES } from "@/lib/auth/rbac";
import { humanize, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Users" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; page?: string }> }) {
  const sp = await searchParams;
  const me = await requireArea("admin-users"); // ADMIN only; moderators are redirected
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.UserWhereInput = {};
  if (sp.q?.trim()) where.OR = [{ email: { contains: sp.q.trim(), mode: "insensitive" } }, { name: { contains: sp.q.trim(), mode: "insensitive" } }];
  if (sp.role && (ALL_ROLES as string[]).includes(sp.role)) where.role = sp.role as never;
  const [users, total] = await Promise.all([db.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }), db.user.count({ where })]);
  return (
    <>
      <PageHeader title="Users" description={`${total} matching. Changing a role signs the user out of every device.`} />
      <form className="panel mb-5 grid gap-3 p-3 sm:grid-cols-[2fr_1fr_auto]">
        <input name="q" defaultValue={sp.q} placeholder="Name or email" className="field" aria-label="Search" />
        <select name="role" defaultValue={sp.role ?? ""} className="field" aria-label="Role"><option value="">All roles</option>{ALL_ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</select>
        <button className="btn btn-primary btn-sm">Filter</button>
      </form>
      {users.length === 0 ? <EmptyState title="No users" /> : (
        <Table>
          <thead><tr><Th>User</Th><Th>Role</Th><Th>Status</Th><Th>Joined</Th><Th /></tr></thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === me.id;
              return (
                <tr key={u.id}>
                  <Td><span className="font-medium">{u.name}</span><br /><span className="text-[12.5px] text-muted">{u.email}</span></Td>
                  <Td>
                    {self ? <Badge>{humanize(u.role)} (you)</Badge> : (
                      <form action={setUserRole.bind(null, u.id)} className="flex gap-1.5">
                        <select name="role" defaultValue={u.role} className="field w-auto py-1 text-[13px]" aria-label={`Role for ${u.name}`}>{ALL_ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</select>
                        <button className="btn btn-secondary btn-sm">Set</button>
                      </form>
                    )}
                  </Td>
                  <Td>{u.status === "ACTIVE" ? <Badge tone="ok">Active</Badge> : <Badge tone="bad">Suspended</Badge>}{!u.emailVerifiedAt && <span className="ml-1"><Badge tone="warn">Unverified</Badge></span>}</Td>
                  <Td className="text-muted">{timeAgo(u.createdAt)}</Td>
                  <Td className="text-right">{!self && u.role !== "ADMIN" && <form action={setUserStatus.bind(null, u.id, u.status === "ACTIVE")}><button className={u.status === "ACTIVE" ? "btn btn-danger btn-sm" : "btn btn-secondary btn-sm"}>{u.status === "ACTIVE" ? "Suspend" : "Reinstate"}</button></form>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pages={Math.ceil(total / PAGE_SIZE)} basePath="/admin/users" params={{ q: sp.q, role: sp.role }} />
    </>
  );
}
