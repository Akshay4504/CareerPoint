import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { Avatar, Chip, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { DISCIPLINES } from "@/lib/taxonomy";

export const metadata: Metadata = pageMeta({ title: "BIM professionals", description: "Public profiles of BIM coordinators, modelers, engineers and managers, with the software, projects and certifications they chose to share.", path: "/professionals" });
export const dynamic = "force-dynamic";
const PAGE_SIZE = 18;

export default async function ProfessionalsPage({ searchParams }: { searchParams: Promise<{ q?: string; discipline?: string; page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.BIMProfessionalProfileWhereInput = { visibility: "PUBLIC" };
  if (sp.discipline) where.discipline = sp.discipline;
  if (sp.q?.trim()) {
    const q = sp.q.trim().slice(0, 80);
    where.OR = [{ headline: { contains: q, mode: "insensitive" } }, { user: { name: { contains: q, mode: "insensitive" } } }, { location: { contains: q, mode: "insensitive" } }, { softwareSkills: { some: { software: { contains: q, mode: "insensitive" } } } }];
  }
  const [rows, total] = await Promise.all([
    db.bIMProfessionalProfile.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { user: { select: { name: true } }, softwareSkills: { take: 5, orderBy: { years: "desc" } } } }),
    db.bIMProfessionalProfile.count({ where }),
  ]);

  return (
    <>
      <PageHeader title="BIM professionals" description="Public profiles from CareerPoint members. Contact details are never shown." />
      <form className="panel mb-5 grid gap-3 p-3 sm:grid-cols-[2fr_1fr_auto]" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Name, headline, software, location…" className="field" aria-label="Search professionals" />
        <select name="discipline" defaultValue={sp.discipline ?? ""} className="field" aria-label="Discipline"><option value="">Any discipline</option>{DISCIPLINES.map((d) => <option key={d}>{d}</option>)}</select>
        <button className="btn btn-primary btn-sm">Search</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No public profiles found" description="Profiles appear here when members choose to make them public." action={<Link href="/register" className="btn btn-secondary btn-sm">Create your profile</Link>} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => (
            <li key={p.id}>
              <Link href={`/professionals/${p.slug}`} className="panel flex h-full flex-col gap-3 p-4 transition-colors hover:border-line-strong">
                <div className="flex items-center gap-3">
                  <Avatar name={p.user.name} src={p.avatarFileId ? `/api/files/${p.avatarFileId}` : null} size={40} />
                  <div className="min-w-0"><p className="truncate font-medium">{p.user.name}</p><p className="truncate text-[12.5px] text-muted">{p.headline ?? p.discipline ?? "BIM professional"}</p></div>
                </div>
                <p className="text-[12.5px] text-muted">{[p.location, p.yearsExperience != null ? `${p.yearsExperience}y experience` : null].filter(Boolean).join(" · ")}</p>
                <div className="mt-auto flex flex-wrap gap-1">{p.softwareSkills.map((s) => <Chip key={s.id}>{s.software}</Chip>)}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pages={Math.ceil(total / PAGE_SIZE)} basePath="/professionals" params={{ q: sp.q, discipline: sp.discipline }} />
    </>
  );
}
