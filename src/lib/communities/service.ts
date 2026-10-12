import type { CommunityCategory, PostKind, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyEvent } from "@/lib/notifications/service";
import { rateLimitShared } from "@/lib/auth/rate-limit";
import { generateToken, hashToken } from "@/lib/auth/password";
import { isEmployerRole, isStaff } from "@/lib/auth/rbac";
import { ALL_COMMUNITIES } from "./catalog";

export class CommunityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommunityError";
  }
}

export type Actor = { id: string; role: Role; emailVerifiedAt: Date | null };

export const PAGE_SIZE = 20;
/** A person can belong to at most this many communities at once. */
export const MAX_COMMUNITIES = 2;
export const INVITE_DAYS = 7;
export const KINDS: PostKind[] = ["DISCUSSION", "QUESTION", "SHOWCASE"];
export const KIND_LABEL: Record<PostKind, string> = { DISCUSSION: "Discussion", QUESTION: "Question", SHOWCASE: "Showcase" };

/** Makes sure every catalogue community exists (idempotent, cheap when already synced). */
export async function syncCatalog() {
  const have = await db.community.count();
  if (have >= ALL_COMMUNITIES.length) return;
  for (const c of ALL_COMMUNITIES) await db.community.upsert({ where: { slug: c.slug }, create: { slug: c.slug, name: c.name, category: c.category, description: c.description, sortOrder: c.sortOrder }, update: { name: c.name, description: c.description, category: c.category, sortOrder: c.sortOrder } });
}

export async function listCommunities(userId?: string | null) {
  await syncCatalog();
  const [rows, mine, asked] = await Promise.all([
    db.community.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }], include: { _count: { select: { members: true, posts: { where: { hidden: false } } } } } }),
    userId ? db.communityMember.findMany({ where: { userId }, select: { communityId: true } }) : [],
    userId ? db.communityJoinRequest.findMany({ where: { userId, status: "PENDING" }, select: { communityId: true } }) : [],
  ]);
  const joined = new Set(mine.map((m) => m.communityId));
  const requested = new Set(asked.map((m) => m.communityId));
  return rows.map((c) => ({ id: c.id, slug: c.slug, name: c.name, category: c.category as CommunityCategory, description: c.description, members: c._count.members, posts: c._count.posts, joined: joined.has(c.id), requested: requested.has(c.id) }));
}

export async function getCommunity(slug: string, userId?: string | null) {
  await syncCatalog();
  const c = await db.community.findUnique({ where: { slug }, include: { _count: { select: { members: true } } } });
  if (!c) return null;
  const joined = userId ? !!(await db.communityMember.findUnique({ where: { communityId_userId: { communityId: c.id, userId } }, select: { id: true } })) : false;
  const requested = userId && !joined ? !!(await db.communityJoinRequest.findFirst({ where: { communityId: c.id, userId, status: "PENDING" }, select: { id: true } })) : false;
  return { ...c, members: c._count.members, joined, requested };
}

/** Display name + context for an author. Candidates appear by name only; employers also show their company. Never email. */
const AUTHOR = { select: { id: true, name: true, role: true, employerUsers: { take: 1, select: { company: { select: { name: true } } } }, profile: { select: { slug: true, visibility: true, headline: true } } } } satisfies Prisma.UserDefaultArgs;

export function authorView(a: { id: string; name: string; role: Role; employerUsers: { company: { name: string } }[]; profile: { slug: string; visibility: string; headline: string | null } | null }) {
  const staff = isStaff(a.role);
  const company = a.employerUsers[0]?.company.name;
  return {
    id: a.id,
    name: a.name,
    badge: staff ? "CareerPoint team" : isEmployerRole(a.role) ? (company ? `Employer · ${company}` : "Employer") : (a.profile?.visibility === "PUBLIC" ? a.profile.headline : null),
    profileSlug: a.profile?.visibility === "PUBLIC" ? a.profile.slug : null,
  };
}

export async function listPosts(communityId: string, opts: { kind?: PostKind; page?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.CommunityPostWhereInput = { communityId, hidden: false, ...(opts.kind ? { kind: opts.kind } : {}) };
  const [rows, total] = await Promise.all([
    db.communityPost.findMany({ where, orderBy: { lastActivityAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { author: AUTHOR } }),
    db.communityPost.count({ where }),
  ]);
  return { rows: rows.map((r) => ({ ...r, author: authorView(r.author) })), total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getPost(communityId: string, postId: string, viewer?: Actor | null) {
  const post = await db.communityPost.findFirst({ where: { id: postId, communityId }, include: { author: AUTHOR, community: { select: { slug: true, name: true } } } });
  if (!post) return null;
  const staff = !!viewer && isStaff(viewer.role);
  if (post.hidden && !staff && post.authorId !== viewer?.id) return null;
  const comments = await db.communityComment.findMany({ where: { postId: post.id, ...(staff ? {} : { hidden: false }) }, orderBy: { createdAt: "asc" }, take: 300, include: { author: AUTHOR } });
  return { post: { ...post, author: authorView(post.author) }, comments: comments.map((c) => ({ ...c, author: authorView(c.author) })) };
}

// ---- membership ------------------------------------------------------------------------------------------------
// Nobody joins instantly. A person arrives either through a member's invite link (after verifying their email) or by
// asking to join and being approved by a moderator. Either way they can belong to at most MAX_COMMUNITIES communities.

export const membershipCount = (userId: string) => db.communityMember.count({ where: { userId } });
export const isMember = async (userId: string, communityId: string) => !!(await db.communityMember.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { id: true } }));

/** The single place a membership is created, so the cap and the staff rule cannot be bypassed. */
async function addMember(userId: string, role: Role, communityId: string) {
  if (isStaff(role)) throw new CommunityError("Staff accounts moderate communities and do not join them.");
  if (await isMember(userId, communityId)) return false;
  if ((await membershipCount(userId)) >= MAX_COMMUNITIES) throw new CommunityError(`You can belong to at most ${MAX_COMMUNITIES} communities. Leave one to join another.`);
  try {
    await db.communityMember.create({ data: { communityId, userId } });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
    return false;
  }
  // Two simultaneous joins could both pass the count check; undo the extra one.
  if ((await membershipCount(userId)) > MAX_COMMUNITIES) {
    await db.communityMember.deleteMany({ where: { communityId, userId } });
    throw new CommunityError(`You can belong to at most ${MAX_COMMUNITIES} communities. Leave one to join another.`);
  }
  return true;
}

export async function leaveCommunity(user: Actor, slug: string) {
  const c = await db.community.findUnique({ where: { slug }, select: { id: true } });
  if (!c) return;
  await db.communityMember.deleteMany({ where: { communityId: c.id, userId: user.id } });
  await audit(user.id, "community.left", "Community", c.id);
}

export async function requestToJoin(user: Actor, slug: string, message?: string) {
  if (isStaff(user.role)) throw new CommunityError("Staff accounts moderate communities and do not join them.");
  const c = await db.community.findUnique({ where: { slug }, select: { id: true } });
  if (!c) throw new CommunityError("Community not found.");
  if (await isMember(user.id, c.id)) throw new CommunityError("You are already a member.");
  if ((await membershipCount(user.id)) >= MAX_COMMUNITIES) throw new CommunityError(`You can belong to at most ${MAX_COMMUNITIES} communities. Leave one to request another.`);
  if (!(await rateLimitShared(`community-join:${user.id}`, 10, 86400_000)).ok) throw new CommunityError("Too many join requests today. Try again tomorrow.");
  const text = message?.trim().slice(0, 500) || null;
  const req = await db.communityJoinRequest.upsert({ where: { communityId_userId: { communityId: c.id, userId: user.id } }, create: { communityId: c.id, userId: user.id, message: text }, update: { status: "PENDING", message: text, handledAt: null, handledById: null } });
  await audit(user.id, "community.join_requested", "Community", c.id);
  return req;
}

export async function cancelJoinRequest(user: Actor, slug: string) {
  const c = await db.community.findUnique({ where: { slug }, select: { id: true } });
  if (c) await db.communityJoinRequest.deleteMany({ where: { communityId: c.id, userId: user.id, status: "PENDING" } });
}

export async function listPendingJoinRequests(limit = 100) {
  return db.communityJoinRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: limit, include: { community: { select: { slug: true, name: true } }, user: { select: { id: true, name: true, role: true } } } });
}

export async function decideJoinRequest(staff: Actor, requestId: string, approve: boolean) {
  if (!isStaff(staff.role)) throw new CommunityError("Not allowed.");
  const req = await db.communityJoinRequest.findUnique({ where: { id: requestId }, include: { community: { select: { name: true, slug: true } }, user: { select: { id: true, role: true } } } });
  if (!req || req.status !== "PENDING") throw new CommunityError("This request was already handled.");
  const now = new Date();
  if (approve) {
    try {
      await addMember(req.user.id, req.user.role, req.communityId);
    } catch (e) {
      await db.communityJoinRequest.update({ where: { id: req.id }, data: { status: "DECLINED", handledById: staff.id, handledAt: now } });
      await audit(staff.id, "community.join_declined", "Community", req.communityId, { userId: req.user.id, reason: "cap" });
      throw e;
    }
  }
  await db.communityJoinRequest.update({ where: { id: req.id }, data: { status: approve ? "APPROVED" : "DECLINED", handledById: staff.id, handledAt: now } });
  await audit(staff.id, approve ? "community.join_approved" : "community.join_declined", "Community", req.communityId, { userId: req.user.id });
  await notifyEvent(req.user.id, "community.membership", { title: approve ? `You joined ${req.community.name}` : `Your request to join ${req.community.name} was not approved`, href: approve ? `/communities/${req.community.slug}` : "/communities" });
}

// ---- invite links ------------------------------------------------------------------------------------------------

/** Members create links; whoever opens one must verify an email address before joining. The token is shown once. */
export async function createInvite(user: Actor, slug: string) {
  const c = await db.community.findUnique({ where: { slug }, select: { id: true } });
  if (!c) throw new CommunityError("Community not found.");
  if (!isStaff(user.role) && !(await isMember(user.id, c.id))) throw new CommunityError("Only members can invite people.");
  if (!(await rateLimitShared(`community-invite:${user.id}`, 10, 86400_000)).ok) throw new CommunityError("You have created a lot of invite links today. Try again tomorrow.");
  const token = generateToken(24);
  const invite = await db.communityInvite.create({ data: { communityId: c.id, createdById: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) } });
  await audit(user.id, "community.invite_created", "CommunityInvite", invite.id, { community: slug });
  return { token, expiresAt: invite.expiresAt };
}

export async function listMyInvites(userId: string, communityId: string) {
  return db.communityInvite.findMany({ where: { communityId, createdById: userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, uses: true, maxUses: true, expiresAt: true, createdAt: true } });
}

export async function revokeInvite(user: Actor, inviteId: string) {
  const r = await db.communityInvite.updateMany({ where: { id: inviteId, ...(isStaff(user.role) ? {} : { createdById: user.id }), revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count) await audit(user.id, "community.invite_revoked", "CommunityInvite", inviteId);
}

export async function inviteByToken(token: string) {
  const inv = await db.communityInvite.findUnique({ where: { tokenHash: hashToken(token) }, include: { community: { select: { id: true, slug: true, name: true, description: true } } } });
  if (!inv || inv.revokedAt || inv.expiresAt < new Date() || inv.uses >= inv.maxUses) return null;
  return inv;
}

/** Called after the visitor proved control of `verifiedEmail`. The signed-in account must own that same address. */
export async function acceptInvite(user: Actor & { email: string }, token: string, verifiedEmail: string) {
  const inv = await inviteByToken(token);
  if (!inv) throw new CommunityError("This invitation is invalid, expired or has been used up.");
  if (user.email.trim().toLowerCase() !== verifiedEmail.trim().toLowerCase()) throw new CommunityError(`Sign in with ${verifiedEmail}, the address you verified, to accept this invitation.`);
  const joined = await addMember(user.id, user.role, inv.communityId);
  if (joined) {
    const used = await db.communityInvite.updateMany({ where: { id: inv.id, uses: { lt: inv.maxUses } }, data: { uses: { increment: 1 } } });
    if (used.count === 0) {
      await db.communityMember.deleteMany({ where: { communityId: inv.communityId, userId: user.id } });
      throw new CommunityError("This invitation has been used up.");
    }
    // Control of the address was just proven with a one-time code, so the account email counts as verified.
    if (!user.emailVerifiedAt) await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await db.communityJoinRequest.deleteMany({ where: { communityId: inv.communityId, userId: user.id } });
    await audit(user.id, "community.joined_by_invite", "CommunityInvite", inv.id, { community: inv.community.slug });
  }
  return inv.community;
}

// ---- writing ------------------------------------------------------------------------------------------------------

function assertCanWrite(user: Actor) {
  if (isStaff(user.role)) return; // staff may reply officially
  if (!user.emailVerifiedAt) throw new CommunityError("Verify your email address to post. It keeps communities free of spam.");
}

const clean = (s: string) => s.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();

export async function createPost(user: Actor, slug: string, input: { kind: string; title: string; body: string }) {
  assertCanWrite(user);
  const c = await db.community.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!c) throw new CommunityError("Community not found.");
  const title = clean(input.title).replace(/\s+/g, " ");
  const body = clean(input.body);
  if (title.length < 5 || title.length > 140) throw new CommunityError("Give your post a title of 5-140 characters.");
  if (body.length < 10 || body.length > 5000) throw new CommunityError("Write between 10 and 5,000 characters.");
  const kind = KINDS.find((k) => k === input.kind) ?? "DISCUSSION";
  if (!(await rateLimitShared(`community-post:${user.id}`, 10, 3600_000)).ok) throw new CommunityError("You're posting quickly. Try again in a little while.");
  if (!isStaff(user.role) && !(await isMember(user.id, c.id))) throw new CommunityError("Join this community to post. Request to join, or use an invite link from a member.");
  const post = await db.communityPost.create({ data: { communityId: c.id, authorId: user.id, kind, title, body } });
  await audit(user.id, "community.post_created", "CommunityPost", post.id, { community: slug });
  return post;
}

export async function addComment(user: Actor, postId: string, bodyIn: string) {
  assertCanWrite(user);
  const body = clean(bodyIn);
  if (body.length < 1 || body.length > 2000) throw new CommunityError("Write a reply of up to 2,000 characters.");
  const post = await db.communityPost.findFirst({ where: { id: postId, hidden: false }, select: { id: true, authorId: true, title: true, community: { select: { slug: true } } } });
  if (!post) throw new CommunityError("This post is no longer available.");
  const parent = await db.communityPost.findUnique({ where: { id: postId }, select: { communityId: true } });
  if (!isStaff(user.role) && !(parent && (await isMember(user.id, parent.communityId)))) throw new CommunityError("Join this community to reply.");
  if (!(await rateLimitShared(`community-comment:${user.id}`, 40, 3600_000)).ok) throw new CommunityError("You're replying quickly. Try again in a little while.");
  const [comment] = await db.$transaction([
    db.communityComment.create({ data: { postId, authorId: user.id, body } }),
    db.communityPost.update({ where: { id: postId }, data: { commentCount: { increment: 1 }, lastActivityAt: new Date() } }),
  ]);
  if (post.authorId !== user.id) {
    const author = await db.user.findUnique({ where: { id: post.authorId }, select: { role: true } });
    const event = author && isEmployerRole(author.role) ? "community.reply.employer" : "community.reply";
    const who = await db.user.findUnique({ where: { id: user.id }, select: { name: true } });
    await notifyEvent(post.authorId, event, { title: `${who?.name ?? "Someone"} replied to your post`, body: post.title, href: `/communities/${post.community.slug}/posts/${post.id}` });
  }
  return comment;
}

/** Author deletes their own post; staff may hide or restore anything. Hidden content is kept for moderation history. */
export async function setPostHidden(user: Actor, postId: string, hidden: boolean) {
  const post = await db.communityPost.findUnique({ where: { id: postId }, select: { authorId: true } });
  if (!post) throw new CommunityError("Post not found.");
  const staff = isStaff(user.role);
  if (!staff && !(post.authorId === user.id && hidden)) throw new CommunityError("You can't change this post.");
  await db.communityPost.update({ where: { id: postId }, data: { hidden, hiddenById: hidden ? user.id : null } });
  await audit(user.id, hidden ? "community.post_hidden" : "community.post_restored", "CommunityPost", postId, { byStaff: staff });
}

export async function setCommentHidden(user: Actor, commentId: string, hidden: boolean) {
  const c = await db.communityComment.findUnique({ where: { id: commentId }, select: { authorId: true, postId: true, hidden: true } });
  if (!c) throw new CommunityError("Reply not found.");
  const staff = isStaff(user.role);
  if (!staff && !(c.authorId === user.id && hidden)) throw new CommunityError("You can't change this reply.");
  if (c.hidden === hidden) return;
  await db.$transaction([db.communityComment.update({ where: { id: commentId }, data: { hidden } }), db.communityPost.update({ where: { id: c.postId }, data: { commentCount: { increment: hidden ? -1 : 1 } } })]);
  await audit(user.id, hidden ? "community.comment_hidden" : "community.comment_restored", "CommunityComment", commentId, { byStaff: staff });
}

const REPORT_REASONS = ["spam", "abuse", "off_topic", "misleading", "other"] as const;

export async function reportPost(user: Actor, postId: string, reason: string) {
  const r = REPORT_REASONS.find((x) => x === reason);
  if (!r) throw new CommunityError("Choose a reason.");
  const post = await db.communityPost.findUnique({ where: { id: postId }, select: { id: true, authorId: true } });
  if (!post) throw new CommunityError("Post not found.");
  if (post.authorId === user.id) throw new CommunityError("You can't report your own post.");
  await db.communityReport.upsert({ where: { userId_postId: { userId: user.id, postId } }, create: { userId: user.id, postId, reason: r }, update: { reason: r, status: "OPEN", handledAt: null, handledById: null } });
  await audit(user.id, "community.post_reported", "CommunityPost", postId, { reason: r });
}

export async function resolveCommunityReport(staffUser: Actor, reportId: string, outcome: "ACTIONED" | "DISMISSED") {
  if (!isStaff(staffUser.role)) throw new CommunityError("Not allowed.");
  const rep = await db.communityReport.findUnique({ where: { id: reportId }, select: { postId: true } });
  if (!rep) return;
  await db.communityReport.updateMany({ where: { postId: rep.postId, status: "OPEN" }, data: { status: outcome, handledById: staffUser.id, handledAt: new Date() } });
  if (outcome === "ACTIONED") await setPostHidden(staffUser, rep.postId, true);
  await audit(staffUser.id, `community.report_${outcome.toLowerCase()}`, "CommunityPost", rep.postId);
}
