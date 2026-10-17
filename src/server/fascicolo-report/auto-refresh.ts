import { persistStructuredFascicoloReport } from "@/server/fascicolo-report/repository";
import { getFascicoloAutomaticWorkflowReadModelForTenant } from "@/server/queries/fascicolo-automatic-workflow";

/** Rebuild and archive an unvalidated draft using existing current evidence, without providers. */
export async function refreshStructuredReportAfterResearch(input: {
  tenantId: string;
  procedimentoId: string;
}): Promise<"CREATED" | "REUSED" | "NO_KNOWLEDGE"> {
  const model = await getFascicoloAutomaticWorkflowReadModelForTenant(input);
  if (!model?.structuredReport) return "NO_KNOWLEDGE";
  const saved = await persistStructuredFascicoloReport(model.structuredReport);
  return saved.outcome;
}
