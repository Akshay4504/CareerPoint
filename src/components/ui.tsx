import Link from "next/link";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-[22px] leading-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[14px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, description, actions, children, className, id, pad = true, tint }: { title?: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string; pad?: boolean; tint?: Tint }) {
  return (
    <section id={id} className={cn("panel scroll-mt-20", tint && `${TINT[tint]} border-transparent`, className)}>
      {(title || actions) && (
        <header className={cn("flex items-center justify-between gap-3 border-b px-4 py-3", tint ? "border-forest/10" : "border-line")}>
          <div>
            {title && <h2 className="text-[14px]">{title}</h2>}
            {description && <p className="text-[12.5px] text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={pad ? "p-4" : undefined}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, htmlFor, className }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "bad";
export type Tint = "mint" | "sky" | "sand" | "lilac";
export const TINT: Record<Tint, string> = { mint: "bg-mint", sky: "bg-sky", sand: "bg-sand", lilac: "bg-lilac" };
const TONES: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2 border-line",
  accent: "bg-accent-soft text-accent-strong border-[#c9d7fb]",
  ok: "bg-ok-soft text-ok border-[#b9dcc6]",
  warn: "bg-warn-soft text-warn border-[#ecd29e]",
  bad: "bg-bad-soft text-bad border-[#e9b9b5]",
};

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-px text-[12px] font-medium leading-5", TONES[tone], className)}>{children}</span>;
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <h3 className="text-[14px]">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

export function Stat({ label, value, hint, href, bar, tint }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; tint?: Tint; /** Optional progress under the number (0-100) */ bar?: { value: number; tone?: Tone } }) {
  const body = (
    <div className={cn("panel h-full p-4 transition-all hover:shadow-[0_6px_20px_-10px_rgba(11,74,62,0.35)]", tint ? `${TINT[tint]} border-transparent` : "hover:border-line-strong")}>
      <p className={cn("text-[12.5px]", tint ? "font-medium text-forest" : "text-muted")}>{label}</p>
      <p className="mt-1.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
      {bar && <div className="mt-3"><Meter value={bar.value} label={label} tone={bar.tone} /></div>}
      {hint && <p className={cn("mt-2 text-[12.5px]", tint ? "text-forest/75" : "text-muted")}>{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-lg focus-visible:outline-offset-0">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Horizontal meter for 0-100 values. Accessible via role=meter. */
export function Meter({ value, max = 100, label, tone }: { value: number; max?: number; label: string; tone?: Tone }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = tone === "warn" ? "bg-[#f59e0b]" : tone === "bad" ? "bg-[#ef4444]" : tone === "ok" ? "bg-[#22c55e]" : "bg-accent";
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function MatchBadge({ score }: { score: number }) {
  const tone: Tone = score >= 75 ? "ok" : score >= 55 ? "accent" : score >= 35 ? "warn" : "neutral";
  return <Badge tone={tone}>{score}% match</Badge>;
}

export function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-block rounded-md bg-accent-soft px-2 py-px text-[12px] font-medium text-accent-strong">{children}</span>;
}

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img src={src} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-strong" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials || "?"}
    </span>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("panel overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] text-left text-[13.5px]">{children}</table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th scope="col" className={cn("border-b border-line bg-surface px-3 py-2 text-[12px] font-medium text-muted", className)}>
    {children}
  </th>
);
export const Td = ({ children, className }: { children?: React.ReactNode; className?: string }) => <td className={cn("border-b border-line px-3 py-2.5 align-top last:border-b-0", className)}>{children}</td>;

export function Pagination({ page, pages, basePath, params }: { page: number; pages: number; basePath: string; params?: Record<string, string | undefined> }) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v) q.set(k, v);
    q.set("page", String(p));
    return `${basePath}?${q}`;
  };
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-[13px]">
      <span className="text-muted">
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link className="btn btn-secondary btn-sm" href={href(page - 1)}>
            Previous
          </Link>
        )}
        {page < pages && (
          <Link className="btn btn-secondary btn-sm" href={href(page + 1)}>
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <rect x="1" y="1" width="20" height="20" rx="4" fill="#0f172a" />
        <path d="M6 15V7l5 3v8M11 10l5-3v8l-5 3" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      </svg>
      CareerPoint
    </span>
  );
}

/** Circular score gauge (0-100). The number is real; colour follows the same thresholds as the bars. */
export function ScoreRing({ value, size = 150, label = "out of 100" }: { value: number; size?: number; label?: string }) {
  const r = (size - 16) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 70 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} role="img" aria-label={`Score ${pct} ${label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e8ebf4" strokeWidth="10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: "stroke-dashoffset .8s ease" }} />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className="text-[40px] font-semibold leading-none tabular-nums">{pct}</span>
        <span className="mt-1 text-[12px] text-muted">{label}</span>
      </div>
    </div>
  );
}
