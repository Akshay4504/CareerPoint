"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Error boundary body used inside the signed-in shells, so navigation stays available and the user can retry in place. */
export function AreaError({ error, reset, home = "/" }: { error: Error & { digest?: string }; reset: () => void; home?: string }) {
  useEffect(() => {
    // Surfaces in the browser console for support; the server already logged the error with its digest.
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-[22px]">This page could not be loaded</h1>
      <p className="mt-2 text-muted">Something went wrong on our side. Your data is safe. Try again, or go back.{error.digest && <> <span className="font-mono text-[12px]">Ref: {error.digest}</span></>}</p>
      <div className="mt-6 flex justify-center gap-3">
        <button onClick={reset} className="btn btn-primary">Try again</button>
        <Link href={home} className="btn btn-secondary">Go to home</Link>
      </div>
    </div>
  );
}
