import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { PageHeader } from "@/components/ui";
import { ScoreTool } from "./score-tool";

export const metadata: Metadata = pageMeta({ title: "BIM resume score tool", description: "Paste your resume text and get a deterministic BIM resume score with the exact gaps to close. Nothing is stored.", path: "/tools" });

export default function ToolsPage() {
  return (
    <div className="py-10">
      <PageHeader title="BIM resume score" description="Paste your resume text and get the same deterministic 100-point score used inside CareerPoint. Nothing is stored." />
      <ScoreTool />
    </div>
  );
}
