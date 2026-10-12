import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { absoluteUrl } from "@/lib/seo";

// Public, indexable URLs only. Bounded: one sitemap file holds up to 50,000 URLs; we cap each section well below that.
export const dynamic = "force-dynamic";
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [jobs, companies, profiles, communities, posts] = await Promise.all([
    db.job.findMany({ where: { status: "ACTIVE", canonicalJobId: null }, select: { slug: true, updatedAt: true }, orderBy: { postedAt: "desc" }, take: 20000 }),
    db.company.findMany({ where: { verified: true }, select: { slug: true, createdAt: true }, take: 5000 }),
    db.bIMProfessionalProfile.findMany({ where: { visibility: "PUBLIC" }, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 20000 }),
    db.community.findMany({ select: { slug: true } }),
    db.communityPost.findMany({ where: { hidden: false }, select: { id: true, lastActivityAt: true, community: { select: { slug: true } } }, orderBy: { lastActivityAt: "desc" }, take: 10000 }),
  ]);
  const stat = (path: string, priority: number, changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]) => ({ url: absoluteUrl(path), priority, changeFrequency });
  return [
    stat("/", 1, "weekly"),
    stat("/jobs", 0.9, "hourly"),
    stat("/professionals", 0.6, "daily"),
    stat("/companies", 0.6, "daily"),
    stat("/communities", 0.6, "daily"),
    stat("/resources", 0.6, "monthly"),
    stat("/tools", 0.6, "monthly"),
    ...jobs.map((j) => ({ url: absoluteUrl(`/jobs/${j.slug}`), lastModified: j.updatedAt, changeFrequency: "daily" as const, priority: 0.8 })),
    ...companies.map((c) => ({ url: absoluteUrl(`/companies/${c.slug}`), lastModified: c.createdAt, changeFrequency: "weekly" as const, priority: 0.5 })),
    ...communities.map((c) => ({ url: absoluteUrl(`/communities/${c.slug}`), changeFrequency: "daily" as const, priority: 0.5 })),
    ...posts.map((p) => ({ url: absoluteUrl(`/communities/${p.community.slug}/posts/${p.id}`), lastModified: p.lastActivityAt, changeFrequency: "weekly" as const, priority: 0.4 })),
    ...profiles.map((p) => ({ url: absoluteUrl(`/professionals/${p.slug}`), lastModified: p.updatedAt, changeFrequency: "weekly" as const, priority: 0.4 })),
  ];
}
