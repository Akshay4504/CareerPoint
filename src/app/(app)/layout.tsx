import { AppShell, CANDIDATE_NAV } from "@/components/shell";
import { requireArea } from "@/lib/auth/guards";

export default async function CandidateLayout({ children }: { children: React.ReactNode }) {
  const user = await requireArea("app");
  return (
    <AppShell user={user} nav={CANDIDATE_NAV} area="Career">
      {children}
    </AppShell>
  );
}
