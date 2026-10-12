import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { createProjectAction, updateProjectAction } from "@/app/actions/projects";
import { DISCIPLINES, LOD_LEVELS, SECTORS, softwareNames } from "@/lib/taxonomy";

export type ProjectFormData = {
  id: string;
  name: string;
  client: string | null;
  clientPublic: boolean;
  sector: string | null;
  discipline: string | null;
  role: string | null;
  software: string[];
  lod: string | null;
  scale: string | null;
  location: string | null;
  year: number | null;
  responsibilities: string | null;
  challenges: string | null;
  solutions: string | null;
  outcomes: string | null;
  description: string | null;
};

export function ProjectForm({ project }: { project?: ProjectFormData }) {
  const action = project ? updateProjectAction.bind(null, project.id) : createProjectAction;
  const k = project?.id ?? "new";
  return (
    <ActionForm action={action} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <datalist id={`sw-${k}`}>{softwareNames.map((s) => <option key={s} value={s} />)}</datalist>
      <Field label="Project name" htmlFor={`n-${k}`} className="sm:col-span-2"><input id={`n-${k}`} name="name" required defaultValue={project?.name} className="field" /></Field>
      <Field label="Client" htmlFor={`c-${k}`}><input id={`c-${k}`} name="client" defaultValue={project?.client ?? ""} className="field" /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-[13.5px]"><input type="checkbox" name="clientPublic" defaultChecked={project?.clientPublic} /> Show client name publicly</label>
      <Field label="Project type" htmlFor={`s-${k}`}><select id={`s-${k}`} name="sector" defaultValue={project?.sector ?? ""} className="field"><option value="">—</option>{SECTORS.map((x) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Discipline" htmlFor={`d-${k}`}><select id={`d-${k}`} name="discipline" defaultValue={project?.discipline ?? ""} className="field"><option value="">—</option>{DISCIPLINES.map((x) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Your role" htmlFor={`r-${k}`}><input id={`r-${k}`} name="role" defaultValue={project?.role ?? ""} className="field" placeholder="e.g. BIM Coordinator" /></Field>
      <Field label="LOD delivered" htmlFor={`l-${k}`}><select id={`l-${k}`} name="lod" defaultValue={project?.lod ?? ""} className="field"><option value="">—</option>{LOD_LEVELS.map((x) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Software" htmlFor={`sw-in-${k}`} hint="Comma separated"><input id={`sw-in-${k}`} name="software" list={`sw-${k}`} defaultValue={project?.software.join(", ")} className="field" /></Field>
      <Field label="Project scale" htmlFor={`sc-${k}`} hint="Area, value, floors, number of trades…"><input id={`sc-${k}`} name="scale" defaultValue={project?.scale ?? ""} className="field" placeholder="e.g. 85,000 m², 9 trades" /></Field>
      <Field label="Location" htmlFor={`lo-${k}`}><input id={`lo-${k}`} name="location" defaultValue={project?.location ?? ""} className="field" /></Field>
      <Field label="Year" htmlFor={`y-${k}`}><input id={`y-${k}`} name="year" type="number" min={1990} max={2100} defaultValue={project?.year ?? ""} className="field" /></Field>
      <Field label="Description" htmlFor={`de-${k}`} className="sm:col-span-2"><textarea id={`de-${k}`} name="description" rows={3} defaultValue={project?.description ?? ""} className="field" /></Field>
      <Field label="Your responsibilities" htmlFor={`re-${k}`} className="sm:col-span-2"><textarea id={`re-${k}`} name="responsibilities" rows={3} defaultValue={project?.responsibilities ?? ""} className="field" /></Field>
      <Field label="Challenges" htmlFor={`ch-${k}`}><textarea id={`ch-${k}`} name="challenges" rows={3} defaultValue={project?.challenges ?? ""} className="field" /></Field>
      <Field label="Solutions" htmlFor={`so-${k}`}><textarea id={`so-${k}`} name="solutions" rows={3} defaultValue={project?.solutions ?? ""} className="field" /></Field>
      <Field label="Outcomes" htmlFor={`ou-${k}`} className="sm:col-span-2"><textarea id={`ou-${k}`} name="outcomes" rows={3} defaultValue={project?.outcomes ?? ""} className="field" placeholder="Measurable results where you have them" /></Field>
      <div className="sm:col-span-2"><SubmitButton>{project ? "Save project" : "Create project"}</SubmitButton></div>
    </ActionForm>
  );
}
