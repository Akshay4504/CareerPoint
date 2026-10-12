import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { PostKind } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/rbac";
import { CATEGORY_LABEL } from "@/lib/communities/catalog";
import { KINDS, KIND_LABEL, MAX_COMMUNITIES, getCommunity, listMyInvites, listPosts, membershipCount } from "@/lib/communities/service";
import { createPostAction } from "@/app/actions/communities";
import { cancelJoinRequestAction, leaveCommunityAction, requestJoinAction, revokeInviteAction } from "@/app/actions/access";
import { InvitePanel } from "./invite-panel";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, Field, PageHeader, Pagination, Panel } from "@/components/ui";
import { pageMeta } from "@/lib/seo";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ kind?: string; page?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = await getCommunity(slug);
  if (!c) return { title: "Community", robots: { index: false, follow: false } };
  return pageMeta({ title: `${c.name} · BIM community`, description: c.description, path: `/communities/${slug}` });
}

export default async function CommunityPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = await getCurrentUser();
  const community = await getCommunity(slug, user?.id);
  if (!community) notFound();
  const kind = KINDS.find((k) => k === sp.kind) as PostKind | undefined;
  const { rows, total, page, pages } = await listPosts(community.id, { kind, page: Number(sp.page) || 1 });
  const staff = !!user && isStaff(user.role);
  const canPost = staff || community.joined;
  const invites = user && canPost ? await listMyInvites(user.id, community.id) : [];
  const used = user && !staff ? await membershipCount(user.id) : 0;
  const tab = (label: string, k?: string) => (
    <Link key={label} href={k ? `/communities/${slug}?kind=${k}` : `/communities/${slug}`} aria-current={(kind ?? "") === (k ?? "") ? "page" : undefined} className={`rounded-md px-3 py-1.5 text-[13px] ${(kind ?? "") === (k ?? "") ? "bg-ink font-medium text-white" : "text-ink-2 hover:bg-sunken"}`}>{label}</Link>
  );

  return (
    <>
      <Link href="/communities" className="text-[13px] text-muted hover:text-ink">← All communities</Link>
      <PageHeader
        title={community.name}
        eyebrow={CATEGORY_LABEL[community.category].title}
        description={`${community.description} · ${community.members} ${community.members === 1 ? "member" : "members"}`}
        actions={user && !staff && community.joined ? (
          <form action={leaveCommunityAction.bind(null, slug)}>
            <button className="btn btn-secondary btn-sm">Member ✓ · Leave</button>
          </form>
        ) : undefined}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0" aria-label="Posts">
          <div className="mb-3 flex flex-wrap gap-1">{tab("All")}{KINDS.map((k) => tab(KIND_LABEL[k] + "s", k))}</div>
          {rows.length === 0 ? (
            <EmptyState title={kind ? `No ${KIND_LABEL[kind].toLowerCase()}s yet` : "No posts yet"} description={canPost ? "Start the conversation: ask a question, share a workflow or show a project." : "Members will post here. Request to join, or use an invite link from a member."} />
          ) : (
            <ul className="space-y-3">
              {rows.map((p) => (
                <li key={p.id} className="panel p-4 transition-colors hover:border-line-strong">
                  <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted"><Badge tone={p.kind === "QUESTION" ? "warn" : p.kind === "SHOWCASE" ? "ok" : "neutral"}>{KIND_LABEL[p.kind]}</Badge>{p.author.name}{p.author.badge ? ` · ${p.author.badge}` : ""} · {timeAgo(p.createdAt)}</p>
                  <h3 className="mt-1.5 text-[16px] leading-snug"><Link href={`/communities/${slug}/posts/${p.id}`} className="hover:underline">{p.title}</Link></h3>
                  <p className="mt-1 line-clamp-2 text-[13.5px] text-ink-2">{p.body}</p>
                  <p className="mt-2 text-[12.5px] text-muted">{p.commentCount} {p.commentCount === 1 ? "reply" : "replies"}{p.commentCount > 0 ? ` · last activity ${timeAgo(p.lastActivityAt)}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
          <Pagination page={page} pages={pages} basePath={`/communities/${slug}`} params={{ kind }} />
          {total > 0 && <p className="mt-3 text-[12px] text-muted">{total} {total === 1 ? "post" : "posts"}</p>}
        </section>

        <aside className="space-y-4">
          {canPost ? (
            <Panel title="Start a conversation" description={`Visible to everyone, in ${community.name}.`}>
              <ActionForm action={createPostAction.bind(null, slug)} className="space-y-3">
                <Field label="Type" htmlFor="kind"><select id="kind" name="kind" className="field">{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
                <Field label="Title" htmlFor="title"><input id="title" name="title" required minLength={5} maxLength={140} className="field" placeholder="e.g. Best way to handle linked MEP models in Revit?" /></Field>
                <Field label="Details" htmlFor="body" hint="Be specific: software version, what you tried, what you expected."><textarea id="body" name="body" required minLength={10} maxLength={5000} rows={6} className="field" /></Field>
                {user && !user.emailVerifiedAt && !staff && <p className="text-[12.5px] text-warn">Verify your email address to post.</p>}
                <SubmitButton className="btn btn-primary w-full" pendingText="Posting…">Post</SubmitButton>
              </ActionForm>
            </Panel>
          ) : (
            <Panel title="Join this community" description="Membership is by approval or invitation. You can read everything in the meantime.">
              {!user ? (
                <div className="space-y-2 text-[13.5px]"><p className="text-muted">Sign in to request membership.</p><Link href={`/login?next=/communities/${slug}`} className="btn btn-primary w-full">Sign in</Link></div>
              ) : community.requested ? (
                <div className="space-y-2 text-[13.5px]">
                  <p className="rounded-md bg-accent-soft px-3 py-2 text-accent-strong">Your request is waiting for a moderator.</p>
                  <form action={cancelJoinRequestAction.bind(null, slug)}><button className="btn btn-ghost btn-sm">Cancel request</button></form>
                </div>
              ) : used >= MAX_COMMUNITIES ? (
                <p className="text-[13.5px] text-muted">You are already in {MAX_COMMUNITIES} communities, the maximum. Leave one to request another.</p>
              ) : (
                <ActionForm action={requestJoinAction.bind(null, slug)} className="space-y-2.5">
                  <Field label="Why would you like to join? (optional)" htmlFor="message"><textarea id="message" name="message" rows={3} maxLength={500} className="field" /></Field>
                  <SubmitButton className="btn btn-primary w-full" pendingText="Sending…">Request to join</SubmitButton>
                  <p className="text-[12px] text-muted">Have an invite link from a member? Open it instead. You can be in {MAX_COMMUNITIES} communities at a time ({used} used).</p>
                </ActionForm>
              )}
            </Panel>
          )}
          {user && canPost && (
            <Panel title="Invite someone">
              <InvitePanel slug={slug} name={community.name} />
              {invites.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-[12.5px]">
                  <li className="eyebrow">Active links</li>
                  {invites.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 text-muted">
                      <span>{i.uses}/{i.maxUses} used · expires {i.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                      <form action={revokeInviteAction.bind(null, slug, i.id)}><button className="underline hover:text-ink">Revoke</button></form>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          <p className="px-1 text-[12px] text-muted">Be respectful, stay on topic and do not share confidential project information. Posts can be reported and are reviewed by moderators.</p>
        </aside>
      </div>
    </>
  );
}
