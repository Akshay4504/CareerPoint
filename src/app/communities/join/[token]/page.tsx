import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { claimCookieName, verifyClaim } from "@/lib/auth/claim";
import { MAX_COMMUNITIES, inviteByToken, isMember, membershipCount } from "@/lib/communities/service";
import { acceptCommunityInviteAction, sendInviteCodeAction, verifyInviteCodeAction } from "@/app/actions/access";
import { ActionForm, SubmitButton } from "@/components/forms";
import { EmailVerify } from "@/components/email-verify";
import { Panel } from "@/components/ui";
import { isStaff } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "Community invitation", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function JoinByInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await inviteByToken(token);
  const user = inv ? await getCurrentUser() : null;
  const claim = inv ? verifyClaim((await cookies()).get(claimCookieName("invite", inv.id))?.value, "invite", inv.id) : null;

  return (
    <div className="mx-auto max-w-md py-8">
      {!inv ? (
        <Panel title="Invitation unavailable">
          <p className="text-[13.5px] text-muted">This invitation link is invalid, has expired or has been used up. Ask the member who invited you for a new one.</p>
          <Link href="/communities" className="btn btn-secondary btn-sm mt-4">Browse communities</Link>
        </Panel>
      ) : (
        <Panel title={`You're invited to ${inv.community.name}`} description={inv.community.description}>
          {!claim ? (
            <EmailVerify
              send={sendInviteCodeAction.bind(null, token)}
              verify={verifyInviteCodeAction.bind(null, token)}
              intro="To join, first confirm your email address. We'll send you a one-time code."
            />
          ) : !user ? (
            <div className="space-y-3 text-[13.5px]">
              <p role="status" className="rounded-md bg-ok-soft px-3 py-2 text-ok">Email verified: {claim.email}</p>
              <p className="text-ink-2">Now sign in, or create an account with this email address, and return to this page to finish joining.</p>
              <Link href={`/login?next=${encodeURIComponent(`/communities/join/${token}`)}`} className="btn btn-primary w-full">Sign in</Link>
              <Link href={`/register?email=${encodeURIComponent(claim.email)}&next=${encodeURIComponent(`/communities/join/${token}`)}`} className="btn btn-secondary w-full">Create account</Link>
            </div>
          ) : isStaff(user.role) ? (
            <p className="text-[13.5px] text-muted">Staff accounts moderate communities and do not join them.</p>
          ) : (await isMember(user.id, inv.communityId)) ? (
            <div className="space-y-3 text-[13.5px]"><p className="text-ok">You are already a member.</p><Link href={`/communities/${inv.community.slug}`} className="btn btn-primary w-full">Open community</Link></div>
          ) : (await membershipCount(user.id)) >= MAX_COMMUNITIES ? (
            <p className="text-[13.5px] text-muted">You are already in {MAX_COMMUNITIES} communities, the maximum. Leave one from its page, then open this link again.</p>
          ) : (
            <ActionForm action={acceptCommunityInviteAction.bind(null, token)} className="space-y-3">
              <p role="status" className="rounded-md bg-ok-soft px-3 py-2 text-[13.5px] text-ok">Email verified: {claim.email}</p>
              <SubmitButton className="btn btn-accent w-full" pendingText="Joining…">Join {inv.community.name}</SubmitButton>
            </ActionForm>
          )}
        </Panel>
      )}
    </div>
  );
}
