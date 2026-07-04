"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { GUIDED_DEMO_STATE_STORAGE_KEY, type GuidedDemoSessionState } from "@/lib/demo-guidata";

export function ResumeDemoBanner() {
  const [state, setState] = useState<GuidedDemoSessionState | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const raw = window.sessionStorage.getItem(GUIDED_DEMO_STATE_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as GuidedDemoSessionState;
      if (parsed.pausedForVisit) {
        setState(parsed);
      }
    } catch {
      setState(null);
    }
  }, []);

  if (!state?.pausedForVisit) {
    return null;
  }

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3" data-testid="resume-demo-banner">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-emerald-900">
          Demo guidata sospesa: torna alla slide corrente e riprendi la visita.
        </p>
        <Badge variant="success">Ripresa disponibile</Badge>
      </div>
      <p className="mt-1 text-xs text-emerald-900">
        Ultimo modulo visitato: {state.lastVisitedLabel ?? "modulo contestuale"}.
      </p>
      <Link
        href="/demo-guidata?resume=1"
        className="mt-2 inline-flex h-9 items-center justify-center rounded-md border border-emerald-700 bg-white px-3 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
      >
        Torna alla demo guidata
      </Link>
    </div>
  );
}
