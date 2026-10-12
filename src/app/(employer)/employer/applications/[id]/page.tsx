import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEmployerCtx } from "@/lib/auth/guards";
import { getEmployerApplication } from "@/lib/applications/employer";
import { STAGE_LABEL, buildTimeline } from "@/lib/applications/lifecycle";
import { signFileUrl } from "@/lib/files/signed";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { ResumeView } from "@/components/resume-view";
import { Timeline } from "@/components/timeline";
import { Avatar, Badge, Chip, Field, PageHeader, Panel } from "@/components/ui";
import { addNoteAction, deleteNoteAction, employerMessageAction, moveApplicationAction, scheduleInterviewAction, updateInterviewAction } from "@/app/actions/employer";
import { formatMonth, humanize, timeAgo } from "@/lib/utils";
import type { ResumeContent } from "@/lib/resume/types";

export const metadata: Metadata = { title: "Application" };
export const dynamic = "force-dynamic";

export default async function EmployerApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, ctx } = await requireEmployerCtx();
  // Scoped to this company's NATIVE applications in the query itself — any other id is a 404.
  const data = await getEmployerApplication(ctx, id);
  if (!data) notFound();
  const { app, projects, items, caps, allowed } = data;
  const p = app.user.profile;
  const resumeFileId = app.resumeVersion?.resume.sourceFileId;
  const timeline = buildTimeline({ external: false, interactions: [], events: app.events.map((e) => ({ ...e, visibleToCandidate: true })), interviews: app.interviews });

  return (
    <>
      <PageHeader
        title={app.user.name}
        eyebrow={`Applied to ${app.job.title}`}
        description={[p?.headline, p?.location, p?.yearsExperience != null ? `${p.yearsExperience} years` : null].filter(Boolean).join(" · ")}
        actions={<><Link href="/employer/applications" className="btn btn-ghost btn-sm">← Applications</Link><Badge tone={app.status === "REJECTED" ? "bad" : "accent"}>{STAGE_LABEL[app.status]}</Badge></>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Candidate">
            <div className="flex items-start gap-4">
              <Avatar name={app.user.name} size={48} />
              <div className="min-w-0 text-[13.5px]">
                <p className="font-medium">{app.user.name}</p>
                <p className="text-muted">Contact: <a className="underline" href={`mailto:${app.user.email}`}>{app.user.email}</a> <span className="text-[12px]">(shared because they applied)</span></p>
                {p?.availability && <p className="text-muted">Availability: {p.availability}</p>}
              </div>
            </div>
            {app.coverNote && <div className="mt-4 border-t border-line pt-3"><p className="eyebrow mb-1">Note from candidate</p><p className="prose-plain text-[13.5px] text-ink-2">{app.coverNote}</p></div>}
            {p && (
              <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
                {p.softwareSkills.length > 0 && <div><p className="eyebrow mb-1.5">BIM software</p><ul className="space-y-1 text-[13px]">{p.softwareSkills.map((s) => <li key={s.id} className="flex justify-between"><span>{s.software}</span><span className="text-muted">{humanize(s.level)}{s.years != null ? ` · ${s.years}y` : ""}</span></li>)}</ul></div>}
                {p.skills.length > 0 && <div><p className="eyebrow mb-1.5">Skills</p><div className="flex flex-wrap gap-1">{p.skills.map((s) => <Chip key={s.skillId}>{s.skill.name}</Chip>)}</div></div>}
                {p.certifications.length > 0 && <div><p className="eyebrow mb-1.5">Certifications</p><ul className="space-y-0.5 text-[13px]">{p.certifications.map((c) => <li key={c.id}>{c.name}</li>)}</ul></div>}
                {p.languages.length > 0 && <div><p className="eyebrow mb-1.5">Languages</p><p className="text-[13px]">{p.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(", ")}</p></div>}
              </div>
            )}
            {p && p.experiences.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="eyebrow mb-2">Experience</p>
                <ol className="space-y-3 text-[13.5px]">{p.experiences.map((e) => <li key={e.id}><p className="font-medium">{e.title} <span className="font-normal text-ink-2">· {e.company}</span></p><p className="text-[12.5px] text-muted">{formatMonth(e.startDate)} – {e.current ? "Present" : formatMonth(e.endDate) || "—"}</p>{e.description && <p className="prose-plain mt-1 text-ink-2">{e.description}</p>}</li>)}</ol>
              </div>
            )}
          </Panel>

          <Panel title="Resume" actions={resumeFileId ? <a href={signFileUrl(resumeFileId, user.id)} className="btn btn-secondary btn-sm">Download original (expires in 5 min)</a> : undefined}>
            {app.resumeVersion ? <div className="rounded-md border border-line bg-surface p-5"><ResumeView content={app.resumeVersion.content as unknown as ResumeContent} /></div> : <p className="text-[13.5px] text-muted">No resume attached.</p>}
          </Panel>

          {(projects.length > 0 || items.length > 0) && (
            <Panel title="Portfolio shared with you" description="Only what the candidate chose to include with this application.">
              <ul className="space-y-5">
                {projects.map((x) => (
                  <li key={x.id}>
                    <p className="font-medium">{x.name} <span className="font-normal text-muted">{[x.role, x.sector, x.lod, x.year].filter(Boolean).join(" · ")}</span></p>
                    {x.software.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{x.software.map((s) => <Chip key={s}>{s}</Chip>)}</div>}
                    {x.portfolio.some((i) => i.fileId) && (
                      <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {x.portfolio.map((i) => i.fileId && (
                          <li key={i.id} className="overflow-hidden rounded-md border border-line">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/files/${i.fileId}`} alt={i.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                          </li>
                        ))}
                      </ul>
                    )}
                    {([["Responsibilities", x.responsibilities], ["Challenges", x.challenges], ["Solutions", x.solutions], ["Outcomes", x.outcomes]] as const).map(([l, t]) => t && <div key={l} className="mt-2"><p className="eyebrow">{l}</p><p className="prose-plain text-[13.5px] text-ink-2">{t}</p></div>)}
                  </li>
                ))}
                {items.map((i) => <li key={i.id} className="text-[13.5px]"><span className="font-medium">{i.title}</span>{i.url && <> · <a className="underline" href={i.url} target="_blank" rel="noopener noreferrer nofollow">link ↗</a></>}</li>)}
              </ul>
            </Panel>
          )}

          <Panel title="Timeline"><Timeline entries={timeline} /></Panel>
        </div>

        <div className="space-y-4">
          {allowed.length > 0 && (
            <Panel title="Move stage" description="The candidate is notified of every change.">
              <ActionForm action={moveApplicationAction.bind(null, app.id)} className="space-y-3">
                <Field label="Move to" htmlFor="status"><select id="status" name="status" className="field">{allowed.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></Field>
                <Field label="Note to candidate (optional)" htmlFor="note"><input id="note" name="note" maxLength={500} className="field" /></Field>
                <SubmitButton className="btn btn-primary w-full" pendingText="Updating…">Update stage</SubmitButton>
              </ActionForm>
            </Panel>
          )}

          <Panel title="Internal notes" description="Private to your team. Candidates can never see these.">
            {caps.notes && (
              <ActionForm action={addNoteAction.bind(null, app.id)} className="mb-4 space-y-2" resetOnSuccess>
                <label className="sr-only" htmlFor="note-body">Internal note</label>
                <textarea id="note-body" name="body" rows={3} required maxLength={4000} className="field" placeholder="Add an internal note…" />
                <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">Add note</SubmitButton>
              </ActionForm>
            )}
            {app.notes.length === 0 ? <p className="text-[13px] text-muted">No notes yet.</p> : (
              <ul className="space-y-3">
                {app.notes.map((n) => (
                  <li key={n.id} className="rounded-md bg-sunken p-2.5 text-[13px]">
                    <p className="prose-plain">{n.body}</p>
                    <p className="mt-1 flex items-center justify-between text-[11.5px] text-muted"><span>{n.author?.name ?? "Team member"} · {timeAgo(n.createdAt)}</span>{(n.authorId === ctx.userId || ctx.role === "EMPLOYER_ADMIN") && caps.notes && <form action={deleteNoteAction.bind(null, app.id, n.id)}><ConfirmButton message="Delete this note?" className="text-bad underline">Delete</ConfirmButton></form>}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Interviews">
            {app.interviews.length > 0 && (
              <ul className="mb-4 space-y-2.5 text-[13px]">
                {app.interviews.map((iv) => (
                  <li key={iv.id} className="rounded-md border border-line p-2.5">
                    <p className="font-medium">{iv.scheduledAt.toISOString().slice(0, 16).replace("T", " ")} UTC · {iv.durationMin} min · {iv.mode.toLowerCase()}</p>
                    <p className="text-muted">{iv.status.toLowerCase()}{iv.candidateResponse ? ` · candidate ${iv.candidateResponse.toLowerCase()}` : iv.status === "SCHEDULED" ? " · awaiting response" : ""}</p>
                    {iv.status === "SCHEDULED" && caps.interviews && (
                      <div className="mt-1.5 flex gap-1.5">
                        <form action={updateInterviewAction.bind(null, app.id, iv.id, "COMPLETE")}><button className="btn btn-ghost btn-sm">Mark done</button></form>
                        <form action={updateInterviewAction.bind(null, app.id, iv.id, "CANCEL")}><ConfirmButton message="Cancel this interview? The candidate will be told." className="btn btn-ghost btn-sm text-bad">Cancel</ConfirmButton></form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {caps.interviews ? (
              <ActionForm action={scheduleInterviewAction.bind(null, app.id)} className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Date & time (UTC)" htmlFor="scheduledAt" className="col-span-2"><input id="scheduledAt" name="scheduledAt" type="datetime-local" required className="field" /></Field>
                  <Field label="Minutes" htmlFor="durationMin"><input id="durationMin" name="durationMin" type="number" min={10} max={480} defaultValue={45} className="field" /></Field>
                  <Field label="Type" htmlFor="mode"><select id="mode" name="mode" className="field"><option value="VIDEO">Video</option><option value="PHONE">Phone</option><option value="ONSITE">On-site</option></select></Field>
                </div>
                <Field label="Link or address" htmlFor="locationOrLink"><input id="locationOrLink" name="locationOrLink" className="field" /></Field>
                <Field label="Message to candidate" htmlFor="message"><textarea id="message" name="message" rows={2} className="field" /></Field>
                <SubmitButton className="btn btn-secondary w-full" pendingText="Scheduling…">Schedule interview</SubmitButton>
              </ActionForm>
            ) : <p className="text-[12.5px] text-muted">Your role can&apos;t schedule interviews.</p>}
          </Panel>

          <Panel title="Messages" description="Visible to the candidate.">
            {app.messages.length > 0 && (
              <ul className="mb-3 space-y-2">
                {app.messages.map((m) => <li key={m.id} className={`max-w-[92%] rounded-lg px-2.5 py-1.5 text-[13px] ${m.senderRole === "EMPLOYER" ? "ml-auto bg-accent-soft" : "bg-sunken"}`}><p className="prose-plain">{m.body}</p><p className="text-[11px] text-muted">{m.senderRole === "EMPLOYER" ? "Your team" : "Candidate"} · {timeAgo(m.createdAt)}</p></li>)}
              </ul>
            )}
            {caps.messages ? (
              <ActionForm action={employerMessageAction.bind(null, app.id)} className="space-y-2" resetOnSuccess>
                <label className="sr-only" htmlFor="msg">Message</label>
                <textarea id="msg" name="body" rows={3} required maxLength={3000} className="field" placeholder="Write to the candidate…" />
                <SubmitButton className="btn btn-secondary btn-sm" pendingText="Sending…">Send</SubmitButton>
              </ActionForm>
            ) : <p className="text-[12.5px] text-muted">Your role can&apos;t message candidates.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
