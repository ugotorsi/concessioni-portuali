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
  promotable: boolean;
}

export async function persistStructuredKnowledgeRevision(input: KnowledgeScope & {
  corpusFingerprint: string;
  knowledge: unknown;
  evidenceByBasisRef: ReadonlyMap<string, KnowledgeEvidenceCandidate>;
  sourceTextByBasisRef?: ReadonlyMap<string, string>;
  revisionContractVersion?: string;
  deferPromotion?: boolean;
  preserveDraftOnQualityFailure?: boolean;
  compilation?: {
    promotable: boolean;
    quarantinedItemLocalIds: readonly string[];
    diagnostics: readonly {
      code: string;
      path: string;
      action: "PRESERVED" | "REBUILT" | "MARKED_UNRESOLVED" | "BLOCKED";
    }[];
  };
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
    const compilationBlockingReasons = input.compilation?.promotable === false
      ? ["UNVERIFIED_PROVIDER_ITEMS"]
      : [];
    const quality: StructuredKnowledgeQualityAssessment = {
      ...projection.quality,
      proposedCount: projection.quality.proposedCount
        + (input.compilation?.quarantinedItemLocalIds.length ?? 0),
      rejectedCount: projection.quality.rejectedCount
        + (input.compilation?.quarantinedItemLocalIds.length ?? 0),
      blockingReasons: [...new Set([
        ...projection.quality.blockingReasons,
        ...compilationBlockingReasons,
      ])].sort(),
    };
    const promotable = quality.blockingReasons.length === 0;
    if (!promotable && !input.preserveDraftOnQualityFailure) {
      assertStructuredKnowledgeQuality(quality);
    }
    const compilationWarnings = input.compilation?.diagnostics.map((diagnostic) => (
      `COMPILATION:${diagnostic.action}:${diagnostic.code}:${diagnostic.path}`
    )) ?? [];
    const current = await getCurrentKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
    }, transactionContext);
    const building = await createBuildingKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      corpusFingerprint: input.corpusFingerprint,
      contractVersion: input.revisionContractVersion ?? FASCICOLO_STRUCTURED_KNOWLEDGE_VERSION,
      warnings: [...projection.warnings, ...compilationWarnings],
    }, transactionContext);
    const result = await reconcileAndPromoteKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      revisionId: building.id,
      expectedCurrentRevisionId: current?.id ?? null,
      deferPromotion: input.deferPromotion || !promotable,
      candidates: projection.candidates,
      relations: projection.relations,
    }, transactionContext);
    return {
      ...result,
      warnings: projection.warnings,
      subjectIdsByLocalId,
      quality,
      promotable,
    };
  }, overrides);
}