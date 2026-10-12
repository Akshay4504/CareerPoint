import { AppShell, EMPLOYER_NAV } from "@/components/shell";
import { requireEmployer } from "@/lib/auth/guards";

export default async function EmployerLayout({ children }: { children: React.ReactNode }) {
  const { user, company } = await requireEmployer();
  return (
    <AppShell user={user} nav={EMPLOYER_NAV} area={company.name}>
      {!company.verified && (
        <div role="note" className="mb-6 rounded-md border border-[#ecd29e] bg-warn-soft px-4 py-3 text-[13px] text-warn">
          <strong className="font-semibold">Company pending verification.</strong> Your jobs are reviewed by our team before they go live, and the candidate directory unlocks once your company is verified.
        </div>
      )}
      {children}
    </AppShell>
  );
}
