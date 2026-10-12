"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[24px]">Something went wrong</h1>
      <p className="mt-2 text-muted">An unexpected error occurred. {error.digest && <span className="font-mono text-[12px]">Ref: {error.digest}</span>}</p>
      <button onClick={reset} className="btn btn-primary mt-6">Try again</button>
    </main>
  );
}
