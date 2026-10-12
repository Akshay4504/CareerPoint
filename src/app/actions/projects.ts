"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { addProjectImage, createProject, deleteProject, removeProjectImage, setProjectPublished, updateProject } from "@/lib/services/portfolio";
import { ensureProfile } from "@/lib/services/profile";
import { csvToList } from "@/lib/utils";
import type { ActionState } from "@/components/forms";

async function candidate() {
  const user = await actionUser("app");
  if (user) await ensureProfile(user);
  return user;
}

const refresh = (id?: string) => {
  revalidatePath("/portfolio");
  revalidatePath("/dashboard");
  revalidatePath("/profile");
  if (id) revalidatePath(`/portfolio/projects/${id}`);
};

function parseForm(fd: FormData) {
  const s = (k: string) => String(fd.get(k) ?? "");
  const year = s("year");
  return {
    name: s("name"),
    client: s("client"),
    clientPublic: fd.get("clientPublic") === "on",
    sector: s("sector"),
    discipline: s("discipline"),
    role: s("role"),
    software: csvToList(fd.get("software"), 15),
    lod: s("lod"),
    scale: s("scale"),
    location: s("location"),
    year: year ? Number(year) : undefined,
    responsibilities: s("responsibilities"),
    challenges: s("challenges"),
    solutions: s("solutions"),
    outcomes: s("outcomes"),
    description: s("description"),
  };
}

function message(e: unknown) {
  if (e instanceof Error && e.name === "ZodError") return (e as unknown as { issues: { message: string }[] }).issues[0]?.message ?? "Invalid input.";
  return e instanceof Error ? e.message : "Something went wrong.";
}

export async function createProjectAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await candidate();
  if (!user) return { error: "Please sign in again." };
  let id: string;
  try {
    id = (await createProject(user.id, parseForm(fd))).id;
  } catch (e) {
    return { error: message(e) };
  }
  await audit(user.id, "project.create", "Project", id);
  refresh();
  return { redirectTo: `/portfolio/projects/${id}` };
}

export async function updateProjectAction(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await candidate();
  if (!user) return { error: "Please sign in again." };
  try {
    await updateProject(user.id, id, parseForm(fd));
  } catch (e) {
    return { error: message(e) };
  }
  refresh(id);
  return { ok: "Project saved." };
}

export async function publishProjectAction(id: string, publish: boolean): Promise<void> {
  const user = await candidate();
  if (!user) return;
  try {
    await setProjectPublished(user.id, id, publish);
    await audit(user.id, publish ? "project.publish" : "project.unpublish", "Project", id);
  } catch {
    /* blockers are shown on the project page */
  }
  refresh(id);
}

export async function deleteProjectAction(id: string): Promise<void> {
  const user = await candidate();
  if (!user) return;
  try {
    await deleteProject(user.id, id);
    await audit(user.id, "project.delete", "Project", id);
  } catch {
    /* already gone */
  }
  refresh();
  redirect("/portfolio");
}

export async function addProjectImageAction(projectId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await candidate();
  if (!user) return { error: "Please sign in again." };
  try {
    await addProjectImage(user.id, projectId, fd.get("file") as File | null, String(fd.get("title") ?? ""));
  } catch (e) {
    return { error: message(e) };
  }
  refresh(projectId);
  return { ok: "Image added." };
}

export async function removeProjectImageAction(projectId: string, itemId: string): Promise<void> {
  const user = await candidate();
  if (!user) return;
  try {
    await removeProjectImage(user.id, itemId);
  } catch {
    /* ignore */
  }
  refresh(projectId);
}
