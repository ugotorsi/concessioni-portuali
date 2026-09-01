import { buildAiFascicoloAuthoritativeEvidenceV1 } from "@/server/ai/fascicoloAuthoritativeEvidence";
import { createFascicoloLiveAnalysisPreparationService } from "@/server/ai/fascicoloLiveAnalysis";
import { persistAiFascicoloTrustedReviewMaterial } from "@/server/ai/fascicoloReviewPersistence";
import { buildAiFascicoloTrustedReviewV1 } from "@/server/ai/fascicoloTrustedReview";
import type { AiFascicoloTrustedReviewLineageV1 } from "@/server/ai/fascicoloTrustedReviewIdentity";

export class AiFascicoloTrustedReviewProductionError extends Error {
  readonly code = "INVALID_INPUT" as const;

  constructor() {
    super("INVALID_INPUT");
    this.name = "AiFascicoloTrustedReviewProductionError";
  }
}

export interface AiFascicoloTrustedReviewProductionResultV1 {
  readonly materialId: string;
  readonly procedimentoId: string;
  readonly outcome: "CREATED" | "REUSED" | "REUSED_AFTER_RACE";
}

export interface FascicoloTrustedReviewProductionService {
  execute(input: unknown): Promise<AiFascicoloTrustedReviewProductionResultV1>;
}

function parseInput(input: unknown): { readonly procedimentoId: string } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new AiFascicoloTrustedReviewProductionError();
  }
  const prototype = Object.getPrototypeOf(input);
  const names = Object.getOwnPropertyNames(input);
  const symbols = Object.getOwnPropertySymbols(input);
  const descriptor = Object.getOwnPropertyDescriptor(input, "procedimentoId");
  if (
    (prototype !== Object.prototype && prototype !== null)
    || names.length !== 1
    || names[0] !== "procedimentoId"
    || symbols.length !== 0
    || !descriptor?.enumerable
    || !("value" in descriptor)
    || typeof descriptor.value !== "string"
    || descriptor.value.trim().length === 0
  ) {
    throw new AiFascicoloTrustedReviewProductionError();
  }
  return { procedimentoId: descriptor.value };
}

export function createFascicoloTrustedReviewProductionService(
  config: Parameters<typeof createFascicoloLiveAnalysisPreparationService>[0],
): FascicoloTrustedReviewProductionService {
  const preparation = createFascicoloLiveAnalysisPreparationService(config);
  return {
    async execute(input: unknown) {
      const { procedimentoId } = parseInput(input);
      const context = await preparation.prepare(procedimentoId);
      const authoritativeEvidence = buildAiFascicoloAuthoritativeEvidenceV1({
        snapshot: context.snapshot,
        projection: context.projection,
      });
      const trustedReview = buildAiFascicoloTrustedReviewV1({
        trustedResult: context.analysis,
        authoritativeEvidence,
      });
      const lineage: AiFascicoloTrustedReviewLineageV1 = {
        analysisSchemaVersion: context.analysis.analysisSchemaVersion,
        snapshotSchemaVersion: context.analysis.snapshotSchemaVersion,
        outboundSchemaVersion: context.analysis.outboundSchemaVersion,
        sourceSnapshotContentHash: context.analysis.sourceSnapshotContentHash,
        outboundProjectionHash: context.analysis.outboundProjectionHash,
        outboundProjectionHashAlgorithm: context.analysis.outboundProjectionHashAlgorithm,
      };
      const persisted = await persistAiFascicoloTrustedReviewMaterial({
        procedimentoId,
        trustedReview,
        lineage,
      });
      return Object.freeze({
        materialId: persisted.materialId,
        procedimentoId: persisted.procedimentoId,
        outcome: persisted.outcome,
      });
    },
  };
}
