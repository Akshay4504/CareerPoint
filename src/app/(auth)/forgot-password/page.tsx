import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { forgotPasswordAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="rise">
      <h1 className="text-[22px]">Reset your password</h1>
      <p className="mt-1 text-muted">We&apos;ll email you a link that works for one hour.</p>
      <ActionForm action={forgotPasswordAction} className="mt-6 space-y-4">
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" autoComplete="email" required className="field" />
        </Field>
        <SubmitButton className="btn btn-primary w-full" pendingText="Sending…">
          Send reset link
        </SubmitButton>
      </ActionForm>
      <p className="mt-5 text-[13px]">
        <Link href="/login" className="text-muted hover:text-ink">
          ← Back to sign in
        </Link>
      </p>
    </div>
  );
}
