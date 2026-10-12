"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/forms";
import { Badge, Chip, Meter, Panel } from "@/components/ui";
import { scoreTextAction, type ToolState } from "@/app/actions/tools";
import { scoreLabel } from "@/lib/resume/score";

export function ScoreTool() {
  const [state, action] = useActionState<ToolState, FormData>(scoreTextAction, undefined);
  const r = state?.result;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={action} className="space-y-3">
        <label htmlFor="text" className="label">Resume text</label>
        <textarea id="text" name="text" rows={20} required minLength={150} maxLength={30000} placeholder="Paste your resume here…" className="field font-mono text-[12.5px]" />
        {state?.error && <p role="alert" className="rounded-md border border-[#e9b9b5] bg-bad-soft px-3 py-2 text-[13px] text-bad">{state.error}</p>}
        <SubmitButton className="btn btn-accent" pendingText="Scoring…">Score my resume</SubmitButton>
      </form>

      <div aria-live="polite">
        {!r ? (
          <div className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center text-[13.5px] text-muted">Your score and the exact gaps to close will appear here.</div>
        ) : (
          <div className="space-y-4">
            <div className="panel p-5">
              <p className="flex items-baseline gap-1"><span className="text-[56px] font-semibold leading-none tabular-nums">{r.total}</span><span className="text-[18px] text-muted">/ 100</span></p>
              <div className="mt-3"><Badge tone={r.total >= 70 ? "ok" : r.total >= 50 ? "warn" : "bad"}>{scoreLabel(r.total)}</Badge></div>
            </div>
            <Panel title="Breakdown">
              <ul className="space-y-3">{r.breakdown.map((c) => <li key={c.key}><div className="mb-1 flex justify-between text-[13.5px]"><span>{c.label}</span><span className="font-mono text-[12.5px] text-muted">{c.score}/{c.max}</span></div><Meter value={c.score} max={c.max} label={c.label} /></li>)}</ul>
            </Panel>
            {state?.software && state.software.length > 0 && <Panel title="Software detected"><div className="flex flex-wrap gap-1">{state.software.map((s) => <Chip key={s}>{s}</Chip>)}</div></Panel>}
            {r.suggestions.length > 0 && (
              <Panel title="Fix these first"><ol className="space-y-2 text-[13.5px]">{r.suggestions.slice(0, 6).map((s, i) => <li key={i} className="flex justify-between gap-3"><span>{s.message}</span><Badge tone="accent">+{s.impact}</Badge></li>)}</ol></Panel>
            )}
            <Link href="/register" className="btn btn-primary w-full">Save this as your BIM profile</Link>
          </div>
        )}
      </div>
    </div>
  );
}
