CREATE TABLE "AutomaticFascicoloReport" (
    "id" VARCHAR(96) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "neutralIntakeId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "contractVersion" VARCHAR(64) NOT NULL,
    "artifactSha256" CHAR(64) NOT NULL,
    "corpusFingerprint" CHAR(64) NOT NULL,
    "payloadFingerprint" CHAR(64) NOT NULL,
    "analysisPayload" JSONB NOT NULL,
    "provenancePayload" JSONB NOT NULL,
    "status" VARCHAR(64) NOT NULL,
    "verificationStatus" VARCHAR(64) NOT NULL,
    "createdByActorId" VARCHAR(256) NOT NULL,
    "supersededByReportId" VARCHAR(96),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomaticFascicoloReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomaticFascicoloReportDocument" (
    "reportId" VARCHAR(96) NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "artifactSha256" CHAR(64) NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomaticFascicoloReportDocument_pkey" PRIMARY KEY ("reportId", "documentVersionId")
);

CREATE TABLE "AutomaticFascicoloReportMission" (
    "reportId" VARCHAR(96) NOT NULL,
    "missionId" VARCHAR(96) NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomaticFascicoloReportMission_pkey" PRIMARY KEY ("reportId", "missionId")
);

CREATE UNIQUE INDEX "automatic_fascicolo_report_version_uq"
ON "AutomaticFascicoloReport"("tenantId", "procedimentoId", "documentVersionId", "contractVersion");

CREATE UNIQUE INDEX "automatic_fascicolo_report_corpus_uq"
ON "AutomaticFascicoloReport"("tenantId", "procedimentoId", "corpusFingerprint", "contractVersion");

CREATE UNIQUE INDEX "automatic_fascicolo_report_document_ordinal_uq"
ON "AutomaticFascicoloReportDocument"("reportId", "ordinal");

CREATE INDEX "automatic_fascicolo_report_document_link_idx"
ON "AutomaticFascicoloReportDocument"("documentVersionId");

CREATE INDEX "automatic_fascicolo_report_scope_idx"
ON "AutomaticFascicoloReport"("tenantId", "procedimentoId", "createdAt");

CREATE INDEX "automatic_fascicolo_report_document_version_idx"
ON "AutomaticFascicoloReport"("documentVersionId");

CREATE INDEX "automatic_fascicolo_report_superseded_idx"
ON "AutomaticFascicoloReport"("supersededByReportId");

CREATE INDEX "automatic_fascicolo_report_mission_idx"
ON "AutomaticFascicoloReportMission"("missionId");

ALTER TABLE "AutomaticFascicoloReport"
ADD CONSTRAINT "AutomaticFascicoloReport_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomaticFascicoloReport"
ADD CONSTRAINT "AutomaticFascicoloReport_procedimentoId_fkey"
FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomaticFascicoloReport"
ADD CONSTRAINT "AutomaticFascicoloReport_documentVersionId_fkey"
FOREIGN KEY ("documentVersionId") REFERENCES "NeutralIntakeExtractionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomaticFascicoloReport"
ADD CONSTRAINT "AutomaticFascicoloReport_supersededByReportId_fkey"
FOREIGN KEY ("supersededByReportId") REFERENCES "AutomaticFascicoloReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomaticFascicoloReportMission"
ADD CONSTRAINT "AutomaticFascicoloReportMission_reportId_fkey"
FOREIGN KEY ("reportId") REFERENCES "AutomaticFascicoloReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomaticFascicoloReportMission"
ADD CONSTRAINT "AutomaticFascicoloReportMission_missionId_fkey"
FOREIGN KEY ("missionId") REFERENCES "ResearchMissionRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomaticFascicoloReportDocument"
ADD CONSTRAINT "AutomaticFascicoloReportDocument_reportId_fkey"
FOREIGN KEY ("reportId") REFERENCES "AutomaticFascicoloReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomaticFascicoloReportDocument"
ADD CONSTRAINT "AutomaticFascicoloReportDocument_documentVersionId_fkey"
FOREIGN KEY ("documentVersionId") REFERENCES "NeutralIntakeExtractionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;