import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db } from "@/lib/db";
import { generateToken, hashToken } from "./password";

export const SESSION_COOKIE = "careerpoint_session";
const SESSION_DAYS = 30;
const RENEW_AFTER_DAYS = 7;

export async function clientInfo() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "local",
    userAgent: h.get("user-agent")?.slice(0, 250) ?? null,
  };
}

export async function createSession(userId: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const info = await clientInfo();
  await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt, ip: info.ip, userAgent: info.userAgent } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function destroyOtherSessions(userId: string, keepToken?: string) {
  const keep = keepToken ? hashToken(keepToken) : undefined;
  await db.session.deleteMany({ where: { userId, ...(keep ? { tokenHash: { not: keep } } : {}) } });
}

export async function currentToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Resolves the signed-in user (or null). Suspended users never resolve. Memoised per request. */
export const getCurrentUser = cache(async () => {
  const token = await currentToken();
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { employerUsers: { include: { company: true } } } } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date() || session.user.status !== "ACTIVE") {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // Sliding renewal (DB only; cookie is refreshed on the next sign-in or action to avoid setting cookies during render).
  if (session.expiresAt.getTime() - Date.now() < (SESSION_DAYS - RENEW_AFTER_DAYS) * 86400_000) {
    await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) } }).catch(() => {});
  }
  return session.user;
});

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
