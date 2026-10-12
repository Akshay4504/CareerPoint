"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { StepResult } from "@/app/actions/access";

/**
 * Two-step email checkpoint: enter an address, receive a one-time code, enter it.
 * The server actions set a signed cookie on success, so a refresh is all that is needed to move on.
 */
export function EmailVerify({ send, verify, intro, sendLabel = "Send code" }: { send: (email: string) => Promise<StepResult>; verify: (email: string, code: string) => Promise<StepResult>; intro: string; sendLabel?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const sendCode = () =>
    start(async () => {
      setError(null);
      const r = await send(email);
      if (!r.ok) return setError(r.error ?? "Could not send the code.");
      setStep("code");
      setNote(`If ${email.trim()} can access this, a 6-digit code is on its way. It expires in 10 minutes.`);
    });

  const check = () =>
    start(async () => {
      setError(null);
      const r = await verify(email, code);
      if (!r.ok) return setError(r.error ?? "That code did not work.");
      router.refresh();
    });

  return (
    <div className="space-y-3 text-[13.5px]">
      <p className="text-ink-2">{intro}</p>
      {step === "email" ? (
        <form onSubmit={(e) => { e.preventDefault(); sendCode(); }} className="space-y-2.5">
          <label className="label" htmlFor="ev-email">Your email address</label>
          <input id="ev-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field" placeholder="you@example.com" />
          <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Sending…" : sendLabel}</button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); check(); }} className="space-y-2.5">
          {note && <p role="status" className="rounded-md bg-accent-soft px-3 py-2 text-[13px] text-accent-strong">{note}</p>}
          <label className="label" htmlFor="ev-code">6-digit code</label>
          <input id="ev-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="field text-center font-mono text-[18px] tracking-[0.3em]" />
          <button className="btn btn-primary w-full" disabled={pending || code.length !== 6}>{pending ? "Checking…" : "Verify"}</button>
          <button type="button" className="btn btn-ghost btn-sm w-full" onClick={() => { setStep("email"); setCode(""); setNote(null); setError(null); }}>Use a different email or resend</button>
        </form>
      )}
      {error && <p role="alert" className="text-bad">{error}</p>}
    </div>
  );
}
