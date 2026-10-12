import type { Metadata } from "next";
import { requireArea } from "@/lib/auth/guards";
import { DEFAULT_WEIGHTS, DIMENSION_KEYS, RUBRIC_VERSION, normalizeWeights } from "@/lib/scoring/config";
import { LABELS } from "@/lib/scoring/engine";
import { BENCHMARK_META, ROLE_BENCHMARKS } from "@/lib/scoring/benchmark";
import { getScoringConfig, scoringHistory } from "@/lib/scoring/store";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { restoreScoringAction, saveScoringAction } from "@/app/actions/admin";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Resume scoring" };
export const dynamic = "force-dynamic";

export default async function AdminScoring() {
  await requireArea("admin-users");
  const [active, history] = await Promise.all([getScoringConfig(), scoringHistory(15)]);
  const authors = await db.user.findMany({ where: { id: { in: history.map((h) => h.createdById).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const who = new Map(authors.map((a) => [a.id, a.name]));
  const normalized = normalizeWeights(active.weights);

  return (
    <>
      <PageHeader
        title="Resume scoring"
        description={`Weights are relative and normalised to 100 when scoring. Rubric v${RUBRIC_VERSION} · live config ${active.version === 0 ? "built-in defaults" : `version ${active.version}`}. Scoring stays deterministic: same weights, same resume, same score.`}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ActionForm action={saveScoringAction} className="min-w-0 space-y-6">
          <Panel title="Dimension weights" description="Set a weight to 0 to switch a dimension off. The effective share (out of 100) is shown on the right of each field.">
            <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {DIMENSION_KEYS.map((k) => (
                <li key={k} className="flex items-center justify-between gap-3 text-[13.5px]">
                  <label htmlFor={`w-${k}`}>{LABELS[k]}</label>
                  <span className="flex items-center gap-2">
                    <input id={`w-${k}`} name={`w:${k}`} type="number" min={0} max={100} step="any" defaultValue={active.weights[k]} className="field w-20 text-right" />
                    <span className="w-10 text-right text-[12px] tabular-nums text-muted" title="Effective points out of 100">{normalized[k]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Role benchmark" description={`Source: ${BENCHMARK_META.source}. ${BENCHMARK_META.description} Override the numeric expectations per role; leave a value unchanged to keep the curated number.`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="text-[12px] text-muted">
                    <th className="pb-2 font-medium">Role</th>
                    <th className="pb-2 font-medium">Quantified lines</th>
                    <th className="pb-2 font-medium">Projects</th>
                    <th className="pb-2 font-medium">Certifications</th>
                    <th className="pb-2 font-medium">Typical years</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ROLE_BENCHMARKS.map((r) => {
                    const o = active.benchmark[r.id] ?? {};
                    const years = o.typicalYears ?? r.typicalYears;
                    const num = (name: string, v: number, label: string) => <input name={`b:${r.id}:${name}`} type="number" min={0} max={60} defaultValue={v} aria-label={`${r.label}: ${label}`} className="field w-16" />;
                    return (
                      <tr key={r.id}>
                        <td className="py-2 pr-3 font-medium">{r.label}</td>
                        <td>{num("q", o.expectedQuantified ?? r.expectedQuantified, "quantified lines")}</td>
                        <td>{num("p", o.expectedProjects ?? r.expectedProjects, "projects")}</td>
                        <td>{num("c", o.expectedCertifications ?? r.expectedCertifications, "certifications")}</td>
                        <td>
                          <span className="flex items-center gap-1">{num("y0", years[0], "minimum years")}–{num("y1", years[1], "maximum years")}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel>
            <label className="label" htmlFor="note">Change note (kept in the history)</label>
            <input id="note" name="note" maxLength={300} className="field mb-3" placeholder="e.g. Raised portfolio weight after review" />
            <SubmitButton className="btn btn-primary" pendingText="Saving…">Save as new version</SubmitButton>
          </Panel>
        </ActionForm>

        <div className="space-y-4">
          <Panel title="Version history" description="Append-only. Restoring creates a new version.">
            {history.length === 0 ? (
              <p className="text-[13px] text-muted">Using built-in defaults. Nothing saved yet.</p>
            ) : (
              <ul className="space-y-3 text-[13px]">
                {history.map((h) => (
                  <li key={h.id}>
                    <p className="flex items-center justify-between">
                      <span className="font-medium">Version {h.version}</span>
                      {h.version === active.version ? (
                        <Badge tone="ok">Live</Badge>
                      ) : (
                        <form action={restoreScoringAction.bind(null, h.version)}><button className="text-[12px] underline">Restore</button></form>
                      )}
                    </p>
                    <p className="text-muted">{timeAgo(h.createdAt)}{h.createdById ? ` · ${who.get(h.createdById) ?? "admin"}` : ""}</p>
                    {h.note && <p className="text-ink-2">{h.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Defaults">
            <p className="text-[12.5px] text-muted">Built-in weights total {Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)}. Resumes are stamped with the config version they were scored under, so score history stays interpretable.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
