import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployerCtx } from "@/lib/auth/guards";
import { can, ROLE_LABEL } from "@/lib/employer/permissions";
import { listTeam } from "@/lib/employer/team";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { NotificationPrefs } from "@/components/notification-prefs";
import { Badge, Field, PageHeader, Panel } from "@/components/ui";
import { changeRoleAction, inviteMemberAction, removeMemberAction } from "@/app/actions/employer";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Employer settings" };
export const dynamic = "force-dynamic";

const ROLES = ["EMPLOYER", "RECRUITER", "EMPLOYER_ADMIN"] as const;

export default async function EmployerSettings() {
  const { user, ctx } = await requireEmployerCtx();
  const isAdmin = can(ctx.role, "team.manage");
  const { members, invites } = await listTeam(ctx);
  return (
    <>
      <PageHeader title="Settings" description="Your team, permissions and notifications." actions={<Link href="/settings" className="btn btn-ghost btn-sm">Account & security</Link>} />
      <div className="max-w-3xl space-y-6">
        <Panel title="Team" description="Hiring managers can review, comment and shortlist. Recruiters also manage jobs, stages, interviews and messages. Admins also manage the company and team.">
          <ul className="divide-y divide-line">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13.5px]">
                <span className="min-w-0"><span className="font-medium">{m.user.name}</span>{m.userId === ctx.userId && <span className="text-muted"> (you)</span>}<span className="block truncate text-[12.5px] text-muted">{m.user.email}</span></span>
                {isAdmin && m.userId !== ctx.userId ? (
                  <span className="flex items-center gap-2">
                    <ActionForm action={changeRoleAction.bind(null, m.id)} className="flex items-center gap-1.5">
                      <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {m.user.name}</label>
                      <select id={`role-${m.id}`} name="role" defaultValue={m.role} className="field w-auto">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                      <SubmitButton className="btn btn-secondary btn-sm" pendingText="…">Set</SubmitButton>
                    </ActionForm>
                    <form action={removeMemberAction.bind(null, m.id)}><ConfirmButton message={`Remove ${m.user.name} from the company?`} className="btn btn-ghost btn-sm text-bad">Remove</ConfirmButton></form>
                  </span>
                ) : <Badge>{ROLE_LABEL[m.role]}</Badge>}
              </li>
            ))}
          </ul>
          {isAdmin && invites.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="eyebrow mb-1.5">Pending invitations</p>
              <ul className="space-y-1 text-[13px] text-ink-2">{invites.map((i) => <li key={i.id}>{i.email} · {ROLE_LABEL[i.role]} · sent {timeAgo(i.createdAt)}</li>)}</ul>
            </div>
          )}
          {isAdmin ? (
            <ActionForm action={inviteMemberAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4" resetOnSuccess>
              <Field label="Invite by email" htmlFor="invite-email" className="min-w-[220px] flex-1"><input id="invite-email" name="email" type="email" required className="field" placeholder="colleague@company.com" /></Field>
              <Field label="Role" htmlFor="invite-role"><select id="invite-role" name="role" defaultValue="RECRUITER" className="field">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
              <SubmitButton className="btn btn-secondary" pendingText="Sending…">Send invite</SubmitButton>
            </ActionForm>
          ) : <p className="mt-3 text-[12.5px] text-muted">Only company admins can manage the team.</p>}
        </Panel>

        <Panel title="Notifications" description="Choose what reaches you in CareerPoint and by email.">
          <NotificationPrefs userId={user.id} audience="employer" emailVerified={!!user.emailVerifiedAt} />
        </Panel>
      </div>
    </>
  );
}
