import { ADMIN_NAV, AppShell, CANDIDATE_NAV, EMPLOYER_NAV } from "@/components/shell";
import { requireUser } from "@/lib/auth/guards";
import { isEmployerRole, isStaff } from "@/lib/auth/rbac";

// Shared by every role (settings, notifications); the navigation follows the user's role.
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const nav = isStaff(user.role) ? ADMIN_NAV : isEmployerRole(user.role) ? EMPLOYER_NAV : CANDIDATE_NAV;
  const area = isStaff(user.role) ? "Administration" : isEmployerRole(user.role) ? (user.employerUsers[0]?.company.name ?? "Employer") : "Career";
  return (
    <AppShell user={user} nav={isStaff(user.role) && user.role !== "ADMIN" ? nav.filter((n) => !["/admin/users", "/admin/system", "/admin/scoring"].includes(n.href)) : nav} area={area}>
      {children}
    </AppShell>
  );
}
