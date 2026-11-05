"use client";

import { Button } from "@/components/ui/Button";

interface ProcedimentoOption {
  id: string;
  label: string;
}

interface TenantOption {
  id: string;
  label: string;
}

interface AiModelOption {
  code: string;
  label: string;
  enabled: boolean;
}

export function ManualAnalysisControls(props: {
  procedimenti: readonly ProcedimentoOption[];
  tenants: readonly TenantOption[];
  aiModels: readonly AiModelOption[];
  defaultAiModelCode: string;
  singleExecutionId: string;
  batchExecutionId: string;
  singleAction: (formData: FormData) => Promise<void>;
  batchAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <form
        action={props.singleAction}
        onSubmit={(event) => {
          if (!window.confirm("Avviare ora l'analisi manuale del fascicolo selezionato entro i budget configurati?")) {
            event.preventDefault();
          }
        }}
        className="space-y-3 rounded-lg border border-slate-200 p-4"
      >
        <h3 className="font-semibold text-slate-900">Singolo fascicolo</h3>
        <input type="hidden" name="confirmation" value="RUN_MANUAL_FASCICOLO_ANALYSIS" />
        <input type="hidden" name="executionId" value={props.singleExecutionId} />
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Fascicolo attivo
          <select
            className="h-10 rounded-md border border-slate-300 px-3 text-sm"
            name="procedimentoId"
            required
          >
            <option value="">Seleziona un fascicolo</option>
            {props.procedimenti.map((procedimento) => (
              <option key={procedimento.id} value={procedimento.id}>
                {procedimento.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Provider e modello
          <select
            className="h-10 rounded-md border border-slate-300 px-3 text-sm"
            name="aiModelSelection"
            defaultValue={props.defaultAiModelCode}
            required
          >
            {props.aiModels.map((model) => (
              <option key={model.code} value={model.code} disabled={!model.enabled}>
                {model.label}{model.enabled ? "" : " · dati reali non abilitati"}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={!props.procedimenti.length}>
          Avvia analisi manuale
        </Button>
      </form>

      <form
        action={props.batchAction}
        onSubmit={(event) => {
          if (!window.confirm("Avviare l'analisi di tutti i fascicoli attivi dell'ente selezionato? I budget restano vincolanti e l'operazione è auditata.")) {
            event.preventDefault();
          }
        }}
        className="space-y-3 rounded-lg border border-slate-200 p-4"
      >
        <h3 className="font-semibold text-slate-900">Tutti i fascicoli di un ente</h3>
        <input type="hidden" name="confirmation" value="RUN_ALL_ACTIVE_FASCICOLI" />
        <input type="hidden" name="executionId" value={props.batchExecutionId} />
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Ente
          <select
            className="h-10 rounded-md border border-slate-300 px-3 text-sm"
            name="tenantId"
            required
          >
            <option value="">Seleziona un ente</option>
            {props.tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Provider e modello
          <select
            className="h-10 rounded-md border border-slate-300 px-3 text-sm"
            name="aiModelSelection"
            defaultValue={props.defaultAiModelCode}
            required
          >
            {props.aiModels.map((model) => (
              <option key={model.code} value={model.code} disabled={!model.enabled}>
                {model.label}{model.enabled ? "" : " · dati reali non abilitati"}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline" disabled={!props.tenants.length}>
          Avvia batch manuale
        </Button>
      </form>
    </div>
  );
}
