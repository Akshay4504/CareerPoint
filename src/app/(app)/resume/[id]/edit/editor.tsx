"use client";

import { useMemo, useState, useTransition } from "react";
import { ResumeView } from "@/components/resume-view";
import { saveResumeEditor } from "@/app/actions/builder";
import { DEFAULT_ORDER, SECTION_KEYS, TEMPLATES, layoutOf, type ResumeContent, type ResumeExperience, type ResumeProject } from "@/lib/resume/types";

export type MasterOptions = {
  software: string[];
  skills: string[];
  certifications: string[];
  educations: ResumeContent["educations"];
  languages: { name: string; level?: string }[];
  portfolio: { id: string; title: string; description?: string; url?: string }[];
};

const SECTION_TITLES: Record<string, string> = { summary: "Summary", experience: "Experience", software: "BIM software", skills: "Skills & standards", projects: "Projects", portfolio: "Portfolio", certifications: "Certifications", education: "Education", languages: "Languages" };

const move = <T,>(arr: T[], i: number, d: number) => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export function ResumeEditor({ resumeId, initial, master, title, version }: { resumeId: string; initial: ResumeContent; master: MasterOptions; title: string; version: number }) {
  const [c, setC] = useState<ResumeContent>({ ...initial, languages: initial.languages ?? [], customSections: initial.customSections ?? [], portfolio: initial.portfolio ?? [], layout: layoutOf(initial) });
  const [status, setStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [newSection, setNewSection] = useState("");
  const [customTitle, setCustomTitle] = useState("");

  const set = (patch: Partial<ResumeContent>) => {
    setC((p) => ({ ...p, ...patch }));
    setDirty(true);
    setStatus(null);
  };
  const layout = layoutOf(c);
  const setLayout = (patch: Partial<typeof layout>) => set({ layout: { ...layout, ...patch } });
  const hidden = SECTION_KEYS.filter((k) => !layout.order.includes(k));

  const updateExp = (i: number, patch: Partial<ResumeExperience>) => set({ experiences: c.experiences.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const updateProj = (i: number, patch: Partial<ResumeProject>) => set({ projects: c.projects.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const payload = useMemo(() => JSON.stringify(c), [c]);
  const save = (label?: string) =>
    start(async () => {
      const r = await saveResumeEditor(resumeId, payload, label);
      if (r.ok) {
        setDirty(false);
        setStatus({ kind: "ok", msg: `Saved as a new version. Score: ${r.score}/100.` });
      } else setStatus({ kind: "error", msg: r.error ?? "Could not save." });
    });

  const input = "field";
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,520px)_1fr]">
      <div className="no-print space-y-5">
        <div className="panel sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-medium">{title}</p>
            <p className="text-[12px] text-muted">v{version}{dirty ? " · unsaved changes" : ""}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}>Export PDF</button>
            <button type="button" className="btn btn-accent btn-sm" disabled={pending || !dirty} onClick={() => save()}>{pending ? "Saving…" : "Save version"}</button>
          </div>
          {status && <p role={status.kind === "error" ? "alert" : "status"} className={`w-full text-[13px] ${status.kind === "error" ? "text-bad" : "text-ok"}`}>{status.msg}</p>}
        </div>

        <Block title="Template & sections">
          <label className="label" htmlFor="tpl">Template</label>
          <select id="tpl" className={input} value={layout.template} onChange={(e) => setLayout({ template: e.target.value })}>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label} — {t.note}</option>)}
          </select>
          <p className="label mt-4">Section order <span className="font-normal text-muted">(sections not listed are hidden)</span></p>
          <ol className="space-y-1">
            {layout.order.map((k, i) => (
              <li key={k} className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[13px]">
                <span className="flex-1">{k.startsWith("custom:") ? (c.customSections ?? []).find((s) => s.id === k.slice(7))?.title ?? "Custom" : SECTION_TITLES[k]}</span>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move ${k} up`} disabled={i === 0} onClick={() => setLayout({ order: move(layout.order, i, -1) })}>↑</button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move ${k} down`} disabled={i === layout.order.length - 1} onClick={() => setLayout({ order: move(layout.order, i, 1) })}>↓</button>
                <button type="button" className="btn btn-ghost btn-sm text-bad" aria-label={`Remove ${k}`} onClick={() => setLayout({ order: layout.order.filter((x) => x !== k) })}>Remove</button>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label className="label" htmlFor="addsec">Add section</label>
              <select id="addsec" className={input} value={newSection} onChange={(e) => setNewSection(e.target.value)}>
                <option value="">Choose…</option>
                {hidden.map((k) => <option key={k} value={k}>{SECTION_TITLES[k]}</option>)}
                <option value="__custom">Custom section…</option>
              </select>
            </div>
            {newSection === "__custom" && <input className={`${input} flex-1`} placeholder="Section title" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} aria-label="Custom section title" />}
            <button type="button" className="btn btn-secondary btn-sm" disabled={!newSection || (newSection === "__custom" && !customTitle.trim())} onClick={() => {
              if (newSection === "__custom") {
                const id = `s${Date.now().toString(36)}`;
                set({ customSections: [...(c.customSections ?? []), { id, title: customTitle.trim(), body: "" }], layout: { ...layout, order: [...layout.order, `custom:${id}`] } });
                setCustomTitle("");
              } else setLayout({ order: [...layout.order, newSection] });
              setNewSection("");
            }}>Add</button>
          </div>
        </Block>

        <Block title="Header & summary">
          <label className="label" htmlFor="hl">Headline</label>
          <input id="hl" className={input} value={c.headline ?? ""} maxLength={140} onChange={(e) => set({ headline: e.target.value })} />
          <label className="label mt-3" htmlFor="sm">Summary</label>
          <textarea id="sm" className={input} rows={5} maxLength={2000} value={c.summary ?? ""} onChange={(e) => set({ summary: e.target.value })} />
          <p className="mt-1 text-[12px] text-muted">{(c.summary ?? "").split(/\s+/).filter(Boolean).length} words · 40–80 is typical.</p>
        </Block>

        <Block title="Experience">
          <div className="space-y-3">
            {c.experiences.map((e, i) => (
              <div key={i} className="rounded-md border border-line p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className={input} aria-label="Title" placeholder="Title" value={e.title} onChange={(ev) => updateExp(i, { title: ev.target.value })} />
                  <input className={input} aria-label="Company" placeholder="Company" value={e.company} onChange={(ev) => updateExp(i, { company: ev.target.value })} />
                  <input className={input} type="month" aria-label="Start" value={e.startDate ?? ""} onChange={(ev) => updateExp(i, { startDate: ev.target.value || undefined })} />
                  <input className={input} type="month" aria-label="End" disabled={e.current} value={e.endDate ?? ""} onChange={(ev) => updateExp(i, { endDate: ev.target.value || undefined })} />
                </div>
                <label className="mt-2 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!e.current} onChange={(ev) => updateExp(i, { current: ev.target.checked, endDate: ev.target.checked ? undefined : e.endDate })} /> Current role</label>
                <label className="label mt-2" htmlFor={`d${i}`}>Responsibilities &amp; achievements (one per line)</label>
                <textarea id={`d${i}`} className={input} rows={5} value={e.description ?? ""} onChange={(ev) => updateExp(i, { description: ev.target.value })} />
                <div className="mt-2 flex gap-1.5">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => set({ experiences: move(c.experiences, i, -1) })}>↑ Move up</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === c.experiences.length - 1} onClick={() => set({ experiences: move(c.experiences, i, 1) })}>↓ Move down</button>
                  <button type="button" className="btn btn-ghost btn-sm text-bad" onClick={() => set({ experiences: c.experiences.filter((_, j) => j !== i) })}>Remove role</button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => set({ experiences: [...c.experiences, { title: "", company: "", description: "" }] })}>+ Add role</button>
        </Block>

        <Block title="Projects">
          <div className="space-y-3">
            {c.projects.map((p, i) => (
              <div key={i} className="rounded-md border border-line p-3">
                <input className={input} aria-label="Project name" placeholder="Project name" value={p.name} onChange={(e) => updateProj(i, { name: e.target.value })} />
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input className={input} aria-label="Role" placeholder="Role" value={p.role ?? ""} onChange={(e) => updateProj(i, { role: e.target.value })} />
                  <input className={input} aria-label="Sector" placeholder="Sector" value={p.sector ?? ""} onChange={(e) => updateProj(i, { sector: e.target.value })} />
                  <input className={input} aria-label="LOD" placeholder="LOD" value={p.lod ?? ""} onChange={(e) => updateProj(i, { lod: e.target.value })} />
                  <input className={input} aria-label="Scale" placeholder="Scale / value" value={p.scale ?? ""} onChange={(e) => updateProj(i, { scale: e.target.value })} />
                </div>
                <textarea className={`${input} mt-2`} rows={3} aria-label="Project description" placeholder="Description" value={p.description ?? ""} onChange={(e) => updateProj(i, { description: e.target.value })} />
                <div className="mt-2 flex gap-1.5">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => set({ projects: move(c.projects, i, -1) })}>↑</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === c.projects.length - 1} onClick={() => set({ projects: move(c.projects, i, 1) })}>↓</button>
                  <button type="button" className="btn btn-ghost btn-sm text-bad" onClick={() => set({ projects: c.projects.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => set({ projects: [...c.projects, { name: "" }] })}>+ Add project</button>
        </Block>

        <Block title="Select skills & software" hint="Pick from your master profile. Only things you've added to your profile appear here.">
          <Chips title="BIM software" options={master.software} selected={c.software} onToggle={(v) => set({ software: toggle(c.software, v) })} />
          <Chips title="Skills & standards" options={master.skills} selected={c.skills} onToggle={(v) => set({ skills: toggle(c.skills, v) })} />
          <Chips title="Certifications" options={master.certifications} selected={c.certifications} onToggle={(v) => set({ certifications: toggle(c.certifications, v) })} />
          <p className="eyebrow mb-1.5 mt-3">Education</p>
          <div className="space-y-1">
            {master.educations.length === 0 && <p className="text-[13px] text-muted">No education on your profile.</p>}
            {master.educations.map((e) => {
              const on = c.educations.some((x) => x.school === e.school && x.degree === e.degree);
              return <label key={`${e.school}${e.degree}`} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={on} onChange={() => set({ educations: on ? c.educations.filter((x) => !(x.school === e.school && x.degree === e.degree)) : [...c.educations, e] })} /> {e.school} <span className="text-muted">{[e.degree, e.endYear].filter(Boolean).join(" · ")}</span></label>;
            })}
          </div>
          <p className="eyebrow mb-1.5 mt-3">Languages</p>
          <div className="flex flex-wrap gap-2">
            {master.languages.length === 0 && <p className="text-[13px] text-muted">No languages on your profile.</p>}
            {master.languages.map((l) => {
              const on = (c.languages ?? []).some((x) => x.name === l.name);
              return <label key={l.name} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[13px]"><input type="checkbox" checked={on} onChange={() => set({ languages: on ? (c.languages ?? []).filter((x) => x.name !== l.name) : [...(c.languages ?? []), l] })} />{l.name}{l.level ? ` (${l.level})` : ""}</label>;
            })}
          </div>
        </Block>

        <Block title="Portfolio items">
          {master.portfolio.length === 0 ? <p className="text-[13px] text-muted">No portfolio items yet. Add projects in your portfolio.</p> : (
            <div className="space-y-1">
              {master.portfolio.map((p) => {
                const on = (c.portfolio ?? []).some((x) => x.id === p.id);
                return <label key={p.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={on} onChange={() => set({ portfolio: on ? (c.portfolio ?? []).filter((x) => x.id !== p.id) : [...(c.portfolio ?? []), p] })} />{p.title}</label>;
              })}
            </div>
          )}
        </Block>

        {(c.customSections ?? []).length > 0 && (
          <Block title="Custom sections">
            <div className="space-y-3">
              {(c.customSections ?? []).map((s, i) => (
                <div key={s.id}>
                  <div className="mb-1 flex items-center justify-between"><label className="label mb-0" htmlFor={`cs${s.id}`}>{s.title}</label><button type="button" className="btn btn-ghost btn-sm text-bad" onClick={() => set({ customSections: (c.customSections ?? []).filter((x) => x.id !== s.id), layout: { ...layout, order: layout.order.filter((k) => k !== `custom:${s.id}`) } })}>Delete</button></div>
                  <textarea id={`cs${s.id}`} className={input} rows={4} value={s.body} onChange={(e) => set({ customSections: (c.customSections ?? []).map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
                </div>
              ))}
            </div>
          </Block>
        )}
      </div>

      <div>
        <p className="no-print eyebrow mb-2">Live preview · {TEMPLATES.find((t) => t.id === layout.template)?.label}</p>
        <div className="panel overflow-hidden bg-white p-6 print:border-0 print:p-0">
          <ResumeView content={c} />
        </div>
      </div>
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <header className="border-b border-line px-4 py-2.5"><h2 className="text-[14px]">{title}</h2>{hint && <p className="text-[12px] text-muted">{hint}</p>}</header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Chips({ title, options, selected, onToggle }: { title: string; options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  const all = Array.from(new Set([...options, ...selected]));
  return (
    <div className="mb-3">
      <p className="eyebrow mb-1.5">{title}</p>
      {all.length === 0 ? <p className="text-[13px] text-muted">None on your profile yet.</p> : (
        <div className="flex flex-wrap gap-1.5">
          {all.map((o) => {
            const on = selected.includes(o);
            return <button key={o} type="button" aria-pressed={on} onClick={() => onToggle(o)} className={`rounded-md border px-2 py-0.5 text-[12.5px] ${on ? "border-accent bg-accent-soft font-medium text-accent-strong" : "border-line-strong text-ink-2"}`}>{o}</button>;
          })}
        </div>
      )}
    </div>
  );
}

export { DEFAULT_ORDER };
