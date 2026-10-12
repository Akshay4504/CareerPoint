import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import { PageHeader } from "@/components/ui";
import { ResumeEditor, type MasterOptions } from "./editor";
import { duplicateResumeAction } from "@/app/actions/builder";
import type { ResumeContent } from "@/lib/resume/types";

export const metadata: Metadata = { title: "Edit resume" };
export const dynamic = "force-dynamic";

export default async function EditResumePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireArea("app");
  const resume = await db.resume.findFirst({ where: { id, profile: { userId: user.id } }, include: { versions: { orderBy: { version: "desc" }, take: 1 }, profile: { include: { softwareSkills: true, skills: { include: { skill: true } }, certifications: true, educations: true, languages: true, portfolioItems: { orderBy: { sortOrder: "desc" } } } } } });
  if (!resume || !resume.versions[0]) notFound();
  const p = resume.profile;
  const master: MasterOptions = {
    software: p.softwareSkills.map((s) => s.software),
    skills: p.skills.map((s) => s.skill.name),
    certifications: p.certifications.map((c) => c.name),
    educations: p.educations.map((e) => ({ school: e.school, degree: e.degree ?? undefined, field: e.field ?? undefined, startYear: e.startYear ?? undefined, endYear: e.endYear ?? undefined })),
    languages: p.languages.map((l) => ({ name: l.name, level: l.level ?? undefined })),
    portfolio: p.portfolioItems.map((i) => ({ id: i.id, title: i.title, description: i.description ?? undefined, url: i.url ?? undefined })),
  };
  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Resume builder"
          description={resume.kind === "UPLOADED" ? "Editing saves a new version. Your original upload and earlier versions are never changed." : "Your master profile is unchanged — this version is yours to tailor."}
          actions={
            <>
              <Link href="/resume" className="btn btn-ghost btn-sm">← Resumes</Link>
              <Link href={`/resume/assistant?resume=${resume.id}`} className="btn btn-secondary btn-sm">AI assistant</Link>
              <Link href={`/resume/score?resume=${resume.id}`} className="btn btn-secondary btn-sm">Score</Link>
              <form action={duplicateResumeAction.bind(null, resume.id)}><button className="btn btn-secondary btn-sm">Duplicate</button></form>
            </>
          }
        />
      </div>
      <ResumeEditor resumeId={resume.id} initial={resume.versions[0].content as unknown as ResumeContent} master={master} title={resume.title} version={resume.versions[0].version} />
    </>
  );
}
