"use server";

import { revalidatePath } from "next/cache";
import { actionUser } from "@/lib/auth/guards";
import { log } from "@/lib/log";
import { CommunityError, addComment, createPost, reportPost, resolveCommunityReport, setCommentHidden, setPostHidden } from "@/lib/communities/service";
import type { ActionState } from "@/components/forms";

function msg(e: unknown) {
  if (e instanceof CommunityError) return e.message;
  log.error("community.action_failed", { err: e });
  return "Something went wrong. Please try again.";
}

export async function createPostAction(slug: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await actionUser();
  if (!user) return { error: "Please sign in to post." };
  try {
    const post = await createPost(user, slug, { kind: String(fd.get("kind") ?? ""), title: String(fd.get("title") ?? ""), body: String(fd.get("body") ?? "") });
    revalidatePath(`/communities/${slug}`);
    return { ok: "Posted.", redirectTo: `/communities/${slug}/posts/${post.id}` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function addCommentAction(slug: string, postId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await actionUser();
  if (!user) return { error: "Please sign in to reply." };
  try {
    await addComment(user, postId, String(fd.get("body") ?? ""));
    revalidatePath(`/communities/${slug}/posts/${postId}`);
    return { ok: "Reply posted." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function hidePostAction(slug: string, postId: string, hidden: boolean): Promise<void> {
  const user = await actionUser();
  if (!user) return;
  try {
    await setPostHidden(user, postId, hidden);
  } catch (e) {
    msg(e);
  }
  revalidatePath(`/communities/${slug}`);
  revalidatePath(`/communities/${slug}/posts/${postId}`);
}

export async function hideCommentAction(slug: string, postId: string, commentId: string, hidden: boolean): Promise<void> {
  const user = await actionUser();
  if (!user) return;
  try {
    await setCommentHidden(user, commentId, hidden);
  } catch (e) {
    msg(e);
  }
  revalidatePath(`/communities/${slug}/posts/${postId}`);
}

export async function reportPostAction(postId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await actionUser();
  if (!user) return { error: "Please sign in to report." };
  try {
    await reportPost(user, postId, String(fd.get("reason") ?? ""));
    revalidatePath("/admin/reports");
    return { ok: "Thanks. A moderator will review this post." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function resolveCommunityReportAction(reportId: string, outcome: "ACTIONED" | "DISMISSED"): Promise<void> {
  const user = await actionUser("admin");
  if (!user) return;
  try {
    await resolveCommunityReport(user, reportId, outcome);
  } catch (e) {
    msg(e);
  }
  revalidatePath("/admin/reports");
}
