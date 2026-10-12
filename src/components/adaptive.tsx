import { getCurrentUser } from "@/lib/auth/session";
import { isEmployerRole, isStaff } from "@/lib/auth/rbac";
import { SiteFooter, SiteHeader } from "./site";
import { ADMIN_NAV, AppShell, CANDIDATE_NAV, EMPLOYER_NAV } from "./shell";

/** Public pages that become part of the signed-in workspace (sidebar) when a user is logged in. */
export async function AdaptiveLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (user) {
    const staff = isStaff(user.role);
    const nav = staff ? ADMIN_NAV.filter((n) => user.role === "ADMIN" || !["/admin/users", "/admin/system"].includes(n.href)) : isEmployerRole(user.role) ? EMPLOYER_NAV : CANDIDATE_NAV;
    const area = staff ? "Administration" : isEmployerRole(user.role) ? (user.employerUsers[0]?.company.name ?? "Employer") : "Career";
    return (
      <AppShell user={user} nav={nav} area={area}>
        {children}
      </AppShell>
    );
  }
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-8">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
