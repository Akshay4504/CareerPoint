import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { ensureProfile } from "@/lib/services/profile";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { deleteResume, generateFromProfile, syncProfileFromResume, uploadResume } from "@/app/actions/resume";
import { createTargetedAction, duplicateResumeAction, setPublicResume } from "@/app/actions/builder";
import { BENCHMARK_ROLES_FOR_TARGETING } from "@/lib/scoring/benchmark";
import { timeAgo } from "@/lib/utils";
import { scoreLabel } from "@/lib/resume/score";

export const metadata: Metadata = { title: "Resume" };
export const dynamic = "force-dynamic";

const KIND = { UPLOADED: "Uploaded", GENERATED: "Master profile resume", TARGETED: "Targeted version" } as const;

export default async function ResumePage() {
  const user = await requireArea("app");
  const profile = await ensureProfile(user);
  const [resumes, pendingImports] = await Promise.all([
    db.resume.findMany({ where: { profileId: profile.id }, orderBy: { updatedAt: "desc" }, include: { sourceFile: true, versions: { orderBy: { version: "desc" }, take: 1, include: { scores: { orderBy: { createdAt: "desc" }, take: 1 } } } } }),
    db.resumeImport.findMany({ where: { profileId: profile.id, status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);

  return (
    <>
      <PageHeader title="Resume" description="Your profile is the master. Upload a resume to import it, then build targeted versions for specific BIM roles without ever touching the original." actions={<Link href="/resume/score" className="btn btn-secondary btn-sm">Resume score</Link>} />

      {pendingImports.length > 0 && (
        <div role="note" className="mb-5 rounded-md border border-[#ecd29e] bg-warn-soft px-4 py-3 text-[13px] text-warn">
          <strong className="font-semibold">Resume waiting for your review.</strong>{" "}
          {pendingImports.map((i) => (
            <Link key={i.id} href={`/resume/import/${i.id}`} className="ml-1 underline">Review import from {timeAgo(i.createdAt)}</Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {resumes.length === 0 ? (
            <EmptyState title="No resume yet" description="Upload a PDF, DOCX or TXT and review what we extract before anything is saved — or generate one from your profile." />
          ) : (
            resumes.map((r) => {
              const v = r.versions[0];
              const s = v?.scores[0];
              const isPublic = profile.publicResumeId === r.id;
              return (
                <article key={r.id} className="panel p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-[15px]">{r.title}</h2>
                      <p className="mt-0.5 text-[12.5px] text-muted">
                        {KIND[r.kind]}{r.targetRole ? ` · ${BENCHMARK_ROLES_FOR_TARGETING.find((b) => b.id === r.targetRole)?.label ?? r.targetRole}` : ""} · v{v?.version ?? 1} · updated {timeAgo(r.updatedAt)}
                      </p>
                      {isPublic && <div className="mt-1"><Badge tone="accent">Shown on public profile (if enabled)</Badge></div>}
                    </div>
                    {s && (
                      <Link href={`/resume/score?resume=${r.id}`} className="text-right">
                        <span className="block text-[24px] font-semibold leading-none tabular-nums">{s.total}</span>
                        <Badge tone={s.total >= 70 ? "ok" : s.total >= 50 ? "warn" : "bad"}>{scoreLabel(s.total)}</Badge>
                      </Link>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/resume/${r.id}/edit`} className="btn btn-primary btn-sm">Edit</Link>
                    <Link href={`/resume/${r.id}`} className="btn btn-secondary btn-sm">Preview / PDF</Link>
                    <Link href={`/resume/score?resume=${r.id}`} className="btn btn-secondary btn-sm">Score &amp; gaps</Link>
                    <form action={duplicateResumeAction.bind(null, r.id)}><button className="btn btn-ghost btn-sm">Duplicate</button></form>
                    {r.sourceFile && <a href={`/api/files/${r.sourceFile.id}`} className="btn btn-ghost btn-sm">Download original</a>}
                    <form action={setPublicResume.bind(null, isPublic ? null : r.id)}><button className="btn btn-ghost btn-sm">{isPublic ? "Don’t show on profile" : "Use on public profile"}</button></form>
                    <form action={syncProfileFromResume.bind(null, r.id)}><ConfirmButton className="btn btn-ghost btn-sm" message="Replace your profile's experience, education, projects and certifications with this resume's content? This overwrites profile data.">Overwrite profile from this</ConfirmButton></form>
                    <form action={deleteResume.bind(null, r.id)}><ConfirmButton message="Delete this resume and its file? Applications that used it will lose the attachment.">Delete</ConfirmButton></form>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Upload a resume" description="PDF, DOCX or TXT up to 5 MB. Stored privately.">
            <ActionForm action={uploadResume} className="space-y-3" encType="multipart/form-data">
              <input type="file" name="file" required accept=".pdf,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="block w-full text-[13px] file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-bg file:px-3 file:py-1.5 file:text-[13px]" aria-label="Resume file" />
              <SubmitButton className="btn btn-accent w-full" pendingText="Reading resume…">Upload &amp; review</SubmitButton>
              <p className="text-[12px] text-muted">You&apos;ll review everything we found before it touches your profile.</p>
            </ActionForm>
          </Panel>
          <Panel title="Targeted version" description="Builds a new resume from your master profile, tuned to a BIM role.">
            <ActionForm action={createTargetedAction} className="space-y-3">
              <div>
                <label className="label" htmlFor="role">Target role</label>
                <select id="role" name="role" required className="field" defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {BENCHMARK_ROLES_FOR_TARGETING.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ttitle">Name <span className="font-normal text-muted">(optional)</span></label>
                <input id="ttitle" name="title" maxLength={80} className="field" placeholder="e.g. BIM Coordinator Resume" />
              </div>
              <SubmitButton className="btn btn-secondary w-full" pendingText="Creating…">Create &amp; edit</SubmitButton>
            </ActionForm>
          </Panel>
          <Panel title="Master profile resume" description="One-click snapshot of your whole profile.">
            <form action={generateFromProfile}><button className="btn btn-secondary w-full">Generate from profile</button></form>
          </Panel>
        </div>
      </div>
    </>
  );
}
