import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/rbac";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="px-4 py-4 sm:px-8">
        <Link href="/" aria-label="CareerPoint home">
          <Logo />
        </Link>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-4 pb-16">
        {children}
      </main>
    </div>
  );
}
