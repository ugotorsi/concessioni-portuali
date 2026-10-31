CREATE TABLE "V7ProviderOutputRecoveryArtifact" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "corpusFingerprint" CHAR(64) NOT NULL,
    "approvalId" VARCHAR(256) NOT NULL,
    "outputFingerprint" CHAR(64) NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "V7ProviderOutputRecoveryArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "V7ProviderOutputRecoveryArtifact_jobId_key"
ON "V7ProviderOutputRecoveryArtifact"("jobId");

CREATE INDEX "V7ProviderOutputRecoveryArtifact_tenantId_procedimentoId_createdAt_idx"
ON "V7ProviderOutputRecoveryArtifact"("tenantId", "procedimentoId", "createdAt");

CREATE INDEX "V7ProviderOutputRecoveryArtifact_expiresAt_idx"
ON "V7ProviderOutputRecoveryArtifact"("expiresAt");
