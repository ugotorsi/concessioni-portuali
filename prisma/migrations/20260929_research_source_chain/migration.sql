CREATE TYPE "ResearchSourceRetrievalState" AS ENUM ('RETRIEVAL_REQUIRED', 'RESOLVED', 'BLOCKED');
CREATE TYPE "ResearchSourceTextState" AS ENUM ('METADATA_ONLY', 'SNIPPET_ONLY', 'PARTIAL_TEXT', 'FULL_TEXT');
CREATE TYPE "ResearchSourceIdentityState" AS ENUM ('NOT_ASSESSED', 'VERIFIED', 'MISMATCH', 'INCOMPLETE', 'MANUAL_REVIEW_REQUIRED');
CREATE TYPE "ResearchSourceContentState" AS ENUM ('NOT_ASSESSED', 'VERIFIED', 'MISMATCH', 'INCOMPLETE', 'MANUAL_REVIEW_REQUIRED');
CREATE TYPE "ResearchSourceTemporalState" AS ENUM ('NOT_ASSESSED', 'APPLICABLE', 'NOT_APPLICABLE', 'UNCERTAIN');
CREATE TYPE "ResearchSourceAdverseState" AS ENUM ('NOT_REQUIRED', 'REQUIRED', 'COMPLETED');
CREATE TYPE "ResearchSourceOfficiality" AS ENUM ('OFFICIAL', 'NON_OFFICIAL', 'SECONDARY', 'UNKNOWN');
CREATE TYPE "ResearchAdverseRequirementStatus" AS ENUM ('REQUIRED', 'COMPLETED', 'HISTORICAL');

CREATE TABLE "ResearchSourceAssessmentRecord" (
  "id" VARCHAR(96) PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "caseId" VARCHAR(256) NOT NULL,
  "resultId" VARCHAR(96) NOT NULL,
  "missionId" VARCHAR(96) NOT NULL,
  "researchQuestionSemanticKey" CHAR(64) NOT NULL,
  "missionFingerprint" CHAR(64) NOT NULL,
  "referenceDate" TIMESTAMPTZ NOT NULL,
  "referenceDateBasis" JSONB NOT NULL,
  "verificationVersion" VARCHAR(64) NOT NULL,
  "chainFingerprint" CHAR(64) NOT NULL,
  "sourceFamilyId" TEXT,
  "sourceVersionId" TEXT,
  "acquisitionId" TEXT,
  "temporalAssessmentId" TEXT,
  "sourceIdentityKey" VARCHAR(512),
  "contentSha256" CHAR(64),
  "retrievalState" "ResearchSourceRetrievalState" NOT NULL DEFAULT 'RETRIEVAL_REQUIRED',
  "textState" "ResearchSourceTextState" NOT NULL DEFAULT 'METADATA_ONLY',
  "identityState" "ResearchSourceIdentityState" NOT NULL DEFAULT 'NOT_ASSESSED',
  "contentState" "ResearchSourceContentState" NOT NULL DEFAULT 'NOT_ASSESSED',
  "temporalState" "ResearchSourceTemporalState" NOT NULL DEFAULT 'NOT_ASSESSED',
  "adverseState" "ResearchSourceAdverseState" NOT NULL DEFAULT 'NOT_REQUIRED',
  "officiality" "ResearchSourceOfficiality" NOT NULL DEFAULT 'UNKNOWN',
  "citationAnchors" JSONB NOT NULL,
  "blockingReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "manualReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "manualReviewReason" VARCHAR(1000),
  "usable" BOOLEAN NOT NULL DEFAULT false,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_source_assessment_result_fk" FOREIGN KEY ("resultId") REFERENCES "ResearchQuestionResultRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_source_assessment_mission_tenant_fk" FOREIGN KEY ("missionId", "tenantId") REFERENCES "ResearchMissionRecord"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_source_assessment_family_fk" FOREIGN KEY ("sourceFamilyId") REFERENCES "LegalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_source_assessment_version_fk" FOREIGN KEY ("sourceVersionId") REFERENCES "LegalSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_source_assessment_acquisition_fk" FOREIGN KEY ("acquisitionId") REFERENCES "LegalSourceAcquisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_source_assessment_temporal_fk" FOREIGN KEY ("temporalAssessmentId") REFERENCES "LegalSourceTemporalAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "research_source_assessment_chain_uq" ON "ResearchSourceAssessmentRecord"("chainFingerprint");
CREATE UNIQUE INDEX "research_source_assessment_identity_uq" ON "ResearchSourceAssessmentRecord"("resultId", "chainFingerprint");
CREATE INDEX "research_source_assessment_current_question_idx" ON "ResearchSourceAssessmentRecord"("tenantId", "caseId", "researchQuestionSemanticKey", "isCurrent");
CREATE INDEX "research_source_assessment_current_mission_idx" ON "ResearchSourceAssessmentRecord"("missionId", "isCurrent");
CREATE INDEX "research_source_assessment_source_idx" ON "ResearchSourceAssessmentRecord"("sourceFamilyId", "sourceVersionId");

CREATE TABLE "ResearchAdverseRequirement" (
  "id" VARCHAR(96) PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "caseId" VARCHAR(256) NOT NULL,
  "researchQuestionSemanticKey" CHAR(64) NOT NULL,
  "primaryMissionId" VARCHAR(96) NOT NULL,
  "adverseMissionId" VARCHAR(96),
  "primaryMissionFingerprint" CHAR(64) NOT NULL,
  "policyVersion" VARCHAR(64) NOT NULL,
  "requirementFingerprint" CHAR(64) NOT NULL,
  "rationale" VARCHAR(2000) NOT NULL,
  "status" "ResearchAdverseRequirementStatus" NOT NULL DEFAULT 'REQUIRED',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ,
  CONSTRAINT "research_adverse_requirement_primary_fk" FOREIGN KEY ("primaryMissionId") REFERENCES "ResearchMissionRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_adverse_requirement_mission_fk" FOREIGN KEY ("adverseMissionId") REFERENCES "ResearchMissionRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "research_adverse_requirement_mission_uq" ON "ResearchAdverseRequirement"("adverseMissionId");
CREATE UNIQUE INDEX "research_adverse_requirement_fingerprint_uq" ON "ResearchAdverseRequirement"("requirementFingerprint");
CREATE UNIQUE INDEX "research_adverse_requirement_current_uq" ON "ResearchAdverseRequirement"("tenantId", "caseId", "researchQuestionSemanticKey", "primaryMissionFingerprint", "policyVersion") WHERE "status" <> 'HISTORICAL';
CREATE INDEX "research_adverse_requirement_question_idx" ON "ResearchAdverseRequirement"("tenantId", "caseId", "researchQuestionSemanticKey", "status");
CREATE INDEX "research_adverse_requirement_primary_idx" ON "ResearchAdverseRequirement"("primaryMissionId");