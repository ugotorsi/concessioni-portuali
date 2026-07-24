"use client";

import { useEffect } from "react";

import { SectionUnavailableFallback } from "@/components/layout/SectionUnavailableFallback";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    // Keep a client-side signal for diagnostics without exposing stack traces in UI.
    console.error("[app-error]", error.message);
  }, [error]);

  return (
    <div className="mx-auto mt-12 w-full max-w-3xl px-4">
      <SectionUnavailableFallback />
    </div>
  );
}