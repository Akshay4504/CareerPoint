import type { Metadata } from "next";
import { getScoringConfig } from "@/lib/scoring/store";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { ensureProfile, portfolioCount } from "@/lib/services/profile";
import { ScoreRing, Badge, EmptyState, Meter, PageHeader, Panel } from "@/components/ui";
import { generateFromProfile } from "@/app/actions/resume";
import { scoreLabel, scoreResume } from "@/lib/resume/score";
import { BENCHMARK_META } from "@/lib/scoring/benchmark";
import type { ResumeContent } from "@/lib/resume/types";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Resume score" };
export const dynamic = "force-dynamic";

const tone = (r: number) => (r >= 0.7 ? ("ok" as const) : r >= 0.4 ? ("warn" as const) : ("bad" as const));

export default async function ScorePage({ searchParams }: { searchParams: Promise<{ resume?: string; imported?: string }> }) {
  const sp = await searchParams;
  const user = await requireArea("app");
  const profile = await ensureProfile(user);
  const resumes = await db.resume.findMany({ where: { profileId: profile.id }, orderBy: { updatedAt: "desc" } });

  if (resumes.length === 0) {
    return (
      <>
        <PageHeader title="Resume score" />
        <EmptyState title="Nothing to score yet" description="Upload a resume or generate one from your profile to get a deterministic BIM score with the evidence behind every point." action={<Link href="/resume" className="btn btn-primary btn-sm">Go to Resume</Link>} />
      </>
    );
  }

  const selected = resumes.find((r) => r.id === sp.resume) ?? resumes[0];
  const versions = await db.resumeVersion.findMany({ where: { resumeId: selected.id }, orderBy: { version: "desc" }, include: { scores: { orderBy: { createdAt: "desc" }, take: 1 } } });
  const current = versions[0];
  // Pure + deterministic: recomputed from the stored content, the original text and the live portfolio count.
  const active = await getScoringConfig();
  const live = scoreResume({ content: current.content as unknown as ResumeContent, rawText: current.rawText, portfolioCount: await portfolioCount(profile.id), targetRole: selected.targetRole }, active.config);
  const potential = Math.min(100, live.total + live.suggestions.reduce((n, s) => n + s.impact, 0));

  return (
    <>
      <PageHeader
        title="BIM Resume Score"
        description="Deterministic: the same resume always scores the same. No AI is involved in the score."
        actions={
          <>
            {resumes.length > 1 && (
              <form className="flex items-center gap-2">
                <label className="sr-only" htmlFor="resume">Resume</label>
                <select id="resume" name="resume" defaultValue={selected.id} className="field w-auto">{resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
                <button className="btn btn-secondary btn-sm">Show</button>
              </form>
            )}
            <Link href={`/resume/${selected.id}/edit`} className="btn btn-secondary btn-sm">Edit resume</Link>
            <form action={generateFromProfile}><button className="btn btn-secondary btn-sm">Rescore from profile</button></form>
          </>
        }
      />
      {sp.imported && <p role="status" className="mb-5 rounded-md border border-[#b9dcc6] bg-ok-soft px-3 py-2 text-[13px] text-ok">Saved. Your approved selections were added to your profile.</p>}

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <div className="panel p-5">
            <p className="text-[12.5px] text-muted">{selected.title} · v{current.version}</p>
            <div className="mt-4"><ScoreRing value={live.total} /></div>
            <div className="mt-4 text-center"><Badge tone={live.total >= 70 ? "ok" : live.total >= 50 ? "warn" : "bad"}>{scoreLabel(live.total)}</Badge></div>
            {live.suggestions.length > 0 && <p className="mt-3 text-[13px] text-muted">Closing the gaps below could take this to about <strong className="text-ink">{potential}</strong>.</p>}
            {versions[1]?.scores[0] && (() => {
              const prev = versions[1].scores[0];
              const delta = live.total - prev.total;
              const prevCfg = (prev.breakdown as { configVersion?: number } | null)?.configVersion ?? 0;
              return (
                <dl className="mt-4 space-y-1 border-t border-line pt-3 text-[13px]" aria-label="Score comparison">
                  <div className="flex justify-between"><dt className="text-muted">Previous score (v{versions[1].version})</dt><dd className="tabular-nums">{prev.total}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Current score (v{current.version})</dt><dd className="tabular-nums">{live.total}</dd></div>
                  <div className="flex justify-between font-medium"><dt>Improvement</dt><dd className={`tabular-nums ${delta > 0 ? "text-ok" : delta < 0 ? "text-bad" : "text-muted"}`}>{delta > 0 ? "+" : ""}{delta}</dd></div>
                  {prevCfg !== active.version && <p className="pt-1 text-[11.5px] text-muted">The previous score used earlier scoring weights, so part of the difference may come from the weights, not your resume.</p>}
                </dl>
              );
            })()}
            <p className="mt-3 text-[12px] text-muted">Compared with the <strong>{live.benchmarkRole.label}</strong> benchmark. {BENCHMARK_META.description}</p>
          </div>
          {versions.length > 1 && (
            <Panel title="History">
              <ul className="space-y-1.5 text-[13px]">
                {versions.map((v) => <li key={v.id} className="flex justify-between gap-2"><span className="truncate text-muted">v{v.version}{v.label ? ` · ${v.label}` : ""} · {timeAgo(v.createdAt)}</span><span className="tabular-nums">{v.scores[0]?.total ?? "—"}</span></li>)}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="Score breakdown" description="Every line states the evidence found in your resume.">
            <ul className="space-y-6">
              {live.groups.map((g) => (
                <li key={g.key}>
                  <div className="mb-1 flex items-baseline justify-between gap-3"><h3 className="text-[14px]">{g.label}</h3><span className="font-mono text-[13px] tabular-nums">{Math.round(g.score)}/{g.max}</span></div>
                  <Meter value={g.score} max={g.max} label={g.label} tone={tone(g.max ? g.score / g.max : 0)} />
                  <details className="mt-1.5">
                    <summary className="text-[12.5px] text-muted hover:text-ink">Evidence</summary>
                    <ul className="mt-2 space-y-2.5 border-l border-line pl-3">
                      {g.dimensions.map((d) => (
                        <li key={d.key} className="text-[13px]">
                          <div className="flex justify-between gap-3"><span className="font-medium">{d.label}</span><span className="font-mono text-[12px] text-muted">{d.score}/{d.max}</span></div>
                          {d.evidence.map((e, i) => <p key={i} className="text-ink-2">{e}</p>)}
                          {d.gaps.map((e, i) => <p key={i} className="text-warn">△ {e}</p>)}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Fix these first" description="Ordered by points available.">
            {live.suggestions.length === 0 ? (
              <p className="text-[13.5px] text-ok">No measurable gaps against this benchmark.</p>
            ) : (
              <ol className="divide-y divide-line">
                {live.suggestions.slice(0, 10).map((s, i) => (
                  <li key={i} className="flex items-start justify-between gap-4 py-2.5 text-[13.5px] first:pt-0 last:pb-0">
                    <span>{s.message}</span>
                    <Badge tone="accent" className="shrink-0">+{s.impact}</Badge>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-4 text-[12.5px] text-muted">Only add what is true. Want help wording it? Try the <Link className="underline" href={`/resume/assistant?resume=${selected.id}`}>AI assistant</Link> — every suggestion needs your approval.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
