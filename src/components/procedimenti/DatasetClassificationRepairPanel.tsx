import { SubmitButtonPending } from "@/components/forms/SubmitButtonPending";
import type { DatasetClassificationRepairPlan } from "@/server/dataset-classification/repair-plan";
import { repairDatasetClassificationAction } from "@/server/actions/dataset-classification-repair";
import { DATASET_CLASSIFICATION_REPAIR_CONFIRMATION } from "@/server/dataset-classification/repair";

export function DatasetClassificationRepairPanel({
  plan,
}: {
  readonly plan: DatasetClassificationRepairPlan;
}) {
  if (plan.changes.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Correzione classificazione dataset"
      className="rounded-md border border-amber-300 bg-amber-50 p-4"
    >
      <h2 className="text-base font-semibold text-amber-950">
        Classificazione dataset incoerente
      </h2>
      <p className="mt-1 text-sm text-amber-900">
        Il tenant {plan.tenantCode} richiede la classe {plan.targetClass}, ma{" "}
        {plan.changes.length} radici collegate risultano classificate diversamente.
        Documenti, versioni, estrazioni, conoscenza, job, rapporti e audit non verranno
        modificati.
      </p>
      <form action={repairDatasetClassificationAction} className="mt-3 space-y-3">
        <input type="hidden" name="procedimentoId" value={plan.selectedProcedureId} />
        <input type="hidden" name="expectedFingerprint" value={plan.fingerprint} />
        <label className="block text-sm font-medium text-amber-950">
          Motivazione della correzione
          <input
            name="reason"
            required
            minLength={10}
            maxLength={1_000}
            className="mt-1 h-10 w-full rounded-md border border-amber-300 bg-white px-3 text-sm text-slate-950"
          />
        </label>
        <label className="flex items-start gap-2 text-xs text-amber-950">
          <input
            type="checkbox"
            name="confirmation"
            value={DATASET_CLASSIFICATION_REPAIR_CONFIRMATION}
            required
          />
          Confermo l&apos;allineamento atomico delle sole radici dataset al tenant; lo
          storico e tutti gli artefatti collegati devono essere preservati.
        </label>
        <SubmitButtonPending pendingLabel="Allineamento in corso...">
          Allinea al workspace {plan.targetScope === "SYNTHETIC" ? "sintetico" : "professionale"}
        </SubmitButtonPending>
      </form>
    </section>
  );
}
