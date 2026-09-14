-- CreateTable
CREATE TABLE "NeutralIntakeDestination" (
    "neutralIntakeId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "authoritySource" TEXT NOT NULL,
    "establishedByUserId" TEXT,
    "establishedByActorId" TEXT NOT NULL,
    "establishedByRole" TEXT NOT NULL,
    "establishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NeutralIntakeDestination_pkey" PRIMARY KEY ("neutralIntakeId"),
    CONSTRAINT "neutral_intake_destination_required_text_ck" CHECK (
        "procedimentoId" ~ '[^[:space:]]'
        AND "contractVersion" ~ '[^[:space:]]'
        AND "authoritySource" ~ '[^[:space:]]'
        AND "establishedByActorId" ~ '[^[:space:]]'
        AND "establishedByRole" ~ '[^[:space:]]'
    )
);

-- CreateTable
CREATE TABLE "LegalSourceCandidateAdmission" (
    "id" TEXT NOT NULL,
    "enteId" TEXT,
    "neutralIntakeId" TEXT NOT NULL,
    "classificationAttemptId" TEXT NOT NULL,
    "extractionAttemptId" TEXT NOT NULL,
    "evidenceHash" CHAR(64) NOT NULL,
    "classifierVersion" TEXT NOT NULL,
    "classificationOutcome" "NeutralIntakeClassificationOutcome" NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT,
    "actorRole" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalSourceCandidateAdmission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_source_candidate_required_text_ck" CHECK (
        "classifierVersion" ~ '[^[:space:]]'
        AND "contractVersion" ~ '[^[:space:]]'
        AND "actorId" ~ '[^[:space:]]'
        AND "actorRole" ~ '[^[:space:]]'
        AND "purpose" ~ '[^[:space:]]'
        AND "evidenceHash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "legal_source_candidate_outcome_ck" CHECK (
        "classificationOutcome" = 'LEGAL_SOURCE_CANDIDATE'
    )
);

CREATE UNIQUE INDEX "NeutralIntakeClassificationAttempt_handoff_binding_key"
ON "NeutralIntakeClassificationAttempt"("id", "neutralIntakeId", "extractionAttemptId", "evidenceHash", "classifierVersion", "outcome");

CREATE UNIQUE INDEX "LegalSourceCandidateAdmission_identity_key"
ON "LegalSourceCandidateAdmission"("neutralIntakeId", "classificationAttemptId", "evidenceHash", "contractVersion");

CREATE INDEX "NeutralIntakeDestination_procedimentoId_idx"
ON "NeutralIntakeDestination"("procedimentoId");

CREATE INDEX "NeutralIntakeDestination_establishedByUserId_idx"
ON "NeutralIntakeDestination"("establishedByUserId");

CREATE INDEX "LegalSourceCandidateAdmission_enteId_admittedAt_idx"
ON "LegalSourceCandidateAdmission"("enteId", "admittedAt");

CREATE INDEX "LegalSourceCandidateAdmission_classificationAttemptId_idx"
ON "LegalSourceCandidateAdmission"("classificationAttemptId");

ALTER TABLE "NeutralIntakeDestination"
ADD CONSTRAINT "NeutralIntakeDestination_neutralIntakeId_fkey"
FOREIGN KEY ("neutralIntakeId") REFERENCES "NeutralIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NeutralIntakeDestination"
ADD CONSTRAINT "NeutralIntakeDestination_procedimentoId_fkey"
FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NeutralIntakeDestination"
ADD CONSTRAINT "NeutralIntakeDestination_establishedByUserId_fkey"
FOREIGN KEY ("establishedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalSourceCandidateAdmission"
ADD CONSTRAINT "LegalSourceCandidateAdmission_enteId_fkey"
FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalSourceCandidateAdmission"
ADD CONSTRAINT "LegalSourceCandidateAdmission_neutralIntakeId_fkey"
FOREIGN KEY ("neutralIntakeId") REFERENCES "NeutralIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalSourceCandidateAdmission"
ADD CONSTRAINT "LegalSourceCandidateAdmission_classification_binding_fkey"
FOREIGN KEY ("classificationAttemptId", "neutralIntakeId", "extractionAttemptId", "evidenceHash", "classifierVersion", "classificationOutcome")
REFERENCES "NeutralIntakeClassificationAttempt"("id", "neutralIntakeId", "extractionAttemptId", "evidenceHash", "classifierVersion", "outcome") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION enforce_neutral_intake_destination_tenant()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "NeutralIntake" intake
        JOIN "Procedimento" procedimento ON procedimento."id" = NEW."procedimentoId"
        JOIN "Concessione" concessione ON concessione."id" = procedimento."concessioneId"
        WHERE intake."id" = NEW."neutralIntakeId"
          AND intake."enteId" IS NOT NULL
          AND intake."enteId" = concessione."enteId"
    ) THEN
        RAISE EXCEPTION 'NeutralIntakeDestination tenant mismatch';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER neutral_intake_destination_tenant_consistent
AFTER INSERT ON "NeutralIntakeDestination"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_neutral_intake_destination_tenant();

CREATE FUNCTION enforce_destination_tenant_after_intake_change()
RETURNS trigger AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "NeutralIntakeDestination" destination
        JOIN "Procedimento" procedimento ON procedimento."id" = destination."procedimentoId"
        JOIN "Concessione" concessione ON concessione."id" = procedimento."concessioneId"
        WHERE destination."neutralIntakeId" = NEW."id"
          AND (NEW."enteId" IS NULL OR NEW."enteId" IS DISTINCT FROM concessione."enteId")
    ) THEN
        RAISE EXCEPTION 'NeutralIntake tenant mutation would invalidate destination';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER neutral_intake_destination_tenant_after_intake_change
AFTER UPDATE OF "enteId" ON "NeutralIntake"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_destination_tenant_after_intake_change();

CREATE FUNCTION enforce_destination_tenant_after_procedimento_change()
RETURNS trigger AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "NeutralIntakeDestination" destination
        JOIN "NeutralIntake" intake ON intake."id" = destination."neutralIntakeId"
        JOIN "Concessione" concessione ON concessione."id" = NEW."concessioneId"
        WHERE destination."procedimentoId" = NEW."id"
          AND (intake."enteId" IS NULL OR intake."enteId" IS DISTINCT FROM concessione."enteId")
    ) THEN
        RAISE EXCEPTION 'Procedimento hierarchy mutation would invalidate destination';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER neutral_intake_destination_tenant_after_procedimento_change
AFTER UPDATE OF "concessioneId" ON "Procedimento"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_destination_tenant_after_procedimento_change();

CREATE FUNCTION enforce_destination_tenant_after_concessione_change()
RETURNS trigger AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Procedimento" procedimento
        JOIN "NeutralIntakeDestination" destination ON destination."procedimentoId" = procedimento."id"
        JOIN "NeutralIntake" intake ON intake."id" = destination."neutralIntakeId"
        WHERE procedimento."concessioneId" = NEW."id"
          AND (NEW."enteId" IS NULL OR intake."enteId" IS DISTINCT FROM NEW."enteId")
    ) THEN
        RAISE EXCEPTION 'Concessione tenant mutation would invalidate destination';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER neutral_intake_destination_tenant_after_concessione_change
AFTER UPDATE OF "enteId" ON "Concessione"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_destination_tenant_after_concessione_change();

CREATE FUNCTION enforce_legal_source_candidate_tenant()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "NeutralIntake" intake
        WHERE intake."id" = NEW."neutralIntakeId"
          AND intake."enteId" IS NOT DISTINCT FROM NEW."enteId"
    ) THEN
        RAISE EXCEPTION 'LegalSourceCandidateAdmission tenant mismatch';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER legal_source_candidate_tenant_consistent
AFTER INSERT ON "LegalSourceCandidateAdmission"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_legal_source_candidate_tenant();

CREATE FUNCTION reject_neutral_intake_destination_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'NeutralIntakeDestination rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER neutral_intake_destination_immutable
BEFORE UPDATE OR DELETE ON "NeutralIntakeDestination"
FOR EACH ROW EXECUTE FUNCTION reject_neutral_intake_destination_mutation();

CREATE FUNCTION reject_legal_source_candidate_admission_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'LegalSourceCandidateAdmission rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER legal_source_candidate_admission_immutable
BEFORE UPDATE OR DELETE ON "LegalSourceCandidateAdmission"
FOR EACH ROW EXECUTE FUNCTION reject_legal_source_candidate_admission_mutation();