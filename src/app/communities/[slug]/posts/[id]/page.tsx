import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/rbac";
import { KIND_LABEL, getCommunity, getPost } from "@/lib/communities/service";
import { addCommentAction, hideCommentAction, hidePostAction, reportPostAction } from "@/app/actions/communities";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Panel } from "@/components/ui";
import { db } from "@/lib/db";
import { pageMeta } from "@/lib/seo";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, id } = await params;
  const p = await db.communityPost.findFirst({ where: { id, hidden: false, community: { slug } }, select: { title: true, body: true, community: { select: { name: true } } } });
  if (!p) return { title: "Post", robots: { index: false, follow: false } };
  return pageMeta({ title: `${p.title} · ${p.community.name}`, description: p.body, path: `/communities/${slug}/posts/${id}`, type: "article" });
}

export default async function PostPage({ params }: Props) {
  const { slug, id } = await params;
  const user = await getCurrentUser();
  const community = await getCommunity(slug);
  if (!community) notFound();
  const data = await getPost(community.id, id, user);
  if (!data) notFound();
  const { post, comments } = data;
  const staff = !!user && isStaff(user.role);
  const mine = user?.id === post.authorId;

  return (
    <>
      <Link href={`/communities/${slug}`} className="text-[13px] text-muted hover:text-ink">← {community.name}</Link>
      <article className="mt-3 max-w-3xl">
        {post.hidden && <p role="status" className="mb-3 rounded-md border border-[#f5dfae] bg-warn-soft px-3 py-2 text-[13px] text-warn">This post is hidden from the community{staff ? ". You can restore it below." : "."}</p>}
        <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted"><Badge tone={post.kind === "QUESTION" ? "warn" : post.kind === "SHOWCASE" ? "ok" : "neutral"}>{KIND_LABEL[post.kind]}</Badge>{timeAgo(post.createdAt)}</p>
        <h1 className="mt-2 text-[24px] leading-tight">{post.title}</h1>
        <div className="mt-3 flex items-center gap-2.5">
          <Avatar name={post.author.name} size={32} />
          <div className="text-[13px] leading-tight">
            <p className="font-medium">{post.author.profileSlug ? <Link href={`/professionals/${post.author.profileSlug}`} className="hover:underline">{post.author.name}</Link> : post.author.name}</p>
            {post.author.badge && <p className="text-muted">{post.author.badge}</p>}
          </div>
        </div>
        <div className="prose-plain mt-5 text-[15px] leading-relaxed text-ink-2">{post.body}</div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-[13px]">
          {(mine || staff) && !post.hidden && (
            <form action={hidePostAction.bind(null, slug, post.id, true)}><ConfirmButton message={mine ? "Delete your post?" : "Hide this post from the community?"} className="text-bad underline">{mine ? "Delete post" : "Hide post (moderator)"}</ConfirmButton></form>
          )}
          {staff && post.hidden && <form action={hidePostAction.bind(null, slug, post.id, false)}><button className="underline">Restore post</button></form>}
          {user && !mine && !post.hidden && (
            <details>
              <summary className="text-muted hover:text-ink">Report</summary>
              <ActionForm action={reportPostAction.bind(null, post.id)} className="mt-2 flex items-center gap-2">
                <label className="sr-only" htmlFor="rr">Reason</label>
                <select id="rr" name="reason" className="field w-auto py-1 text-[13px]" required defaultValue="">
                  <option value="" disabled>Reason…</option>
                  <option value="spam">Spam</option><option value="abuse">Abusive</option><option value="off_topic">Off topic</option><option value="misleading">Misleading</option><option value="other">Other</option>
                </select>
                <SubmitButton className="btn btn-secondary btn-sm" pendingText="Sending…">Send</SubmitButton>
              </ActionForm>
            </details>
          )}
        </div>

        <section aria-labelledby="replies" className="mt-8">
          <h2 id="replies" className="text-[16px]">{post.commentCount} {post.commentCount === 1 ? "reply" : "replies"}</h2>
          <ul className="mt-3 space-y-3">
            {comments.map((c) => (
              <li key={c.id} className={`panel p-4 ${c.hidden ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={c.author.name} size={28} />
                    <div className="text-[13px] leading-tight"><p className="font-medium">{c.author.name}{c.author.id === post.authorId && <span className="ml-1.5 font-normal text-accent">author</span>}</p>{c.author.badge && <p className="text-muted">{c.author.badge}</p>}</div>
                  </div>
                  <span className="text-[12px] text-muted">{timeAgo(c.createdAt)}</span>
                </div>
                <p className="prose-plain mt-2 text-[14px] text-ink-2">{c.hidden ? "[hidden by a moderator]" : c.body}</p>
                {user && (staff || (user.id === c.author.id && !c.hidden)) && (
                  <form action={hideCommentAction.bind(null, slug, post.id, c.id, !c.hidden)} className="mt-1.5">
                    <button className="text-[12px] text-muted underline hover:text-ink">{c.hidden ? "Restore" : user.id === c.author.id ? "Delete" : "Hide"}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {!post.hidden && (
            <Panel className="mt-4" title="Add a reply">
              {!user ? (
                <p className="text-[13.5px] text-muted"><Link href={`/login?next=/communities/${slug}/posts/${post.id}`} className="font-medium text-accent underline">Sign in</Link> to reply.</p>
              ) : (
                <ActionForm action={addCommentAction.bind(null, slug, post.id)} className="space-y-2.5" resetOnSuccess>
                  <label className="sr-only" htmlFor="reply">Reply</label>
                  <textarea id="reply" name="body" required maxLength={2000} rows={4} className="field" placeholder="Share what worked for you…" />
                  <SubmitButton className="btn btn-primary" pendingText="Posting…">Reply</SubmitButton>
                </ActionForm>
              )}
            </Panel>
          )}
        </section>
      </article>
    </>
  );
}
