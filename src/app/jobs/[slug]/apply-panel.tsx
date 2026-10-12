"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui";
import { applyNativeAction, confirmExternalAction, startExternalApplyAction } from "@/app/actions/applications";

type Resume = { resumeId: string; versionId: string; label: string };
type Existing = { id: string; status: string; external: boolean } | null;
type Props = {
  jobId: string;
  native: boolean;
  resumes: Resume[];
  projects: { id: string; name: string; published: boolean }[];
  items: { id: string; title: string }[];
  application: Existing;
  origin: string;
  jobRole?: string | null;
};

const LABEL: Record<string, string> = { APPLYING: "Applying", APPLIED: "Applied", RECRUITER_REVIEW: "Recruiter review", SHORTLISTED: "Shortlisted", ASSESSMENT: "Assessment", INTERVIEW: "Interview", OFFER: "Offer", ACCEPTED: "Accepted", REJECTED: "Rejected", WITHDRAWN: "Withdrawn", EXPIRED: "Expired" };

export function ApplyPanel({ jobId, native, resumes, projects, items, application, origin, jobRole }: Props) {
  const [app, setApp] = useState<Existing>(application);
  const [versionId, setVersionId] = useState(resumes[0]?.versionId ?? "");
  const selectedResume = resumes.find(r => r.versionId === versionId);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [tailoring, setTailoring] = useState(false);
  const [answered, setAnswered] = useState<"yes" | "no" | null>(null);

  const open = (url: string, w: Window | null) => {
    if (w && !w.closed) w.location.href = url;
    else window.open(url, "_blank");
  };

  // External: record the click, open the official application page, then ask whether it was completed.
  const applyExternally = () => {
    setError(null);
    const w = window.open("", "_blank"); // opened synchronously so popup blockers allow it
    if (w) w.opener = null;
    start(async () => {
      const r = await startExternalApplyAction(jobId, versionId || null, origin);
      if (!r.ok) {
        w?.close();
        setError(r.error);
        return;
      }
      open(r.url, w);
      setApp({ id: r.applicationId, status: "APPLYING", external: true });
    });
  };

  const confirm = (submitted: boolean) =>
    start(async () => {
      if (!app) return;
      const r = await confirmExternalAction(app.id, submitted);
      if (!r.ok) return setError(r.error ?? "Could not save.");
      setAnswered(submitted ? "yes" : "no");
      if (submitted) setApp({ ...app, status: "APPLIED" });
    });

  const handleTailor = async () => {
    if (!selectedResume || !jobRole) return;
    setTailoring(true);
    setError(null);
    try {
      const res = await fetch("/api/resumes/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: selectedResume.resumeId, roleName: jobRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to tailor resume");
      
      alert("Resume successfully tailored for " + jobRole + "! The page will reload to reflect your new match score.");
      
      // Update the URL to include ?resume= so the server calculates the match score using the newly tailored resume
      const url = new URL(window.location.href);
      url.searchParams.set("resume", selectedResume.resumeId);
      window.location.assign(url.toString());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTailoring(false);
    }
  };

  // ---- already tracked -----------------------------------------------------------------------------------
  if (app && app.status !== "APPLYING" && app.status !== "WITHDRAWN" && app.status !== "EXPIRED") {
    return (
      <div className="space-y-2 text-[13.5px]">
        <p className="flex items-center gap-2"><Badge tone={app.status === "REJECTED" ? "bad" : "ok"}>{LABEL[app.status] ?? app.status}</Badge>{app.external && <span className="text-[12px] text-muted">self-reported</span>}</p>
        {app.external && app.status === "APPLIED" && answered === "yes" && <p className="text-muted">Saved. We track this application for you; we can&apos;t see what the employer does with it.</p>}
        <Link href={`/applications/${app.id}`} className="btn btn-secondary btn-sm">Track application</Link>
      </div>
    );
  }

  // ---- external: waiting for confirmation -------------------------------------------------------------------
  if (app && app.status === "APPLYING" && app.external) {
    return (
      <div className="space-y-3 text-[13.5px]">
        <p className="font-medium">Did you complete the application?</p>
        <p className="text-muted">We opened the employer&apos;s official application page. We can&apos;t see whether you submitted it, so tell us — you can change this later.</p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-accent flex-1" disabled={pending} onClick={() => confirm(true)}>Yes, submitted</button>
          <button type="button" className="btn btn-secondary flex-1" disabled={pending} onClick={() => confirm(false)}>No, not yet</button>
        </div>
        {answered === "no" && <p className="text-[12.5px] text-muted">No problem — it stays as “Applying” and you can confirm later from your tracker.</p>}
        {error && <p role="alert" className="text-bad">{error}</p>}
        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={applyExternally}>Open the application page again ↗</button>
      </div>
    );
  }

  // ---- external: not started ----------------------------------------------------------------------------------
  if (!native) {
    return (
      <div className="space-y-3 text-[13.5px]">
        <p className="rounded-md bg-sunken px-2.5 py-2 text-[12.5px] text-ink-2">External application — you&apos;ll apply on the employer&apos;s own site. CareerPoint records that you opened it and helps you track it.</p>
        {resumes.length > 0 && (
          <div>
            <label className="label" htmlFor="ext-resume">Resume you&apos;ll use (for your records)</label>
            <select id="ext-resume" className="field" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              {resumes.map((r) => <option key={r.versionId} value={r.versionId}>{r.label}</option>)}
            </select>
            {jobRole && (
              <button type="button" onClick={handleTailor} disabled={tailoring} className="mt-2 text-[12px] font-medium text-accent hover:underline">
                {tailoring ? "Tailoring..." : `✨ Auto-tailor this resume for ${jobRole}`}
              </button>
            )}
          </div>
        )}
        <button type="button" className="btn btn-primary w-full" disabled={pending} onClick={applyExternally}>{pending ? "Opening…" : "Apply on employer site ↗"}</button>
        {error && <p role="alert" className="text-bad">{error}</p>}
      </div>
    );
  }

  // ---- native ------------------------------------------------------------------------------------------------------
  if (resumes.length === 0) {
    return (
      <div className="space-y-3 text-[13.5px]">
        <p className="text-muted">Add a resume so the employer receives your structured BIM profile with your application.</p>
        <Link href="/resume" className="btn btn-primary w-full">Add a resume</Link>
      </div>
    );
  }
  return (
    <ActionForm action={applyNativeAction} className="space-y-3">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="origin" value={origin} />
      <p className="rounded-md bg-accent-soft px-2.5 py-2 text-[12.5px] text-accent-strong">Apply on CareerPoint — the employer receives your application immediately.</p>
      <div>
        <label className="label" htmlFor="resumeVersionId">Resume</label>
        <select id="resumeVersionId" name="resumeVersionId" className="field" required value={versionId} onChange={(e) => setVersionId(e.target.value)}>
          {resumes.map((r) => <option key={r.versionId} value={r.versionId}>{r.label}</option>)}
        </select>
        {jobRole && (
          <button type="button" onClick={handleTailor} disabled={tailoring} className="mt-2 text-[12px] font-medium text-accent hover:underline">
            {tailoring ? "Tailoring..." : `✨ Auto-tailor this resume for ${jobRole}`}
          </button>
        )}
      </div>
      {(projects.length > 0 || items.length > 0) && (
        <fieldset>
          <legend className="label">Portfolio to include <span className="font-normal text-muted">(optional)</span></legend>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-line p-2 text-[13px]">
            {projects.map((p) => <label key={p.id} className="flex items-center gap-2"><input type="checkbox" name="projects" value={p.id} /> {p.name}{!p.published && <span className="text-[11.5px] text-muted">(draft — shared only with this employer)</span>}</label>)}
            {items.map((i) => <label key={i.id} className="flex items-center gap-2"><input type="checkbox" name="items" value={i.id} /> {i.title}</label>)}
          </div>
        </fieldset>
      )}
      <div>
        <label className="label" htmlFor="coverNote">Note to employer <span className="font-normal text-muted">(optional)</span></label>
        <textarea id="coverNote" name="coverNote" rows={3} maxLength={2000} className="field" />
      </div>
      <SubmitButton className="btn btn-accent w-full" pendingText="Submitting…">Submit application</SubmitButton>
    </ActionForm>
  );
}
