CREATE TYPE "FascicoloKnowledgeIdentityState" AS ENUM (
  'VERIFIED_NEW',
  'VERIFIED_CONTINUATION',
  'AMBIGUOUS',
  'LEGACY_UNVERIFIED'
);

CREATE TABLE "FascicoloKnowledgeIdentity" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "procedimentoId" TEXT NOT NULL,
  "kind" VARCHAR(64) NOT NULL,
  "createdInRevisionId" TEXT NOT NULL,
  "creationBasis" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FascicoloKnowledgeIdentity_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FascicoloKnowledgeItem"
  ADD COLUMN "identityId" TEXT,
  ADD COLUMN "identityState" "FascicoloKnowledgeIdentityState",
  ADD COLUMN "identityBasis" JSONB,
  ADD COLUMN "identityCommandFingerprint" CHAR(64);

CREATE TABLE "FascicoloKnowledgeEvidenceSpan" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "procedimentoId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "startOffset" INTEGER NOT NULL,
  "endOffset" INTEGER NOT NULL,
  "quoteSha256" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FascicoloKnowledgeEvidenceSpan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fascicolo_knowledge_evidence_span_offsets_ck"
    CHECK ("startOffset" >= 0 AND "endOffset" > "startOffset")
);

ALTER TABLE "FascicoloKnowledgeItem"
  ADD CONSTRAINT "fascicolo_knowledge_item_identity_state_ck"
  CHECK (
    (
      "identityState" IS NULL
      AND "identityId" IS NULL
      AND "identityBasis" IS NULL
      AND "identityCommandFingerprint" IS NULL
    )
    OR (
      "identityState" = 'LEGACY_UNVERIFIED'
      AND "identityId" IS NULL
      AND "identityBasis" IS NULL
      AND "identityCommandFingerprint" IS NULL
    )
    OR (
      "identityState" = 'AMBIGUOUS'
      AND "identityId" IS NULL
      AND "identityBasis" IS NOT NULL
      AND "identityCommandFingerprint" IS NOT NULL
    )
    OR (
      "identityState" = 'VERIFIED_NEW'
      AND "identityId" IS NOT NULL
      AND "identityBasis" IS NULL
      AND "identityCommandFingerprint" IS NOT NULL
    )
    OR (
      "identityState" = 'VERIFIED_CONTINUATION'
      AND "identityId" IS NOT NULL
      AND "identityBasis" IS NOT NULL
      AND "identityCommandFingerprint" IS NOT NULL
    )
  );

CREATE UNIQUE INDEX "fascicolo_knowledge_identity_scope_kind_uq"
  ON "FascicoloKnowledgeIdentity" ("id", "tenantId", "procedimentoId", "kind");

CREATE INDEX "fascicolo_knowledge_identity_scope_kind_idx"
  ON "FascicoloKnowledgeIdentity" ("tenantId", "procedimentoId", "kind", "createdAt");

CREATE INDEX "fascicolo_knowledge_identity_created_revision_idx"
  ON "FascicoloKnowledgeIdentity" ("createdInRevisionId");

CREATE UNIQUE INDEX "fascicolo_knowledge_item_revision_identity_uq"
  ON "FascicoloKnowledgeItem" ("revisionId", "identityId");

CREATE UNIQUE INDEX "fascicolo_knowledge_item_verified_new_identity_uq"
  ON "FascicoloKnowledgeItem" ("identityId")
  WHERE "identityState" = 'VERIFIED_NEW';

CREATE INDEX "fascicolo_knowledge_item_identity_idx"
  ON "FascicoloKnowledgeItem" ("tenantId", "procedimentoId", "identityId");

CREATE UNIQUE INDEX "fascicolo_knowledge_evidence_scope_uq"
  ON "FascicoloKnowledgeEvidence" ("id", "tenantId", "procedimentoId");

CREATE UNIQUE INDEX "fascicolo_knowledge_evidence_span_occurrence_uq"
  ON "FascicoloKnowledgeEvidenceSpan" ("evidenceId", "startOffset", "endOffset");

CREATE INDEX "fascicolo_knowledge_evidence_span_scope_idx"
  ON "FascicoloKnowledgeEvidenceSpan" ("tenantId", "procedimentoId", "evidenceId");

ALTER TABLE "FascicoloKnowledgeIdentity"
  ADD CONSTRAINT "FascicoloKnowledgeIdentity_tenantId_fkey"
  FOREIGN KEY ("tenantId")
  REFERENCES "Ente" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FascicoloKnowledgeIdentity"
  ADD CONSTRAINT "fascicolo_knowledge_identity_procedure_scope_fk"
  FOREIGN KEY ("procedimentoId", "tenantId")
  REFERENCES "Procedimento" ("id", "enteId")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "FascicoloKnowledgeIdentity"
  ADD CONSTRAINT "fascicolo_knowledge_identity_created_revision_scope_fk"
  FOREIGN KEY ("createdInRevisionId", "tenantId", "procedimentoId")
  REFERENCES "FascicoloKnowledgeRevision" ("id", "tenantId", "procedimentoId")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "FascicoloKnowledgeItem"
  ADD CONSTRAINT "fascicolo_knowledge_item_identity_scope_kind_fk"
  FOREIGN KEY ("identityId", "tenantId", "procedimentoId", "kind")
  REFERENCES "FascicoloKnowledgeIdentity" ("id", "tenantId", "procedimentoId", "kind")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "FascicoloKnowledgeEvidenceSpan"
  ADD CONSTRAINT "fascicolo_knowledge_evidence_span_evidence_scope_fk"
  FOREIGN KEY ("evidenceId", "tenantId", "procedimentoId")
  REFERENCES "FascicoloKnowledgeEvidence" ("id", "tenantId", "procedimentoId")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "FascicoloKnowledgeEvidence"
  ADD CONSTRAINT "fascicolo_knowledge_evidence_document_scope_fk"
  FOREIGN KEY ("documentoId", "tenantId", "procedimentoId")
  REFERENCES "Documento" ("id", "enteId", "procedimentoId")
  ON DELETE RESTRICT ON UPDATE NO ACTION
  NOT VALID;

ALTER TABLE "FascicoloKnowledgeEvidence"
  ADD CONSTRAINT "fascicolo_knowledge_evidence_file_version_scope_fk"
  FOREIGN KEY ("documentFileVersionId", "documentoId", "tenantId")
  REFERENCES "DocumentFileVersion" ("id", "documentId", "canonicalEnteId")
  ON DELETE RESTRICT ON UPDATE NO ACTION
  NOT VALID;

CREATE UNIQUE INDEX "document_extraction_attempt_evidence_scope_uq"
  ON "DocumentExtractionAttempt" (
    "id",
    "documentoId",
    "documentFileVersionId",
    "tenantId",
    "procedimentoId"
  );

ALTER TABLE "FascicoloKnowledgeEvidence"
  ADD CONSTRAINT "fascicolo_knowledge_evidence_document_attempt_scope_fk"
  FOREIGN KEY (
    "documentExtractionAttemptId",
    "documentoId",
    "documentFileVersionId",
    "tenantId",
    "procedimentoId"
  )
  REFERENCES "DocumentExtractionAttempt" (
    "id",
    "documentoId",
    "documentFileVersionId",
    "tenantId",
    "procedimentoId"
  )
  ON DELETE RESTRICT ON UPDATE NO ACTION
  NOT VALID;

CREATE UNIQUE INDEX "neutral_intake_extraction_page_evidence_uq"
  ON "NeutralIntakeExtractionPage" ("extractionAttemptId", "pageNumber", "textSha256");

CREATE UNIQUE INDEX "document_extraction_page_evidence_uq"
  ON "DocumentExtractionPage" ("extractionAttemptId", "pageNumber", "textSha256");

ALTER TABLE "FascicoloKnowledgeEvidence"
  ADD CONSTRAINT "fascicolo_knowledge_evidence_neutral_page_fk"
  FOREIGN KEY ("extractionAttemptId", "pageNumber", "textSha256")
  REFERENCES "NeutralIntakeExtractionPage" ("extractionAttemptId", "pageNumber", "textSha256")
  ON DELETE RESTRICT ON UPDATE NO ACTION
  NOT VALID;

ALTER TABLE "FascicoloKnowledgeEvidence"
  ADD CONSTRAINT "fascicolo_knowledge_evidence_document_page_fk"
  FOREIGN KEY ("documentExtractionAttemptId", "pageNumber", "textSha256")
  REFERENCES "DocumentExtractionPage" ("extractionAttemptId", "pageNumber", "textSha256")
  ON DELETE RESTRICT ON UPDATE NO ACTION
  NOT VALID;
