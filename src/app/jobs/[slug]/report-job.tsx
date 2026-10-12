"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { reportJobAction } from "@/app/actions/admin";

const REASONS: [string, string][] = [
  ["scam", "Looks like a scam"],
  ["expired", "No longer available"],
  ["not_bim", "Not a BIM role"],
  ["misleading", "Misleading details"],
  ["duplicate", "Duplicate listing"],
  ["other", "Something else"],
];

export function ReportJob({ jobId }: { jobId: string }) {
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer text-muted hover:text-ink">Report this posting</summary>
      <ActionForm action={reportJobAction.bind(null, jobId)} className="mt-2 space-y-2">
        <label className="sr-only" htmlFor="report-reason">Reason</label>
        <select id="report-reason" name="reason" className="field py-1 text-[13px]" required defaultValue="">
          <option value="" disabled>Choose a reason…</option>
          {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="sr-only" htmlFor="report-details">Details (optional)</label>
        <textarea id="report-details" name="details" rows={2} maxLength={1000} className="field text-[13px]" placeholder="Details (optional)" />
        <SubmitButton className="btn btn-secondary btn-sm" pendingText="Sending…">Send report</SubmitButton>
      </ActionForm>
    </details>
  );
}
