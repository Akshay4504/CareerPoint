import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/lib/auth/guards";
import { PageHeader } from "@/components/ui";
import { ProjectForm } from "../../project-form";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage() {
  await requireArea("app");
  return (
    <>
      <PageHeader title="New project" description="Projects stay private until you publish them." actions={<Link href="/portfolio" className="btn btn-ghost btn-sm">← Portfolio</Link>} />
      <ProjectForm />
    </>
  );
}
