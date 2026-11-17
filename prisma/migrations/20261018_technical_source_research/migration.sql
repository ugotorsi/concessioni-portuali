CREATE TABLE "TechnicalSourceResearchRecord" (
    "id" VARCHAR(96) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "missionId" VARCHAR(96) NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "questionSnapshot" TEXT NOT NULL,
    "toolName" VARCHAR(64) NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "responsePayload" JSONB NOT NULL,
    "serviceVersion" VARCHAR(64) NOT NULL,
    "verificationStatus" VARCHAR(48) NOT NULL DEFAULT 'DA_VERIFICARE_SU_FONTE_ORIGINALE',
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "technical_source_research_tool_ck" CHECK (
        "toolName" IN ('search', 'fetch', 'lista_livelli_wms', 'interroga_punto_wms', 'matrice_verifiche_manufatto')
    ),
    CONSTRAINT "technical_source_research_verification_ck" CHECK (
        "verificationStatus" IN ('DA_VERIFICARE_SU_FONTE_ORIGINALE', 'INDICATIVO_DA_VERIFICARE', 'RISPOSTA_VUOTA_NON_PROBATORIA')
    ),
    CONSTRAINT "TechnicalSourceResearchRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "technical_source_research_mission_idx"
ON "TechnicalSourceResearchRecord"("tenantId", "procedimentoId", "missionId", "retrievedAt");

CREATE INDEX "technical_source_research_actor_idx"
ON "TechnicalSourceResearchRecord"("tenantId", "requestedByUserId", "retrievedAt");

ALTER TABLE "TechnicalSourceResearchRecord"
ADD CONSTRAINT "TechnicalSourceResearchRecord_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TechnicalSourceResearchRecord"
ADD CONSTRAINT "technical_source_research_procedure_fk"
FOREIGN KEY ("procedimentoId", "tenantId") REFERENCES "Procedimento"("id", "enteId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TechnicalSourceResearchRecord"
ADD CONSTRAINT "technical_source_research_mission_fk"
FOREIGN KEY ("missionId", "tenantId") REFERENCES "ResearchMissionRecord"("id", "tenantId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TechnicalSourceResearchRecord"
ADD CONSTRAINT "technical_source_research_user_fk"
FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
