import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/auth/password";

export const metadata: Metadata = { title: "Verify email" };
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let ok = false;
  if (token) {
    const rec = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (rec && rec.type === "VERIFY_EMAIL" && rec.expiresAt > new Date()) {
      await db.$transaction([
        db.user.updateMany({ where: { id: rec.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } }),
        db.authToken.update({ where: { id: rec.id }, data: { usedAt: rec.usedAt ?? new Date() } }),
      ]);
      ok = true;
    }
  }
  return (
    <div className="rise text-center">
      <h1 className="text-[22px]">{ok ? "Email verified" : "Link invalid or expired"}</h1>
      <p className="mt-2 text-muted">{ok ? "Thanks — your email address is confirmed." : "Sign in and request a new verification email from your dashboard."}</p>
      <Link href="/login" className="btn btn-primary mt-6">
        Continue
      </Link>
    </div>
  );
}
