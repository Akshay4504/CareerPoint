import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/auth/password";
import { getCurrentUser } from "@/lib/auth/session";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Logo } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/employer/permissions";
import { acceptInviteAction } from "@/app/actions/employer";
import { registerInviteAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Team invitation", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await db.employerInvite.findUnique({ where: { tokenHash: hashToken(token) }, include: { company: { select: { name: true } } } });
  const valid = inv && !inv.acceptedAt && inv.expiresAt > new Date();
  const user = valid ? await getCurrentUser() : null;
  const exists = valid ? !!(await db.user.findUnique({ where: { email: inv.email }, select: { id: true } })) : false;

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="px-4 py-4 sm:px-8"><Link href="/" aria-label="CareerPoint home"><Logo /></Link></header>
      <main id="main" className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-4 pb-16">
        {!valid ? (
          <>
            <h1 className="text-[22px]">Invitation unavailable</h1>
            <p className="mt-2 text-muted">This invitation is invalid, already used, or has expired. Ask your company admin to send a new one.</p>
          </>
        ) : (
          <>
            <h1 className="text-[22px]">Join {inv.company.name}</h1>
            <p className="mt-1 text-muted">You&apos;ve been invited as <strong>{ROLE_LABEL[inv.role]}</strong> ({inv.email}).</p>
            {user ? (
              <ActionForm action={acceptInviteAction.bind(null, token)} className="mt-6 space-y-3">
                <SubmitButton className="btn btn-accent w-full" pendingText="Joining…">Accept invitation as {user.email}</SubmitButton>
              </ActionForm>
            ) : exists ? (
              <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="btn btn-accent mt-6 w-full">Sign in to accept</Link>
            ) : (
              <ActionForm action={registerInviteAction} className="mt-6 space-y-4">
                <input type="hidden" name="token" value={token} />
                <Field label="Full name" htmlFor="name"><input id="name" name="name" autoComplete="name" required minLength={2} className="field" /></Field>
                <Field label="Email" htmlFor="email"><input id="email" value={inv.email} readOnly className="field bg-sunken" /></Field>
                <Field label="Password" htmlFor="password" hint="At least 10 characters, with letters and a number."><input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} className="field" /></Field>
                <SubmitButton className="btn btn-accent w-full" pendingText="Creating account…">Create account & join</SubmitButton>
              </ActionForm>
            )}
          </>
        )}
      </main>
    </div>
  );
}
