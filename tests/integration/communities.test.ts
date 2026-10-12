import { afterAll, describe, expect, it } from "vitest";
import { cleanup, makeUser, RUN } from "./helpers";
import { db } from "@/lib/db";
import { ALL_COMMUNITIES, CATALOG } from "@/lib/communities/catalog";
import { CommunityError, addComment, createPost, getPost, listCommunities, listPosts, reportPost, resolveCommunityReport, setCommentHidden, setPostHidden } from "@/lib/communities/service";

afterAll(async () => {
  await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: "community-" } } });
  await cleanup();
});

const actor = (u: { id: string; role: never; emailVerifiedAt: Date | null }) => ({ id: u.id, role: u.role, emailVerifiedAt: u.emailVerifiedAt });
/** Test helper: put a user in a community directly (the real paths are invite links and approved requests, tested separately). */
const enter = async (userId: string, slug: string) => {
  const c = await db.community.findUniqueOrThrow({ where: { slug } });
  await db.communityMember.create({ data: { communityId: c.id, userId } });
};
const body = "How do you keep linked models performant on large projects with many links?";

describe("community catalogue", () => {
  it("covers disciplines, technologies, regions and levels with unique slugs", () => {
    expect(Object.keys(CATALOG).sort()).toEqual(["DISCIPLINE", "LEVEL", "REGION", "TECHNOLOGY"]);
    const slugs = ALL_COMMUNITIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of ["architecture", "civil-3d", "revit", "dynamo", "solibri", "uae", "qatar", "students", "managers", "consultants"]) expect(slugs).toContain(s);
  });

  it("syncs idempotently and reports real counts (no invented activity)", async () => {
    const a = await listCommunities();
    const b = await listCommunities();
    expect(a).toHaveLength(ALL_COMMUNITIES.length);
    expect(await db.community.count()).toBe(ALL_COMMUNITIES.length);
    expect(b.find((c) => c.slug === "revit")).toMatchObject({ joined: false });
  });
});

describe("membership and posting", () => {
  it("requires a verified email, validates input and membership", async () => {
    const { user } = await makeUser("cm-post");
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    await enter(user.id, "dynamo");
    const unverified = { id: user.id, role: user.role, emailVerifiedAt: null };
    await expect(createPost(unverified, "dynamo", { kind: "QUESTION", title: "A fine title here", body })).rejects.toThrow(/Verify your email/);
    const ok = actor(user as never);
    await expect(createPost(ok, "dynamo", { kind: "QUESTION", title: "no", body })).rejects.toThrow(/title/);
    await expect(createPost(ok, "dynamo", { kind: "QUESTION", title: "A fine title here", body: "short" })).rejects.toThrow(/characters/);
    await expect(createPost(ok, "no-such-community", { kind: "QUESTION", title: "A fine title here", body })).rejects.toThrow(/not found/);
    const post = await createPost(ok, "dynamo", { kind: "bogus", title: "  A   fine title   here ", body });
    expect(post.kind).toBe("DISCUSSION"); // unknown kinds fall back safely
    expect(post.title).toBe("A fine title here");
    const outsider = await makeUser("cm-outsider");
    await expect(createPost(actor(outsider.user as never), "dynamo", { kind: "QUESTION", title: "A fine title here", body })).rejects.toThrow(/Join this community/);
    expect((await listCommunities(outsider.user.id)).find((c) => c.slug === "dynamo")?.joined).toBe(false); // posting never auto-joins
  });

  it("replies notify the author once per reply (never for self-replies) and bump the thread", async () => {
    const author = await makeUser("cm-author");
    const replier = await makeUser("cm-replier");
    await enter(author.user.id, "navisworks");
    await enter(replier.user.id, "navisworks");
    const post = await createPost(actor(author.user as never), "navisworks", { kind: "QUESTION", title: "Clash tolerances for MEP?", body });
    await addComment(actor(author.user as never), post.id, "Adding context myself.");
    expect(await db.notification.count({ where: { userId: author.user.id, type: "community.reply" } })).toBe(0);
    await addComment(actor(replier.user as never), post.id, "We use 25mm hard clash tolerance.");
    expect(await db.notification.count({ where: { userId: author.user.id, type: "community.reply" } })).toBe(1);
    const full = await db.communityPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(full.commentCount).toBe(2);
    await expect(addComment(actor(replier.user as never), post.id, "   ")).rejects.toBeInstanceOf(CommunityError);
  });
});

describe("moderation and privacy", () => {
  it("authors can delete their own content, others can't, staff can hide and restore", async () => {
    const a = await makeUser("cm-mod-a");
    const b = await makeUser("cm-mod-b");
    const staff = await makeUser("cm-mod-staff", "MODERATOR", { profile: false });
    await enter(a.user.id, "solibri");
    await enter(b.user.id, "solibri");
    const post = await createPost(actor(a.user as never), "solibri", { kind: "DISCUSSION", title: "Ruleset sharing thread", body });
    const c = await addComment(actor(b.user as never), post.id, "Here is our ruleset approach.");
    await expect(setPostHidden(actor(b.user as never), post.id, true)).rejects.toBeInstanceOf(CommunityError);
    await expect(setCommentHidden(actor(a.user as never), c.id, true)).rejects.toBeInstanceOf(CommunityError); // not the comment's author
    await setCommentHidden(actor(b.user as never), c.id, true);
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: post.id } })).commentCount).toBe(0);
    await setPostHidden(actor(staff.user as never), post.id, true);
    const community = await db.community.findUniqueOrThrow({ where: { slug: "solibri" } });
    expect((await listPosts(community.id)).rows.map((r) => r.id)).not.toContain(post.id);
    expect(await getPost(community.id, post.id, null)).toBeNull(); // anonymous can't see hidden posts
    expect(await getPost(community.id, post.id, actor(b.user as never))).toBeNull();
    expect(await getPost(community.id, post.id, actor(staff.user as never))).not.toBeNull();
    await setPostHidden(actor(staff.user as never), post.id, false);
    expect((await listPosts(community.id)).rows.map((r) => r.id)).toContain(post.id);
    await expect(setPostHidden(actor(a.user as never), post.id, false)).rejects.toBeInstanceOf(CommunityError); // authors can delete, not restore
  });

  it("reports hide a post only when a moderator actions them; authors never expose email", async () => {
    const a = await makeUser("cm-rep-a");
    const b = await makeUser("cm-rep-b");
    const staff = await makeUser("cm-rep-staff", "ADMIN", { profile: false });
    await enter(a.user.id, "uk");
    const post = await createPost(actor(a.user as never), "uk", { kind: "SHOWCASE", title: "Our ISO 19650 workflow", body });
    await expect(reportPost(actor(a.user as never), post.id, "spam")).rejects.toThrow(/own post/);
    await expect(reportPost(actor(b.user as never), post.id, "nonsense")).rejects.toThrow(/reason/);
    await reportPost(actor(b.user as never), post.id, "spam");
    await reportPost(actor(b.user as never), post.id, "abuse"); // same reporter updates, never duplicates
    expect(await db.communityReport.count({ where: { postId: post.id } })).toBe(1);
    const rep = await db.communityReport.findFirstOrThrow({ where: { postId: post.id } });
    await expect(resolveCommunityReport(actor(b.user as never), rep.id, "ACTIONED")).rejects.toBeInstanceOf(CommunityError);
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: post.id } })).hidden).toBe(false);
    await resolveCommunityReport(actor(staff.user as never), rep.id, "ACTIONED");
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: post.id } })).hidden).toBe(true);

    const community = await db.community.findUniqueOrThrow({ where: { slug: "uk" } });
    const pub = await createPost(actor(a.user as never), "uk", { kind: "DISCUSSION", title: "Another public thread", body });
    const view = await getPost(community.id, pub.id, null);
    expect(JSON.stringify(view)).not.toContain(a.user.email);
    expect(view?.post.author.profileSlug).toBeNull(); // private profile: no link
    await db.bIMProfessionalProfile.update({ where: { userId: a.user.id }, data: { visibility: "PUBLIC", headline: `Coordinator ${RUN}` } });
    expect((await getPost(community.id, pub.id, null))?.post.author).toMatchObject({ badge: `Coordinator ${RUN}` });
  });
});
