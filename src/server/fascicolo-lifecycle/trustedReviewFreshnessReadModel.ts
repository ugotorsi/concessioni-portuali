import { buildAiFascicoloSnapshotV1 } from "@/server/ai/fascicoloSnapshot";

import {
  evaluateTrustedReviewFreshness,
  type FreshnessAssessment,
  type QualifiedPendingRecalculation,
} from "./freshness";

export async function loadTrustedReviewFreshness(input: {
  procedimentoId: string;
  sourceSnapshotContentHash: string;
  pendingRecalculation?: QualifiedPendingRecalculation | null;
}): Promise<FreshnessAssessment> {
  const snapshot = await buildAiFascicoloSnapshotV1(input.procedimentoId);
  return evaluateTrustedReviewFreshness({
    currentSnapshotContentHash: snapshot.metadata.contentHash,
    sourceSnapshotContentHash: input.sourceSnapshotContentHash,
    pendingRecalculation: input.pendingRecalculation,
  });
}