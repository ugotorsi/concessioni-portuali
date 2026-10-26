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
import {
  assertStructuredKnowledgeQuality,
  projectStructuredKnowledge,
  type StructuredKnowledgeQualityAssessment,
} from "./structuredProjection";

export interface StructuredKnowledgePersistenceResult extends KnowledgeReconciliationResult {
  warnings: readonly string[];
  subjectIdsByLocalId: ReadonlyMap<string, string>;
  quality: StructuredKnowledgeQualityAssessment;
}

export async function persistStructuredKnowledgeRevision(input: KnowledgeScope & {
  corpusFingerprint: string;
  knowledge: unknown;
  evidenceByBasisRef: ReadonlyMap<string, KnowledgeEvidenceCandidate>;
  sourceTextByBasisRef?: ReadonlyMap<string, string>;
  revisionContractVersion?: string;
  deferPromotion?: boolean;
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
      sourceTextByBasisRef: input.sourceTextByBasisRef,
    });
    assertStructuredKnowledgeQuality(projection.quality);
    const current = await getCurrentKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
    }, transactionContext);
    const building = await createBuildingKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      corpusFingerprint: input.corpusFingerprint,
      contractVersion: input.revisionContractVersion ?? FASCICOLO_STRUCTURED_KNOWLEDGE_VERSION,
      warnings: [...projection.warnings],
    }, transactionContext);
    const result = await reconcileAndPromoteKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      revisionId: building.id,
      expectedCurrentRevisionId: current?.id ?? null,
      deferPromotion: input.deferPromotion,
      candidates: projection.candidates,
      relations: projection.relations,
    }, transactionContext);
    return {
      ...result,
      warnings: projection.warnings,
      subjectIdsByLocalId,
      quality: projection.quality,
    };
  }, overrides);
}