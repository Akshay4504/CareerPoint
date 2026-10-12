import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { resetPasswordAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token)
    return (
      <p>
        This link is missing its token.{" "}
        <Link className="underline" href="/forgot-password">
          Request a new one
        </Link>
        .
      </p>
    );
  return (
    <div className="rise">
      <h1 className="text-[22px]">Choose a new password</h1>
      <ActionForm action={resetPasswordAction} className="mt-6 space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="New password" htmlFor="password" hint="At least 10 characters, with letters and a number.">
          <input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} className="field" />
        </Field>
        <Field label="Confirm password" htmlFor="confirm">
          <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="field" />
        </Field>
        <SubmitButton className="btn btn-primary w-full">Update password</SubmitButton>
      </ActionForm>
    </div>
  );
}
