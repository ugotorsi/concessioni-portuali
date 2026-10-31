"use client";

import { useCallback, useEffect, useState } from "react";

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
    jobStatus: string | null;
    attemptCount: number | null;
    expiresAt: string | null;
  };
}

export function EvaluationAuthorizationPanel() {
  const [state, setState] = useState<EvaluationState | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [runConfirmation, setRunConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const loadState = useCallback(async () => {
    const response = await fetch("/api/admin/fascicolo-analysis-evaluation", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Impossibile verificare i vincoli della valutazione.");
    const nextState = await response.json() as EvaluationState;
    setState(nextState);
    return nextState;
  }, []);

  useEffect(() => {
    loadState().catch((error: Error) => setMessage(error.message));
  }, [loadState]);

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
      await loadState();
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

  async function runOnce() {
    if (!state?.state.jobId || runConfirmation !== "ESEGUI TEST-LEGAL-001") return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/fascicolo-analysis-evaluation/run", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": state.csrfToken,
        },
        body: JSON.stringify({
          action: "RUN_ONCE",
          confirmation: runConfirmation,
          jobId: state.state.jobId,
          csrfToken: state.csrfToken,
        }),
      });
      const result = await response.json() as {
        error?: string;
        outcome?: string;
        jobId?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Esecuzione non completata.");
      }
      await loadState();
      setMessage(`Job ${result.jobId} concluso con esito runner ${result.outcome}. Nessun retry è disponibile.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Esecuzione non completata.");
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
        <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p>
            Job ammesso: <span className="font-mono">{state.state.jobId}</span>.
            Stato: <span className="font-medium">{state.state.jobStatus ?? "NON DISPONIBILE"}</span>.
          </p>
          {state.state.jobStatus === "PENDING" && state.state.attemptCount === 0 ? (
            <>
              <p>
                L'azione seguente esegue il runner una sola volta e può invocare OpenAI.
                Non sono previsti retry automatici.
              </p>
              <label className="grid gap-1 font-medium text-slate-800">
                Digita ESEGUI TEST-LEGAL-001 per confermare l'esecuzione
                <input
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 font-mono text-sm"
                  value={runConfirmation}
                  onChange={(event) => setRunConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <Button
                type="button"
                onClick={runOnce}
                disabled={pending || runConfirmation !== "ESEGUI TEST-LEGAL-001"}
              >
                {pending
                  ? "Esecuzione in corso..."
                  : "Esegui una sola volta TEST-LEGAL-001"}
              </Button>
            </>
          ) : null}
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
