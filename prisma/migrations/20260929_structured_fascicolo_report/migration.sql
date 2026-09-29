CREATE TYPE "StructuredFascicoloReportStatus" AS ENUM ('CURRENT', 'STALE', 'SUPERSEDED');

CREATE TABLE "StructuredFascicoloReportSnapshot" (
  "id" VARCHAR(96) PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "procedimentoId" TEXT NOT NULL,
  "knowledgeRevisionId" TEXT NOT NULL,
  "contractVersion" VARCHAR(64) NOT NULL,
  "reportFingerprint" CHAR(64) NOT NULL,
  "corpusFingerprint" CHAR(64) NOT NULL,
  "researchStateFingerprint" CHAR(64) NOT NULL,
  "sourceStateFingerprint" CHAR(64) NOT NULL,
  "status" "StructuredFascicoloReportStatus" NOT NULL DEFAULT 'CURRENT',
  "payload" JSONB NOT NULL,
  "warnings" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "staleReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "supersededBySnapshotId" VARCHAR(96),
  "generatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "structured_fascicolo_report_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "structured_fascicolo_report_procedure_fk" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "structured_fascicolo_report_revision_fk" FOREIGN KEY ("knowledgeRevisionId", "tenantId", "procedimentoId") REFERENCES "FascicoloKnowledgeRevision"("id", "tenantId", "procedimentoId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "structured_fascicolo_report_superseded_fk" FOREIGN KEY ("supersededBySnapshotId") REFERENCES "StructuredFascicoloReportSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "structured_fascicolo_report_fingerprint_uq" ON "StructuredFascicoloReportSnapshot"("reportFingerprint");
CREATE UNIQUE INDEX "structured_fascicolo_report_current_uq" ON "StructuredFascicoloReportSnapshot"("tenantId", "procedimentoId") WHERE "status" = 'CURRENT';
CREATE INDEX "structured_fascicolo_report_scope_status_idx" ON "StructuredFascicoloReportSnapshot"("tenantId", "procedimentoId", "status", "generatedAt");
CREATE INDEX "structured_fascicolo_report_revision_idx" ON "StructuredFascicoloReportSnapshot"("knowledgeRevisionId");
CREATE INDEX "structured_fascicolo_report_superseded_idx" ON "StructuredFascicoloReportSnapshot"("supersededBySnapshotId");