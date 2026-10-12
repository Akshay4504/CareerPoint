import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/guards";
import ResumeTailor from "@/components/ResumeTailor";
import { ResumeView } from "@/components/resume-view";
import { PrintButton } from "./print-button";
import type { ResumeContent } from "@/lib/resume/types";

export const metadata: Metadata = { title: "Resume preview" };
export const dynamic = "force-dynamic";

export default async function ResumePreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireArea("app");
  // Ownership enforced in the query: someone else's resume id is a 404.
  const resume = await db.resume.findFirst({ where: { id, profile: { userId: user.id } }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!resume || !resume.versions[0]) notFound();
  return (
    <>
      <div className="no-print mb-6 flex items-center justify-between">
        <Link href="/resume" className="text-[13px] text-muted hover:text-ink">← Resumes</Link>
        <PrintButton />
      </div>
      <div className="no-print mb-8">
        <ResumeTailor resumeId={resume.id} />
      </div>
      <ResumeView content={resume.versions[0].content as unknown as ResumeContent} />
    </>
  );
}
