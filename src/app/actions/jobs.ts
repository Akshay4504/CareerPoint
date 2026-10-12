"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { actionUser } from "@/lib/auth/guards";
import { recordInteraction } from "@/lib/applications/candidate";

async function candidate() {
  return actionUser("app");
}

const refresh = () => {
  for (const p of ["/jobs", "/jobs/saved", "/dashboard", "/applications"]) revalidatePath(p);
};

export async function toggleSaveJob(jobId: string): Promise<void> {
  const user = await candidate();
  if (!user) return;
  const key = { userId_jobId: { userId: user.id, jobId } };
  const existing = await db.savedJob.findUnique({ where: key });
  if (existing) {
    await db.savedJob.delete({ where: key });
    await db.pinnedJob.deleteMany({ where: { userId: user.id, jobId } });
    await recordInteraction(user.id, jobId, "UNSAVED");
  } else if (await db.job.findFirst({ where: { id: jobId, status: "ACTIVE" }, select: { id: true } })) {
    await db.savedJob.create({ data: { userId: user.id, jobId } });
    await recordInteraction(user.id, jobId, "SAVED");
  }
  refresh();
}

export async function togglePinJob(jobId: string): Promise<void> {
  const user = await candidate();
  if (!user) return;
  const key = { userId_jobId: { userId: user.id, jobId } };
  if (await db.pinnedJob.findUnique({ where: key })) {
    await db.pinnedJob.delete({ where: key });
    await recordInteraction(user.id, jobId, "UNPINNED");
  } else if (await db.job.findFirst({ where: { id: jobId, status: "ACTIVE" }, select: { id: true } })) {
    // Pinning implies saving.
    if (!(await db.savedJob.findUnique({ where: key }))) {
      await db.savedJob.create({ data: { userId: user.id, jobId } });
      await recordInteraction(user.id, jobId, "SAVED");
    }
    await db.pinnedJob.create({ data: { userId: user.id, jobId } });
    await recordInteraction(user.id, jobId, "PINNED");
  }
  refresh();
}
