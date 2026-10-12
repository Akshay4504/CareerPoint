import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { ensureProfile } from "@/lib/services/profile";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, Field, PageHeader, Panel } from "@/components/ui";
import { addPortfolioImage, addPortfolioLink, deletePortfolioItem } from "@/app/actions/portfolio";

export const metadata: Metadata = { title: "Portfolio" };
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const user = await requireArea("app");
  const profile = await ensureProfile(user);
  const [items, projects] = await Promise.all([
    db.portfolioItem.findMany({ where: { profileId: profile.id, projectId: null }, orderBy: { sortOrder: "desc" }, include: { project: true } }),
    db.project.findMany({ where: { profileId: profile.id }, orderBy: { createdAt: "desc" }, include: { portfolio: { orderBy: { sortOrder: "asc" }, take: 1 }, _count: { select: { portfolio: true } } } }),
  ]);
  const projectSelect = (
    <Field label="Related project" htmlFor="projectId">
      <select id="projectId" name="projectId" className="field"><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </Field>
  );

  return (
    <>
      <PageHeader title="Portfolio" description="Show models, sheets and renders. Items are visible to others only when your profile is public." actions={profile.visibility === "PUBLIC" ? <Link href={`/professionals/${profile.slug}`} className="btn btn-secondary btn-sm">View public profile</Link> : <Link href="/profile" className="btn btn-secondary btn-sm">Make profile public</Link>} />
      <section className="mb-10" aria-labelledby="projects-h">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="projects-h" className="eyebrow">BIM projects · {projects.length}</h2>
          <Link href="/portfolio/projects/new" className="btn btn-primary btn-sm">New project</Link>
        </div>
        {projects.length === 0 ? (
          <EmptyState title="No projects yet" description="Document your BIM work: role, software, LOD, challenges, solutions and outcomes. Publish the ones you want on your public profile." action={<Link href="/portfolio/projects/new" className="btn btn-secondary btn-sm">Create your first project</Link>} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id} className="panel overflow-hidden transition-colors hover:border-line-strong">
                <Link href={`/portfolio/projects/${p.id}`} className="block">
                  {p.portfolio[0]?.fileId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${p.portfolio[0].fileId}`} alt="" loading="lazy" className="aspect-[16/10] w-full bg-sunken object-cover" />
                  ) : (
                    <div className="flex aspect-[16/10] items-center justify-center bg-sunken text-[12.5px] text-muted">No image</div>
                  )}
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2"><p className="font-medium leading-snug">{p.name}</p>{p.published ? <Badge tone="ok">Published</Badge> : <Badge>Draft</Badge>}</div>
                    <p className="mt-0.5 text-[12.5px] text-muted">{[p.role, p.sector, p.lod, p.year].filter(Boolean).join(" · ") || "No details yet"}</p>
                    <p className="mt-1 text-[12px] text-muted">{p._count.portfolio} {p._count.portfolio === 1 ? "image" : "images"}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="eyebrow mb-3">Other items</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          {items.length === 0 ? (
            <EmptyState title="Your portfolio is empty" description="Add images of your BIM work, or link to a Behance, Sketchfab or website project." />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {items.map((it) => (
                <li key={it.id} className="panel overflow-hidden">
                  {it.fileId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${it.fileId}`} alt={it.title} loading="lazy" className="aspect-[4/3] w-full bg-sunken object-cover" />
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center bg-sunken text-[13px] text-muted">External link</div>
                  )}
                  <div className="p-3">
                    <p className="font-medium">{it.title}</p>
                    {it.project && <p className="text-[12.5px] text-muted">{it.project.name}</p>}
                    {it.description && <p className="mt-1 text-[13px] text-ink-2">{it.description}</p>}
                    <div className="mt-2 flex items-center justify-between">
                      {it.url ? <a href={it.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[13px] underline">Open link ↗</a> : <span />}
                      <form action={deletePortfolioItem.bind(null, it.id)}><ConfirmButton message="Remove this item?">Remove</ConfirmButton></form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-4">
          <Panel title="Add image" description="PNG, JPG or WebP up to 5 MB.">
            <ActionForm action={addPortfolioImage} className="space-y-3" encType="multipart/form-data" resetOnSuccess>
              <Field label="Title" htmlFor="img-title"><input id="img-title" name="title" required className="field" /></Field>
              <Field label="Description" htmlFor="img-desc"><textarea id="img-desc" name="description" rows={2} className="field" /></Field>
              {projectSelect}
              <input type="file" name="file" required accept="image/png,image/jpeg,image/webp" aria-label="Image file" className="block w-full text-[13px] file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-bg file:px-3 file:py-1.5" />
              <SubmitButton className="btn btn-accent w-full" pendingText="Uploading…">Upload image</SubmitButton>
            </ActionForm>
          </Panel>
          <Panel title="Add link">
            <ActionForm action={addPortfolioLink} className="space-y-3" resetOnSuccess>
              <Field label="Title" htmlFor="ln-title"><input id="ln-title" name="title" required className="field" /></Field>
              <Field label="URL" htmlFor="ln-url"><input id="ln-url" name="url" type="url" required placeholder="https://" className="field" /></Field>
              <Field label="Description" htmlFor="ln-desc"><textarea id="ln-desc" name="description" rows={2} className="field" /></Field>
              <SubmitButton className="btn btn-secondary w-full" pendingText="Adding…">Add link</SubmitButton>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </>
  );
}
