import type { KnowledgeEvidenceCandidate, KnowledgeScope } from "./contracts";
import {
  createBuildingKnowledgeRevision,
  getCurrentKnowledgeRevision,
  reconcileAndPromoteKnowledgeRevision,
  resolveKnowledgeSubjects,
  runInFascicoloKnowledgeTransaction,
  type FascicoloKnowledgeRepositoryContext,
  type KnowledgeReconciliationResult,
} from "./repository";
import {
  FASCICOLO_STRUCTURED_KNOWLEDGE_VERSION,
  fascicoloStructuredKnowledgeSchema,
} from "./structuredContracts";
import { projectStructuredKnowledge } from "./structuredProjection";

export interface StructuredKnowledgePersistenceResult extends KnowledgeReconciliationResult {
  warnings: readonly string[];
  subjectIdsByLocalId: ReadonlyMap<string, string>;
}

export async function persistStructuredKnowledgeRevision(input: KnowledgeScope & {
  corpusFingerprint: string;
  knowledge: unknown;
  evidenceByBasisRef: ReadonlyMap<string, KnowledgeEvidenceCandidate>;
}, overrides: Partial<FascicoloKnowledgeRepositoryContext> = {}): Promise<StructuredKnowledgePersistenceResult> {
  const knowledge = fascicoloStructuredKnowledgeSchema.parse(input.knowledge);
  return runInFascicoloKnowledgeTransaction(async (transactionContext) => {
    const subjects = await resolveKnowledgeSubjects({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      candidates: knowledge.subjects,
    }, transactionContext);
    const subjectIdsByLocalId = new Map([...subjects].map(([localId, subject]) => [localId, subject.id]));
    const projection = projectStructuredKnowledge({
      knowledge,
      subjectIdsByLocalId,
      evidenceByBasisRef: input.evidenceByBasisRef,
    });
    const current = await getCurrentKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
    }, transactionContext);
    const building = await createBuildingKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      corpusFingerprint: input.corpusFingerprint,
      contractVersion: FASCICOLO_STRUCTURED_KNOWLEDGE_VERSION,
      warnings: [...projection.warnings],
    }, transactionContext);
    const result = await reconcileAndPromoteKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      revisionId: building.id,
      expectedCurrentRevisionId: current?.id ?? null,
      candidates: projection.candidates,
      relations: projection.relations,
    }, transactionContext);
    return { ...result, warnings: projection.warnings, subjectIdsByLocalId };
  }, overrides);
}