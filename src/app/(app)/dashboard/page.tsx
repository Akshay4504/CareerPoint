import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { ensureProfile, profileCompleteness } from "@/lib/services/profile";
import { computeInsights } from "@/lib/services/insights";
import { activeJobWhere } from "@/lib/services/jobs";
import { Badge, EmptyState, Meter, MatchBadge, PageHeader, Panel, Stat } from "@/components/ui";
import { scoreLabel } from "@/lib/resume/score";
import { VIEW_LABEL, viewSummary } from "@/lib/services/profile-views";
import { humanize, msAgo, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = ["APPLIED", "RECRUITER_REVIEW", "SHORTLISTED", "ASSESSMENT", "INTERVIEW", "OFFER"] as const;

export default async function DashboardPage() {
  const user = await requireArea("app");
  const profile = await ensureProfile(user);
  const since7 = msAgo(7 * 86400_000);

  const [completeness, latestResume, topMatches, newMatchCount, apps, vs, events, notifications, insights] = await Promise.all([
    profileCompleteness(profile.id),
    db.resume.findFirst({ where: { profileId: profile.id }, orderBy: { updatedAt: "desc" }, include: { versions: { orderBy: { version: "desc" }, take: 1, include: { scores: { orderBy: { createdAt: "desc" }, take: 1 } } } } }),
    db.jobMatch.findMany({
      where: { profileId: profile.id, score: { gte: 35 }, job: { AND: [activeJobWhere(), { applications: { none: { userId: user.id } } }] } },
      orderBy: [{ score: "desc" }, { computedAt: "desc" }],
      take: 5,
      include: { job: { select: { slug: true, title: true, companyName: true, location: true, postedAt: true } } },
    }),
    db.jobMatch.count({ where: { profileId: profile.id, score: { gte: 55 }, job: { AND: [activeJobWhere(), { postedAt: { gte: since7 } }] } } }),
    db.application.groupBy({ by: ["status"], where: { userId: user.id }, _count: true }),
    viewSummary(profile.id, 30),
    db.applicationEvent.findMany({ where: { application: { userId: user.id } }, orderBy: { createdAt: "desc" }, take: 6, include: { application: { include: { job: { select: { title: true, companyName: true } } } } } }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 4 }),
    computeInsights(profile.id),
  ]);

  const score = latestResume?.versions[0]?.scores[0]?.total ?? null;
  const activeApps = apps.filter((a) => (ACTIVE_STATUSES as readonly string[]).includes(a.status)).reduce((n, a) => n + a._count, 0);
  const totalApps = apps.reduce((n, a) => n + a._count, 0);
  const nextStep = completeness.checks.find((c) => !c.done);
  const noMatchData = completeness.profile._count.softwareSkills === 0 && completeness.profile._count.skills === 0;
  const views = vs.total;

  const unlock = insights.unlockList[0];
  const recs: { text: string; href: string }[] = [];
  if (nextStep) recs.push({ text: `Complete your profile: add ${nextStep.label.toLowerCase()}.`, href: nextStep.href });
  const missingSw = insights.software.find((s) => !s.have);
  if (missingSw) recs.push({ text: `${missingSw.name} appears in ${missingSw.jobs} open ${insights.scope} and isn't on your profile.`, href: "/career-insights" });
  if (unlock) recs.push({ text: `Adding ${unlock.name} would bring ${unlock.jobs} more ${unlock.jobs === 1 ? "job" : "jobs"} within one skill of a full match.`, href: "/career-insights" });
  if (score != null && score < 85) recs.push({ text: "Close the gaps in your resume score to increase it.", href: "/resume/score" });

  return (
    <>
      <PageHeader title={`Welcome back, ${user.name.split(" ")[0]} 👋`} actions={profile.visibility === "PUBLIC" ? <Link href={`/professionals/${profile.slug}`} className="btn btn-primary btn-sm">View public profile</Link> : <Link href="/profile" className="btn btn-secondary btn-sm">Make profile public</Link>} description={nextStep ? <>Next: <Link href={nextStep.href} className="font-medium text-ink underline">{nextStep.label}</Link> would strengthen your profile.</> : "Your profile is complete. Keep an eye on new matches."} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat tint="mint" label="Resume score" value={score != null ? <>{score}<span className="text-[15px] font-normal text-muted"> / 100</span></> : "—"} bar={score != null ? { value: score, tone: score >= 70 ? "ok" : score >= 50 ? "warn" : "bad" } : undefined} hint={score != null ? scoreLabel(score) : "Upload a resume to get scored"} href={score != null ? "/resume/score" : "/resume"} />
        <Stat tint="sky" label="New matches (7 days)" value={noMatchData ? "—" : newMatchCount} hint={noMatchData ? "Add software & skills to match" : "Jobs scoring 55%+ for you"} href="/jobs?sort=match" />
        <Stat tint="sand" label="Active applications" value={activeApps} hint={totalApps ? `${totalApps} total` : "None yet"} href="/applications" />
        <Stat tint="lilac" label="Profile views (30 days)" value={views} hint={views ? `${vs.verifiedEmployers} verified employer${vs.verifiedEmployers === 1 ? "" : "s"} viewed your profile` : profile.visibility === "PUBLIC" ? "No views yet" : "Make your profile public to be found"} href="/profile" />
      </div>

      <div className="mt-6 grid gap-6 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Recommended jobs" actions={<Link href="/jobs?sort=match" className="text-[13px] text-muted hover:text-ink">View all →</Link>} pad={false}>
            {topMatches.length === 0 ? (
              <div className="p-4">
                <EmptyState title={noMatchData ? "Add software and skills to see matches" : "No matching jobs right now"} description={noMatchData ? "Matching compares your BIM software, skills, discipline and location to each open job." : "We'll score new jobs against your profile as they arrive."} action={<Link href={noMatchData ? "/resume" : "/jobs"} className="btn btn-secondary btn-sm">{noMatchData ? "Upload resume" : "Browse jobs"}</Link>} />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {topMatches.map((m) => (
                  <li key={m.jobId}>
                    <Link href={`/jobs/${m.job.slug}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface">
                      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-[15px] font-semibold text-accent">{m.job.companyName.trim().charAt(0).toUpperCase() || "?"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{m.job.title}</span>
                        <span className="block truncate text-[12.5px] text-muted">{[m.job.companyName, m.job.location].filter(Boolean).join(" · ")} · {timeAgo(m.job.postedAt)}</span>
                      </span>
                      <MatchBadge score={m.score} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Recent activity" pad={false}>
            {events.length === 0 && notifications.length === 0 ? (
              <p className="p-4 text-[13.5px] text-muted">Activity on your applications and account will show up here.</p>
            ) : (
              <ul className="divide-y divide-line text-[13.5px]">
                {events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3 px-4 py-2.5">
                    <span><span className="font-medium">{e.application.job.title}</span> <span className="text-muted">· {e.application.job.companyName}</span><br /><span className="text-[12.5px] text-muted">{e.actorRole === "CANDIDATE" ? "You" : "Employer"}: {e.toStatus ? humanize(e.toStatus) : humanize(e.type)}{e.note ? ` — ${e.note}` : ""}</span></span>
                    <span className="shrink-0 text-[12px] text-muted">{timeAgo(e.createdAt)}</span>
                  </li>
                ))}
                {notifications.map((n) => (
                  <li key={n.id} className="flex justify-between gap-3 px-4 py-2.5">
                    <span>{n.href ? <Link href={n.href} className="hover:underline">{n.title}</Link> : n.title}{n.body && <><br /><span className="text-[12.5px] text-muted">{n.body}</span></>}</span>
                    <span className="shrink-0 text-[12px] text-muted">{timeAgo(n.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="Profile completeness" tint="mint">
            <p className="text-[26px] font-semibold leading-none tabular-nums">{completeness.percent}%</p>
            <div className="mt-3"><Meter value={completeness.percent} label="Profile completeness" /></div>
            <ul className="mt-3 space-y-1 text-[13px]">
              {completeness.checks.filter((c) => !c.done).slice(0, 4).map((c) => <li key={c.key}><Link className="text-ink-2 hover:underline" href={c.href}>+ {c.label}</Link></li>)}
            </ul>
          </Panel>

          <Panel title="Applications">
            {totalApps === 0 ? (
              <p className="text-[13.5px] text-muted">No applications yet. <Link href="/jobs" className="underline">Find a role</Link>.</p>
            ) : (
              <ul className="space-y-1.5 text-[13.5px]">
                {apps.sort((a, b) => b._count - a._count).map((a) => <li key={a.status} className="flex justify-between"><span>{humanize(a.status)}</span><span className="tabular-nums text-muted">{a._count}</span></li>)}
              </ul>
            )}
          </Panel>

          {vs.total > 0 && (
            <Panel tint="sky" title="Profile engagement" description={`Last ${vs.days} days, on CareerPoint only.`}>
              <p className="mb-2 text-[13.5px] font-medium">{vs.verifiedEmployers} verified employer{vs.verifiedEmployers === 1 ? "" : "s"} viewed your profile{vs.verifiedEmployers > 0 && vs.employerNames.length > 0 ? ` — ${vs.employerNames.join(", ")}` : ""}</p>
              <ul className="space-y-1 text-[13px]">{Object.entries(vs.byKind).map(([k, n]) => <li key={k} className="flex justify-between"><span className="text-ink-2">{VIEW_LABEL[k as keyof typeof VIEW_LABEL] ?? k}</span><span className="tabular-nums text-muted">{n}</span></li>)}</ul>
            </Panel>
          )}

          <Panel title="Career recommendations" tint="sand">
            {recs.length === 0 ? <p className="text-[13.5px] text-muted">You&apos;re in good shape. Check back as new jobs arrive.</p> : (
              <ul className="space-y-2.5 text-[13.5px]">
                {recs.slice(0, 4).map((r, i) => <li key={i}><Link href={r.href} className="hover:underline">{r.text}</Link></li>)}
              </ul>
            )}
          </Panel>
          {profile.visibility === "PRIVATE" && <Badge tone="neutral">Your profile is private</Badge>}
        </div>
      </div>
    </>
  );
}
