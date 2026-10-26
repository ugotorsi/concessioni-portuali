import {
  promotePreparedKnowledgeRevision,
  runInFascicoloKnowledgeTransaction,
  type KnowledgeRevisionSnapshot,
} from "@/server/fascicolo-knowledge/repository";
import { persistStructuredFascicoloReport } from "@/server/fascicolo-report/repository";
import type { BuiltStructuredFascicoloReport } from "@/server/fascicolo-report/structured-report";
import { getFascicoloAutomaticWorkflowReadModelForTenant } from "@/server/queries/fascicolo-automatic-workflow";

export async function buildStructuredReportForRevision(input: {
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId: string;
}): Promise<BuiltStructuredFascicoloReport | null> {
  const model = await getFascicoloAutomaticWorkflowReadModelForTenant(input);
  if (
    !model?.structuredReport
    || model.structuredReport.payload.knowledgeRevisionId
      !== input.knowledgeRevisionId
  ) {
    return null;
  }
  return model.structuredReport;
}

export async function finalizeStructuredKnowledgeAndReport(input: {
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId: string;
  expectedCurrentRevisionId: string | null;
  report: BuiltStructuredFascicoloReport;
}): Promise<{
  revision: KnowledgeRevisionSnapshot;
  outcome: "CREATED" | "REUSED";
  snapshotId: string;
}> {
  return runInFascicoloKnowledgeTransaction(async (transactionContext) => {
    const revision = await promotePreparedKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      revisionId: input.knowledgeRevisionId,
      expectedCurrentRevisionId: input.expectedCurrentRevisionId,
    }, transactionContext);
    const saved = await persistStructuredFascicoloReport(input.report, {
      read: transactionContext.read,
      transaction: transactionContext.transaction,
    });
    return {
      revision,
      outcome: saved.outcome,
      snapshotId: saved.snapshot.id,
    };
  });
}

/** Rebuild and archive an unvalidated draft using existing current evidence, without providers. */
export async function persistCurrentStructuredReport(input: {
  tenantId: string;
  procedimentoId: string;
}): Promise<{
  outcome: "CREATED" | "REUSED";
  snapshotId: string;
} | null> {
  const model = await getFascicoloAutomaticWorkflowReadModelForTenant(input);
  if (!model?.structuredReport) return null;
  const saved = await persistStructuredFascicoloReport(model.structuredReport);
  return { outcome: saved.outcome, snapshotId: saved.snapshot.id };
}

/** Rebuild and archive an unvalidated draft using existing current evidence, without providers. */
export async function refreshStructuredReportAfterResearch(input: {
  tenantId: string;
  procedimentoId: string;
}): Promise<"CREATED" | "REUSED" | "NO_KNOWLEDGE"> {
  const saved = await persistCurrentStructuredReport(input);
  return saved?.outcome ?? "NO_KNOWLEDGE";
}
