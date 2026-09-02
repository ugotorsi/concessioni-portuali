"use server";

import { AiFascicoloAnalysisError } from "@/server/ai/fascicoloAnalysis";
import { AiFascicoloAuthoritativeEvidenceError } from "@/server/ai/fascicoloAuthoritativeEvidence";
import { AiFascicoloBasisRefResolutionError } from "@/server/ai/fascicoloBasisRefResolution";
import { AiFascicoloLiveAnalysisError } from "@/server/ai/fascicoloLiveAnalysis";
import { AiFascicoloOutboundProjectionError } from "@/server/ai/fascicoloOutboundProjection";
import { AiFascicoloReviewPersistenceError } from "@/server/ai/fascicoloReviewPersistence";
import { AiFascicoloSnapshotError } from "@/server/ai/fascicoloSnapshot";
import { AiFascicoloTrustedReviewValidationError } from "@/server/ai/fascicoloTrustedReview";
import {
  AiFascicoloTrustedReviewProductionError,
  type AiFascicoloTrustedReviewProductionResultV1,
} from "@/server/ai/fascicoloTrustedReviewProduction";
import {
  OpenAiRuntimeConfigurationError,
  createOpenAiFascicoloTrustedReviewProductionRuntimeFromEnv,
} from "@/server/ai/openaiRuntime";
import { AiRealDataActivationError } from "@/server/ai/realDataActivation";

type ProductionErrorCode =
  | AiFascicoloAnalysisError["code"]
  | AiFascicoloAuthoritativeEvidenceError["code"]
  | AiFascicoloBasisRefResolutionError["code"]
  | AiFascicoloLiveAnalysisError["code"]
  | AiFascicoloOutboundProjectionError["code"]
  | AiFascicoloReviewPersistenceError["code"]
  | AiFascicoloSnapshotError["code"]
  | AiFascicoloTrustedReviewValidationError["code"]
  | AiFascicoloTrustedReviewProductionError["code"]
  | OpenAiRuntimeConfigurationError["code"]
  | AiRealDataActivationError["code"]
  | "PRODUCTION_FAILURE";

type ProductionSuccess = Pick<
  AiFascicoloTrustedReviewProductionResultV1,
  "materialId" | "procedimentoId" | "outcome"
>;

export type AiFascicoloTrustedReviewProductionActionResult =
  | { readonly ok: true; readonly result: ProductionSuccess }
  | { readonly ok: false; readonly error: { readonly code: ProductionErrorCode } };

function safeProductionErrorCode(error: unknown): ProductionErrorCode {
  if (
    error instanceof AiFascicoloAnalysisError
    || error instanceof AiFascicoloAuthoritativeEvidenceError
    || error instanceof AiFascicoloBasisRefResolutionError
    || error instanceof AiFascicoloLiveAnalysisError
    || error instanceof AiFascicoloOutboundProjectionError
    || error instanceof AiFascicoloReviewPersistenceError
    || error instanceof AiFascicoloSnapshotError
    || error instanceof AiFascicoloTrustedReviewValidationError
    || error instanceof AiFascicoloTrustedReviewProductionError
    || error instanceof OpenAiRuntimeConfigurationError
    || error instanceof AiRealDataActivationError
  ) {
    return error.code;
  }
  return "PRODUCTION_FAILURE";
}

export async function produceAiFascicoloTrustedReviewAction(
  input: unknown,
): Promise<AiFascicoloTrustedReviewProductionActionResult> {
  try {
    const service = createOpenAiFascicoloTrustedReviewProductionRuntimeFromEnv();
    const result = await service.execute(input);
    return {
      ok: true,
      result: {
        materialId: result.materialId,
        procedimentoId: result.procedimentoId,
        outcome: result.outcome,
      },
    };
  } catch (error) {
    return { ok: false, error: { code: safeProductionErrorCode(error) } };
  }
}