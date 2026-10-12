import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, Field, PageHeader, Panel } from "@/components/ui";
import { createAlert, deleteAlert, toggleAlert } from "@/app/actions/alerts";
import { criteriaSchema, describeCriteria } from "@/lib/jobs/alerts";
import { jobFacets } from "@/lib/jobs/search";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Job alerts" };
export const dynamic = "force-dynamic";

type SP = { keywords?: string; role?: string; country?: string; city?: string };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireArea("app");
  const [alerts, facets, profile] = await Promise.all([db.jobAlert.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }), jobFacets(), db.bIMProfessionalProfile.findUnique({ where: { userId: user.id }, select: { id: true, city: true, preferredLocations: true } })]);

  return (
    <>
      <PageHeader title="Job alerts" description="Get notified when BIM jobs matching your criteria are found. Alerts only use jobs we have actually discovered." actions={<Link href="/jobs" className="btn btn-ghost btn-sm">← Jobs</Link>} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          {alerts.length === 0 ? (
            <EmptyState title="No alerts yet" description="For example: “Notify me when BIM Coordinator jobs matching my profile are found in Bengaluru.”" />
          ) : (
            alerts.map((a) => {
              const c = criteriaSchema.safeParse(a.criteria);
              return (
                <article key={a.id} className="panel p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-[14.5px]">{a.name}</h2>
                      <p className="mt-0.5 text-[12.5px] text-muted">{c.success ? describeCriteria(c.data) : "Invalid criteria"}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                        <Badge>{a.frequency.toLowerCase()}</Badge>
                        {a.channels.map((ch) => <Badge key={ch}>{ch === "IN_APP" ? "in-app" : "email"}</Badge>)}
                        {!a.active && <Badge tone="warn">Paused</Badge>}
                        <span>{a.lastNotifiedAt ? `last notified ${timeAgo(a.lastNotifiedAt)}` : "not triggered yet"}</span>
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <form action={toggleAlert.bind(null, a.id, !a.active)}><button className="btn btn-secondary btn-sm">{a.active ? "Pause" : "Resume"}</button></form>
                      <form action={deleteAlert.bind(null, a.id)}><ConfirmButton message="Delete this alert?">Delete</ConfirmButton></form>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <Panel title="New alert">
          <ActionForm action={createAlert} className="space-y-3" resetOnSuccess>
            <Field label="Keywords" htmlFor="keywords"><input id="keywords" name="keywords" defaultValue={sp.keywords} className="field" placeholder="e.g. coordinator" /></Field>
            <Field label="BIM role" htmlFor="bimRole"><select id="bimRole" name="bimRole" defaultValue={sp.role ?? ""} className="field"><option value="">Any</option>{facets.roles.map((r) => <option key={r.value}>{r.value}</option>)}{sp.role && !facets.roles.some((r) => r.value === sp.role) && <option>{sp.role}</option>}</select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City" htmlFor="city"><input id="city" name="city" defaultValue={sp.city ?? profile?.preferredLocations[0] ?? profile?.city ?? ""} className="field" placeholder="e.g. Bengaluru" /></Field>
              <Field label="Country" htmlFor="country"><input id="country" name="country" defaultValue={sp.country} className="field" placeholder="e.g. India" /></Field>
            </div>
            <Field label="Software (comma separated, all required)" htmlFor="software"><input id="software" name="software" className="field" placeholder="Revit, Navisworks" /></Field>
            <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="remote" /> Remote only</label>
            <div className="rounded-md border border-line bg-surface p-3">
              <label className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" name="matchProfile" defaultChecked={!!profile} className="mt-1" disabled={!profile} /> <span>Only jobs that match my profile<br /><span className="text-[12.5px] text-muted">Compatibility score at least <input type="number" name="minMatch" defaultValue={55} min={10} max={100} className="field mx-1 inline-block w-16 py-0.5" aria-label="Minimum match percent" />%</span></span></label>
            </div>
            <Field label="How often" htmlFor="frequency"><select id="frequency" name="frequency" defaultValue="DAILY" className="field"><option value="INSTANT">As soon as found</option><option value="DAILY">Daily digest</option><option value="WEEKLY">Weekly digest</option></select></Field>
            <fieldset><legend className="label">Notify me by</legend><div className="flex gap-4 text-[13.5px]"><label className="flex items-center gap-1.5"><input type="checkbox" name="channels" value="IN_APP" defaultChecked /> In-app</label><label className="flex items-center gap-1.5"><input type="checkbox" name="channels" value="EMAIL" defaultChecked /> Email</label></div></fieldset>
            <SubmitButton className="btn btn-accent w-full" pendingText="Creating…">Create alert</SubmitButton>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
