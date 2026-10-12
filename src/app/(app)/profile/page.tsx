import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { ensureProfile, profileCompleteness } from "@/lib/services/profile";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Field, Meter, PageHeader, Panel } from "@/components/ui";
import { DISCIPLINES, skillNames, softwareNames } from "@/lib/taxonomy";
import { formatMonth, humanize, toYm } from "@/lib/utils";
import { ExtendedSections } from "./sections";
import { ShareProfile } from "./share-profile";
import { listShares } from "@/lib/profile-share";
import { revokeShareAction } from "@/app/actions/access";
import { absoluteUrl } from "@/lib/seo";
import { timeAgo } from "@/lib/utils";
import { addSkills, deleteCertification, deleteEducation, deleteExperience, deleteSoftware, regenerateSlug, removeAvatar, removeSkill, saveBasics, saveCertification, saveEducation, saveExperience, saveSoftware, uploadAvatar } from "@/app/actions/profile";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireArea("app");
  const base = await ensureProfile(user);
  const { percent, checks } = await profileCompleteness(base.id);
  const p = await db.bIMProfessionalProfile.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      experiences: { orderBy: [{ current: "desc" }, { startDate: "desc" }] },
      educations: { orderBy: { endYear: "desc" } },
      skills: { include: { skill: true }, orderBy: { skill: { name: "asc" } } },
      softwareSkills: { orderBy: { software: "asc" } },
      certifications: true,
      languages: true,
      projects: { orderBy: { year: "desc" } },
    },
  });
  const shares = p.visibility === "PRIVATE" ? await listShares(user.id) : [];
  const missing = checks.filter((c) => !c.done);
  const resumes = await db.resume.findMany({ where: { profileId: p.id }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" } });

  return (
    <>
      <PageHeader
        title="Your BIM profile"
        description="The single source for your resume, matches and applications. Changes here update everything else."
        actions={p.visibility === "PUBLIC" ? <Link href={`/professionals/${p.slug}`} className="btn btn-secondary btn-sm">View public profile</Link> : <Badge>Private</Badge>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Share your profile" description={p.visibility === "PUBLIC" ? "Public: anyone with the link can view it." : "Private: viewers verify their email first."}>
            <ShareProfile visibility={p.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE"} publicUrl={absoluteUrl(`/professionals/${p.slug}`)} />
            {shares.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="eyebrow mb-2">Your share links</p>
                <ul className="space-y-2.5 text-[13px]">
                  {shares.map((sh) => {
                    const expired = !!sh.expiresAt && sh.expiresAt < new Date();
                    return (
                      <li key={sh.id} className="rounded-md border border-line p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium">{sh.label ?? (sh.recipientEmail ? `For ${sh.recipientEmail}` : "Open link")}{sh.revokedAt ? " · revoked" : expired ? " · expired" : ""}</p>
                            <p className="text-muted">Created {timeAgo(sh.createdAt)} · {sh.viewCount} {sh.viewCount === 1 ? "view" : "views"}{sh.recipientEmail ? ` · restricted to ${sh.recipientEmail}` : ""}</p>
                            {sh.accesses.length > 0 && <p className="mt-0.5 text-muted">Opened by {sh.accesses.map((a) => a.email).filter((v, i, arr) => arr.indexOf(v) === i).join(", ")}</p>}
                          </div>
                          {!sh.revokedAt && !expired && <form action={revokeShareAction.bind(null, sh.id)}><ConfirmButton message="Revoke this link? Anyone holding it will lose access." className="text-[12.5px] text-bad underline">Revoke</ConfirmButton></form>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Panel>
          <Panel title="Basics">
            <div className="mb-5 flex items-center gap-4">
              <Avatar name={user.name} src={p.avatarFileId ? `/api/files/${p.avatarFileId}` : null} size={56} />
              <div className="min-w-0 flex-1">
                <ActionForm action={uploadAvatar} className="flex flex-wrap items-center gap-2" encType="multipart/form-data">
                  <input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="max-w-full text-[13px] file:mr-2 file:rounded-md file:border file:border-line-strong file:bg-bg file:px-2.5 file:py-1 file:text-[13px]" aria-label="Profile photo" required />
                  <SubmitButton className="btn btn-secondary btn-sm" pendingText="Uploading…">Upload photo</SubmitButton>
                </ActionForm>
                <p className="mt-1 text-[12px] text-muted">PNG, JPG or WebP up to 2 MB. Shown only when your profile is public.</p>
              </div>
              {p.avatarFileId && <form action={removeAvatar}><button className="btn btn-ghost btn-sm">Remove</button></form>}
            </div>
            <ActionForm action={saveBasics} className="grid gap-4 sm:grid-cols-2">
              <Field label="Headline" htmlFor="headline" className="sm:col-span-2" hint="e.g. BIM Coordinator | MEP | Revit & Navisworks"><input id="headline" name="headline" defaultValue={p.headline ?? ""} maxLength={140} className="field" /></Field>
              <Field label="Summary" htmlFor="summary" className="sm:col-span-2" hint="40–80 words: discipline, years of experience, key software."><textarea id="summary" name="summary" rows={4} defaultValue={p.summary ?? ""} maxLength={2000} className="field" /></Field>
              <Field label="Location" htmlFor="location"><input id="location" name="location" defaultValue={p.location ?? ""} placeholder="City, Country" className="field" /></Field>
              <Field label="City" htmlFor="city"><input id="city" name="city" defaultValue={p.city ?? ""} className="field" /></Field>
              <Field label="Country" htmlFor="country"><input id="country" name="country" defaultValue={p.country ?? ""} className="field" /></Field>
              <Field label="Discipline" htmlFor="discipline">
                <select id="discipline" name="discipline" defaultValue={p.discipline ?? ""} className="field"><option value="">Select…</option>{DISCIPLINES.map((d) => <option key={d}>{d}</option>)}</select>
              </Field>
              <Field label="Years of experience" htmlFor="yearsExperience"><input id="yearsExperience" name="yearsExperience" type="number" min={0} max={60} defaultValue={p.yearsExperience ?? ""} className="field" /></Field>
              <Field label="Target role" htmlFor="desiredRole"><input id="desiredRole" name="desiredRole" defaultValue={p.desiredRole ?? ""} placeholder="e.g. BIM Manager" className="field" /></Field>
              <div className="space-y-2 sm:col-span-2">
                <label className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" name="openToWork" defaultChecked={p.openToWork} className="mt-1" /><span><strong className="font-medium">Open to work</strong><br /><span className="text-muted">Verified employers can see this on your public profile.</span></span></label>
                <label className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" name="visibility" value="PUBLIC" defaultChecked={p.visibility === "PUBLIC"} className="mt-1" /><span><strong className="font-medium">Public profile</strong><br /><span className="text-muted">Visible at /professionals/{p.slug}. Your email, phone and resume files are never shown.</span></span></label>
              </div>
              <div className="sm:col-span-2"><SubmitButton>Save basics</SubmitButton></div>
            </ActionForm>
          </Panel>

          <Panel id="software" title="BIM software" description="Used for resume scoring and job matching.">
            <datalist id="sw-list">{softwareNames.map((s) => <option key={s} value={s} />)}</datalist>
            <div className="mb-4 flex flex-wrap gap-2">
              {p.softwareSkills.length === 0 && <p className="text-[13px] text-muted">No software yet.</p>}
              {p.softwareSkills.map((s) => (
                <form key={s.id} action={deleteSoftware.bind(null, s.id)} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface py-0.5 pl-2 pr-0.5 text-[13px]">
                  {s.software} <span className="text-muted">· {humanize(s.level)}{s.years != null ? ` · ${s.years}y` : ""}</span>
                  <button className="rounded px-1.5 text-muted hover:bg-sunken hover:text-bad" aria-label={`Remove ${s.software}`}>×</button>
                </form>
              ))}
            </div>
            <ActionForm action={saveSoftware} className="grid gap-3 sm:grid-cols-[2fr_1fr_90px_auto] sm:items-end" resetOnSuccess>
              <Field label="Software (comma separated)" htmlFor="software-input"><input id="software-input" name="software" list="sw-list" placeholder="Revit, Navisworks" className="field" required /></Field>
              <Field label="Level" htmlFor="level"><select id="level" name="level" defaultValue="ADVANCED" className="field">{["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"].map((l) => <option key={l} value={l}>{humanize(l)}</option>)}</select></Field>
              <Field label="Years" htmlFor="years"><input id="years" name="years" type="number" min={0} max={60} className="field" /></Field>
              <SubmitButton className="btn btn-secondary" pendingText="Adding…">Add</SubmitButton>
            </ActionForm>
          </Panel>

          <Panel id="skills" title="BIM skills & standards">
            <datalist id="sk-list">{skillNames.map((s) => <option key={s} value={s} />)}</datalist>
            <div className="mb-4 flex flex-wrap gap-2">
              {p.skills.length === 0 && <p className="text-[13px] text-muted">No skills yet.</p>}
              {p.skills.map((s) => (
                <form key={s.skillId} action={removeSkill.bind(null, s.skillId)} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface py-0.5 pl-2 pr-0.5 text-[13px]">
                  {s.skill.name}
                  <button className="rounded px-1.5 text-muted hover:bg-sunken hover:text-bad" aria-label={`Remove ${s.skill.name}`}>×</button>
                </form>
              ))}
            </div>
            <ActionForm action={addSkills} className="flex flex-wrap items-end gap-3" resetOnSuccess>
              <Field label="Skills (comma separated)" htmlFor="skills-input" className="min-w-[240px] flex-1"><input id="skills-input" name="skills" list="sk-list" placeholder="Clash Detection, ISO 19650" className="field" required /></Field>
              <SubmitButton className="btn btn-secondary" pendingText="Adding…">Add</SubmitButton>
            </ActionForm>
          </Panel>

          <Panel id="experience" title="Experience">
            <div className="space-y-3">
              {p.experiences.length === 0 && <p className="text-[13px] text-muted">No experience yet. Upload a resume to import it, or add roles manually.</p>}
              {p.experiences.map((e) => (
                <details key={e.id} className="rounded-md border border-line">
                  <summary className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <span>
                      <span className="block font-medium">{e.title}</span>
                      <span className="block text-[13px] text-muted">{e.company} · {formatMonth(e.startDate)} – {e.current ? "Present" : formatMonth(e.endDate) || "—"}</span>
                    </span>
                    <span className="text-[12px] text-muted">Edit</span>
                  </summary>
                  <div className="border-t border-line p-3">
                    <ExperienceForm exp={{ id: e.id, title: e.title, company: e.company, location: e.location ?? "", startDate: toYm(e.startDate), endDate: toYm(e.endDate), current: e.current, description: e.description ?? "" }} />
                    <form action={deleteExperience.bind(null, e.id)} className="mt-2"><ConfirmButton message="Delete this role?">Delete role</ConfirmButton></form>
                  </div>
                </details>
              ))}
              <details className="rounded-md border border-dashed border-line-strong">
                <summary className="px-3 py-2.5 text-[13.5px] font-medium">+ Add experience</summary>
                <div className="border-t border-line p-3"><ExperienceForm /></div>
              </details>
            </div>
          </Panel>

          <Panel id="projects" title="Projects" description="Projects live in your portfolio, where you can add images and publish them.">
            <p className="text-[13.5px] text-ink-2">{p.projects.length} {p.projects.length === 1 ? "project" : "projects"} · {p.projects.filter((x) => x.published).length} published.</p>
            <Link href="/portfolio" className="btn btn-secondary btn-sm mt-3">Manage projects</Link>
          </Panel>

          <ExtendedSections profile={p} resumes={resumes} />

          <Panel id="education" title="Education">
            <div className="space-y-3">
              {p.educations.length === 0 && <p className="text-[13px] text-muted">No education yet.</p>}
              {p.educations.map((e) => (
                <details key={e.id} className="rounded-md border border-line">
                  <summary className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <span>
                      <span className="block font-medium">{e.school}</span>
                      <span className="block text-[13px] text-muted">{[e.degree, e.field, e.endYear].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="text-[12px] text-muted">Edit</span>
                  </summary>
                  <div className="border-t border-line p-3">
                    <EducationForm edu={e} />
                    <form action={deleteEducation.bind(null, e.id)} className="mt-2"><ConfirmButton message="Delete this entry?">Delete</ConfirmButton></form>
                  </div>
                </details>
              ))}
              <details className="rounded-md border border-dashed border-line-strong">
                <summary className="px-3 py-2.5 text-[13.5px] font-medium">+ Add education</summary>
                <div className="border-t border-line p-3"><EducationForm /></div>
              </details>
            </div>
          </Panel>

          <Panel id="certifications" title="Certifications">
            <div className="space-y-3">
              {p.certifications.length === 0 && <p className="text-[13px] text-muted">No certifications yet.</p>}
              {p.certifications.map((c) => (
                <details key={c.id} className="rounded-md border border-line">
                  <summary className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <span>
                      <span className="block font-medium">{c.name}</span>
                      <span className="block text-[13px] text-muted">{[c.issuer, formatMonth(c.issuedAt)].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="text-[12px] text-muted">Edit</span>
                  </summary>
                  <div className="border-t border-line p-3">
                    <CertForm cert={{ ...c, issuedAt: toYm(c.issuedAt), expiresAt: toYm(c.expiresAt) }} />
                    <form action={deleteCertification.bind(null, c.id)} className="mt-2"><ConfirmButton message="Delete this certification?">Delete</ConfirmButton></form>
                  </div>
                </details>
              ))}
              <details className="rounded-md border border-dashed border-line-strong">
                <summary className="px-3 py-2.5 text-[13.5px] font-medium">+ Add certification</summary>
                <div className="border-t border-line p-3"><CertForm /></div>
              </details>
            </div>
          </Panel>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Panel title="Completeness">
            <p className="text-[26px] font-semibold tabular-nums leading-none">{percent}%</p>
            <div className="mt-3"><Meter value={percent} label="Profile completeness" /></div>
            {missing.length > 0 ? (
              <ul className="mt-4 space-y-1.5 text-[13px]">
                {missing.slice(0, 6).map((m) => <li key={m.key}><Link href={m.href} className="text-ink-2 hover:text-ink hover:underline">+ {m.label}</Link></li>)}
              </ul>
            ) : <p className="mt-3 text-[13px] text-ok">Your profile is complete.</p>}
          </Panel>
          <Panel title="Public link">
            <p className="break-all font-mono text-[12px] text-muted">/professionals/{p.slug}</p>
            <form action={regenerateSlug} className="mt-2"><button className="btn btn-ghost btn-sm">Regenerate link</button></form>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function ExperienceForm({ exp }: { exp?: { id: string; title: string; company: string; location: string; startDate: string; endDate: string; current: boolean; description: string } }) {
  return (
    <ActionForm action={saveExperience} className="grid gap-3 sm:grid-cols-2" resetOnSuccess={!exp}>
      {exp && <input type="hidden" name="id" value={exp.id} />}
      <Field label="Job title" htmlFor={`t-${exp?.id ?? "new"}`}><input id={`t-${exp?.id ?? "new"}`} name="title" defaultValue={exp?.title} required className="field" /></Field>
      <Field label="Company" htmlFor={`c-${exp?.id ?? "new"}`}><input id={`c-${exp?.id ?? "new"}`} name="company" defaultValue={exp?.company} required className="field" /></Field>
      <Field label="Location" htmlFor={`l-${exp?.id ?? "new"}`}><input id={`l-${exp?.id ?? "new"}`} name="location" defaultValue={exp?.location} className="field" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start" htmlFor={`s-${exp?.id ?? "new"}`}><input id={`s-${exp?.id ?? "new"}`} type="month" name="startDate" defaultValue={exp?.startDate} className="field" /></Field>
        <Field label="End" htmlFor={`e-${exp?.id ?? "new"}`}><input id={`e-${exp?.id ?? "new"}`} type="month" name="endDate" defaultValue={exp?.endDate} className="field" /></Field>
      </div>
      <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" name="current" defaultChecked={exp?.current} /> I currently work here</label>
      <Field label="Achievements" htmlFor={`d-${exp?.id ?? "new"}`} className="sm:col-span-2" hint="One bullet per line. Quantify: models, m², clashes resolved, hours saved."><textarea id={`d-${exp?.id ?? "new"}`} name="description" rows={5} defaultValue={exp?.description} className="field" /></Field>
      <div className="sm:col-span-2"><SubmitButton className="btn btn-secondary">{exp ? "Save changes" : "Add role"}</SubmitButton></div>
    </ActionForm>
  );
}

function EducationForm({ edu }: { edu?: { id: string; school: string; degree: string | null; field: string | null; startYear: number | null; endYear: number | null } }) {
  const k = edu?.id ?? "new";
  return (
    <ActionForm action={saveEducation} className="grid gap-3 sm:grid-cols-2" resetOnSuccess={!edu}>
      {edu && <input type="hidden" name="id" value={edu.id} />}
      <Field label="Institution" htmlFor={`es-${k}`} className="sm:col-span-2"><input id={`es-${k}`} name="school" defaultValue={edu?.school} required className="field" /></Field>
      <Field label="Degree" htmlFor={`ed-${k}`}><input id={`ed-${k}`} name="degree" defaultValue={edu?.degree ?? ""} className="field" /></Field>
      <Field label="Field of study" htmlFor={`ef-${k}`}><input id={`ef-${k}`} name="field" defaultValue={edu?.field ?? ""} className="field" /></Field>
      <Field label="Start year" htmlFor={`ey-${k}`}><input id={`ey-${k}`} name="startYear" type="number" defaultValue={edu?.startYear ?? ""} className="field" /></Field>
      <Field label="End year" htmlFor={`ee-${k}`}><input id={`ee-${k}`} name="endYear" type="number" defaultValue={edu?.endYear ?? ""} className="field" /></Field>
      <div className="sm:col-span-2"><SubmitButton className="btn btn-secondary">{edu ? "Save changes" : "Add education"}</SubmitButton></div>
    </ActionForm>
  );
}

function CertForm({ cert }: { cert?: { id: string; name: string; issuer: string | null; issuedAt: string; expiresAt: string; credentialUrl: string | null } }) {
  const k = cert?.id ?? "new";
  return (
    <ActionForm action={saveCertification} className="grid gap-3 sm:grid-cols-2" resetOnSuccess={!cert}>
      {cert && <input type="hidden" name="id" value={cert.id} />}
      <Field label="Certification" htmlFor={`cn-${k}`} className="sm:col-span-2"><input id={`cn-${k}`} name="name" defaultValue={cert?.name} required className="field" /></Field>
      <Field label="Issuer" htmlFor={`ci-${k}`}><input id={`ci-${k}`} name="issuer" defaultValue={cert?.issuer ?? ""} className="field" /></Field>
      <Field label="Credential link" htmlFor={`cu-${k}`}><input id={`cu-${k}`} name="credentialUrl" type="url" defaultValue={cert?.credentialUrl ?? ""} className="field" /></Field>
      <Field label="Issued" htmlFor={`cs-${k}`}><input id={`cs-${k}`} name="issuedAt" type="month" defaultValue={cert?.issuedAt} className="field" /></Field>
      <Field label="Expires" htmlFor={`ce-${k}`}><input id={`ce-${k}`} name="expiresAt" type="month" defaultValue={cert?.expiresAt} className="field" /></Field>
      <div className="sm:col-span-2"><SubmitButton className="btn btn-secondary">{cert ? "Save changes" : "Add certification"}</SubmitButton></div>
    </ActionForm>
  );
}
