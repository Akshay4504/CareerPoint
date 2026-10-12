import Link from "next/link";
import { db } from "@/lib/db";
import { logoutAction, resendVerificationAction } from "@/app/actions/auth";
import type { SessionUser } from "@/lib/auth/session";
import { Avatar, Logo } from "./ui";
import { NavLink } from "./nav-link";
import { Icon, type IconName } from "./icons";
import { humanize } from "@/lib/utils";

export type NavItem = { href: string; label: string; badge?: number; exact?: boolean; icon?: IconName };

export const CANDIDATE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/profile", label: "Profile", icon: "profile" },
  { href: "/resume", label: "Resume", exact: true, icon: "resume" },
  { href: "/resume/score", label: "Resume score", icon: "score" },
  { href: "/portfolio", label: "Portfolio", icon: "portfolio" },
  { href: "/jobs", label: "Jobs", exact: true, icon: "jobs" },
  { href: "/jobs/saved", label: "Saved jobs", icon: "saved" },
  { href: "/applications", label: "Applications", icon: "applications" },
  { href: "/communities", label: "Communities", icon: "users" },
  { href: "/career-insights", label: "Career insights", icon: "insights" },
];

export const EMPLOYER_NAV: NavItem[] = [
  { href: "/employer", label: "Overview", exact: true, icon: "overview" },
  { href: "/employer/jobs", label: "Jobs", icon: "jobs" },
  { href: "/employer/applications", label: "Applications", icon: "applications" },
  { href: "/employer/candidates", label: "Candidates", icon: "candidates" },
  { href: "/employer/interviews", label: "Interviews", icon: "interviews" },
  { href: "/communities", label: "Communities", icon: "users" },
  { href: "/employer/analytics", label: "Analytics", icon: "analytics" },
  { href: "/employer/company", label: "Company", icon: "company" },
  { href: "/employer/settings", label: "Settings", icon: "settings" },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", exact: true, icon: "overview" },
  { href: "/admin/jobs", label: "Jobs", icon: "jobs" },
  { href: "/admin/employers", label: "Employers", icon: "company" },
  { href: "/admin/applications", label: "Applications", icon: "applications" },
  { href: "/admin/sources", label: "Job sources", icon: "sources" },
  { href: "/admin/reports", label: "Reports", icon: "reports" },
  { href: "/admin/scoring", label: "Resume scoring", icon: "scoring" },
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/system", label: "System", icon: "system" },
];

export async function AppShell({ user, nav, children, area }: { user: SessionUser; nav: NavItem[]; children: React.ReactNode; area: string }) {
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } });
  const items = [...nav];
  const footer: NavItem[] = [
    { href: "/notifications", label: "Notifications", badge: unread, icon: "bell" },
    { href: "/settings", label: "Settings", icon: "settings" },
  ];

  const search = user.role === "CANDIDATE" ? { action: "/jobs", placeholder: "Search jobs, companies or skills…" } : user.role === "ADMIN" || user.role === "MODERATOR" ? { action: "/admin/jobs", placeholder: "Search jobs…" } : { action: "/employer/candidates", placeholder: "Search candidates by name or headline…" };

  const navList = (
    <>
      <ul className="space-y-0.5">
        {items.map((i) => (
          <li key={i.href}>
            <NavLink {...i} />
          </li>
        ))}
      </ul>
      <div className="my-4 border-t border-line" />
      <ul className="space-y-0.5">
        {footer.map((i) => (
          <li key={i.href}>
            <NavLink {...i} />
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <div className="app-grid min-h-dvh md:grid md:grid-cols-[236px_1fr]">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col border-r border-line bg-bg px-3 py-4 md:flex">
        <Link href="/" className="mb-1 px-2.5" aria-label="CareerPoint home">
          <Logo />
        </Link>
        {area !== "Career" && <p className="mb-3 truncate px-2.5 text-[11.5px] font-medium uppercase tracking-wide text-muted">{area}</p>}
        <nav aria-label="Primary" className="mt-4 flex-1 overflow-y-auto">
          {navList}
        </nav>
        <UserBlock user={user} />
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" aria-label="CareerPoint home">
            <Logo />
          </Link>
          <details className="group relative">
            <summary className="btn btn-secondary btn-sm list-none [&::-webkit-details-marker]:hidden" aria-label="Open menu">
              Menu
              {unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-white">{unread}</span>}
            </summary>
            <div className="absolute right-0 top-10 z-40 max-h-[75dvh] w-64 overflow-y-auto rounded-xl border border-line bg-bg p-3 shadow-[0_12px_32px_-12px_rgba(15,23,42,.28)]">
              <nav aria-label="Primary mobile">{navList}</nav>
              <div className="mt-3 border-t border-line pt-3">
                <UserBlock user={user} />
              </div>
            </div>
          </details>
        </div>
      </header>

      <div className="min-w-0">
        {/* Desktop top bar: global search + notifications */}
        <div className="no-print sticky top-0 z-20 hidden items-center gap-4 border-b border-line bg-bg/90 px-8 py-2.5 backdrop-blur md:flex">
          <form action={search.action} role="search" className="relative max-w-xl flex-1">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <label htmlFor="global-search" className="sr-only">Search</label>
            <input id="global-search" name="q" type="search" placeholder={search.placeholder} className="field border-transparent bg-sunken py-[7px] pl-9 text-[13.5px] hover:border-line-strong focus:bg-bg" />
          </form>
          <Link href="/notifications" className="relative ml-auto rounded-lg p-2 text-ink-2 hover:bg-sunken" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
            <Icon name="bell" size={18} />
            {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-bg" />}
          </Link>
        </div>
        {!user.emailVerifiedAt && (
          <form action={resendVerificationAction} className="no-print flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#f5dfae] bg-warn-soft px-4 py-2 text-[13px] text-warn sm:px-8">
            <span>Verify your email address to secure your account.</span>
            <button className="font-medium underline">Resend verification email</button>
          </form>
        )}
        <main id="main" className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-8 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function UserBlock({ user }: { user: SessionUser }) {
  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-line bg-surface p-2">
      <Avatar name={user.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium leading-tight">{user.name}</p>
        <p className="truncate text-[12px] leading-tight text-muted">{humanize(user.role)}</p>
      </div>
      <form action={logoutAction}>
        <button className="btn btn-ghost btn-sm px-2" aria-label="Sign out">
          Sign out
        </button>
      </form>
    </div>
  );
}
