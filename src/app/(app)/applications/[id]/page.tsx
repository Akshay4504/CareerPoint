import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth/guards";
import { getCandidateApplication } from "@/lib/applications/candidate";
import { STAGE_LABEL, allowedMoves, buildTimeline, isTerminal } from "@/lib/applications/lifecycle";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Timeline } from "@/components/timeline";
import { Badge, Field, PageHeader, Panel } from "@/components/ui";
import { candidateMessageAction, moveApplicationAsCandidate, respondInterviewAction } from "@/app/actions/applications";
import { ExternalConfirm } from "./external-confirm";
import { safeUrl, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Application" };
export const dynamic = "force-dynamic";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireArea("app");
  // Ownership is part of the query: another user's application id is a 404.
  const data = await getCandidateApplication(user.id, id);
  if (!data) notFound();
  const { app, interactions } = data;
  const timeline = buildTimeline({ external: app.external, interactions, events: app.events, interviews: app.interviews });
  const moves = allowedMoves(app, "CANDIDATE").filter((s) => s !== "APPLIED" || app.status !== "APPLYING");
  const applyUrl = safeUrl(app.job.applyUrl);
  const upcoming = app.interviews.filter((i) => i.status === "SCHEDULED");

  return (
    <>
      <PageHeader
        title={app.job.title}
        eyebrow={app.external ? "External application" : "Applied on CareerPoint"}
        description={[app.job.companyName, app.job.location].filter(Boolean).join(" · ")}
        actions={<><Link href="/applications" className="btn btn-ghost btn-sm">← Tracker</Link><Link href={`/jobs/${app.job.slug}`} className="btn btn-secondary btn-sm">View job</Link><Badge tone={app.status === "REJECTED" ? "bad" : app.status === "OFFER" || app.status === "ACCEPTED" ? "ok" : "accent"}>{STAGE_LABEL[app.status]}</Badge></>}
      />

      {app.external && app.status === "APPLYING" && <div className="mb-6"><ExternalConfirm applicationId={app.id} applyUrl={applyUrl} /></div>}
      {app.external && app.status !== "APPLYING" && <p role="note" className="mb-6 rounded-md border border-line bg-surface px-4 py-2.5 text-[13px] text-ink-2">This application was made on the employer&apos;s own site. CareerPoint doesn&apos;t receive updates from them — stages after “Applied” are what you tell us.</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Panel title="Timeline" description="Only things that actually happened.">
            <Timeline entries={timeline} />
          </Panel>

          {upcoming.length > 0 && (
            <Panel title="Interviews">
              <ul className="space-y-3">
                {upcoming.map((iv) => (
                  <li key={iv.id} className="rounded-md border border-line p-3 text-[13.5px]">
                    <p className="font-medium">{iv.scheduledAt.toISOString().slice(0, 16).replace("T", " ")} UTC · {iv.durationMin} min · {iv.mode.toLowerCase()}</p>
                    {iv.locationOrLink && <p className="break-all text-ink-2">{iv.locationOrLink}</p>}
                    {iv.messageToCandidate && <p className="prose-plain mt-1 text-ink-2">{iv.messageToCandidate}</p>}
                    <div className="mt-2 flex items-center gap-2">
                      {iv.candidateResponse ? <Badge tone={iv.candidateResponse === "ACCEPTED" ? "ok" : "neutral"}>You {iv.candidateResponse === "ACCEPTED" ? "confirmed" : "declined"}</Badge> : (
                        <>
                          <form action={respondInterviewAction.bind(null, iv.id, app.id, true)}><button className="btn btn-accent btn-sm">Confirm</button></form>
                          <form action={respondInterviewAction.bind(null, iv.id, app.id, false)}><button className="btn btn-secondary btn-sm">Decline</button></form>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {!app.external && (
            <Panel title="Messages" description="A private conversation with the employer about this application.">
              {app.messages.length === 0 ? <p className="mb-3 text-[13.5px] text-muted">No messages yet.</p> : (
                <ul className="mb-4 space-y-2.5">
                  {app.messages.map((m) => (
                    <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-[13.5px] ${m.senderRole === "CANDIDATE" ? "ml-auto bg-accent-soft" : "bg-sunken"}`}>
                      <p className="prose-plain">{m.body}</p>
                      <p className="mt-0.5 text-[11.5px] text-muted">{m.senderRole === "CANDIDATE" ? "You" : "Employer"} · {timeAgo(m.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
              {!isTerminal(app.status) && (
                <ActionForm action={candidateMessageAction.bind(null, app.id)} className="space-y-2" resetOnSuccess>
                  <label className="sr-only" htmlFor="body">Message</label>
                  <textarea id="body" name="body" rows={3} required maxLength={3000} className="field" placeholder="Write a message…" />
                  <SubmitButton className="btn btn-secondary btn-sm" pendingText="Sending…">Send</SubmitButton>
                </ActionForm>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Details">
            <dl className="space-y-1.5 text-[13.5px]">
              <div className="flex justify-between gap-3"><dt className="text-muted">Source</dt><dd>{app.sourceLabel ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Started</dt><dd>{app.applyClickedAt ? timeAgo(app.applyClickedAt) : timeAgo(app.createdAt)}</dd></div>
              {app.appliedAt && <div className="flex justify-between gap-3"><dt className="text-muted">Applied</dt><dd>{timeAgo(app.appliedAt)}</dd></div>}
              {app.resumeVersion && <div className="flex justify-between gap-3"><dt className="text-muted">Resume</dt><dd><Link className="underline" href={`/resume/${app.resumeVersion.resume.id}`}>{app.resumeVersion.resume.title} v{app.resumeVersion.version}</Link></dd></div>}
              {!app.external && (app.portfolioProjectIds.length > 0 || app.portfolioItemIds.length > 0) && <div className="flex justify-between gap-3"><dt className="text-muted">Portfolio shared</dt><dd>{app.portfolioProjectIds.length + app.portfolioItemIds.length} item(s)</dd></div>}
              {!app.external && app.viewedByEmployerAt && <div className="flex justify-between gap-3"><dt className="text-muted">Employer viewed</dt><dd>{timeAgo(app.viewedByEmployerAt)}</dd></div>}
            </dl>
            {app.coverNote && <div className="mt-3 border-t border-line pt-3"><p className="eyebrow mb-1">Your note</p><p className="prose-plain text-[13px] text-ink-2">{app.coverNote}</p></div>}
          </Panel>

          {moves.length > 0 && (
            <Panel title={app.external ? "Update your progress" : "Your options"} description={app.external ? "You're tracking this yourself, so these are recorded as self-reported." : undefined}>
              <ActionForm action={moveApplicationAsCandidate.bind(null, app.id)} className="space-y-3">
                <Field label="Move to" htmlFor="status"><select id="status" name="status" className="field">{moves.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></Field>
                <Field label="Note (optional)" htmlFor="note"><input id="note" name="note" maxLength={500} className="field" /></Field>
                <SubmitButton className="btn btn-secondary w-full" pendingText="Saving…">Update</SubmitButton>
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
