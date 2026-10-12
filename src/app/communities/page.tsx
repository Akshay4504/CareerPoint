import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/lib/communities/catalog";
import { listCommunities } from "@/lib/communities/service";
import { Badge, PageHeader } from "@/components/ui";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({ title: "BIM communities", description: "Join structured BIM communities by discipline, technology, region and career level. Ask questions, share work and learn from people who do the same job.", path: "/communities" });
export const dynamic = "force-dynamic";

export default async function CommunitiesPage() {
  const user = await getCurrentUser();
  const all = await listCommunities(user?.id);
  const mine = all.filter((c) => c.joined);

  const card = (c: (typeof all)[number]) => (
    <li key={c.id} className="panel flex flex-col p-4 transition-all hover:border-line-strong hover:shadow-[0_4px_16px_-8px_rgba(47,60,120,0.25)]">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] leading-snug"><Link href={`/communities/${c.slug}`} className="hover:underline">{c.name}</Link></h3>
        {c.joined && <Badge tone="accent">Member</Badge>}
      </div>
      <p className="mt-1 flex-1 text-[13px] text-muted">{c.description}</p>
      <div className="mt-3 flex items-center justify-between gap-2 text-[12.5px] text-muted">
        <span>{c.members} {c.members === 1 ? "member" : "members"} · {c.posts} {c.posts === 1 ? "post" : "posts"}</span>
        {c.requested && !c.joined && <Badge>Requested</Badge>}
      </div>
    </li>
  );

  return (
    <>
      <PageHeader title="BIM communities" description="Discussions organised around how BIM professionals identify themselves: what you work on, the tools you use, where you are and where you are in your career. Membership is by approval or invitation, and you can be in up to 2 communities." />
      {!user && (
        <p role="note" className="mb-6 rounded-lg border border-line bg-bg px-4 py-3 text-[13.5px] text-ink-2">
          Browse freely. <Link href="/register" className="font-medium text-accent underline">Create a profile</Link> or <Link href="/login?next=/communities" className="font-medium text-accent underline">sign in</Link>, then request to join or use an invite from a member.
        </p>
      )}
      {mine.length > 0 && (
        <section aria-labelledby="mine" className="mb-10">
          <h2 id="mine" className="eyebrow mb-3">Your communities</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{mine.map(card)}</ul>
        </section>
      )}
      {CATEGORY_ORDER.map((cat) => (
        <section key={cat} aria-labelledby={`cat-${cat}`} className="mb-10">
          <h2 id={`cat-${cat}`} className="text-[17px]">{CATEGORY_LABEL[cat].title}</h2>
          <p className="mb-3 text-[13.5px] text-muted">{CATEGORY_LABEL[cat].blurb}</p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{all.filter((c) => c.category === cat).map(card)}</ul>
        </section>
      ))}
    </>
  );
}
