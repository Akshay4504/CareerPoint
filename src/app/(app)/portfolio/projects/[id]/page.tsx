import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { addProjectImageAction, deleteProjectAction, publishProjectAction, removeProjectImageAction } from "@/app/actions/projects";
import { publishBlockers } from "@/lib/services/portfolio";
import { ProjectForm } from "../../project-form";

export const metadata: Metadata = { title: "Edit project" };
export const dynamic = "force-dynamic";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireArea("app");
  // Ownership enforced in the query.
  const project = await db.project.findFirst({ where: { id, profile: { userId: user.id } }, include: { portfolio: { orderBy: { sortOrder: "asc" } }, profile: { select: { visibility: true, slug: true } } } });
  if (!project) notFound();
  const blockers = publishBlockers(project);

  return (
    <>
      <PageHeader
        title={project.name}
        actions={
          <>
            <Link href="/portfolio" className="btn btn-ghost btn-sm">← Portfolio</Link>
            {project.published ? <Badge tone="ok">Published</Badge> : <Badge>Draft</Badge>}
            <form action={publishProjectAction.bind(null, project.id, !project.published)}><button className="btn btn-secondary btn-sm" disabled={!project.published && blockers.length > 0}>{project.published ? "Unpublish" : "Publish"}</button></form>
          </>
        }
      />
      {!project.published && blockers.length > 0 && <p className="mb-4 text-[13px] text-muted">To publish: {blockers.join("; ")}.</p>}
      {project.published && project.profile.visibility !== "PUBLIC" && <p role="note" className="mb-4 rounded-md border border-[#ecd29e] bg-warn-soft px-3 py-2 text-[13px] text-warn">This project is published, but your profile is private, so nobody can see it. <Link href="/profile" className="underline">Make your profile public</Link>.</p>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ProjectForm project={project} />
        <div className="space-y-4">
          <Panel title={`Images (${project.portfolio.length}/8)`} description="PNG, JPG or WebP up to 5 MB.">
            {project.portfolio.length > 0 && (
              <ul className="mb-4 grid grid-cols-2 gap-2">
                {project.portfolio.map((it) => (
                  <li key={it.id} className="overflow-hidden rounded-md border border-line">
                    {it.fileId && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/files/${it.fileId}`} alt={it.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                    )}
                    <form action={removeProjectImageAction.bind(null, project.id, it.id)} className="p-1.5"><ConfirmButton message="Remove this image?" className="btn btn-ghost btn-sm w-full text-bad">Remove</ConfirmButton></form>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={addProjectImageAction.bind(null, project.id)} className="space-y-2" encType="multipart/form-data" resetOnSuccess>
              <input name="title" placeholder="Caption (optional)" className="field" aria-label="Caption" />
              <input type="file" name="file" required accept="image/png,image/jpeg,image/webp" aria-label="Image file" className="block w-full text-[13px] file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-bg file:px-3 file:py-1.5" />
              <SubmitButton className="btn btn-secondary w-full" pendingText="Uploading…">Upload image</SubmitButton>
            </ActionForm>
          </Panel>
          <Panel title="Delete project">
            <form action={deleteProjectAction.bind(null, project.id)}><ConfirmButton message="Delete this project and its images?" className="btn btn-danger btn-sm">Delete project</ConfirmButton></form>
          </Panel>
        </div>
      </div>
    </>
  );
}
