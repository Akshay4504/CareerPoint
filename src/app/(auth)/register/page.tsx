import Link from "next/link";
import type { Metadata } from "next";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ type?: string; email?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="rise">
      <h1 className="text-[22px]">Build your BIM profile</h1>
      <p className="mt-1 text-muted">Free for BIM professionals. Takes about a minute.</p>
      <RegisterForm initialType={sp.type === "employer" ? "EMPLOYER_ADMIN" : "CANDIDATE"} email={sp.email?.slice(0, 254)} next={sp.next} />
      <p className="mt-5 text-[13px] text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-ink underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
