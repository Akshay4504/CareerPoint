import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { checkHealth } from "@/lib/health";
import { deadLetters, queueStats } from "@/lib/queue/queue";
import { usageSummary } from "@/lib/ai/usage";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { retryDeadLetterAction, retryEmailAction } from "@/app/actions/admin";
import { msAgo, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · System" };
export const dynamic = "force-dynamic";

const TONE = { ok: "ok", degraded: "warn", down: "bad" } as const;

export default async function AdminSystem() {
  await requireArea("admin-users");
  const [health, queue, dead, ai, sessions, files, bytes, failedEmail, emailCounts, logs] = await Promise.all([
    checkHealth(),
    queueStats(),
    deadLetters(20),
    usageSummary(7),
    db.session.count({ where: { expiresAt: { gt: new Date() } } }),
    db.fileAsset.count(),
    db.fileAsset.aggregate({ _sum: { size: true } }),
    db.emailOutbox.findMany({ where: { OR: [{ status: "FAILED" }, { status: "PENDING", createdAt: { lt: msAgo(15 * 60_000) } }] }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.emailOutbox.groupBy({ by: ["status"], where: { createdAt: { gte: msAgo(7 * 86400_000) } }, _count: true }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { actor: { select: { name: true, email: true } } } }),
  ]);
  const secure: [string, boolean, string][] = [
    ["APP_URL", !!process.env.APP_URL && !process.env.APP_URL.includes("localhost"), process.env.APP_URL ?? "unset"],
    ["AUTH_SECRET", (process.env.AUTH_SECRET?.length ?? 0) >= 16, (process.env.AUTH_SECRET?.length ?? 0) >= 16 ? "Set" : "Missing or too short. Required in production."],
    ["Secure cookies", process.env.NODE_ENV === "production", process.env.NODE_ENV === "production" ? "Enabled" : "Disabled (development)"],
  ];
  const aiTokens = ai.rows.reduce((n, r) => n + (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0), 0);

  return (
    <>
      <PageHeader title="System" description={`Checked ${timeAgo(new Date(health.checkedAt))}. The same checks are exposed at /api/health/ready for load balancers and uptime monitors.`} actions={<Badge tone={TONE[health.status]}>{health.status}</Badge>} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel title="Health">
            <ul className="space-y-2.5 text-[13.5px]">
              {Object.entries(health.components).map(([k, c]) => (
                <li key={k}>
                  <span className="flex items-center justify-between"><span className="capitalize">{k}</span><Badge tone={TONE[c.status]}>{c.status === "ok" ? "OK" : c.status}</Badge></span>
                  <span className="text-[12.5px] text-muted">{c.detail}{c.latencyMs != null ? ` · ${c.latencyMs} ms` : ""}</span>
                </li>
              ))}
              {secure.map(([k, ok, d]) => (
                <li key={k}>
                  <span className="flex items-center justify-between"><span>{k}</span><Badge tone={ok ? "ok" : "warn"}>{ok ? "OK" : "Check"}</Badge></span>
                  <span className="text-[12.5px] text-muted">{d}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Usage">
            <dl className="space-y-1.5 text-[13.5px]">
              <div className="flex justify-between"><dt className="text-muted">Active sessions</dt><dd className="tabular-nums">{sessions}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Stored files</dt><dd className="tabular-nums">{files}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Storage</dt><dd className="tabular-nums">{((bytes._sum.size ?? 0) / 1048576).toFixed(1)} MB</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Queue: pending / running</dt><dd className="tabular-nums">{queue.rows.filter((r) => r.status === "PENDING").reduce((n, r) => n + r._count, 0)} / {queue.rows.filter((r) => r.status === "RUNNING").reduce((n, r) => n + r._count, 0)}</dd></div>
            </dl>
          </Panel>
          <Panel title="AI usage (7 days)" description={`Limits: ${ai.limits.perUserDaily} requests per user per day; ${ai.limits.dailyTokenBudget ? `${ai.limits.dailyTokenBudget.toLocaleString("en-US")} tokens per day overall` : "no global token cap"}.`}>
            {ai.rows.length === 0 ? <p className="text-[13px] text-muted">No AI requests yet.</p> : (
              <dl className="space-y-1.5 text-[13.5px]">
                {ai.rows.map((r) => <div key={r.status} className="flex justify-between"><dt className="text-muted">{r.status === "ok" ? "Model answers" : r.status === "fallback" ? "Deterministic fallbacks" : "Failed calls"}</dt><dd className="tabular-nums">{r._count}</dd></div>)}
                <div className="flex justify-between"><dt className="text-muted">Tokens used</dt><dd className="tabular-nums">{aiTokens.toLocaleString("en-US")}</dd></div>
              </dl>
            )}
          </Panel>
          <Panel title="Email (7 days)">
            <dl className="space-y-1.5 text-[13.5px]">
              {emailCounts.length === 0 ? <p className="text-[13px] text-muted">No email sent yet.</p> : emailCounts.map((e) => <div key={e.status} className="flex justify-between"><dt className="text-muted">{e.status.toLowerCase()}</dt><dd className="tabular-nums">{e._count}</dd></div>)}
            </dl>
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="Dead-lettered tasks" description="Background tasks that exhausted their retries or can never succeed. Retry puts a task back on the queue." pad={false}>
            {dead.length === 0 ? <div className="p-4"><EmptyState title="Nothing dead-lettered" description="Failed tasks appear here after all automatic retries." /></div> : (
              <ul className="divide-y divide-line text-[13px]">
                {dead.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0"><span className="font-mono text-[12px]">{d.queue}</span><span className="text-muted"> · {d.attempts} attempts · {d.finishedAt ? timeAgo(d.finishedAt) : ""}</span><br /><span className="break-words text-[12px] text-bad">{d.error}</span></span>
                    <form action={retryDeadLetterAction.bind(null, d.id)}><button className="btn btn-secondary btn-sm">Retry</button></form>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Undelivered email" description="Failed messages, and messages still waiting after 15 minutes (usually the worker is not running)." pad={false}>
            {failedEmail.length === 0 ? <div className="p-4"><p className="text-[13px] text-muted">All notification emails were delivered.</p></div> : (
              <ul className="divide-y divide-line text-[13px]">
                {failedEmail.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0"><span className="font-medium">{m.subject}</span><span className="text-muted"> · {m.toEmail} · {m.status.toLowerCase()} · {m.attempts} attempts</span>{m.error && <><br /><span className="text-[12px] text-bad">{m.error}</span></>}</span>
                    <form action={retryEmailAction.bind(null, m.id)}><button className="btn btn-secondary btn-sm">Retry</button></form>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Audit log" description="Last 50 events" pad={false}>
            <ul className="divide-y divide-line text-[13px]">
              {logs.map((l) => <li key={l.id} className="flex justify-between gap-3 px-4 py-2"><span className="min-w-0"><span className="font-mono text-[12px]">{l.action}</span>{l.entityType && <span className="text-muted"> · {l.entityType}</span>}<br /><span className="text-[12px] text-muted">{l.actor?.email ?? "system"}{l.ip ? ` · ${l.ip}` : ""}</span></span><span className="shrink-0 text-muted">{timeAgo(l.createdAt)}</span></li>)}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
