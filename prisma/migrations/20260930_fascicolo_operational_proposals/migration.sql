CREATE TYPE "FascicoloOperationalProposalType" AS ENUM ('DEADLINE', 'CRITICALITY', 'DOCUMENT_REQUIREMENT', 'CHECKLIST_ITEM', 'ACTIVITY', 'NOTE', 'SUBJECT_UPDATE');
CREATE TYPE "FascicoloOperationalProposalStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'AMENDED_AND_APPROVED', 'MATERIALIZED', 'SUPERSEDED', 'STALE');
CREATE TYPE "FascicoloOperationalProposalReviewAction" AS ENUM ('APPROVE', 'REJECT', 'AMEND_AND_APPROVE');

CREATE TABLE "FascicoloOperationalProposal" (
  "id" VARCHAR(96) PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "procedimentoId" TEXT NOT NULL,
  "knowledgeRevisionId" TEXT NOT NULL,
  "structuredReportId" VARCHAR(96),
  "structuredReportFingerprint" CHAR(64) NOT NULL,
  "policyVersion" VARCHAR(64) NOT NULL,
  "proposalType" "FascicoloOperationalProposalType" NOT NULL,
  "status" "FascicoloOperationalProposalStatus" NOT NULL DEFAULT 'PROPOSED',
  "title" VARCHAR(512) NOT NULL,
  "description" TEXT NOT NULL,
  "proposedPayload" JSONB NOT NULL,
  "approvedPayload" JSONB,
  "originatingKnowledgeItemIds" TEXT[] NOT NULL,
  "originatingIssueSemanticKeys" TEXT[] NOT NULL,
  "originatingQuestionSemanticKeys" TEXT[] NOT NULL,
  "relevantResultIds" TEXT[] NOT NULL,
  "rationale" TEXT NOT NULL,
  "confidence" INTEGER,
  "proposalFingerprint" CHAR(64) NOT NULL,
  "warningCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reviewVersion" INTEGER NOT NULL DEFAULT 0,
  "reviewedAt" TIMESTAMPTZ,
  "reviewedByActorId" VARCHAR(256),
  "reviewedByEmail" VARCHAR(320),
  "reviewedByRole" VARCHAR(128),
  "reviewNote" TEXT,
  "materializedAt" TIMESTAMPTZ,
  "materializedEntityType" VARCHAR(64),
  "materializedEntityId" VARCHAR(256),
  "supersededAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fascicolo_operational_proposal_confidence_ck" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 100),
  CONSTRAINT "fascicolo_operational_proposal_origin_ck" CHECK (cardinality("originatingKnowledgeItemIds") + cardinality("originatingIssueSemanticKeys") + cardinality("originatingQuestionSemanticKeys") + cardinality("relevantResultIds") > 0),
  CONSTRAINT "fascicolo_operational_proposal_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fascicolo_operational_proposal_procedure_fk" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fascicolo_operational_proposal_revision_fk" FOREIGN KEY ("knowledgeRevisionId", "tenantId", "procedimentoId") REFERENCES "FascicoloKnowledgeRevision"("id", "tenantId", "procedimentoId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fascicolo_operational_proposal_report_fk" FOREIGN KEY ("structuredReportId") REFERENCES "StructuredFascicoloReportSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fascicolo_operational_proposal_identity_uq" ON "FascicoloOperationalProposal"("tenantId", "procedimentoId", "proposalFingerprint");
CREATE UNIQUE INDEX "fascicolo_operational_proposal_scope_uq" ON "FascicoloOperationalProposal"("id", "tenantId", "procedimentoId");
CREATE INDEX "fascicolo_operational_proposal_scope_status_idx" ON "FascicoloOperationalProposal"("tenantId", "procedimentoId", "status", "proposalType");
CREATE INDEX "fascicolo_operational_proposal_revision_idx" ON "FascicoloOperationalProposal"("knowledgeRevisionId");
CREATE INDEX "fascicolo_operational_proposal_report_idx" ON "FascicoloOperationalProposal"("structuredReportId");

CREATE TABLE "FascicoloOperationalProposalReviewEvent" (
  "id" VARCHAR(96) PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "procedimentoId" TEXT NOT NULL,
  "proposalId" VARCHAR(96) NOT NULL,
  "action" "FascicoloOperationalProposalReviewAction" NOT NULL,
  "previousStatus" "FascicoloOperationalProposalStatus" NOT NULL,
  "nextStatus" "FascicoloOperationalProposalStatus" NOT NULL,
  "reviewVersion" INTEGER NOT NULL,
  "proposedPayload" JSONB NOT NULL,
  "approvedPayload" JSONB,
  "actorId" VARCHAR(256) NOT NULL,
  "actorEmail" VARCHAR(320),
  "actorRole" VARCHAR(128) NOT NULL,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fascicolo_operational_proposal_review_fk" FOREIGN KEY ("proposalId", "tenantId", "procedimentoId") REFERENCES "FascicoloOperationalProposal"("id", "tenantId", "procedimentoId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fascicolo_operational_proposal_review_version_uq" ON "FascicoloOperationalProposalReviewEvent"("proposalId", "reviewVersion");
CREATE INDEX "fascicolo_operational_proposal_review_scope_idx" ON "FascicoloOperationalProposalReviewEvent"("tenantId", "procedimentoId", "createdAt");

CREATE TABLE "FascicoloOperationalProposalMaterialization" (
  "id" VARCHAR(96) PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "procedimentoId" TEXT NOT NULL,
  "proposalId" VARCHAR(96) NOT NULL,
  "entityType" VARCHAR(64) NOT NULL,
  "entityId" VARCHAR(256) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fascicolo_operational_proposal_materialization_fk" FOREIGN KEY ("proposalId", "tenantId", "procedimentoId") REFERENCES "FascicoloOperationalProposal"("id", "tenantId", "procedimentoId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fascicolo_operational_materialization_proposal_uq" ON "FascicoloOperationalProposalMaterialization"("proposalId");
CREATE UNIQUE INDEX "fascicolo_operational_materialization_scope_uq" ON "FascicoloOperationalProposalMaterialization"("proposalId", "tenantId", "procedimentoId");
CREATE UNIQUE INDEX "fascicolo_operational_materialization_entity_uq" ON "FascicoloOperationalProposalMaterialization"("entityType", "entityId");
CREATE INDEX "fascicolo_operational_materialization_scope_idx" ON "FascicoloOperationalProposalMaterialization"("tenantId", "procedimentoId", "createdAt");