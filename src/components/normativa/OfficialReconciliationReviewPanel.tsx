"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { reviewLegalReferenceOfficialReconciliation } from "@/server/actions/legal-reference-official-reconciliation";
import type { OfficialReconciliationReviewQueueItem } from "@/server/queries/legal-reference-official-reconciliation";

type Decision = "ACCEPT_NEW" | "LINK_EXISTING" | "REJECT";

export function OfficialReconciliationReviewPanel({ item }: { item: OfficialReconciliationReviewQueueItem }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision>(item.exactSources.length > 0
    ? "LINK_EXISTING"
    : "ACCEPT_NEW");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const defaultTitle = item.evidence.find((evidence) => evidence.officialHit.titoloAtto)
    ?.officialHit.titoloAtto ?? item.canonicalKey ?? "";

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const reviewNote = String(formData.get("reviewNote") ?? "");
        const base = {
          reconciliationId: item.id,
          expectedRevision: item.revision,
          reviewNote: reviewNote || undefined,
        };
        if (decision === "ACCEPT_NEW") {
          await reviewLegalReferenceOfficialReconciliation({
            ...base,
            decision: { action: decision, title: String(formData.get("title") ?? "") },
          });
        } else if (decision === "LINK_EXISTING") {
          await reviewLegalReferenceOfficialReconciliation({
            ...base,
            decision: { action: decision, legalSourceId: String(formData.get("legalSourceId") ?? "") },
          });
        } else {
          await reviewLegalReferenceOfficialReconciliation({ ...base, decision: { action: decision } });
        }
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Revisione non registrata.");
      }
    });
  }

  return (
    <form action={submit} className="grid gap-3 border-t border-slate-200 pt-4">
      <label className="grid gap-1 text-sm font-medium text-slate-800">
        Decisione
        <select
          value={decision}
          onChange={(event) => setDecision(event.target.value as Decision)}
          disabled={isPending}
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="ACCEPT_NEW" disabled={!item.identityFingerprint}>Accetta come nuova fonte</option>
          <option value="LINK_EXISTING" disabled={item.exactSources.length === 0}>Collega fonte esistente</option>
          <option value="REJECT">Rifiuta</option>
        </select>
      </label>

      {decision === "ACCEPT_NEW" ? (
        <label className="grid gap-1 text-sm font-medium text-slate-800">
          Titolo canonico
          <input
            name="title"
            required
            maxLength={500}
            defaultValue={defaultTitle}
            disabled={isPending}
            className="h-10 rounded-md border border-slate-300 px-3 text-sm"
          />
        </label>
      ) : null}

      {decision === "LINK_EXISTING" ? (
        <label className="grid gap-1 text-sm font-medium text-slate-800">
          Fonte con identita esatta
          <select
            name="legalSourceId"
            required
            disabled={isPending}
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
          >
            {item.exactSources.map((source) => (
              <option key={source.id} value={source.id}>{source.title}</option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="grid gap-1 text-sm font-medium text-slate-800">
        Nota di revisione
        <textarea
          name="reviewNote"
          maxLength={2000}
          rows={2}
          disabled={isPending}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={isPending || (decision !== "REJECT" && !item.identityFingerprint)}
        className="h-10 justify-self-start rounded-md bg-slate-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Registrazione..." : "Registra decisione"}
      </button>
    </form>
  );
}