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
