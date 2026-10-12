"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth/guards";
import { ensureProfile } from "@/lib/services/profile";
import { deleteStored, saveUpload } from "@/lib/files/storage";
import { safeUrl } from "@/lib/utils";
import type { ActionState } from "@/components/forms";

async function ctx() {
  const user = await actionUser("app");
  if (!user) return null;
  return { user, profile: await ensureProfile(user) };
}

const MAX_ITEMS = 24;
const base = z.object({ title: z.string().trim().min(2, "Enter a title").max(120), description: z.string().trim().max(1000).optional(), projectId: z.string().optional() });

async function validProject(profileId: string, projectId?: string) {
  if (!projectId) return null;
  const p = await db.project.findFirst({ where: { id: projectId, profileId }, select: { id: true } });
  return p?.id ?? null;
}

export async function addPortfolioImage(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const parsed = base.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if ((await db.portfolioItem.count({ where: { profileId: c.profile.id } })) >= MAX_ITEMS) return { error: `Portfolio is limited to ${MAX_ITEMS} items.` };
  const res = await saveUpload({ ownerId: c.user.id, kind: "PORTFOLIO_IMAGE", file: fd.get("file") as File | null });
  if (!res.ok) return { error: res.error };
  await db.portfolioItem.create({ data: { profileId: c.profile.id, kind: "IMAGE", title: parsed.data.title, description: parsed.data.description || null, fileId: res.fileId, projectId: await validProject(c.profile.id, parsed.data.projectId), sortOrder: Date.now() % 2_000_000_000 } });
  revalidatePath("/portfolio");
  revalidatePath("/dashboard");
  return { ok: "Added to portfolio." };
}

export async function addPortfolioLink(_p: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  if (!c) return { error: "Please sign in again." };
  const parsed = base.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const url = safeUrl(String(fd.get("url") ?? ""));
  if (!url) return { error: "Enter a valid http(s) link." };
  if ((await db.portfolioItem.count({ where: { profileId: c.profile.id } })) >= MAX_ITEMS) return { error: `Portfolio is limited to ${MAX_ITEMS} items.` };
  await db.portfolioItem.create({ data: { profileId: c.profile.id, kind: "LINK", title: parsed.data.title, description: parsed.data.description || null, url, projectId: await validProject(c.profile.id, parsed.data.projectId), sortOrder: Date.now() % 2_000_000_000 } });
  revalidatePath("/portfolio");
  revalidatePath("/dashboard");
  return { ok: "Link added." };
}

export async function deletePortfolioItem(id: string): Promise<void> {
  const c = await ctx();
  if (!c) return;
  const item = await db.portfolioItem.findFirst({ where: { id, profileId: c.profile.id } });
  if (!item) return;
  await db.portfolioItem.delete({ where: { id } });
  if (item.fileId) await deleteStored(item.fileId);
  revalidatePath("/portfolio");
  revalidatePath("/dashboard");
}
