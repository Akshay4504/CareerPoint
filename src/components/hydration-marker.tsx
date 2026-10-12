"use client";

import { useEffect } from "react";

/** Sets <html data-hydrated> once React has taken over, so tests (and diagnostics) can wait for interactivity. */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "1";
  }, []);
  return null;
}
