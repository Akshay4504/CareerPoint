import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { EmptyState, PageHeader } from "@/components/ui";
import { respondContactAction } from "@/app/actions/applications";
import { markAllNotificationsRead, markNotificationRead } from "@/app/actions/account";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser("/notifications");
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const contacts = user.role === "CANDIDATE" ? await db.contactRequest.findMany({ where: { status: "PENDING", profile: { userId: user.id } }, orderBy: { createdAt: "desc" }, take: 50, include: { company: { select: { name: true, verified: true } } } }) : [];
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <>
      <PageHeader title="Notifications" description={unread ? `${unread} unread` : "You're all caught up."} actions={<><Link href="/settings" className="btn btn-ghost btn-sm">Preferences</Link>{unread > 0 && <form action={markAllNotificationsRead}><button className="btn btn-secondary btn-sm">Mark all read</button></form>}</>} />
      {contacts.length > 0 && (
        <section aria-label="Contact requests" className="panel mb-6">
          <h2 className="border-b border-line px-4 py-3 text-[14px] font-semibold">Contact requests</h2>
          <ul className="divide-y divide-line">
            {contacts.map((c) => (
              <li key={c.id} className="px-4 py-3 text-[13.5px]">
                <p className="font-medium">{c.company.name}{c.company.verified && <span className="ml-2 text-[12px] font-normal text-ok">Verified employer</span>}</p>
                <p className="prose-plain mt-1 text-ink-2">{c.message}</p>
                <p className="mt-1 text-[12px] text-muted">Accepting shares your email with this company. Declining shares nothing.</p>
                <div className="mt-2 flex gap-2">
                  <form action={respondContactAction.bind(null, c.id, true)}><button className="btn btn-accent btn-sm">Accept & share email</button></form>
                  <form action={respondContactAction.bind(null, c.id, false)}><button className="btn btn-secondary btn-sm">Decline</button></form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {items.length === 0 ? (
        <EmptyState title="No notifications" description="Application updates and employer activity will appear here." />
      ) : (
        <ul className="panel divide-y divide-line">
          {items.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="flex gap-3">
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`} />
                <div>
                  <p className={n.readAt ? "text-ink-2" : "font-medium"}>{n.href ? <Link href={n.href} className="hover:underline">{n.title}</Link> : n.title}</p>
                  {n.body && <p className="text-[13px] text-muted">{n.body}</p>}
                  <p className="mt-0.5 text-[12px] text-muted">{timeAgo(n.createdAt)}{!n.readAt && <span className="sr-only"> (unread)</span>}</p>
                </div>
              </div>
              {!n.readAt && <form action={markNotificationRead.bind(null, n.id)}><button className="btn btn-ghost btn-sm">Mark read</button></form>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
