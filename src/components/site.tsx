import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/rbac";
import { Logo } from "./ui";

const LINKS = [
  { href: "/jobs", label: "Jobs" },
  { href: "/professionals", label: "Professionals" },
  { href: "/communities", label: "Communities" },
  { href: "/companies", label: "Companies" },
  { href: "/resources", label: "Resources" },
  { href: "/tools", label: "Tools" },
];

export async function SiteHeader() {
  const user = await getCurrentUser();
  const cta = user ? (
    <Link href={homeFor(user.role)} className="btn btn-primary btn-sm">
      Open workspace
    </Link>
  ) : (
    <>
      <Link href="/login" className="btn btn-ghost btn-sm">
        Sign in
      </Link>
      <Link href="/register" className="btn btn-primary btn-sm">
        Get started
      </Link>
    </>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-6 px-4 sm:px-8">
        <Link href="/" aria-label="CareerPoint home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-md px-2.5 py-1.5 text-[13.5px] text-ink-2 hover:bg-sunken hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-2 sm:flex">{cta}</div>
          <details className="relative md:hidden">
            <summary className="btn btn-secondary btn-sm list-none [&::-webkit-details-marker]:hidden">Menu</summary>
            <div className="absolute right-0 top-10 z-40 w-56 rounded-lg border border-line bg-bg p-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,.18)]">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="block rounded-md px-2.5 py-2 text-[14px] hover:bg-sunken">
                  {l.label}
                </Link>
              ))}
              <div className="mt-2 flex gap-2 border-t border-line pt-2 sm:hidden">{cta}</div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[1120px] gap-8 px-4 py-10 text-[13px] sm:grid-cols-[1.4fr_1fr_1fr_1fr] sm:px-8">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-muted">The career operating system for BIM professionals.</p>
        </div>
        <FooterCol title="Explore" links={[["/jobs", "BIM jobs"], ["/professionals", "Professionals"], ["/companies", "Companies"], ["/communities", "Communities"]]} />
        <FooterCol title="Learn" links={[["/resources", "Resources"], ["/tools", "Resume score tool"]]} />
        <FooterCol title="Account" links={[["/register", "Create profile"], ["/register?type=employer", "For employers"], ["/login", "Sign in"]]} />
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="eyebrow mb-2">{title}</p>
      <ul className="space-y-1.5">
        {links.map(([h, l]) => (
          <li key={h}>
            <Link href={h} className="text-ink-2 hover:text-ink">
              {l}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
