import "server-only";
import { log } from "@/lib/log";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { clientInfo } from "@/lib/auth/session";
import { notifyEvent } from "@/lib/notifications/service";

/** Append-only audit trail for sensitive events. Works inside requests (records the IP) and in workers/tests (no IP). */
export async function audit(actorId: string | null, action: string, entityType?: string, entityId?: string, meta?: Prisma.InputJsonValue) {
  let ip: string | null = null;
  try {
    ip = (await clientInfo()).ip;
  } catch {
    /* not inside a request */
  }
  try {
    await db.auditLog.create({ data: { actorId, action, entityType, entityId, meta, ip } });
  } catch (e) {
    log.error("audit.write_failed", { err: e });
  }
}

/** Legacy helper kept for existing call sites; delegates to the preference-aware notifier. */
export async function notify(userId: string, type: string, title: string, body?: string, href?: string) {
  try {
    await notifyEvent(userId, type, { title, body, href });
  } catch (e) {
    log.error("notify.failed", { err: e });
  }
}
