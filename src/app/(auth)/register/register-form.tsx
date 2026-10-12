"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { registerAction } from "@/app/actions/auth";

export function RegisterForm({ initialType, email, next }: { initialType: "CANDIDATE" | "EMPLOYER_ADMIN"; email?: string; next?: string }) {
  const [type, setType] = useState(initialType);
  return (
    <ActionForm action={registerAction} className="mt-6 space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <fieldset>
        <legend className="label">I am</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["CANDIDATE", "A BIM professional"],
              ["EMPLOYER_ADMIN", "Hiring for a company"],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className={`cursor-pointer rounded-md border px-3 py-2 text-[13px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${type === v ? "border-accent bg-accent-soft font-medium" : "border-line-strong"}`}>
              <input type="radio" name="accountType" value={v} checked={type === v} onChange={() => setType(v)} className="sr-only" />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Full name" htmlFor="name">
        <input id="name" name="name" autoComplete="name" required minLength={2} className="field" />
      </Field>
      {type === "EMPLOYER_ADMIN" && (
        <Field label="Company name" htmlFor="companyName">
          <input id="companyName" name="companyName" required className="field" />
        </Field>
      )}
      <Field label="Email" htmlFor="email">
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={email} className="field" />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 10 characters, with letters and a number.">
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} className="field" />
      </Field>
      <SubmitButton className="btn btn-accent w-full" pendingText="Creating account…">
        Create account
      </SubmitButton>
    </ActionForm>
  );
}
