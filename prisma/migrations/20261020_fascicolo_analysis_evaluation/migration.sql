CREATE TABLE "FascicoloAnalysisEvaluationPermit" (
    "permitRef" VARCHAR(256) NOT NULL,
    "evaluationId" VARCHAR(128) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "corpusFingerprint" CHAR(64) NOT NULL,
    "operation" VARCHAR(128) NOT NULL,
    "testCaseId" VARCHAR(128) NOT NULL,
    "maxCostAmount" DECIMAL(18,6) NOT NULL,
    "authorizedByUserId" TEXT NOT NULL,
    "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedByJobId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "FascicoloAnalysisEvaluationPermit_pkey" PRIMARY KEY ("permitRef"),
    CONSTRAINT "FascicoloAnalysisEvaluationPermit_cost_check"
      CHECK ("maxCostAmount" = 0.500000),
    CONSTRAINT "FascicoloAnalysisEvaluationPermit_consumption_check"
      CHECK (("consumedByJobId" IS NULL AND "consumedAt" IS NULL)
        OR ("consumedByJobId" IS NOT NULL AND "consumedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "FascicoloAnalysisEvaluationPermit_evaluationId_key"
ON "FascicoloAnalysisEvaluationPermit"("evaluationId");

CREATE UNIQUE INDEX "FascicoloAnalysisEvaluationPermit_consumedByJobId_key"
ON "FascicoloAnalysisEvaluationPermit"("consumedByJobId");

CREATE INDEX "FascicoloAnalysisEvaluationPermit_tenantId_procedimentoId_authorizedAt_idx"
ON "FascicoloAnalysisEvaluationPermit"("tenantId", "procedimentoId", "authorizedAt");

CREATE INDEX "FascicoloAnalysisEvaluationPermit_expiresAt_consumedAt_revokedAt_idx"
ON "FascicoloAnalysisEvaluationPermit"("expiresAt", "consumedAt", "revokedAt");

CREATE TABLE "FascicoloAnalysisEvaluationArtifact" (
    "evaluationId" VARCHAR(128) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "authorizationRef" VARCHAR(256) NOT NULL,
    "testCaseId" VARCHAR(128) NOT NULL,
    "corpusFingerprint" CHAR(64) NOT NULL,
    "contractVersion" VARCHAR(128) NOT NULL,
    "inputFingerprint" CHAR(64) NOT NULL,
    "outputFingerprint" CHAR(64) NOT NULL,
    "providerOutput" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "comparison" JSONB NOT NULL,
    "maxCostAmount" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FascicoloAnalysisEvaluationArtifact_pkey" PRIMARY KEY ("evaluationId")
);

CREATE UNIQUE INDEX "FascicoloAnalysisEvaluationArtifact_jobId_key"
ON "FascicoloAnalysisEvaluationArtifact"("jobId");

CREATE UNIQUE INDEX "FascicoloAnalysisEvaluationArtifact_authorizationRef_key"
ON "FascicoloAnalysisEvaluationArtifact"("authorizationRef");

CREATE INDEX "FascicoloAnalysisEvaluationArtifact_tenantId_procedimentoId_createdAt_idx"
ON "FascicoloAnalysisEvaluationArtifact"("tenantId", "procedimentoId", "createdAt");

CREATE INDEX "FascicoloAnalysisEvaluationArtifact_corpusFingerprint_idx"
ON "FascicoloAnalysisEvaluationArtifact"("corpusFingerprint");

CREATE INDEX "FascicoloAnalysisEvaluationArtifact_testCaseId_createdAt_idx"
ON "FascicoloAnalysisEvaluationArtifact"("testCaseId", "createdAt");

ALTER TABLE "FascicoloAnalysisEvaluationArtifact"
ADD CONSTRAINT "FascicoloAnalysisEvaluationArtifact_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FascicoloAnalysisEvaluationArtifact"
ADD CONSTRAINT "FascicoloAnalysisEvaluationArtifact_procedimentoId_fkey"
FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FascicoloAnalysisEvaluationArtifact"
ADD CONSTRAINT "FascicoloAnalysisEvaluationArtifact_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "AsyncJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FascicoloAnalysisEvaluationPermit"
ADD CONSTRAINT "FascicoloAnalysisEvaluationPermit_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FascicoloAnalysisEvaluationPermit"
ADD CONSTRAINT "FascicoloAnalysisEvaluationPermit_procedimentoId_fkey"
FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FascicoloAnalysisEvaluationPermit"
ADD CONSTRAINT "FascicoloAnalysisEvaluationPermit_authorizedByUserId_fkey"
FOREIGN KEY ("authorizedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FascicoloAnalysisEvaluationPermit"
ADD CONSTRAINT "FascicoloAnalysisEvaluationPermit_consumedByJobId_fkey"
FOREIGN KEY ("consumedByJobId") REFERENCES "AsyncJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FascicoloAnalysisEvaluationArtifact"
ADD CONSTRAINT "FascicoloAnalysisEvaluationArtifact_authorizationRef_fkey"
FOREIGN KEY ("authorizationRef") REFERENCES "FascicoloAnalysisEvaluationPermit"("permitRef")
ON DELETE RESTRICT ON UPDATE CASCADE;
