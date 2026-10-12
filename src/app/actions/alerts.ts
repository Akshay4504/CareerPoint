"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { CHANNELS, criteriaSchema, describeCriteria } from "@/lib/jobs/alerts";
import type { ActionState } from "@/components/forms";

const MAX_ALERTS = 10;

export async function createAlert(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await actionUser("app");
  if (!user) return { error: "Please sign in again." };
  if ((await db.jobAlert.count({ where: { userId: user.id } })) >= MAX_ALERTS) return { error: `You can have up to ${MAX_ALERTS} alerts.` };
  const s = (k: string) => String(fd.get(k) ?? "").trim() || undefined;
  const parsed = criteriaSchema.safeParse({
    keywords: s("keywords"), bimRole: s("bimRole"), discipline: s("discipline"), country: s("country"), city: s("city"), employmentType: s("employmentType"),
    software: String(fd.get("software") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    remote: fd.get("remote") === "on" ? true : undefined,
    minMatch: fd.get("matchProfile") === "on" ? Number(fd.get("minMatch") || 55) : 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const c = parsed.data;
  if (!c.keywords && !c.bimRole && !c.discipline && !c.country && !c.city && !c.software.length && !c.remote && !c.employmentType && !c.minMatch) return { error: "Choose at least one criterion." };
  const frequency = (["INSTANT", "DAILY", "WEEKLY"] as const).find((f) => f === fd.get("frequency")) ?? "DAILY";
  const channels = (CHANNELS as readonly string[]).filter((ch) => fd.getAll("channels").includes(ch));
  if (!channels.length) return { error: "Pick at least one delivery channel." };
  if (c.minMatch > 0 && !(await db.bIMProfessionalProfile.findUnique({ where: { userId: user.id }, select: { id: true } }))) return { error: "Create your BIM profile before using profile matching." };
  const name = (s("name") ?? describeCriteria(c)).slice(0, 120);
  const alert = await db.jobAlert.create({ data: { userId: user.id, name, criteria: c, frequency, channels, lastRunAt: new Date() } });
  await audit(user.id, "alert.create", "JobAlert", alert.id);
  revalidatePath("/jobs/alerts");
  return { ok: "Alert created. You will be notified when new matching jobs are found." };
}

export async function toggleAlert(id: string, active: boolean): Promise<void> {
  const user = await actionUser("app");
  if (!user) return;
  await db.jobAlert.updateMany({ where: { id, userId: user.id }, data: { active } });
  revalidatePath("/jobs/alerts");
}

export async function deleteAlert(id: string): Promise<void> {
  const user = await actionUser("app");
  if (!user) return;
  await db.jobAlert.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/jobs/alerts");
}
