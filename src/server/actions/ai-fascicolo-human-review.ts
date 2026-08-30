"use server";

import {
  AiFascicoloHumanReviewPersistenceError,
  persistAiFascicoloHumanReview,
  type AiFascicoloHumanReviewPersistenceInput,
  type AiFascicoloHumanReviewPersistenceResult,
} from "@/server/ai/fascicoloHumanReviewPersistence";

type HumanReviewApplyErrorCode = AiFascicoloHumanReviewPersistenceError["code"];
type HumanReviewApplySuccess = Omit<AiFascicoloHumanReviewPersistenceResult, "state"> & {
  readonly state: Omit<AiFascicoloHumanReviewPersistenceResult["state"], "id">;
};

export type AiFascicoloHumanReviewApplyActionResult =
  | {
      readonly ok: true;
      readonly result: HumanReviewApplySuccess;
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: HumanReviewApplyErrorCode };
    };

export async function applyAiFascicoloHumanReviewAction(
  input: AiFascicoloHumanReviewPersistenceInput,
): Promise<AiFascicoloHumanReviewApplyActionResult> {
  try {
    const result = await persistAiFascicoloHumanReview(input);
    return {
      ok: true,
      result: {
        outcome: result.outcome,
        materialId: result.materialId,
        statementPath: result.statementPath,
        event: {
          id: result.event.id,
          sequence: result.event.sequence,
          disposition: result.event.disposition,
        },
        state: {
          version: result.state.version,
          latestDisposition: result.state.latestDisposition,
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error instanceof AiFascicoloHumanReviewPersistenceError
          ? error.code
          : "PERSISTENCE_FAILURE",
      },
    };
  }
}