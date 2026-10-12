"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmExternalAction } from "@/app/actions/applications";

/** "Did you complete the application?" — shown for external applications that are still APPLYING. */
export function ExternalConfirm({ applicationId, applyUrl }: { applicationId: string; applyUrl: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const answer = (submitted: boolean) =>
    start(async () => {
      const r = await confirmExternalAction(applicationId, submitted);
      if (!r.ok) return setNote(r.error ?? "Could not save.");
      setNote(submitted ? null : "Okay — it stays as “Applying”. Come back and confirm once you've submitted.");
      router.refresh();
    });
  return (
    <div role="group" aria-label="Confirm external application" className="rounded-lg border border-[#ecd29e] bg-warn-soft p-4">
      <p className="font-medium text-warn">Did you complete the application?</p>
      <p className="mt-1 text-[13px] text-ink-2">We sent you to the employer&apos;s own site. CareerPoint can&apos;t see whether you submitted, so we rely on you — and we&apos;ll show it as self-reported.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-accent btn-sm" disabled={pending} onClick={() => answer(true)}>Yes, submitted</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => answer(false)}>No, not yet</button>
        {applyUrl && <a href={applyUrl} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-ghost btn-sm">Open application page ↗</a>}
      </div>
      {note && <p role="status" className="mt-2 text-[12.5px] text-ink-2">{note}</p>}
    </div>
  );
}
