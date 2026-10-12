"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { saveJob } from "@/app/actions/employer";
import { DISCIPLINES, EMPLOYMENT_TYPES, SENIORITY, SECTORS } from "@/lib/taxonomy";

export type JobFormJob = {
  id: string; title: string; location: string | null; country: string | null; employmentType: string | null; seniority: string | null; discipline: string | null;
  description: string; responsibilities: string | null; requirements: string | null; software: string[]; skills: string[]; remoteType: string | null;
  bimRole: string | null; industry: string | null; experienceMin: number | null; experienceMax: number | null;
  salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null; applyUrl: string | null;
};

const REMOTE_LABEL: Record<string, string> = { ONSITE: "On-site", HYBRID: "Hybrid", REMOTE: "Remote" };

export function JobForm({ job, verified, companyName, bimRoles }: { job?: JobFormJob; verified: boolean; companyName: string; bimRoles: string[] }) {
  const [v, setV] = useState({
    title: job?.title ?? "", location: job?.location ?? "", country: job?.country ?? "", employmentType: job?.employmentType ?? "", seniority: job?.seniority ?? "",
    discipline: job?.discipline ?? "", bimRole: job?.bimRole ?? "", remoteType: job?.remoteType ?? "", industry: job?.industry ?? "",
    description: job?.description ?? "", responsibilities: job?.responsibilities ?? "", requirements: job?.requirements ?? "",
    software: job?.software.join(", ") ?? "", skills: job?.skills.join(", ") ?? "", experienceMin: job?.experienceMin?.toString() ?? "", experienceMax: job?.experienceMax?.toString() ?? "",
    salaryMin: job?.salaryMin?.toString() ?? "", salaryMax: job?.salaryMax?.toString() ?? "", salaryCurrency: job?.salaryCurrency ?? "", applyUrl: job?.applyUrl ?? "",
  });
  const bind = (k: keyof typeof v) => ({ name: k, value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value })) });
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const salary = v.salaryMin || v.salaryMax ? `${v.salaryCurrency.toUpperCase() || ""} ${[v.salaryMin, v.salaryMax].filter(Boolean).map((n) => Number(n).toLocaleString("en-US")).join(" – ")}`.trim() : null;
  const exp = v.experienceMin || v.experienceMax ? `${[v.experienceMin, v.experienceMax].filter(Boolean).join("–")} years experience` : null;
  const meta = [v.location, v.remoteType && REMOTE_LABEL[v.remoteType], v.employmentType, v.seniority, exp, salary].filter(Boolean) as string[];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <ActionForm action={saveJob} className="grid gap-4 sm:grid-cols-2">
        {job && <input type="hidden" name="id" value={job.id} />}
        <Field label="Job title" htmlFor="title" className="sm:col-span-2"><input id="title" required minLength={4} className="field" placeholder="e.g. BIM Coordinator (MEP)" {...bind("title")} /></Field>
        <Field label="BIM role" htmlFor="bimRole" hint="Inferred from the title if left blank."><select id="bimRole" className="field" {...bind("bimRole")}><option value="">Auto</option>{bimRoles.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Discipline" htmlFor="discipline" hint="Inferred from the description if blank."><select id="discipline" className="field" {...bind("discipline")}><option value="">Auto</option>{DISCIPLINES.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Location" htmlFor="location"><input id="location" placeholder="City, Country" className="field" {...bind("location")} /></Field>
        <Field label="Country" htmlFor="country"><input id="country" className="field" {...bind("country")} /></Field>
        <Field label="Work mode" htmlFor="remoteType"><select id="remoteType" className="field" {...bind("remoteType")}><option value="">Auto</option><option value="ONSITE">On-site</option><option value="HYBRID">Hybrid</option><option value="REMOTE">Remote</option></select></Field>
        <Field label="Employment type" htmlFor="employmentType"><select id="employmentType" className="field" {...bind("employmentType")}><option value="">—</option>{EMPLOYMENT_TYPES.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Seniority" htmlFor="seniority" hint="Inferred from the title if blank."><select id="seniority" className="field" {...bind("seniority")}><option value="">Auto</option>{SENIORITY.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Sector" htmlFor="industry"><select id="industry" className="field" {...bind("industry")}><option value="">Auto</option>{SECTORS.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Experience (min years)" htmlFor="experienceMin"><input id="experienceMin" type="number" min={0} max={60} className="field" {...bind("experienceMin")} /></Field>
        <Field label="Experience (max years)" htmlFor="experienceMax"><input id="experienceMax" type="number" min={0} max={60} className="field" {...bind("experienceMax")} /></Field>
        <Field label="Description" htmlFor="description" className="sm:col-span-2" hint="What the team does and what a good candidate looks like (80+ characters)."><textarea id="description" rows={6} required minLength={80} className="field" {...bind("description")} /></Field>
        <Field label="Responsibilities" htmlFor="responsibilities" className="sm:col-span-2"><textarea id="responsibilities" rows={4} className="field" placeholder="One per line" {...bind("responsibilities")} /></Field>
        <Field label="Requirements" htmlFor="requirements" className="sm:col-span-2"><textarea id="requirements" rows={4} className="field" placeholder="One per line" {...bind("requirements")} /></Field>
        <Field label="Required software (comma separated)" htmlFor="software" hint="Detected from the text if blank."><input id="software" className="field" placeholder="Revit, Navisworks" {...bind("software")} /></Field>
        <Field label="Required skills (comma separated)" htmlFor="skills"><input id="skills" className="field" placeholder="Clash Detection, ISO 19650" {...bind("skills")} /></Field>
        <div className="grid grid-cols-3 gap-3 sm:col-span-2">
          <Field label="Salary min" htmlFor="salaryMin"><input id="salaryMin" type="number" min={0} className="field" {...bind("salaryMin")} /></Field>
          <Field label="Salary max" htmlFor="salaryMax"><input id="salaryMax" type="number" min={0} className="field" {...bind("salaryMax")} /></Field>
          <Field label="Currency" htmlFor="salaryCurrency"><input id="salaryCurrency" maxLength={3} placeholder="USD" className="field uppercase" {...bind("salaryCurrency")} /></Field>
        </div>
        <Field label="Application method" htmlFor="applyUrl" className="sm:col-span-2" hint="Leave blank to receive applications inside CareerPoint (resume + portfolio). Enter a URL to send candidates to your own application page instead."><input id="applyUrl" type="url" className="field" placeholder="https://… (optional)" {...bind("applyUrl")} /></Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <SubmitButton name="intent" value="publish" className="btn btn-accent" pendingText="Saving…">{verified ? "Publish job" : "Submit for review"}</SubmitButton>
          <SubmitButton name="intent" value="draft" className="btn btn-secondary" pendingText="Saving…">Save as draft</SubmitButton>
          {!verified && <span className="text-[12.5px] text-muted">Your company isn&apos;t verified yet, so jobs are reviewed before going live.</span>}
        </div>
      </ActionForm>

      <aside aria-label="Job preview" className="lg:sticky lg:top-20 lg:self-start">
        <p className="eyebrow mb-2">Live preview — what candidates will see</p>
        <article className="panel p-5">
          <h2 className="text-[17px] font-semibold leading-snug">{v.title || "Job title"}</h2>
          <p className="mt-0.5 text-[13.5px] text-ink-2">{companyName}</p>
          {meta.length > 0 && <p className="mt-2 text-[12.5px] text-muted">{meta.join(" · ")}</p>}
          <div className="mt-3 flex flex-wrap gap-1">
            {[v.bimRole, v.discipline, v.industry].filter(Boolean).map((x) => <span key={x} className="inline-block rounded-[4px] bg-sunken px-1.5 py-px text-[12px] text-ink-2">{x}</span>)}
            {list(v.software).map((x) => <span key={x} className="inline-block rounded-[4px] bg-sunken px-1.5 py-px text-[12px] text-ink-2">{x}</span>)}
          </div>
          <p className="prose-plain mt-4 line-clamp-6 text-[13.5px] text-ink-2">{v.description || "Your description appears here."}</p>
          {v.responsibilities && <div className="mt-3"><p className="eyebrow">Responsibilities</p><p className="prose-plain line-clamp-4 text-[13px] text-ink-2">{v.responsibilities}</p></div>}
          {v.requirements && <div className="mt-3"><p className="eyebrow">Requirements</p><p className="prose-plain line-clamp-4 text-[13px] text-ink-2">{v.requirements}</p></div>}
          <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-muted">{v.applyUrl ? "Candidates will apply on your own site." : "Candidates apply here with their CareerPoint resume and portfolio."}</p>
        </article>
      </aside>
    </div>
  );
}
