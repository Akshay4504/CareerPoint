"use client";

import { AreaError } from "@/components/area-error";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <AreaError {...props} home="/employer" />;
}
