import { db } from "@/lib/db";
import { QUEUES, enqueue } from "@/lib/queue/queue";
import { sendMail, appUrl } from "@/lib/mail";
import { EVENTS, eventDef, resolvePrefs } from "./events";

// Central notifier. Every notification goes through here so preferences are always honoured:
//   in-app  → Notification row (the notification centre)
//   email   → EmailOutbox row + queue task; delivery, retries and failures are handled by the worker (never in a request)

export type NotifyInput = { title: string; body?: string; href?: string; /** Collapse repeats for the same thing (e.g. one profile-view notice per company per day). */ dedupeKey?: string };

export async function notifyEvent(userId: string, event: string, input: NotifyInput): Promise<{ inApp: boolean; email: boolean }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerifiedAt: true, status: true } });
  if (!user || user.status !== "ACTIVE") return { inApp: false, email: false };
  const stored = await db.notificationPreference.findMany({ where: { userId } });
  const pref = resolvePrefs(stored, event);

  if (input.dedupeKey) {
    const existing = await db.notification.findFirst({ where: { userId, type: event, href: input.dedupeKey }, select: { id: true } });
    if (existing) return { inApp: false, email: false };
  }
  let inApp = false;
  let email = false;
  if (pref.inApp) {
    await db.notification.create({ data: { userId, type: event, title: input.title.slice(0, 200), body: input.body?.slice(0, 500), href: input.dedupeKey ?? input.href } });
    inApp = true;
  }
  // Email only goes to verified addresses.
  if (pref.email && user.emailVerifiedAt) {
    const row = await db.emailOutbox.create({ data: { userId, toEmail: user.email, subject: input.title.slice(0, 200), body: `${input.body ?? ""}${input.href ? `\n\n${appUrl()}${input.href}` : ""}\n\nChange what we email you: ${appUrl()}/settings`.trim(), event } });
    await enqueue(QUEUES.email, { outboxId: row.id }, { dedupeKey: `email:${row.id}`, maxAttempts: 4 });
    email = true;
  }
  return { inApp, email };
}

/** Delivers one outbox row. Safe to retry; marks the row SENT or FAILED with the error. */
export async function deliverOutbox(outboxId: string) {
  const row = await db.emailOutbox.findUnique({ where: { id: outboxId } });
  if (!row || row.status === "SENT") return "skipped" as const;
  try {
    await sendMail({ to: row.toEmail, subject: row.subject, text: row.body });
    await db.emailOutbox.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, error: null } });
    return "sent" as const;
  } catch (e) {
    await db.emailOutbox.update({ where: { id: row.id }, data: { status: "FAILED", attempts: { increment: 1 }, error: String(e instanceof Error ? e.message : e).slice(0, 500) } });
    throw e; // the queue retries with backoff
  }
}

export async function getPreferences(userId: string, audience: "candidate" | "employer") {
  const stored = await db.notificationPreference.findMany({ where: { userId } });
  return EVENTS.filter((e) => e.audience === audience).map((e) => ({ ...e, ...resolvePrefs(stored, e.key) }));
}

export async function setPreferences(userId: string, audience: "candidate" | "employer", values: Record<string, { inApp: boolean; email: boolean }>) {
  const allowed = new Set(EVENTS.filter((e) => e.audience === audience).map((e) => e.key));
  for (const [event, v] of Object.entries(values)) {
    if (!allowed.has(event) || !eventDef(event)) continue;
    await db.notificationPreference.upsert({ where: { userId_event: { userId, event } }, create: { userId, event, inApp: v.inApp, email: v.email }, update: { inApp: v.inApp, email: v.email } });
  }
}
