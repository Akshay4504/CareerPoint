import type { Metadata } from "next";
import { absoluteUrl, jsonLd, pageMeta } from "@/lib/seo";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getPublicProfile } from "@/lib/services/public-profile";
import { Panel } from "@/components/ui";
import { ProfileBody } from "./profile-body";
import { isEmployerRole } from "@/lib/auth/rbac";
import { audit } from "@/lib/audit";
import { employerCtx } from "@/lib/applications/employer";
import { can } from "@/lib/employer/permissions";
import { recordEmployerProfileView, recordView } from "@/lib/services/profile-views";
import { ActionForm, SubmitButton } from "@/components/forms";
import { contactCandidateAction } from "@/app/actions/employer";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await db.bIMProfessionalProfile.findUnique({ where: { slug }, select: { visibility: true, headline: true, summary: true, user: { select: { name: true } } } });
  if (p?.visibility !== "PUBLIC") return { title: "Profile", robots: { index: false, follow: false } };
  return pageMeta({ title: `${p.user.name}${p.headline ? ` — ${p.headline}` : ""}`, description: p.summary ?? `${p.user.name}'s public BIM profile on CareerPoint.`, path: `/professionals/${slug}`, type: "profile" });
}


export default async function ProfessionalPage({ params }: Props) {
  const { slug } = await params;
  const viewer = await getCurrentUser();
  const view = await getPublicProfile(slug, viewer);
  if (!view) notFound();
  const { profile: p, isOwner } = view;

  // Signed-in views only, collapsed per viewer (or per verified company per day) so the metric stays honest.
  // Verified-employer views are shown to the candidate and audited; anonymous visits are never recorded.
  let contactCtx: Awaited<ReturnType<typeof employerCtx>> = null;
  if (viewer && !isOwner && p.visibility === "PUBLIC") {
    const ctx = isEmployerRole(viewer.role) ? await employerCtx(viewer.id) : null;
    if (ctx?.verified) {
      contactCtx = ctx;
      const wrote = await recordEmployerProfileView({ profileId: p.id, candidateUserId: p.userId, companyId: ctx.companyId, companyName: ctx.companyName, viewerUserId: viewer.id });
      if (wrote) await audit(viewer.id, "profile.viewed", "BIMProfessionalProfile", p.id, { companyId: ctx.companyId });
    } else {
      await recordView({ profileId: p.id, kind: "PROFILE", viewerUserId: viewer.id });
    }
  }
  const pending = contactCtx ? await db.contactRequest.findFirst({ where: { companyId: contactCtx.companyId, profileId: p.id, status: "PENDING" }, select: { id: true } }) : null;
  const jobs = contactCtx && can(contactCtx.role, "candidates.search") ? await db.job.findMany({ where: { companyId: contactCtx.companyId, status: "ACTIVE" }, select: { id: true, title: true } }) : [];


  return (
    <ProfileBody
      view={view}
      head={
        p.visibility === "PUBLIC" ? (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({ "@context": "https://schema.org", "@type": "ProfilePage", mainEntity: { "@type": "Person", name: p.user.name, ...(p.headline ? { jobTitle: p.headline } : {}), url: absoluteUrl(`/professionals/${slug}`), ...(p.softwareSkills.length ? { knowsAbout: p.softwareSkills.map((x) => x.software) } : {}) } }) }} />
        ) : null
      }
      extras={
        <>
        {contactCtx && can(contactCtx.role, "candidates.search") && (
          <Panel title="Contact" description="The candidate decides whether to reply. Their email stays private unless they accept.">
            {pending ? <p className="text-[13px] text-muted">You have a pending request to this candidate.</p> : (
              <ActionForm action={contactCandidateAction.bind(null, p.id)} className="space-y-2.5">
                <label className="sr-only" htmlFor="contact-msg">Message</label>
                <textarea id="contact-msg" name="message" rows={4} required minLength={20} maxLength={1500} className="field" placeholder="Who you are and why you're reaching out…" />
                {jobs.length > 0 && <select name="jobId" className="field" aria-label="Related job"><option value="">No specific job</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</select>}
                <SubmitButton className="btn btn-primary w-full" pendingText="Sending…">Send request</SubmitButton>
              </ActionForm>
            )}
          </Panel>
        )}
        </>
      }
    />
  );
}
