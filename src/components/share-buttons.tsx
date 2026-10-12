"use client";

import { useState } from "react";

/** Share a link by email, WhatsApp, LinkedIn, Telegram or X, copy it, or use the device's native share sheet. */
export function ShareButtons({ url, text, subject }: { url: string; text: string; subject: string }) {
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent;
  const channels: [string, string][] = [
    ["Email", `mailto:?subject=${enc(subject)}&body=${enc(`${text}\n\n${url}`)}`],
    ["WhatsApp", `https://wa.me/?text=${enc(`${text} ${url}`)}`],
    ["LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`],
    ["Telegram", `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`],
    ["X", `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`],
  ];
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <input readOnly value={url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} className="field flex-1 font-mono text-[12px]" />
        <button type="button" onClick={copy} className="btn btn-secondary btn-sm">{copied ? "Copied ✓" : "Copy"}</button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Share via">
        {channels.map(([label, href]) => (
          <a key={label} href={href} target={href.startsWith("mailto:") ? undefined : "_blank"} rel="noopener noreferrer" className="btn btn-secondary btn-sm">{label}</a>
        ))}
        {canNative && <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.share({ title: subject, text, url }).catch(() => {})}>More…</button>}
      </div>
    </div>
  );
}
