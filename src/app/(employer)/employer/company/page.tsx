import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireEmployerCtx } from "@/lib/auth/guards";
import { can } from "@/lib/employer/permissions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Field, PageHeader, Panel } from "@/components/ui";
import { saveCompany } from "@/app/actions/employer";
import { SECTORS } from "@/lib/taxonomy";

export const metadata: Metadata = { title: "Company" };
export const dynamic = "force-dynamic";

export default async function CompanyPage() {
  const { ctx } = await requireEmployerCtx();
  const company = await db.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
  const canEdit = can(ctx.role, "company.manage");
  const checks = [
    ["Website", !!company.website],
    ["Description", !!company.description && company.description.length >= 80],
    ["Industry", !!company.industry],
    ["Size", !!company.size],
    ["Locations", company.locations.length > 0],
    ["Logo", !!company.logoFileId],
  ] as const;
  return (
    <>
      <PageHeader title="Company" description="Shown on your public company page and job listings." actions={company.verified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Pending verification</Badge>} />
      <div className="max-w-2xl space-y-6">
        <Panel>
          <ActionForm action={saveCompany} className="grid gap-4 sm:grid-cols-2" encType="multipart/form-data">
            <fieldset disabled={!canEdit} className="contents">
              <Field label="Company name" htmlFor="name" className="sm:col-span-2"><input id="name" name="name" defaultValue={company.name} required className="field" /></Field>
              <Field label="Website" htmlFor="website"><input id="website" name="website" type="url" defaultValue={company.website ?? ""} placeholder="https://" className="field" /></Field>
              <Field label="Industry" htmlFor="industry"><select id="industry" name="industry" defaultValue={company.industry ?? ""} className="field"><option value="">—</option>{SECTORS.map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Company size" htmlFor="size"><select id="size" name="size" defaultValue={company.size ?? ""} className="field"><option value="">—</option>{["1-10", "11-50", "51-200", "201-1000", "1000+"].map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Locations (comma separated)" htmlFor="locations"><input id="locations" name="locations" defaultValue={company.locations.join(", ")} className="field" placeholder="London, Dubai" /></Field>
              <Field label="About" htmlFor="description" className="sm:col-span-2"><textarea id="description" name="description" rows={6} defaultValue={company.description ?? ""} className="field" /></Field>
              <Field label="Logo" htmlFor="logo" className="sm:col-span-2" hint="PNG, JPG or WebP, shown on your jobs.">
                <div className="flex items-center gap-3">
                  {company.logoFileId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${company.logoFileId}`} alt="Current logo" className="h-10 w-10 rounded border border-line object-contain" />
                  )}
                  <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="text-[13px]" />
                </div>
              </Field>
              {canEdit ? <div className="sm:col-span-2"><SubmitButton>Save company</SubmitButton></div> : <p className="text-[13px] text-muted sm:col-span-2">Only company admins can edit these details.</p>}
            </fieldset>
          </ActionForm>
        </Panel>
        <Panel title="Verification" description="Our team reviews each employer before jobs go live and the candidate directory unlocks.">
          <ul className="mb-3 grid grid-cols-2 gap-1.5 text-[13px]">{checks.map(([l, ok]) => <li key={l} className={ok ? "text-ok" : "text-muted"}>{ok ? "✓" : "○"} {l}</li>)}</ul>
          <p className="text-[13.5px] text-ink-2">{company.verified ? "Your company is verified: jobs publish immediately and you can search candidates." : "Complete the checklist above so reviewers have what they need."}</p>
          {company.verified && <Link href={`/companies/${company.slug}`} className="btn btn-secondary btn-sm mt-3">View public page</Link>}
        </Panel>
      </div>
    </>
  );
}
