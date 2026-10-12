"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

export type ActionState = { error?: string; ok?: string; fieldErrors?: Record<string, string>; /** Client-side navigation after success (more reliable than a server redirect from a multipart action). */ redirectTo?: string } | undefined;
type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function SubmitButton({ children, pendingText = "Saving…", className = "btn btn-primary", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || rest.disabled} aria-busy={pending} {...rest}>
      {pending ? pendingText : children}
    </button>
  );
}

export function Notice({ state }: { state: ActionState }) {
  if (!state?.error && !state?.ok) return null;
  const bad = !!state.error;
  return (
    <p role={bad ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-[13px]", bad ? "border-[#e9b9b5] bg-bad-soft text-bad" : "border-[#b9dcc6] bg-ok-soft text-ok")}>
      {state.error ?? state.ok}
    </p>
  );
}

/** Form bound to a server action; shows validation errors / success inline. */
export function ActionForm({ action, children, className, resetOnSuccess }: { action: Action; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; /** Ignored: React sets multipart encoding itself for function actions. Kept so existing call sites compile. */ encType?: string }) {
  const router = useRouter();
  // Navigate once the action has resolved, but outside React's action transition (calling router.push inside it
  // stalls the action), and not from an effect: a successful action often re-renders the page without this form
  // (e.g. "already processed"), which would unmount it before an effect could run. A timer survives the unmount.
  const wrapped = useCallback<Action>(
    async (prev, fd) => {
      const result = await action(prev, fd);
      if (result?.redirectTo) setTimeout(() => router.push(result.redirectTo!), 0);
      return result;
    },
    [action, router],
  );
  const [state, formAction] = useActionState(wrapped, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <Notice state={state} />
    </form>
  );
}

export function ConfirmButton({ children, message, className = "btn btn-danger btn-sm" }: { children: React.ReactNode; message: string; className?: string }) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
