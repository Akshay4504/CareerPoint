import { cn } from "@/lib/utils";
import type { TimelineEntry } from "@/lib/applications/lifecycle";

const DOT = { neutral: "bg-line-strong", ok: "bg-ok", bad: "bg-bad", accent: "bg-accent" } as const;
const EVIDENCE = { platform: "Recorded by CareerPoint", employer: "From the employer on CareerPoint", "self-reported": "Self-reported" } as const;

function fmt(d: Date) {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

/** Vertical timeline. Renders only the entries it is given — callers pass things that actually happened. */
export function Timeline({ entries, empty = "Nothing has happened yet." }: { entries: TimelineEntry[]; empty?: string }) {
  if (entries.length === 0) return <p className="text-[13.5px] text-muted">{empty}</p>;
  return (
    <ol className="relative space-y-4 border-l border-line pl-5" aria-label="Application timeline">
      {entries.map((e) => (
        <li key={e.key} className="relative">
          <span aria-hidden className={cn("absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-bg", DOT[e.tone])} />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-[14px] font-medium">{e.label}</p>
            <time dateTime={e.at.toISOString()} className="text-[12px] text-muted">{fmt(e.at)}</time>
          </div>
          {e.detail && <p className="text-[13px] text-ink-2">{e.detail}</p>}
          <p className={cn("text-[11.5px]", e.evidence === "self-reported" ? "text-warn" : "text-muted")}>{EVIDENCE[e.evidence]}</p>
        </li>
      ))}
    </ol>
  );
}
