import { createHash } from "node:crypto";

import { stableStringify } from "@/server/audit/hash";

export const CLASSIFICATION_REVIEW_ACTION = "RESEARCH_QUESTION_RESULT_REVIEW";
export const CLASSIFICATION_REVIEW_ENTITY = "ResearchQuestionResult";

export interface ClassificationReviewValues {
  tenantId: string;
  missionId: string;
  resultId: string;
  direction: string;
  reviewStatus: string;
  confidence: number | null;
  rationale: string | null;
}

export function classificationReviewFingerprint(values: ClassificationReviewValues): string {
  return createHash("sha256").update(stableStringify(values)).digest("hex");
}
