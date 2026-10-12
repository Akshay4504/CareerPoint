import Link from "next/link";
import type { ReactNode } from "react";
import type { getPublicProfile } from "@/lib/services/public-profile";
import { Avatar, Badge, Chip, Panel } from "@/components/ui";
import { ResumeView } from "@/components/resume-view";
import { formatMonth, humanize } from "@/lib/utils";

const Row = ({ k, v }: { k: string; v?: string | number | null }) => (v != null && v !== "" ? <div className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd>{v}</dd></div> : null);

export type ProfileViewData = NonNullable<Awaited<ReturnType<typeof getPublicProfile>>>;

/** The profile layout shared by the public page and the email-checkpoint share page. */
export function ProfileBody({ view, head, extras }: { view: ProfileViewData; head?: ReactNode; extras?: ReactNode }) {
  const { profile: p, isOwner } = view;
  const hasBim = p.bimDisciplines.length || p.bimRoles.length || p.bimStandards.length || p.lodLevels.length || p.bimResponsibilities.length || p.infoMgmtYears != null || p.coordinationYears != null || p.modelingYears != null || p.vdcYears != null;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      {head}
        {extras}
      <div className="min-w-0 space-y-6">
        {p.visibility !== "PUBLIC" && <p className="rounded-md border border-[#ecd29e] bg-warn-soft px-3 py-2 text-[13px] text-warn">This profile is private. Only you can see this page.</p>}
        <header className="flex items-start gap-4">
          <Avatar name={p.user.name} src={p.avatarFileId ? `/api/files/${p.avatarFileId}` : null} size={72} />
          <div>
            <h1 className="text-[26px] leading-tight">{p.user.name}</h1>
            {p.headline && <p className="text-[15px] text-ink-2">{p.headline}</p>}
            <p className="mt-1 text-[13px] text-muted">{[p.currentRole, view.location, p.discipline, p.yearsExperience != null ? `${p.yearsExperience} years experience` : null].filter(Boolean).join(" · ")}</p>
            {p.openToWork && view.canSeeOpenToWork && <div className="mt-2"><Badge tone="ok">Open to work</Badge></div>}
          </div>
        </header>

        {p.summary && <Panel title="About"><p className="prose-plain text-[14px] text-ink-2">{p.summary}</p></Panel>}

        {view.achievements.length > 0 && (
          <Panel title="Key achievements"><ul className="list-disc space-y-1 pl-5 text-[14px] text-ink-2">{view.achievements.map((a, i) => <li key={i}>{a}</li>)}</ul></Panel>
        )}

        {p.experiences.length > 0 && (
          <Panel title="Experience">
            <ol className="space-y-5">
              {p.experiences.map((e) => (
                <li key={e.id}>
                  <p className="font-medium">{e.title} <span className="font-normal text-ink-2">· {e.company}</span></p>
                  <p className="text-[12.5px] text-muted">{formatMonth(e.startDate)} – {e.current ? "Present" : formatMonth(e.endDate) || "—"}{e.location ? ` · ${e.location}` : ""}</p>
                  {e.description && <p className="prose-plain mt-1.5 text-[13.5px] text-ink-2">{e.description}</p>}
                </li>
              ))}
            </ol>
          </Panel>
        )}

        {view.projects.length > 0 && (
          <Panel title="BIM projects">
            <ul className="space-y-6">
              {view.projects.map((x) => (
                <li key={x.id} className="border-b border-line pb-6 last:border-0 last:pb-0">
                  <p className="font-medium">{x.name} <span className="font-normal text-muted">{[x.sector, x.discipline, x.lod, x.scale, x.year, x.location].filter(Boolean).join(" · ")}</span></p>
                  <p className="text-[12.5px] text-muted">{[x.role && `Role: ${x.role}`, x.client && `Client: ${x.client}`].filter(Boolean).join(" · ")}</p>
                  {x.software.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{x.software.map((s) => <Chip key={s}>{s}</Chip>)}</div>}
                  {x.portfolio.length > 0 && (
                    <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {x.portfolio.map((it) => it.fileId && (
                        <li key={it.id} className="overflow-hidden rounded-md border border-line">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/files/${it.fileId}`} alt={it.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                        </li>
                      ))}
                    </ul>
                  )}
                  {([["Description", x.description], ["Responsibilities", x.responsibilities], ["Challenges", x.challenges], ["Solutions", x.solutions], ["Outcomes", x.outcomes]] as const).map(([label, text]) => text && (
                    <div key={label} className="mt-3"><p className="eyebrow mb-0.5">{label}</p><p className="prose-plain text-[13.5px] text-ink-2">{text}</p></div>
                  ))}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {p.portfolioItems.length > 0 && (
          <Panel title="More work">
            <ul className="grid gap-4 sm:grid-cols-2">
              {p.portfolioItems.map((it) => (
                <li key={it.id} className="overflow-hidden rounded-md border border-line">
                  {it.fileId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${it.fileId}`} alt={it.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                  )}
                  <div className="p-3"><p className="font-medium">{it.title}</p>{it.description && <p className="text-[13px] text-muted">{it.description}</p>}{it.url && <a href={it.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-[13px] underline">Open link ↗</a>}</div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {view.resume && (
          <Panel title="Resume"><div className="rounded-md border border-line bg-surface p-5"><ResumeView content={view.resume} showContact={false} /></div></Panel>
        )}
      </div>

      <aside className="space-y-4">
        {p.softwareSkills.length > 0 && (
          <Panel title="BIM software">
            <ul className="space-y-1.5 text-[13.5px]">{p.softwareSkills.map((s) => <li key={s.id} className="flex justify-between gap-2"><span>{s.software}</span><span className="text-muted">{humanize(s.level)}{s.years != null ? ` · ${s.years}y` : ""}</span></li>)}</ul>
          </Panel>
        )}
        {hasBim ? (
          <Panel title="BIM expertise">
            <dl className="space-y-1.5 text-[13.5px]">
              <Row k="Information mgmt" v={p.infoMgmtYears != null ? `${p.infoMgmtYears}y` : null} />
              <Row k="Coordination" v={p.coordinationYears != null ? `${p.coordinationYears}y` : null} />
              <Row k="Modelling" v={p.modelingYears != null ? `${p.modelingYears}y` : null} />
              <Row k="VDC" v={p.vdcYears != null ? `${p.vdcYears}y` : null} />
            </dl>
            {p.bimDisciplines.length > 0 && <div className="mt-3"><p className="eyebrow mb-1">Disciplines</p><div className="flex flex-wrap gap-1">{p.bimDisciplines.map((x) => <Chip key={x}>{x}</Chip>)}</div></div>}
            {p.bimRoles.length > 0 && <div className="mt-3"><p className="eyebrow mb-1">Roles held</p><div className="flex flex-wrap gap-1">{p.bimRoles.map((x) => <Chip key={x}>{x}</Chip>)}</div></div>}
            {p.bimStandards.length > 0 && <div className="mt-3"><p className="eyebrow mb-1">Standards</p><div className="flex flex-wrap gap-1">{p.bimStandards.map((x) => <Chip key={x}>{x}</Chip>)}</div></div>}
            {p.lodLevels.length > 0 && <div className="mt-3"><p className="eyebrow mb-1">LOD</p><div className="flex flex-wrap gap-1">{p.lodLevels.map((x) => <Chip key={x}>{x}</Chip>)}</div></div>}
            {p.bimResponsibilities.length > 0 && <div className="mt-3"><p className="eyebrow mb-1">Responsibilities</p><ul className="list-disc space-y-0.5 pl-4 text-[13px] text-ink-2">{p.bimResponsibilities.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          </Panel>
        ) : null}
        {p.skills.length > 0 && <Panel title="Skills"><div className="flex flex-wrap gap-1">{p.skills.map((s) => <Chip key={s.skillId}>{s.skill.name}</Chip>)}</div></Panel>}
        {p.certifications.length > 0 && <Panel title="Certifications"><ul className="space-y-1.5 text-[13.5px]">{p.certifications.map((c) => <li key={c.id}>{c.name}{(c.issuer || c.issuedAt) && <span className="block text-[12.5px] text-muted">{[c.issuer, formatMonth(c.issuedAt)].filter(Boolean).join(" · ")}</span>}</li>)}</ul></Panel>}
        {p.educations.length > 0 && <Panel title="Education"><ul className="space-y-1.5 text-[13.5px]">{p.educations.map((e) => <li key={e.id}>{e.school}<span className="block text-[12.5px] text-muted">{[e.degree, e.field, e.endYear].filter(Boolean).join(" · ")}</span></li>)}</ul></Panel>}
        {p.languages.length > 0 && <Panel title="Languages"><ul className="space-y-1 text-[13.5px]">{p.languages.map((l) => <li key={l.id} className="flex justify-between"><span>{l.name}</span><span className="text-muted">{l.level}</span></li>)}</ul></Panel>}
        {view.preferences && (view.preferences.preferredRoles.length > 0 || view.preferences.availability) && (
          <Panel title="Looking for">
            <dl className="space-y-1.5 text-[13.5px]">
              <Row k="Roles" v={view.preferences.preferredRoles.join(", ")} />
              <Row k="Locations" v={view.preferences.preferredLocations.join(", ")} />
              <Row k="Arrangement" v={view.preferences.remotePreference} />
              <Row k="Type" v={view.preferences.employmentTypes.join(", ")} />
              <Row k="Availability" v={view.preferences.availability} />
            </dl>
          </Panel>
        )}
        {extras}
        {isOwner && <Link href="/profile" className="btn btn-secondary w-full">Edit profile</Link>}
      </aside>
    </div>
  );
}
