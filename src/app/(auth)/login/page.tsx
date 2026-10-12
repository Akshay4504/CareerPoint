import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { loginAction } from "@/app/actions/auth";
import { safeNext } from "@/lib/auth/next";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="rise">
      <h1 className="text-[22px]">Sign in to CareerPoint</h1>
      <p className="mt-1 text-muted">Pick up where your BIM career left off.</p>
      {sp.reset && (
        <p role="status" className="mt-4 rounded-md border border-[#b9dcc6] bg-ok-soft px-3 py-2 text-[13px] text-ok">
          Password updated. Sign in with your new password.
        </p>
      )}
      <ActionForm action={loginAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={safeNext(sp.next) ?? ""} />
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" autoComplete="email" required className="field" />
        </Field>
        <Field label="Password" htmlFor="password">
          <input id="password" name="password" type="password" autoComplete="current-password" required className="field" />
        </Field>
        <SubmitButton className="btn btn-primary w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>
      <div className="mt-5 flex justify-between text-[13px] text-muted">
        <Link href="/forgot-password" className="hover:text-ink">
          Forgot password?
        </Link>
        <span>
          New here?{" "}
          <Link href="/register" className="font-medium text-ink underline">
            Create an account
          </Link>
        </span>
      </div>
    </div>
  );
}
