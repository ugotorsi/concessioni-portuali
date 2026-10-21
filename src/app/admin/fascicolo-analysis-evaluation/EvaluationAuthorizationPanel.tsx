"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";

interface EvaluationState {
  csrfToken: string;
  evaluation: {
    evaluationId: string;
    tenantId: string;
    procedimentoId: string;
    corpusFingerprint: string;
    documentCount: number;
    maxCostAmount: number;
  };
  state: {
    status: "READY" | "AUTHORIZED" | "ADMITTED";
    jobId: string | null;
    expiresAt: string | null;
  };
}

export function EvaluationAuthorizationPanel() {
  const [state, setState] = useState<EvaluationState | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch("/api/admin/fascicolo-analysis-evaluation", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Impossibile verificare i vincoli della valutazione.");
        return response.json() as Promise<EvaluationState>;
      })
      .then(setState)
      .catch((error: Error) => setMessage(error.message));
  }, []);

  async function authorize() {
    if (!state || confirmation !== state.evaluation.evaluationId) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/fascicolo-analysis-evaluation", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": state.csrfToken,
        },
        body: JSON.stringify({
          action: "AUTHORIZE_AND_ADMIT",
          confirmation,
          csrfToken: state.csrfToken,
        }),
      });
      const result = await response.json() as {
        error?: string;
        jobId?: string;
        admissionOutcome?: "CREATED" | "REUSED";
      };
      if (!response.ok || !result.jobId) {
        throw new Error(result.error ?? "Autorizzazione non completata.");
      }
      setState({
        ...state,
        state: { status: "ADMITTED", jobId: result.jobId, expiresAt: null },
      });
      setMessage(
        result.admissionOutcome === "CREATED"
          ? `Job ${result.jobId} ammesso. Nessuna chiamata OpenAI è stata eseguita.`
          : `Job ${result.jobId} già ammesso. Nessun secondo job è stato creato.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Autorizzazione non completata.");
    } finally {
      setPending(false);
    }
  }

  if (!state) {
    return <p className="text-sm text-slate-600">{message ?? "Verifica dei vincoli in corso..."}</p>;
  }

  return (
    <div className="space-y-5">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-500">Test</dt><dd className="font-medium">{state.evaluation.evaluationId}</dd></div>
        <div><dt className="text-slate-500">Documenti</dt><dd className="font-medium">{state.evaluation.documentCount}/8 READY</dd></div>
        <div><dt className="text-slate-500">Tenant</dt><dd className="break-all font-mono text-xs">{state.evaluation.tenantId}</dd></div>
        <div><dt className="text-slate-500">Procedimento</dt><dd className="break-all font-mono text-xs">{state.evaluation.procedimentoId}</dd></div>
        <div className="sm:col-span-2"><dt className="text-slate-500">Fingerprint corpus</dt><dd className="break-all font-mono text-xs">{state.evaluation.corpusFingerprint}</dd></div>
        <div><dt className="text-slate-500">Costo massimo prenotabile</dt><dd className="font-medium">{state.evaluation.maxCostAmount.toFixed(2)} EUR</dd></div>
        <div><dt className="text-slate-500">Stato</dt><dd className="font-medium">{state.state.status}</dd></div>
      </dl>

      {state.state.jobId ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Job ammesso: <span className="font-mono">{state.state.jobId}</span>. Il runner one-off resta separato.
        </div>
      ) : (
        <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-950">
            Questa azione crea o riusa un permit a consumo unico e ammette un solo job.
            Non avvia il runner e non effettua chiamate OpenAI.
          </p>
          <label className="grid gap-1 text-sm font-medium text-slate-800">
            Digita TEST-LEGAL-001 per confermare
            <input
              className="h-10 rounded-md border border-slate-300 bg-white px-3 font-mono text-sm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
          <Button
            type="button"
            onClick={authorize}
            disabled={pending || confirmation !== state.evaluation.evaluationId}
          >
            {pending ? "Autorizzazione in corso..." : "Autorizza e ammetti il job"}
          </Button>
        </div>
      )}

      {message ? <p className="text-sm text-slate-700" role="status">{message}</p> : null}
    </div>
  );
}
