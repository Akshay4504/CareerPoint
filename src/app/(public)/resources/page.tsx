import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import { BIM_CERTIFICATIONS, BIM_SKILLS, BIM_SOFTWARE, DISCIPLINES } from "@/lib/taxonomy";
import { Chip, PageHeader } from "@/components/ui";

export const metadata: Metadata = pageMeta({ title: "BIM career resources", description: "Practical guidance for BIM careers: resumes, portfolios, software, standards such as ISO 19650, and interviews.", path: "/resources" });

function group<T extends { category?: string }>(items: T[]) {
  const m = new Map<string, T[]>();
  for (const i of items) m.set(i.category ?? "Other", [...(m.get(i.category ?? "Other") ?? []), i]);
  return [...m.entries()];
}

export default function ResourcesPage() {
  return (
    <div className="py-10">
      <PageHeader title="BIM career resources" description="The vocabulary CareerPoint uses to read resumes, score them and match jobs. Use these exact terms on your resume to be understood." />

      <section className="mb-12">
        <h2 className="mb-4 text-[18px]">Software employers look for</h2>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {group(BIM_SOFTWARE).map(([cat, items]) => (
            <div key={cat}>
              <p className="eyebrow mb-1.5">{cat}</p>
              <div className="flex flex-wrap gap-1">{items.map((i) => <Chip key={i.name}>{i.name}</Chip>)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-[18px]">Skills &amp; standards</h2>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {group(BIM_SKILLS).map(([cat, items]) => (
            <div key={cat}>
              <p className="eyebrow mb-1.5">{cat}</p>
              <div className="flex flex-wrap gap-1">{items.map((i) => <Chip key={i.name}>{i.name}</Chip>)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12 grid gap-8 sm:grid-cols-2">
        <div>
          <h2 className="mb-3 text-[18px]">Recognised certifications</h2>
          <ul className="space-y-1.5 text-[13.5px] text-ink-2">{BIM_CERTIFICATIONS.map((c) => <li key={c.name}>{c.name}</li>)}</ul>
        </div>
        <div>
          <h2 className="mb-3 text-[18px]">Disciplines</h2>
          <ul className="space-y-1.5 text-[13.5px] text-ink-2">{DISCIPLINES.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      </section>

      <div className="rounded-lg border border-line bg-surface p-6">
        <p className="font-medium">See how your resume reads against this vocabulary.</p>
        <Link href="/tools" className="btn btn-primary mt-3">Open the resume score tool</Link>
      </div>
    </div>
  );
}
