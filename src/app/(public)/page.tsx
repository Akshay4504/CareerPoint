import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { HeroIllustration } from "@/components/hero-illustration";
import { pageMeta, jsonLd, organizationLd, websiteLd } from "@/lib/seo";
import { getScoringConfig } from "@/lib/scoring/store";
import { normalizeWeights } from "@/lib/scoring/config";
import { getCurrentUser } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/rbac";

const FLOW = [
  { n: "01", t: "Resume", d: "Upload a PDF, DOCX or TXT. It stays private to you." },
  { n: "02", t: "BIM Profile", d: "Parsed into software, skills, projects, experience and certifications you can edit." },
  { n: "03", t: "Resume Score", d: "A fixed 100-point rubric — same resume, same score — with the exact gaps to close." },
  { n: "04", t: "Job Matches", d: "Every active job is scored against your profile, with the reasons shown." },
  { n: "05", t: "Applications", d: "Apply, save or pin. Every status change from the employer is logged for you." },
  { n: "06", t: "Career Growth", d: "See which tools and skills open the most roles in your discipline." },
];


export const metadata: Metadata = pageMeta({ title: "CareerPoint — Your BIM career, one intelligent profile", description: "Build your BIM profile, score your resume against BIM-specific criteria, discover relevant BIM jobs and track every application in one place.", path: "/" });

export default async function HomePage() {
  const user = await getCurrentUser();
  // The rubric shown here is the live one: group points are summed from the (admin-configurable) normalised weights.
  const active = await getScoringConfig();
  const w = normalizeWeights(active.weights);
  const rubric = active.config.groups.map((g) => [g.label, g.dimensions.reduce((n, d) => n + w[d], 0)] as const).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd([organizationLd(), websiteLd()]) }} />
      <section className="relative -mx-4 px-4 pb-14 pt-12 sm:-mx-8 sm:px-8 sm:pt-16">
        <div aria-hidden className="hero-wash pointer-events-none absolute inset-y-0 left-1/2 w-screen -translate-x-1/2" />
        <div className="relative grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
          <div className="rise">
            <p className="eyebrow mb-5">For BIM &amp; AEC professionals</p>
            <h1 className="text-[42px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[60px]">
              Your BIM Career,
              <br />
              One <span className="text-gradient">Intelligent Profile.</span>
            </h1>
            <p className="mt-6 max-w-md text-[17px] leading-relaxed text-ink-2">Build a powerful BIM profile, discover relevant opportunities, and track your career, all in one place.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={user ? homeFor(user.role) : "/register"} className="btn btn-primary btn-lg">
                Build My BIM Profile <span aria-hidden>→</span>
              </Link>
              <Link href="/jobs" className="btn btn-secondary btn-lg">
                Explore BIM Jobs
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted">
              {([["shield", "Free for professionals"], ["card", "No credit card"], ["lock", "Private by default"]] as const).map(([i, t]) => (
                <li key={t} className="inline-flex items-center gap-1.5"><Icon name={i} className="text-ink-2" />{t}</li>
              ))}
            </ul>
          </div>

          <figure className="relative mx-auto w-full max-w-[520px]" aria-label="Illustration of the CareerPoint workspace">
            <HeroIllustration />
            <div className="glass absolute left-0 top-[18%] w-44 rounded-xl p-3 sm:-left-4">
              <p className="text-[11px] text-muted">Resume score</p>
              <p className="mt-0.5 flex items-baseline gap-1"><span className="text-[26px] font-semibold leading-none tabular-nums">86</span><span className="text-[11px] text-muted">/ 100</span></p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken"><div className="h-full w-[86%] rounded-full bg-[#22c55e]" /></div>
            </div>
            <div className="glass absolute bottom-[16%] left-[6%] flex items-center gap-2.5 rounded-xl p-3 sm:left-[-2%]">
              <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-[13px] font-semibold text-accent">R</span>
              <div><p className="text-[13px] font-medium leading-tight">Revit</p><p className="text-[11px] leading-tight text-ok">Evidence in 3 projects</p></div>
            </div>
            <div className="glass absolute right-0 top-[8%] rounded-xl p-3 sm:-right-2">
              <p className="text-[11px] text-muted">Why a job matches</p>
              <div className="mt-1.5 flex items-end gap-1" aria-hidden>{[14, 22, 18, 30, 24].map((h, i) => <span key={i} className="w-2.5 rounded-sm bg-gradient-to-t from-accent to-violet" style={{ height: h }} />)}</div>
            </div>
            <figcaption className="mt-2 text-center text-[11.5px] text-muted">Illustrative example, not real data</figcaption>
          </figure>
        </div>
      </section>

      <section aria-label="Tools CareerPoint understands" className="pb-14 text-center">
        <p className="text-[13px] text-muted">Reads and scores evidence for the tools and standards you actually use</p>
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[17px] font-semibold tracking-tight text-ink-2/80">
          {["Revit", "Navisworks", "Solibri", "Dynamo", "ArchiCAD", "ISO 19650", "COBie"].map((t) => <span key={t}>{t}</span>)}
        </p>
      </section>

      <section aria-labelledby="how" className="mb-16">
        <p id="how" className="eyebrow mb-3 text-forest">How CareerPoint works</p>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FLOW.map((f) => (
            <li key={f.n} className="flex gap-3.5 rounded-2xl border border-line bg-bg p-5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mint font-mono text-[12px] font-semibold text-forest">{f.n}</span>
              <div><p className="font-semibold leading-snug text-ink">{f.t}</p><p className="mt-1 text-[13.5px] leading-relaxed text-muted">{f.d}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Why CareerPoint" className="grid gap-5 lg:grid-cols-3">
        {([
          ["mint", "profile", "Your profile", "One profile, everything else follows", "Your resume, score, matches, applications and portfolio all read from the same BIM profile. Edit it once and everything recalculates.", "Build my profile", "/register"],
          ["sky", "score", "Explainable", "Explainable, not magical", "Resume scoring and job matching are deterministic. Each result tells you exactly what counted and what is missing.", "Score a resume", "/tools"],
          ["sand", "shield", "Trust", "Employers you can trust", "Employer jobs are moderated and companies are verified before they can browse candidates. You see real activity on your applications, nothing invented.", "See employers", "/companies"],
        ] as const).map(([tint, icon, eyebrow, title, text, cta, href]) => (
          <article key={title} className={`flex flex-col rounded-[28px] p-7 ${tint === "mint" ? "bg-mint" : tint === "sky" ? "bg-sky" : "bg-sand"}`}>
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-forest shadow-sm"><Icon name={icon} size={20} /></span>
            <p className="mt-6 text-[15px] font-semibold text-forest">{eyebrow}</p>
            <h2 className="mt-2 text-[28px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink">{title}</h2>
            <p className="mt-4 flex-1 text-[15px] leading-relaxed text-ink-2/85">{text}</p>
            <Link href={href} className="mt-6 inline-flex items-center gap-1.5 text-[15px] font-semibold text-forest hover:underline">{cta} <span aria-hidden>→</span></Link>
          </article>
        ))}
      </section>

      <section className="mt-20 grid gap-10 lg:grid-cols-[1fr_1fr]">
        <div>
          <p className="eyebrow mb-2 text-forest">Resume score</p>
          <h2 className="text-[28px] leading-tight tracking-tight">A rubric you can read.</h2>
          <p className="mt-3 max-w-md text-ink-2">{rubric.length} BIM-specific areas add up to 100 points. No black box, no random variation — fix a gap and watch the score move.</p>
          <Link href="/tools" className="btn btn-secondary mt-6">
            Score a resume now
          </Link>
        </div>
        <dl className="panel divide-y divide-line">
          {rubric.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-4 py-2.5 text-[13.5px]">
              <dt>{k}</dt>
              <dd className="font-mono tabular-nums text-muted">{v} pts</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-20 rounded-[28px] bg-sand px-6 py-10 sm:px-10">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <h2 className="text-[28px] font-semibold tracking-[-0.03em] text-ink">Hiring BIM talent?</h2>
            <p className="mt-1 max-w-lg text-ink-2">Post moderated BIM roles and review applicants with their structured profile attached.</p>
          </div>
          <Link href="/register?type=employer" className="btn btn-primary">
            Create employer account
          </Link>
        </div>
      </section>
    </>
  );
}
