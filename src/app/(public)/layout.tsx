import { SiteFooter, SiteHeader } from "@/components/site";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-[1120px] px-4 sm:px-8">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
