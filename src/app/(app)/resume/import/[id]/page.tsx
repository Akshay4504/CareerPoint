import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { applyImportAction, discardImportAction } from "@/app/actions/builder";
import { diffScalars } from "@/lib/services/imports";
import { emptyResume, type ResumeContent } from "@/lib/resume/types";

export const metadata: Metadata = { title: "Review resume import" };
export const dynamic = "force-dynamic";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export default async function ImportReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireArea("app");
  // Ownership enforced in the query.
  const imp = await db.resumeImport.findFirst({ where: { id, profile: { userId: user.id } }, include: { profile: { include: { experiences: true, educations: true, projects: true, certifications: true, languages: true, softwareSkills: true, skills: { include: { skill: true } } } } } });
  if (!imp) notFound();
  if (imp.status !== "PENDING") {
    return (
      <>
        <PageHeader title="Import already processed" />
        <p className="text-muted">This import was {imp.status.toLowerCase()}. Upload the resume again to start a new review.</p>
      </>
    );
  }
  const x: ResumeContent = { ...emptyResume(), ...(imp.extracted as unknown as ResumeContent) };
  const p = imp.profile;
  const diff = diffScalars(x, { headline: p.headline, summary: p.summary, location: p.location, yearsExperience: p.yearsExperience, discipline: p.discipline });
  const haveExp = new Set(p.experiences.map((e) => norm(`${e.title}|${e.company}`)));
  const haveEdu = new Set(p.educations.map((e) => norm(`${e.school}|${e.degree ?? ""}`)));
  const haveProj = new Set(p.projects.map((e) => norm(e.name)));
  const haveCert = new Set(p.certifications.map((e) => norm(e.name)));
  const haveLang = new Set(p.languages.map((e) => norm(e.name)));
  const haveSw = new Set(p.softwareSkills.map((e) => norm(e.software)));
  const haveSk = new Set(p.skills.map((e) => norm(e.skill.name)));

  const Dup = () => <Badge>Already in profile</Badge>;

  return (
    <>
      <PageHeader title="Information found in your resume" description="Nothing has been saved yet. Review what we extracted, edit anything that's wrong, and choose what to add to your profile. Existing profile data is never overwritten unless you tick a field marked “differs”." />
      <ActionForm action={applyImportAction.bind(null, id)} className="space-y-6">
        <Panel title="Profile fields">
          <ul className="divide-y divide-line">
            {diff.scalars.map((r) => (
              <li key={r.key} className="py-3 first:pt-0 last:pb-0">
                {r.status === "empty" ? (
                  <p className="text-[13px] text-muted">{r.label}: not found in the resume.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-start">
                    <label className="flex items-center gap-2 text-[13.5px] font-medium">
                      <input type="checkbox" name={`use_${r.key}`} defaultChecked={r.status === "new"} disabled={r.status === "same"} />
                      {r.label}
                      {r.status === "new" && <Badge tone="ok">New</Badge>}
                      {r.status === "same" && <Badge>Same</Badge>}
                      {r.status === "different" && <Badge tone="warn">Differs</Badge>}
                    </label>
                    <div>
                      {r.key === "summary" ? <textarea name={`val_${r.key}`} defaultValue={r.found ?? ""} rows={3} className="field" aria-label={r.label} /> : <input name={`val_${r.key}`} defaultValue={r.found ?? ""} className="field" aria-label={r.label} />}
                      {r.status === "different" && <p className="mt-1 text-[12.5px] text-muted">Your profile currently says: “{r.current}”. Tick to replace it.</p>}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={`Experience (${x.experiences.length})`} description="Edit titles, dates and bullets before adding.">
          <input type="hidden" name="exp_count" value={x.experiences.length} />
          {x.experiences.length === 0 && <p className="text-[13px] text-muted">No roles detected. You can add them on your profile.</p>}
          <div className="space-y-4">
            {x.experiences.map((e, i) => {
              const dup = haveExp.has(norm(`${e.title}|${e.company}`));
              return (
                <fieldset key={i} className="rounded-md border border-line p-3">
                  <legend className="px-1">
                    <label className="flex items-center gap-2 text-[13.5px] font-medium">
                      <input type="checkbox" name={`exp_use_${i}`} defaultChecked={!dup} /> Role {i + 1} {dup && <Dup />}
                    </label>
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input name={`exp_title_${i}`} defaultValue={e.title} className="field" aria-label="Title" />
                    <input name={`exp_company_${i}`} defaultValue={e.company} className="field" aria-label="Company" />
                    <input name={`exp_start_${i}`} type="month" defaultValue={e.startDate ?? ""} className="field" aria-label="Start" />
                    <input name={`exp_end_${i}`} type="month" defaultValue={e.endDate ?? ""} className="field" aria-label="End" />
                    <input name={`exp_location_${i}`} defaultValue={e.location ?? ""} className="field" aria-label="Location" placeholder="Location" />
                    <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name={`exp_current_${i}`} defaultChecked={e.current} /> Current role</label>
                    <textarea name={`exp_desc_${i}`} defaultValue={e.description ?? ""} rows={4} className="field sm:col-span-2" aria-label="Responsibilities and achievements" />
                  </div>
                </fieldset>
              );
            })}
          </div>
        </Panel>

        <Panel title={`Projects (${x.projects.length})`}>
          <input type="hidden" name="proj_count" value={x.projects.length} />
          {x.projects.length === 0 && <p className="text-[13px] text-muted">No projects detected.</p>}
          <div className="space-y-4">
            {x.projects.map((pr, i) => (
              <fieldset key={i} className="rounded-md border border-line p-3">
                <legend className="px-1"><label className="flex items-center gap-2 text-[13.5px] font-medium"><input type="checkbox" name={`proj_use_${i}`} defaultChecked={!haveProj.has(norm(pr.name))} /> Project {i + 1} {haveProj.has(norm(pr.name)) && <Dup />}</label></legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input name={`proj_name_${i}`} defaultValue={pr.name} className="field sm:col-span-2" aria-label="Project name" />
                  <input name={`proj_role_${i}`} defaultValue={pr.role ?? ""} className="field" placeholder="Role" aria-label="Role" />
                  <input name={`proj_sector_${i}`} defaultValue={pr.sector ?? ""} className="field" placeholder="Sector" aria-label="Sector" />
                  <input name={`proj_lod_${i}`} defaultValue={pr.lod ?? ""} className="field" placeholder="LOD" aria-label="LOD" />
                  <input name={`proj_year_${i}`} type="number" defaultValue={pr.year ?? ""} className="field" placeholder="Year" aria-label="Year" />
                  <input name={`proj_software_${i}`} defaultValue={(pr.software ?? []).join(", ")} className="field sm:col-span-2" placeholder="Software" aria-label="Software" />
                  <textarea name={`proj_desc_${i}`} defaultValue={pr.description ?? ""} rows={3} className="field sm:col-span-2" aria-label="Description" />
                </div>
              </fieldset>
            ))}
          </div>
        </Panel>

        <Panel title="Software, skills, certifications">
          <CheckGroup title="BIM software" name="software" items={x.software} have={haveSw} />
          <CheckGroup title="BIM skills & standards" name="skill" items={x.skills} have={haveSk} />
          <CheckGroup title="Certifications" name="cert" items={x.certifications} have={haveCert} />
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={`Education (${x.educations.length})`}>
            <input type="hidden" name="edu_count" value={x.educations.length} />
            {x.educations.length === 0 && <p className="text-[13px] text-muted">None detected.</p>}
            <div className="space-y-3">
              {x.educations.map((e, i) => (
                <fieldset key={i} className="rounded-md border border-line p-3">
                  <legend className="px-1"><label className="flex items-center gap-2 text-[13.5px] font-medium"><input type="checkbox" name={`edu_use_${i}`} defaultChecked={!haveEdu.has(norm(`${e.school}|${e.degree ?? ""}`))} /> Entry {i + 1}</label></legend>
                  <div className="grid gap-2">
                    <input name={`edu_school_${i}`} defaultValue={e.school} className="field" aria-label="Institution" />
                    <div className="grid grid-cols-2 gap-2"><input name={`edu_degree_${i}`} defaultValue={e.degree ?? ""} className="field" placeholder="Degree" aria-label="Degree" /><input name={`edu_field_${i}`} defaultValue={e.field ?? ""} className="field" placeholder="Field" aria-label="Field" /></div>
                    <div className="grid grid-cols-2 gap-2"><input name={`edu_start_${i}`} type="number" defaultValue={e.startYear ?? ""} className="field" placeholder="Start year" aria-label="Start year" /><input name={`edu_end_${i}`} type="number" defaultValue={e.endYear ?? ""} className="field" placeholder="End year" aria-label="End year" /></div>
                  </div>
                </fieldset>
              ))}
            </div>
          </Panel>
          <Panel title={`Languages (${x.languages?.length ?? 0})`}>
            <input type="hidden" name="lang_count" value={x.languages?.length ?? 0} />
            {!x.languages?.length && <p className="text-[13px] text-muted">None detected.</p>}
            <div className="space-y-2">
              {(x.languages ?? []).map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="checkbox" name={`lang_use_${i}`} defaultChecked={!haveLang.has(norm(l.name))} aria-label={`Add ${l.name}`} />
                  <input name={`lang_name_${i}`} defaultValue={l.name} className="field" aria-label="Language" />
                  <input name={`lang_level_${i}`} defaultValue={l.level ?? ""} className="field" placeholder="Level" aria-label="Level" />
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton className="btn btn-accent" pendingText="Saving…">Save selected to my profile</SubmitButton>
          <span className="text-[13px] text-muted">A resume record with exactly what you approved is created, and your original file is kept for download.</span>
        </div>
      </ActionForm>
      <form action={discardImportAction.bind(null, id)} className="mt-4">
        <button className="btn btn-ghost btn-sm">Discard this import</button>
      </form>
    </>
  );
}

function CheckGroup({ title, name, items, have }: { title: string; name: string; items: string[]; have: Set<string> }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="eyebrow mb-1.5">{title} ({items.length})</p>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted">None detected.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((it) => {
            const dup = have.has(norm(it));
            return (
              <label key={it} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[13px]">
                <input type="checkbox" name={name} value={it} defaultChecked={!dup} />
                {it}
                {dup && <span className="text-[11px] text-muted">(have)</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
