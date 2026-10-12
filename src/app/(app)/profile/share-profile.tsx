"use client";

import { useState, useTransition } from "react";
import { createShareAction } from "@/app/actions/access";
import { ShareButtons } from "@/components/share-buttons";

const TEXT = "Take a look at my BIM profile on CareerPoint.";

/** Public profiles are shared by their public link. Private ones get checkpoint links (email code before viewing). */
export function ShareProfile({ visibility, publicUrl }: { visibility: "PUBLIC" | "PRIVATE"; publicUrl: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("30");
  const [pending, start] = useTransition();

  if (visibility === "PUBLIC") {
    return (
      <div className="space-y-3">
        <p className="text-[13.5px] text-muted">Your profile is public, so anyone with this link can view it directly. No sign-in or checkpoint is needed.</p>
        <ShareButtons url={publicUrl} text={TEXT} subject="My BIM profile on CareerPoint" />
      </div>
    );
  }

  const create = () =>
    start(async () => {
      setError(null);
      const r = await createShareAction({ recipientEmail: recipient || undefined, label: label || undefined, days: Number(days) });
      if (!r.ok || !r.url) return setError(r.error ?? "Could not create the link.");
      setUrl(r.url);
      setEmailed(!!r.emailed);
    });

  return (
    <div className="space-y-3 text-[13.5px]">
      <p className="rounded-md bg-sunken px-3 py-2 text-ink-2">Your profile is <strong>private</strong>. A share link lets someone view it only after they confirm their email address with a one-time code. You see who opened it and can revoke it any time.</p>
      {url ? (
        <div className="space-y-2.5">
          {emailed && <p role="status" className="rounded-md bg-ok-soft px-3 py-2 text-ok">We emailed this link to {recipient}.</p>}
          <ShareButtons url={url} text={TEXT} subject="My BIM profile on CareerPoint" />
          <p className="text-[12px] text-muted">Shown once for security. Create a new link any time.</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setUrl(null); setRecipient(""); setLabel(""); }}>Create another link</button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); create(); }} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="sp-recipient">Only this email may open it (optional)</label>
            <input id="sp-recipient" type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="field" placeholder="recruiter@company.com. We will email them the link." />
            <p className="mt-1 text-[12px] text-muted">Leave blank to get a link you can send anywhere (WhatsApp, LinkedIn…). Whoever opens it must still verify an email.</p>
          </div>
          <div>
            <label className="label" htmlFor="sp-label">Label (only you see it)</label>
            <input id="sp-label" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} className="field" placeholder="e.g. Acme recruiter" />
          </div>
          <div>
            <label className="label" htmlFor="sp-days">Expires after</label>
            <select id="sp-days" value={days} onChange={(e) => setDays(e.target.value)} className="field">
              <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
            </select>
          </div>
          <div className="sm:col-span-2"><button className="btn btn-primary" disabled={pending}>{pending ? "Creating…" : "Create share link"}</button></div>
        </form>
      )}
      {error && <p role="alert" className="text-bad">{error}</p>}
    </div>
  );
}
