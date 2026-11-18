"use client";

import { useState } from "react";

type ProviderResult = {
  provider: "ANTHROPIC" | "DEEPSEEK";
  status: "PASS" | "FAIL" | "NOT_TESTED";
  attempted: boolean;
  model: string | null;
  jsonValid: boolean | null;
  refsValid: boolean | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
  } | null;
  estimatedCostUsd: number | null;
  anomaly: string | null;
  stopReason: string | null;
};

type QualificationState = {
  csrfToken: string;
  preflight: {
    inputTokenUpperBound: number;
    maximumCostUsd: number;
    compatible: boolean;
  };
  state: {
    status: string;
    providers: ProviderResult[];
    totalEstimatedCostUsd: number;
  } | null;
};

export function LiveQualificationPanel() {
  const [snapshot, setSnapshot] = useState<QualificationState | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function load() {
    const response = await fetch("/api/admin/ai-live-qualification", {
      cache: "no-store",
    });
    const body = await response.json() as QualificationState & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "PREFLIGHT_FAILED");
    setSnapshot(body);
  }

  async function run() {
    if (!snapshot) return;
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/ai-live-qualification", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": snapshot.csrfToken,
        },
        body: JSON.stringify({
          action: "RUN_ISSUE_70_ONCE",
          confirmation,
          csrfToken: snapshot.csrfToken,
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "LIVE_QUALIFICATION_FAILED");
      await load();
    } catch (runError) {
      setError(runError instanceof Error
        ? runError.message
        : "LIVE_QUALIFICATION_FAILED");
    } finally {
      setRunning(false);
    }
  }

  const state = snapshot?.state;
  const disabled = running
    || !snapshot?.preflight.compatible
    || confirmation !== "ESEGUI DUE TEST SYN-001"
    || state !== null;

  return (
    <section className="mx-auto max-w-5xl space-y-6 p-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
          Harness temporaneo - Issue #70
        </p>
        <h1 className="text-3xl font-semibold">Qualificazione live sintetica</h1>
        <p className="text-sm text-slate-600">
          Solo SYN-001. Una richiesta per provider. Nessun dato applicativo.
        </p>
      </header>

      {snapshot ? (
        <div className="rounded border border-slate-200 bg-white p-5 text-sm">
          <dl className="grid gap-3 md:grid-cols-3">
            <div>
              <dt className="font-medium">Input massimo stimato</dt>
              <dd>{snapshot.preflight.inputTokenUpperBound} token</dd>
            </div>
            <div>
              <dt className="font-medium">Costo massimo cumulativo</dt>
              <dd>${snapshot.preflight.maximumCostUsd.toFixed(6)}</dd>
            </div>
            <div>
              <dt className="font-medium">Stato ledger</dt>
              <dd>{state?.status ?? "READY"}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <button
          type="button"
          className="rounded bg-slate-800 px-4 py-2 font-medium text-white"
          onClick={() => {
            setError(null);
            load().catch((loadError: unknown) => {
              setError(loadError instanceof Error
                ? loadError.message
                : "PREFLIGHT_FAILED");
            });
          }}
        >
          Carica preflight protetto
        </button>
      )}

      {state?.providers?.length ? (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="p-3">Provider</th>
                <th className="p-3">Esito</th>
                <th className="p-3">Modello</th>
                <th className="p-3">JSON / riferimenti</th>
                <th className="p-3">Token input / output</th>
                <th className="p-3">Costo USD</th>
                <th className="p-3">Stop reason</th>
                <th className="p-3">Anomalia</th>
              </tr>
            </thead>
            <tbody>
              {state.providers.map((provider) => (
                <tr className="border-b" key={provider.provider}>
                  <td className="p-3">{provider.provider}</td>
                  <td className="p-3">{provider.status}</td>
                  <td className="p-3">{provider.model ?? "-"}</td>
                  <td className="p-3">
                    {String(provider.jsonValid)} / {String(provider.refsValid)}
                  </td>
                  <td className="p-3">
                    {provider.usage
                      ? `${provider.usage.inputTokens} / ${provider.usage.outputTokens}`
                      : "-"}
                  </td>
                  <td className="p-3">
                    {provider.estimatedCostUsd?.toFixed(8) ?? "-"}
                  </td>
                  <td className="p-3">{provider.stopReason ?? "-"}</td>
                  <td className="p-3">{provider.anomaly ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-3 rounded border border-amber-300 bg-amber-50 p-5">
          <label className="block text-sm font-medium" htmlFor="confirmation">
            Digita ESEGUI DUE TEST SYN-001
          </label>
          <input
            id="confirmation"
            className="w-full rounded border border-slate-300 bg-white px-3 py-2"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            className="rounded bg-amber-700 px-4 py-2 font-medium text-white disabled:opacity-50"
            disabled={disabled}
            onClick={run}
          >
            {running ? "Esecuzione in corso..." : "Esegui una volta"}
          </button>
        </div>
      )}

      {error ? (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}
