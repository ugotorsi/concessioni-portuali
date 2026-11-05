"use client";

import { Button } from "@/components/ui/Button";

interface AiEngineView {
  provider: "OPENAI" | "ANTHROPIC" | "DEEPSEEK";
  label: string;
  model: string;
  credentialConfigured: boolean;
  connectionStatus: "VERIFIED" | "FAILED" | "STALE" | "NOT_VERIFIED";
  credentialValid: boolean;
  modelAvailable: boolean;
  modelTechnicallyQualified: boolean;
  lastVerifiedAtLabel: string | null;
  realDataAuthorized: boolean;
  manualEnabled: boolean;
  manualEligible: boolean;
  automaticSelected: boolean;
  automaticEligible: boolean;
  globalAiEnabled: boolean;
  generalAutomationEnabled: boolean;
  operational: boolean;
  estimatedCostLimitEur: number | null;
  billingApproval: "INTERNAL_LIMIT_CONFIGURED" | "NOT_APPROVED";
  status: "READY" | "DISABLED" | "BLOCKED" | "ATTENTION";
  error: string | null;
}

function yesNo(value: boolean): string {
  return value ? "Sì" : "No";
}

function connectionLabel(status: AiEngineView["connectionStatus"]): string {
  if (status === "VERIFIED") return "Verificata";
  if (status === "FAILED") return "Verifica fallita";
  if (status === "STALE") return "Da ripetere sulla configurazione corrente";
  return "Non verificata";
}

function statusClass(status: AiEngineView["status"]): string {
  if (status === "READY") return "bg-emerald-100 text-emerald-800";
  if (status === "ATTENTION") return "bg-amber-100 text-amber-900";
  if (status === "DISABLED") return "bg-slate-100 text-slate-700";
  return "bg-red-100 text-red-800";
}

export function AiEngineControls(props: {
  engines: readonly AiEngineView[];
  updateManualAction: (formData: FormData) => Promise<void>;
  selectAutomaticAction: (formData: FormData) => Promise<void>;
  verifyConnectionAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {props.engines.map((engine) => (
        <article key={engine.provider} className="space-y-4 rounded-lg border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">{engine.label}</h3>
              <p className="text-xs text-slate-500">{engine.model}</p>
            </div>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(engine.status)}`}>
              {engine.status}
            </span>
          </div>

          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Credenziale API</dt><dd className="font-medium">{engine.credentialConfigured ? "Configurata" : "Assente"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Credenziale valida</dt><dd className="font-medium">{yesNo(engine.credentialValid)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Connessione</dt><dd className="font-medium">{connectionLabel(engine.connectionStatus)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Modello disponibile</dt><dd className="font-medium">{yesNo(engine.modelAvailable)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Modello qualificato</dt><dd className="font-medium">{yesNo(engine.modelTechnicallyQualified)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Dati reali</dt><dd className="font-medium">{engine.realDataAuthorized ? "Autorizzati" : "Non autorizzati"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Manuale</dt><dd className="font-medium">{engine.manualEnabled ? "ON" : "OFF"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Automatico</dt><dd className="font-medium">{engine.automaticSelected ? "ON · principale" : "OFF"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Idoneo automatico</dt><dd className="font-medium">{yesNo(engine.automaticEligible)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Stato operativo</dt><dd className="font-medium">{engine.operational ? "Operativo" : "Bloccato"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Limite preventivo</dt><dd className="font-medium">{engine.estimatedCostLimitEur === null ? "Non configurato" : `€ ${engine.estimatedCostLimitEur.toFixed(6)}`}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Fatturazione</dt><dd className="font-medium">{engine.billingApproval === "INTERNAL_LIMIT_CONFIGURED" ? "Limite interno configurato" : "Non approvata"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Automazione generale</dt><dd className="font-medium">{engine.generalAutomationEnabled ? "ON" : "OFF"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Ultima verifica</dt><dd className="text-right font-medium">{engine.lastVerifiedAtLabel ?? "Mai"}</dd></div>
          </dl>

          {engine.error ? (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">{engine.error}</p>
          ) : null}

          <div className="grid gap-2">
            <form action={props.updateManualAction}>
              <input type="hidden" name="provider" value={engine.provider} />
              <input type="hidden" name="enabled" value={engine.manualEnabled ? "false" : "true"} />
              <input type="hidden" name="confirmation" value="UPDATE_AI_PROVIDER_MANUAL_CONTROL" />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={!engine.manualEnabled && !engine.manualEligible}
              >
                {engine.manualEnabled ? "Disabilita manuale" : "Abilita manuale"}
              </Button>
            </form>

            <form action={props.selectAutomaticAction}>
              <input type="hidden" name="selection" value={`${engine.provider}:${engine.model}`} />
              <input type="hidden" name="confirmation" value="SELECT_AUTOMATIC_AI_PROVIDER" />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={engine.automaticSelected || !engine.automaticEligible}
              >
                {engine.automaticSelected ? "Motore automatico principale" : "Imposta come automatico"}
              </Button>
            </form>

            <form action={props.verifyConnectionAction}>
              <input type="hidden" name="provider" value={engine.provider} />
              <input type="hidden" name="confirmation" value="VERIFY_AI_PROVIDER_CONNECTION" />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={!engine.credentialConfigured}
              >
                Verifica connessione
              </Button>
              <p className="mt-1 text-xs text-slate-500">
                Solo endpoint di autenticazione/modelli; nessuna generazione e costo atteso €0.
              </p>
            </form>
          </div>
        </article>
      ))}
    </div>
  );
}
