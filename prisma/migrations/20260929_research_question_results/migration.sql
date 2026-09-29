CREATE TYPE "ResearchResultSupportDirection" AS ENUM ('SUPPORTS', 'OPPOSES', 'NEUTRAL', 'INCONCLUSIVE', 'UNASSESSED');
CREATE TYPE "ResearchResultClassificationSource" AS ENUM ('PROVIDER_OUTPUT', 'SYNTHETIC_TEST', 'HUMAN_REVIEW', 'AI_CLASSIFIER');
CREATE TYPE "ResearchResultReviewStatus" AS ENUM ('AI_PROPOSED', 'HUMAN_CONFIRMED', 'REJECTED');

CREATE UNIQUE INDEX "research_bundle_mission_uq"
  ON "ResearchEvidenceBundleRecord"("id", "missionId");

CREATE TABLE "ResearchQuestionResultRecord" (
  "id" VARCHAR(96) PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "caseId" VARCHAR(256) NOT NULL,
  "missionId" VARCHAR(96) NOT NULL,
  "bundleId" VARCHAR(96) NOT NULL,
  "candidateId" VARCHAR(256) NOT NULL,
  "legalIssueSemanticKey" CHAR(64) NOT NULL,
  "researchQuestionSemanticKey" CHAR(64) NOT NULL,
  "missionFingerprint" CHAR(64) NOT NULL,
  "providerId" VARCHAR(128),
  "toolId" VARCHAR(128) NOT NULL,
  "candidateSnapshot" JSONB NOT NULL,
  "supportDirection" "ResearchResultSupportDirection" NOT NULL DEFAULT 'UNASSESSED',
  "classificationSource" "ResearchResultClassificationSource" NOT NULL DEFAULT 'PROVIDER_OUTPUT',
  "classificationConfidence" DOUBLE PRECISION,
  "classificationRationale" VARCHAR(2000),
  "classificationReviewStatus" "ResearchResultReviewStatus" NOT NULL DEFAULT 'AI_PROPOSED',
  "coverageElementKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "unresolvedAspectKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_question_result_mission_tenant_fk"
    FOREIGN KEY ("missionId", "tenantId") REFERENCES "ResearchMissionRecord"("id", "tenantId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_question_result_bundle_mission_fk"
    FOREIGN KEY ("bundleId", "missionId") REFERENCES "ResearchEvidenceBundleRecord"("id", "missionId")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "research_question_result_identity_uq"
  ON "ResearchQuestionResultRecord"("tenantId", "missionId", "candidateId");
CREATE INDEX "research_question_result_question_idx"
  ON "ResearchQuestionResultRecord"("tenantId", "caseId", "researchQuestionSemanticKey");
CREATE INDEX "research_question_result_mission_idx"
  ON "ResearchQuestionResultRecord"("missionId", "createdAt");
CREATE INDEX "research_question_result_bundle_idx"
  ON "ResearchQuestionResultRecord"("bundleId");