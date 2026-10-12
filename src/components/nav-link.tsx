"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icons";

export function NavLink({ href, label, badge, exact, icon }: { href: string; label: string; badge?: number; exact?: boolean; icon?: IconName }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors", active ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-sunken hover:text-ink")}
    >
      {icon && <Icon name={icon} className={active ? "text-accent" : "text-muted"} />}
      <span className="flex-1">{label}</span>
      {!!badge && <span className="rounded-full bg-accent px-1.5 text-[11px] font-medium leading-4 text-white">{badge > 99 ? "99+" : badge}</span>}
    </Link>
  );
}
