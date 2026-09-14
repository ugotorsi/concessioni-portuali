import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migrationDirectory = "20260914_b2c9_block3b4a_r1_destination_handoff_contracts";
const migration = readFileSync(resolve("prisma/migrations", migrationDirectory, "migration.sql"), "utf8");
const destination = schema.match(/model NeutralIntakeDestination \{[\s\S]*?\n\}/)?.[0] ?? "";
const candidate = schema.match(/model LegalSourceCandidateAdmission \{[\s\S]*?\n\}/)?.[0] ?? "";

describe("B2C9 Block 3B.4A-R1 handoff schema", () => {
  it("uses one procedimento FK as the one-to-one authoritative destination", () => {
    expect(destination).toContain("neutralIntakeId       String   @id");
    expect(destination).toContain("procedimentoId        String");
    expect(destination).toContain("procedimento      Procedimento  @relation");
    expect(destination).not.toMatch(/originReference|concessioneId|enteId/);
    expect(migration).toContain('PRIMARY KEY ("neutralIntakeId")');
    expect(migration).toContain('REFERENCES "Procedimento"("id")');
  });

  it("binds candidate identity to the exact persisted decision and evidence", () => {
    expect(candidate).toContain("classificationAttemptId String");
    expect(candidate).toContain("extractionAttemptId     String");
    expect(candidate).toContain("evidenceHash            String   @db.Char(64)");
    expect(candidate).toContain("classificationOutcome   NeutralIntakeClassificationOutcome");
    expect(candidate).toContain("@@unique([neutralIntakeId, classificationAttemptId, evidenceHash, contractVersion])");
    expect(migration).toContain('CONSTRAINT "legal_source_candidate_outcome_ck"');
    expect(migration).toContain('FOREIGN KEY ("classificationAttemptId", "neutralIntakeId", "extractionAttemptId", "evidenceHash", "classifierVersion", "classificationOutcome")');
  });

  it("contains no extracted text, canonical identity, provider, or legal analysis", () => {
    for (const forbidden of [
      "extractedText", "ocrText", "normalizedText", "pages", "canonicalCitation",
      "provider", "sourceKey", "legalAnalysis", "authorityDetermination",
    ]) {
      expect(candidate).not.toContain(forbidden);
    }
  });

  it("makes both contracts immutable and changes no canonical LegalSource table", () => {
    expect(migration).toContain("neutral_intake_destination_immutable");
    expect(migration).toContain("legal_source_candidate_admission_immutable");
    expect(migration).not.toMatch(/ALTER TABLE "LegalSource"|CREATE TABLE "LegalSource"/);
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
  });

  it("enforces tenant coherence through the existing procedimento hierarchy", () => {
    expect(migration).toContain("neutral_intake_destination_tenant_consistent");
    expect(migration).toContain('JOIN "Procedimento" procedimento');
    expect(migration).toContain('JOIN "Concessione" concessione');
    expect(migration).toContain('intake."enteId" = concessione."enteId"');
    expect(migration).toContain("legal_source_candidate_tenant_consistent");
    expect(migration).toContain('intake."enteId" IS NOT DISTINCT FROM NEW."enteId"');
  });

  it("rejects every upstream mutation that would invalidate an existing destination", () => {
    expect(migration).toMatch(
      /neutral_intake_destination_tenant_after_intake_change[\s\S]*AFTER UPDATE OF "enteId" ON "NeutralIntake"/,
    );
    expect(migration).toMatch(
      /neutral_intake_destination_tenant_after_procedimento_change[\s\S]*AFTER UPDATE OF "concessioneId" ON "Procedimento"/,
    );
    expect(migration).toMatch(
      /neutral_intake_destination_tenant_after_concessione_change[\s\S]*AFTER UPDATE OF "enteId" ON "Concessione"/,
    );
    expect(migration).toMatch(/NEW\."enteId" IS NULL OR NEW\."enteId" IS DISTINCT FROM concessione\."enteId"/);
    expect(migration).toMatch(/intake\."enteId" IS NULL OR intake\."enteId" IS DISTINCT FROM concessione\."enteId"/);
    expect(migration).toMatch(/NEW\."enteId" IS NULL OR intake\."enteId" IS DISTINCT FROM NEW\."enteId"/);
    expect(migration.match(/DEFERRABLE INITIALLY IMMEDIATE/g)).toHaveLength(5);
  });

  it("creates exactly one unapplied migration for this block", () => {
    const migrations = readdirSync(resolve("prisma/migrations"));
    expect(migrations.filter((name) => name.includes("block3b4a"))).toEqual([migrationDirectory]);
  });
});