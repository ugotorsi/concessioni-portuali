CREATE TYPE "ResearchMissionLifecycleStatus" AS ENUM ('CURRENT', 'HISTORICAL');

ALTER TABLE "ResearchMissionRecord"
  ADD COLUMN "missionFingerprint" CHAR(64),
  ADD COLUMN "knowledgeRevisionId" TEXT,
  ADD COLUMN "firstKnowledgeRevisionId" TEXT,
  ADD COLUMN "legalIssueSemanticKey" CHAR(64),
  ADD COLUMN "researchQuestionSemanticKey" CHAR(64),
  ADD COLUMN "referenceDateBasis" JSONB,
  ADD COLUMN "lifecycleStatus" "ResearchMissionLifecycleStatus" NOT NULL DEFAULT 'CURRENT';

CREATE UNIQUE INDEX "research_mission_knowledge_fingerprint_uq"
  ON "ResearchMissionRecord"("tenantId", "caseId", "missionFingerprint");
CREATE INDEX "research_mission_lifecycle_idx"
  ON "ResearchMissionRecord"("tenantId", "caseId", "lifecycleStatus");
CREATE INDEX "research_mission_knowledge_revision_idx"
  ON "ResearchMissionRecord"("knowledgeRevisionId");
CREATE INDEX "research_mission_first_knowledge_revision_idx"
  ON "ResearchMissionRecord"("firstKnowledgeRevisionId");
CREATE INDEX "research_mission_question_idx"
  ON "ResearchMissionRecord"("tenantId", "caseId", "researchQuestionSemanticKey");

ALTER TABLE "ResearchMissionRecord"
  ADD CONSTRAINT "ResearchMissionRecord_knowledgeRevisionId_fkey"
  FOREIGN KEY ("knowledgeRevisionId") REFERENCES "FascicoloKnowledgeRevision"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResearchMissionRecord"
  ADD CONSTRAINT "ResearchMissionRecord_firstKnowledgeRevisionId_fkey"
  FOREIGN KEY ("firstKnowledgeRevisionId") REFERENCES "FascicoloKnowledgeRevision"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
