import type { BIMProfessionalProfile, Language } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Panel } from "@/components/ui";
import { deleteLanguage, saveBimProfile, saveCareer, saveLanguage, savePreferences, savePrivacy } from "@/app/actions/profile-extended";
import { DISCIPLINES, EMPLOYMENT_TYPES, LOD_LEVELS, REMOTE_PREFS, BIM_SKILLS } from "@/lib/taxonomy";
import { readPrivacy } from "@/lib/services/public-profile";

const AVAILABILITY = ["Immediately", "Within 2 weeks", "Within 1 month", "Within 3 months", "Not currently available"];
const ROLE_SUGGESTIONS = ["BIM Coordinator", "BIM Modeler", "BIM Engineer", "BIM Manager", "Information Manager", "VDC Engineer", "Revit Specialist", "Computational Designer", "BIM Technician"];
const STANDARDS = BIM_SKILLS.filter((s) => s.category === "Standards").map((s) => s.name);

const Check = ({ name, value, checked, label }: { name: string; value: string; checked: boolean; label: string }) => (
  <label className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[13px]">
    <input type="checkbox" name={name} value={value} defaultChecked={checked} />
    {label}
  </label>
);

export function ExtendedSections({ profile: p, resumes }: { profile: BIMProfessionalProfile & { languages: Language[] }; resumes: { id: string; title: string }[] }) {
  const privacy = readPrivacy(p.privacy);
  return (
    <>
      <Panel id="career" title="Career" description="Context employers look for beyond your job list.">
        <ActionForm action={saveCareer} className="grid gap-4 sm:grid-cols-2">
          <Field label="Current role" htmlFor="currentRole"><input id="currentRole" name="currentRole" defaultValue={p.currentRole ?? ""} className="field" placeholder="e.g. Senior BIM Coordinator" /></Field>
          <Field label="Industries" htmlFor="industries" hint="Comma separated"><input id="industries" name="industries" defaultValue={p.industries.join(", ")} className="field" placeholder="Healthcare, Data centers" /></Field>
          <Field label="Project types" htmlFor="projectTypes" hint="Comma separated" className="sm:col-span-2"><input id="projectTypes" name="projectTypes" defaultValue={p.projectTypes.join(", ")} className="field" placeholder="Hospitals, Commercial towers, Rail" /></Field>
          <Field label="Key achievements" htmlFor="achievements" className="sm:col-span-2" hint="One per line, up to 10. Use real, measurable outcomes."><textarea id="achievements" name="achievements" rows={4} defaultValue={p.achievements.join("\n")} className="field" /></Field>
          <div className="sm:col-span-2"><SubmitButton className="btn btn-secondary">Save career</SubmitButton></div>
        </ActionForm>
      </Panel>

      <Panel id="bim" title="BIM expertise" description="Disciplines, roles, standards and where your experience sits.">
        <datalist id="roles-dl">{ROLE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}</datalist>
        <datalist id="std-dl">{STANDARDS.map((r) => <option key={r} value={r} />)}</datalist>
        <ActionForm action={saveBimProfile} className="space-y-4">
          <div>
            <p className="label">BIM disciplines</p>
            <div className="flex flex-wrap gap-2">{DISCIPLINES.map((d) => <Check key={d} name="bimDisciplines" value={d} checked={p.bimDisciplines.includes(d)} label={d} />)}</div>
          </div>
          <Field label="BIM roles you have held" htmlFor="bimRoles" hint="Comma separated"><input id="bimRoles" name="bimRoles" list="roles-dl" defaultValue={p.bimRoles.join(", ")} className="field" /></Field>
          <Field label="BIM responsibilities" htmlFor="bimResponsibilities" hint="One per line, e.g. “Ran weekly clash detection workshops”."><textarea id="bimResponsibilities" name="bimResponsibilities" rows={4} defaultValue={p.bimResponsibilities.join("\n")} className="field" /></Field>
          <Field label="BIM standards" htmlFor="bimStandards" hint="Comma separated, e.g. ISO 19650, COBie, IFC"><input id="bimStandards" name="bimStandards" list="std-dl" defaultValue={p.bimStandards.join(", ")} className="field" /></Field>
          <div>
            <p className="label">LOD experience</p>
            <div className="flex flex-wrap gap-2">{LOD_LEVELS.map((l) => <Check key={l} name="lodLevels" value={l} checked={p.lodLevels.includes(l)} label={l} />)}</div>
          </div>
          <div>
            <p className="label">Years of experience by area</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([["infoMgmtYears", "Information mgmt", p.infoMgmtYears], ["coordinationYears", "Coordination", p.coordinationYears], ["modelingYears", "Modelling", p.modelingYears], ["vdcYears", "VDC", p.vdcYears]] as const).map(([n, l, v]) => (
                <Field key={n} label={l} htmlFor={n}><input id={n} name={n} type="number" min={0} max={60} defaultValue={v ?? ""} className="field" /></Field>
              ))}
            </div>
          </div>
          <SubmitButton className="btn btn-secondary">Save BIM expertise</SubmitButton>
        </ActionForm>
      </Panel>

      <Panel id="languages" title="Languages">
        <div className="mb-4 flex flex-wrap gap-2">
          {p.languages.length === 0 && <p className="text-[13px] text-muted">No languages yet.</p>}
          {p.languages.map((l) => (
            <form key={l.id} action={deleteLanguage.bind(null, l.id)} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface py-0.5 pl-2 pr-0.5 text-[13px]">
              {l.name}{l.level ? <span className="text-muted"> · {l.level}</span> : null}
              <button className="rounded px-1.5 text-muted hover:bg-sunken hover:text-bad" aria-label={`Remove ${l.name}`}>×</button>
            </form>
          ))}
        </div>
        <ActionForm action={saveLanguage} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end" resetOnSuccess>
          <Field label="Language" htmlFor="lang-name"><input id="lang-name" name="name" required className="field" /></Field>
          <Field label="Level" htmlFor="lang-level"><select id="lang-level" name="level" className="field"><option value="">—</option>{["Native", "Fluent", "Professional", "Intermediate", "Basic"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <SubmitButton className="btn btn-secondary" pendingText="Adding…">Add</SubmitButton>
        </ActionForm>
      </Panel>

      <Panel id="preferences" title="Career preferences" description="Used for matching. Minimum salary is private — never shown publicly.">
        <ActionForm action={savePreferences} className="grid gap-4 sm:grid-cols-2">
          <Field label="Preferred roles" htmlFor="preferredRoles" hint="Comma separated"><input id="preferredRoles" name="preferredRoles" list="roles-dl" defaultValue={p.preferredRoles.join(", ")} className="field" /></Field>
          <Field label="Preferred locations" htmlFor="preferredLocations" hint="Comma separated"><input id="preferredLocations" name="preferredLocations" defaultValue={p.preferredLocations.join(", ")} className="field" /></Field>
          <Field label="Work arrangement" htmlFor="remotePreference"><select id="remotePreference" name="remotePreference" defaultValue={p.remotePreference ?? ""} className="field"><option value="">No preference</option>{REMOTE_PREFS.map((d) => <option key={d}>{d}</option>)}</select></Field>
          <Field label="Availability" htmlFor="availability"><select id="availability" name="availability" defaultValue={p.availability ?? ""} className="field"><option value="">—</option>{AVAILABILITY.map((d) => <option key={d}>{d}</option>)}</select></Field>
          <div className="sm:col-span-2"><p className="label">Employment type</p><div className="flex flex-wrap gap-2">{EMPLOYMENT_TYPES.map((t) => <Check key={t} name="employmentTypes" value={t} checked={p.employmentTypes.includes(t)} label={t} />)}</div></div>
          <Field label="Minimum salary (yearly)" htmlFor="minSalary"><input id="minSalary" name="minSalary" type="number" min={0} defaultValue={p.minSalary ?? ""} className="field" /></Field>
          <Field label="Currency" htmlFor="salaryCurrency"><input id="salaryCurrency" name="salaryCurrency" maxLength={3} defaultValue={p.salaryCurrency ?? ""} className="field uppercase" placeholder="USD" /></Field>
          <div className="sm:col-span-2"><SubmitButton className="btn btn-secondary">Save preferences</SubmitButton></div>
        </ActionForm>
      </Panel>

      <Panel id="privacy" title="Public profile privacy" description="Applies when your profile is public. Email, phone and salary are never shown.">
        <ActionForm action={savePrivacy} className="space-y-3">
          <label className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" name="hideLocation" defaultChecked={privacy.hideLocation} className="mt-1" /> Show country only (hide city / region)</label>
          <label className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" name="showAchievements" defaultChecked={privacy.showAchievements} className="mt-1" /> Show key achievements</label>
          <label className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" name="showPreferences" defaultChecked={privacy.showPreferences} className="mt-1" /> Show preferred roles, locations and availability</label>
          <label className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" name="showResume" defaultChecked={privacy.showResume} className="mt-1" /> Show a resume on my public profile (without contact details)</label>
          <Field label="Resume to show" htmlFor="publicResumeId">
            <select id="publicResumeId" name="publicResumeId" defaultValue={p.publicResumeId ?? ""} className="field"><option value="">None</option>{resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
          </Field>
          <SubmitButton className="btn btn-secondary">Save privacy</SubmitButton>
        </ActionForm>
      </Panel>
    </>
  );
}
