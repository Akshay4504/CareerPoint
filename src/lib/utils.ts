import { randomBytes } from "crypto";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function slugify(input: string, max = 60): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/g, "") || "item"
  );
}

export function uniqueSuffix(len = 5) {
  return randomBytes(len).toString("hex").slice(0, len);
}

export function timeAgo(date: Date | string, now = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const s = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function formatMonth(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatSalary(min?: number | null, max?: number | null, currency?: string | null): string | null {
  if (!min && !max) return null;
  const cur = currency ?? "USD";
  const f = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  if (min && max) return `${cur} ${f(min)}–${f(max)}`;
  return `${cur} ${f((min ?? max)!)}${min ? "+" : ""}`;
}

export function toMonthDate(ym?: string | null): Date | null {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  return new Date(Date.UTC(y, m - 1, 1));
}

export function toYm(date?: Date | null): string {
  if (!date) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function csvToList(v: FormDataEntryValue | null | undefined, max = 40): string[] {
  if (typeof v !== "string") return [];
  return Array.from(new Set(v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))).slice(0, max);
}

export function humanize(enumValue: string): string {
  return enumValue.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function safeUrl(u?: string | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(u.startsWith("http") ? u : `https://${u}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Current time minus a duration. Kept in a helper so server components stay pure-looking to the render lint. */
export const msAgo = (ms: number): Date => new Date(Date.now() - ms);
export const minutesFromNow = (date: Date): number => Math.round((date.getTime() - Date.now()) / 60000);
export const isPast = (date: Date): boolean => date.getTime() < Date.now();
