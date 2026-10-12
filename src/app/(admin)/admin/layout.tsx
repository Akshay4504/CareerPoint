import { ADMIN_NAV, AppShell } from "@/components/shell";
import { requireArea } from "@/lib/auth/guards";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireArea("admin");
  // Moderators do not see the users/system sections (those pages enforce ADMIN again server-side).
  const nav = user.role === "ADMIN" ? ADMIN_NAV : ADMIN_NAV.filter((n) => !["/admin/users", "/admin/system", "/admin/scoring"].includes(n.href));
  return (
    <AppShell user={user} nav={nav} area="Administration">
      {children}
    </AppShell>
  );
}
