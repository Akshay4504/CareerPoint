import type { ResumeContent } from "@/lib/resume/types";
import { DEFAULT_ORDER, layoutOf } from "@/lib/resume/types";
import { cn } from "@/lib/utils";

function ym(s?: string) {
  if (!s) return "";
  const [y, m] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

const TEMPLATE_STYLES: Record<string, { root: string; h1: string; heading: string; accent: string }> = {
  classic: { root: "font-serif text-[13px] leading-relaxed", h1: "text-[26px] leading-tight", heading: "mb-1.5 border-b border-line pb-0.5 text-[12px] font-semibold uppercase tracking-[0.08em]", accent: "" },
  compact: { root: "text-[12px] leading-snug", h1: "text-[22px] leading-tight", heading: "mb-1 border-b border-line pb-0.5 text-[11px] font-semibold uppercase tracking-[0.08em]", accent: "" },
  modern: { root: "text-[13px] leading-relaxed", h1: "text-[28px] font-semibold leading-tight tracking-tight", heading: "mb-1.5 border-l-[3px] border-accent pl-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-accent-strong", accent: "text-accent-strong" },
};

/** Read-only rendering of structured resume content, honouring the chosen template, section order and visibility. */
export function ResumeView({ content, showContact = true, templateOverride, orderOverride }: { content: ResumeContent; showContact?: boolean; templateOverride?: string; orderOverride?: string[] }) {
  const c = content;
  const layout = layoutOf(c);
  const t = TEMPLATE_STYLES[templateOverride ?? layout.template] ?? TEMPLATE_STYLES.classic;
  const order = orderOverride ?? layout.order ?? DEFAULT_ORDER;
  const custom = new Map((c.customSections ?? []).map((s) => [s.id, s]));

  const sections: Record<string, React.ReactNode> = {
    summary: c.summary ? <p className="prose-plain">{c.summary}</p> : null,
    experience: c.experiences.length ? (
      <div className="space-y-3">
        {c.experiences.map((e, i) => (
          <div key={i}>
            <div className="flex flex-wrap justify-between gap-x-4">
              <p className="font-semibold">
                {e.title} <span className="font-normal text-ink-2">· {e.company}</span>
              </p>
              <p className="text-muted">
                {ym(e.startDate)} – {e.current ? "Present" : ym(e.endDate)}
              </p>
            </div>
            {e.description && <p className="prose-plain mt-0.5 text-ink-2">{e.description}</p>}
          </div>
        ))}
      </div>
    ) : null,
    software: c.software.length ? <p>{c.software.join(" · ")}</p> : null,
    skills: c.skills.length ? <p>{c.skills.join(" · ")}</p> : null,
    projects: c.projects.length ? (
      <div className="space-y-2.5">
        {c.projects.map((p, i) => (
          <div key={i}>
            <p className="font-semibold">
              {p.name} <span className="font-normal text-muted">{[p.role, p.sector, p.lod, p.scale, p.year].filter(Boolean).join(" · ")}</span>
            </p>
            {p.software && p.software.length > 0 && <p className="text-muted">{p.software.join(", ")}</p>}
            {p.description && <p className="prose-plain text-ink-2">{p.description}</p>}
            {p.outcomes && <p className="prose-plain text-ink-2">Outcome: {p.outcomes}</p>}
          </div>
        ))}
      </div>
    ) : null,
    portfolio: c.portfolio?.length ? (
      <ul className="list-disc pl-5">
        {c.portfolio.map((p) => (
          <li key={p.id}>
            {p.title}
            {p.description ? <span className="text-muted"> — {p.description}</span> : null}
          </li>
        ))}
      </ul>
    ) : null,
    certifications: c.certifications.length ? (
      <ul className="list-disc pl-5">
        {c.certifications.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    ) : null,
    education: c.educations.length ? (
      <ul className="space-y-1">
        {c.educations.map((e, i) => (
          <li key={i}>
            <span className="font-medium">{e.school}</span> <span className="text-muted">{[e.degree, e.field, e.endYear].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ul>
    ) : null,
    languages: c.languages?.length ? <p>{c.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(" · ")}</p> : null,
  };
  const titles: Record<string, string> = { summary: "Summary", experience: "Experience", software: "BIM software", skills: "Skills & standards", projects: "Projects", portfolio: "Portfolio", certifications: "Certifications", education: "Education", languages: "Languages" };

  return (
    <article className={cn("mx-auto max-w-[760px]", t.root)}>
      <header className="pb-3">
        <h1 className={t.h1}>{c.name ?? "Unnamed"}</h1>
        {c.headline && <p className={cn("text-[1.1em]", t.accent || "text-ink-2")}>{c.headline}</p>}
        <p className="mt-0.5 text-muted">{[c.location, ...(showContact ? [c.email, c.phone] : [])].filter(Boolean).join(" · ")}</p>
      </header>
      {order.map((key) => {
        if (key.startsWith("custom:")) {
          const s = custom.get(key.slice(7));
          if (!s || !s.body.trim()) return null;
          return (
            <section key={key} className="mt-4">
              <h2 className={t.heading}>{s.title}</h2>
              <p className="prose-plain">{s.body}</p>
            </section>
          );
        }
        const body = sections[key];
        if (!body) return null;
        return (
          <section key={key} className="mt-4">
            <h2 className={t.heading}>{titles[key]}</h2>
            {body}
          </section>
        );
      })}
    </article>
  );
}
