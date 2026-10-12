"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth/guards";
import type { ActionState } from "@/components/forms";

export async function markNotificationRead(id: string): Promise<void> {
  const user = await actionUser();
  if (!user) return;
  await db.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
}

export async function markAllNotificationsRead(): Promise<void> {
  const user = await actionUser();
  if (!user) return;
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
}

export async function updateName(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await actionUser();
  if (!user) return { error: "Please sign in again." };
  const name = z.string().trim().min(2, "Enter your full name").max(100).safeParse(fd.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };
  await db.user.update({ where: { id: user.id }, data: { name: name.data } });
  revalidatePath("/settings");
  return { ok: "Name updated." };
}
