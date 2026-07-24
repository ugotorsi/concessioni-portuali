"use client";

import { useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { RuleResolutionResult } from "@/server/legal-rules/types";

const defaultPayload = {
  portCode: "NAPOLI-SALERNO",
  concessionVertical: "PORTUALE_ADSP",
  concessionObjectType: "BANCHINA",
  attivita: "COMMERCIALE",
  awardingProcedureType: "COMPARATIVA_ART37",
  feeRegime: "PORTUALE",
  comparativeProcedureStatus: "DA_AVVIARE",
  rilevanzaArt47: false,
  letteraArt47: "",
  hasMorosita: false,
  polizzaValida: true,
};

interface BooleanSelectProps {
  id: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

function BooleanSelect({ id, value, onChange }: BooleanSelectProps) {
  return (
    <select
      id={id}
      value={value ? "true" : "false"}
      onChange={(event) => onChange(event.target.value === "true")}
      className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
    >
      <option value="true">SI</option>
      <option value="false">NO</option>
    </select>
  );
}

export function RuleOrchestratorPanel() {
  const [payload, setPayload] = useState(defaultPayload);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RuleResolutionResult | null>(null);

  const submittedPayload = useMemo(
    () => ({
      ...payload,
      letteraArt47: payload.letteraArt47 || undefined,
    }),
    [payload],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/legal-rules/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(submittedPayload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Errore chiamata API." }));
        throw new Error(typeof body.error === "string" ? body.error : "Errore chiamata API.");
      }

      const json = (await response.json()) as RuleResolutionResult;
      setResult(json);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Errore inatteso.");
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Simulazione orchestratore regole</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={handleSubmit}>
            <label className="grid gap-1 text-sm text-slate-700" htmlFor="portCode">
              Port code
              <input
                id="portCode"
                value={payload.portCode}
                onChange={(event) => setPayload((prev) => ({ ...prev, portCode: event.target.value }))}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700" htmlFor="concessionVertical">
              Concession vertical
              <input
                id="concessionVertical"
                value={payload.concessionVertical}
                onChange={(event) => setPayload((prev) => ({ ...prev, concessionVertical: event.target.value }))}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700" htmlFor="concessionObjectType">
              Object type
              <input
                id="concessionObjectType"
                value={payload.concessionObjectType}
                onChange={(event) => setPayload((prev) => ({ ...prev, concessionObjectType: event.target.value }))}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700" htmlFor="attivita">
              Attivita
              <input
                id="attivita"
                value={payload.attivita}
                onChange={(event) => setPayload((prev) => ({ ...prev, attivita: event.target.value }))}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700" htmlFor="awardingProcedureType">
              Awarding procedure
              <input
                id="awardingProcedureType"
                value={payload.awardingProcedureType}
                onChange={(event) =>
                  setPayload((prev) => ({ ...prev, awardingProcedureType: event.target.value }))
                }
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700" htmlFor="feeRegime">
              Fee regime
              <input
                id="feeRegime"
                value={payload.feeRegime}
                onChange={(event) => setPayload((prev) => ({ ...prev, feeRegime: event.target.value }))}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700" htmlFor="comparativeProcedureStatus">
              Comparative status
              <input
                id="comparativeProcedureStatus"
                value={payload.comparativeProcedureStatus}
                onChange={(event) =>
                  setPayload((prev) => ({ ...prev, comparativeProcedureStatus: event.target.value }))
                }
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700" htmlFor="rilevanzaArt47">
              Rilevanza art. 47
              <BooleanSelect
                id="rilevanzaArt47"
                value={payload.rilevanzaArt47}
                onChange={(value) => setPayload((prev) => ({ ...prev, rilevanzaArt47: value }))}
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700" htmlFor="letteraArt47">
              Lettera art. 47 (opzionale)
              <input
                id="letteraArt47"
                value={payload.letteraArt47}
                onChange={(event) => setPayload((prev) => ({ ...prev, letteraArt47: event.target.value }))}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
                placeholder="D_OMESSO_PAGAMENTO_CANONE"
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700" htmlFor="hasMorosita">
              Morosita rilevata
              <BooleanSelect
                id="hasMorosita"
                value={payload.hasMorosita}
                onChange={(value) => setPayload((prev) => ({ ...prev, hasMorosita: value }))}
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700" htmlFor="polizzaValida">
              Polizza valida
              <BooleanSelect
                id="polizzaValida"
                value={payload.polizzaValida}
                onChange={(value) => setPayload((prev) => ({ ...prev, polizzaValida: value }))}
              />
            </label>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-70"
            >
              {isLoading ? "Elaborazione..." : "Esegui orchestrazione"}
            </button>
            {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Output deterministico</CardTitle>
        </CardHeader>
        <CardContent>
          {!result ? (
            <p className="text-sm text-slate-600">
              Nessuna esecuzione ancora effettuata. L output include sempre disclaimer e humanReviewRequired.
            </p>
          ) : (
            <div className="grid gap-4" data-testid="rule-orchestrator-result">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">{result.disclaimer}</p>
                <p className="mt-1">humanReviewRequired: {String(result.humanReviewRequired)}</p>
              </div>

              <p className="text-sm text-slate-700">
                Regole valutate: {result.totalRulesEvaluated} | Regole applicabili: {result.matchedRules.length}
              </p>

              <div className="grid gap-2">
                {result.matchedRules.map((rule) => (
                  <article key={rule.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {rule.ruleCode} - priorita {rule.priority}
                    </p>
                    <p className="mt-1 font-semibold text-slate-900">{rule.title}</p>
                    <p className="mt-1 text-sm text-slate-700">{rule.outcomeSummary}</p>
                    <p className="mt-2 text-xs text-slate-500">Criteri: {rule.matchedCriteria.join(", ") || "nessun filtro"}</p>
                  </article>
                ))}
                {result.matchedRules.length === 0 ? (
                  <p className="text-sm text-slate-600">Nessuna regola applicabile al set di input corrente.</p>
                ) : null}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900">Document gaps correlati</h3>
                <ul className="mt-2 grid gap-2 text-sm text-slate-700">
                  {result.relatedDocumentGaps.map((gap) => (
                    <li key={gap.id} className="rounded-md border border-slate-200 bg-white p-3">
                      <p className="font-semibold text-slate-900">{gap.gapKey} - {gap.title}</p>
                      <p className="mt-1">{gap.description}</p>
                    </li>
                  ))}
                  {result.relatedDocumentGaps.length === 0 ? <li>Nessun gap documentale aperto sulle regole applicabili.</li> : null}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
