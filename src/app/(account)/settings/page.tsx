import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Badge, Field, PageHeader, Panel } from "@/components/ui";
import { changePasswordAction, deleteAccountAction, resendVerificationAction, signOutOthersAction } from "@/app/actions/auth";
import { updateName } from "@/app/actions/account";
import { NotificationPrefs } from "@/components/notification-prefs";
import { isEmployerRole } from "@/lib/auth/rbac";
import { humanize, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  const sessions = await db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 10 });
  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-2xl space-y-6">
        <Panel title="Account">
          <dl className="mb-4 grid grid-cols-[110px_1fr] gap-y-2 text-[13.5px]">
            <dt className="text-muted">Email</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-2 break-all">{user.email}{user.emailVerifiedAt ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Unverified</Badge>}</dd>
            <dt className="text-muted">Role</dt><dd>{humanize(user.role)}</dd>
          </dl>
          {!user.emailVerifiedAt && <form action={resendVerificationAction} className="mb-4"><button className="btn btn-secondary btn-sm">Resend verification email</button></form>}
          <ActionForm action={updateName} className="flex flex-wrap items-end gap-3">
            <Field label="Full name" htmlFor="name" className="min-w-[220px] flex-1"><input id="name" name="name" defaultValue={user.name} required className="field" /></Field>
            <SubmitButton className="btn btn-secondary">Update name</SubmitButton>
          </ActionForm>
        </Panel>

        {(user.role === "CANDIDATE" || isEmployerRole(user.role)) && (
          <Panel title="Notifications" description="Choose what reaches you in CareerPoint and by email.">
            <NotificationPrefs userId={user.id} audience={user.role === "CANDIDATE" ? "candidate" : "employer"} emailVerified={!!user.emailVerifiedAt} />
          </Panel>
        )}

        <Panel title="Password">
          <ActionForm action={changePasswordAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Current password" htmlFor="currentPassword" className="sm:col-span-2"><input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className="field" /></Field>
            <Field label="New password" htmlFor="newPassword" hint="10+ characters with letters and a number."><input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={10} className="field" /></Field>
            <div className="sm:col-span-2"><SubmitButton className="btn btn-secondary">Change password</SubmitButton></div>
          </ActionForm>
        </Panel>

        <Panel title="Sessions" description="Devices currently signed in to your account.">
          <ul className="mb-3 space-y-1.5 text-[13px]">
            {sessions.map((s) => <li key={s.id} className="flex justify-between gap-3"><span className="truncate text-ink-2">{s.userAgent?.slice(0, 70) ?? "Unknown device"}</span><span className="shrink-0 text-muted">{timeAgo(s.createdAt)}</span></li>)}
          </ul>
          <form action={signOutOthersAction}><button className="btn btn-secondary btn-sm">Sign out other devices</button></form>
        </Panel>

        {user.role !== "ADMIN" && (
          <Panel title="Delete account" description="Permanently removes your profile, resumes, files and applications. This cannot be undone.">
            <ActionForm action={deleteAccountAction} className="flex flex-wrap items-end gap-3">
              <Field label="Confirm with your password" htmlFor="del-pw" className="min-w-[220px] flex-1"><input id="del-pw" name="password" type="password" autoComplete="current-password" required className="field" /></Field>
              <ConfirmButton message="Permanently delete your account and all data?" className="btn btn-danger">Delete account</ConfirmButton>
            </ActionForm>
          </Panel>
        )}
      </div>
    </>
  );
}
