DROP INDEX "research_mission_knowledge_fingerprint_uq";

CREATE INDEX "research_mission_knowledge_fingerprint_idx"
ON "ResearchMissionRecord" ("tenantId", "caseId", "missionFingerprint");

CREATE UNIQUE INDEX "research_mission_current_knowledge_fingerprint_uq"
ON "ResearchMissionRecord" ("tenantId", "caseId", "missionFingerprint")
WHERE "lifecycleStatus" = 'CURRENT' AND "missionFingerprint" IS NOT NULL;
