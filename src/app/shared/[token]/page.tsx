import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { claimCookieName, verifyClaim } from "@/lib/auth/claim";
import { emailAllowed, shareByToken } from "@/lib/profile-share";
import { getPublicProfile } from "@/lib/services/public-profile";
import { sendShareCodeAction, verifyShareCodeAction } from "@/app/actions/access";
import { EmailVerify } from "@/components/email-verify";
import { Logo, Panel } from "@/components/ui";
import { ProfileBody } from "@/app/professionals/[slug]/profile-body";

// Private profile, shared by its owner. Never indexed. The receiver proves control of an email address before seeing anything.
export const metadata: Metadata = { title: "Shared BIM profile", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SharedProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await shareByToken(token);
  const claim = share ? verifyClaim((await cookies()).get(claimCookieName("share", share.id))?.value, "share", share.id) : null;
  const allowed = !!share && !!claim && emailAllowed(share, claim.email);
  const view = allowed ? await getPublicProfile(share!.profile.slug, null, { viaShare: true }) : null;

  if (view) {
    return (
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-8 sm:px-8">
        <p role="note" className="mb-6 rounded-lg border border-line bg-bg px-4 py-2.5 text-[13px] text-ink-2">
          This profile is private and was shared with you. Viewing as <strong>{claim!.email}</strong>. Please do not forward the link.
        </p>
        <ProfileBody view={view} />
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="px-4 py-4 sm:px-8"><Link href="/" aria-label="CareerPoint home"><Logo /></Link></header>
      <main id="main" className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-4 pb-16">
        {!share ? (
          <Panel title="Link unavailable">
            <p className="text-[13.5px] text-muted">This link is invalid, has expired or was revoked by its owner.</p>
          </Panel>
        ) : (
          <Panel title={`${share.profile.user.name} shared a private BIM profile with you`}>
            <EmailVerify
              send={sendShareCodeAction.bind(null, token)}
              verify={verifyShareCodeAction.bind(null, token)}
              intro={share.recipientEmail ? "This profile was shared with a specific person. Confirm your email address with a one-time code to view it." : "To protect their privacy, confirm your email address with a one-time code before viewing."}
            />
          </Panel>
        )}
      </main>
    </div>
  );
}
