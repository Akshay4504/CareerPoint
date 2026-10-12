import type { SVGProps } from "react";

// Small stroke icon set (24px grid, drawn at 16px). One component so navigation, buttons and empty states stay consistent.
const PATHS = {
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  resume: "M7 3h7l4 4v14H7V3Zm7 0v4h4M10 12h5M10 16h5",
  score: "M12 21a9 9 0 1 1 9-9M12 7v5l3 2",
  portfolio: "M3 7h18v13H3V7Zm5 0V4h8v3M3 13h18",
  jobs: "M3 8h18v11H3V8Zm6 0V5h6v3M3 13h18",
  saved: "M6 4h12v17l-6-4-6 4V4Z",
  applications: "M5 4h14v16H5V4Zm4 5h6M9 13h6M9 17h3",
  insights: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  bell: "M6 17h12l-1.5-2V10a4.5 4.5 0 0 0-9 0v5L6 17Zm4 3h4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7-3 2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.5 4 8l-1 3 2 1v2l-2 1 1 3 2-.5L7.5 19l-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1v-2Z",
  overview: "M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z",
  candidates: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0m1-9a3 3 0 1 0 0-6m2 15a5 5 0 0 0-3-4.6",
  interviews: "M4 6h16v11H9l-5 4V6Zm4 4h8M8 13h5",
  analytics: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  company: "M4 21V5l8-2v18M12 9l8 2v10M8 9h1M8 13h1M8 17h1M16 15h1M16 18h1",
  sources: "M12 3v18M3 12h18M5.6 5.6a9 9 0 0 1 12.8 0M5.6 18.4a9 9 0 0 0 12.8 0",
  reports: "M5 21V4h11l-1.5 4 1.5 4H5",
  scoring: "M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-6 2v4",
  system: "M4 5h16v6H4V5Zm0 8h16v6H4v-6Zm3-5h.01M7 16h.01",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0m1-9a3 3 0 1 0 0-6m2 15a5 5 0 0 0-3-4.6",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 5 5",
  check: "M5 12.5 10 17l9-10",
  shield: "M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Zm-3 9 2 2 4-4",
  card: "M3 6h18v12H3V6Zm0 4h18",
  lock: "M6 11h12v9H6v-9Zm3 0V8a3 3 0 0 1 6 0v3",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
