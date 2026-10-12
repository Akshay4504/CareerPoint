"use client";

import { useState, useTransition } from "react";
import { createInviteAction } from "@/app/actions/access";
import { ShareButtons } from "@/components/share-buttons";

/** Members create an invite link. The link is shown once (only a hash is stored); the receiver verifies their email to join. */
export function InvitePanel({ slug, name }: { slug: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [expires, setExpires] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const create = () =>
    start(async () => {
      setError(null);
      const r = await createInviteAction(slug);
      if (!r.ok || !r.url) return setError(r.error ?? "Could not create a link.");
      setUrl(r.url);
      setExpires(r.expiresAt ?? null);
    });
  return (
    <div className="space-y-3 text-[13.5px]">
      <p className="text-muted">Invite a colleague with a private link. They confirm their email address, then join (each person can belong to {2} communities).</p>
      {url ? (
        <>
          <ShareButtons url={url} text={`Join me in the ${name} community on CareerPoint.`} subject={`Join ${name} on CareerPoint`} />
          <p className="text-[12px] text-muted">Shown once. Expires {expires ? new Date(expires).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "in 7 days"}.</p>
        </>
      ) : (
        <button type="button" onClick={create} disabled={pending} className="btn btn-secondary w-full">{pending ? "Creating…" : "Create invite link"}</button>
      )}
      {error && <p role="alert" className="text-bad">{error}</p>}
    </div>
  );
}
