import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-2 text-[24px]">Page not found</h1>
      <p className="mt-2 text-muted">The page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/" className="btn btn-primary mt-6">Back to CareerPoint</Link>
    </main>
  );
}
