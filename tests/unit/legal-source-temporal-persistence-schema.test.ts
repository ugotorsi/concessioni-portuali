import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationDirectory = "20260917_b2c15_block3b9b_temporal_assessment";
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve("prisma/migrations", migrationDirectory, "migration.sql"),
  "utf8",
);
const model = schema.match(/model LegalSourceTemporalAssessment \{[\s\S]*?\n\}/)?.[0] ?? "";

describe("Block 3B.9B temporal assessment schema", () => {
  it("adds one dedicated append-only assessment model", () => {
    expect(readdirSync(resolve("prisma/migrations")).filter((name) => name.includes("block3b9b")))
      .toEqual([migrationDirectory]);
    expect(model).toContain("legalExpressionVersionId String");
    expect(model).toContain("referenceDate            DateTime");
    expect(model).toContain("inputFingerprint         String   @db.Char(64)");
    expect(model).not.toMatch(/updatedAt|reviewedAt|supersededBy/);
    expect(migration).toContain('CREATE TRIGGER "temporal_assessment_append_only_trg"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "LegalSourceTemporalAssessment"');
  });

  it("anchors each assessment to a canonical family and expression", () => {
    expect(model).toContain("sourceFamily          LegalSource");
    expect(model).toContain("legalExpressionVersion LegalExpressionVersion");
    expect(model).toContain("fields: [legalExpressionVersionId, sourceFamilyId]");
    expect(migration).toContain('CONSTRAINT "temporal_assessment_expression_fk"');
    expect(migration).toContain('REFERENCES "LegalExpressionVersion"("id", "sourceFamilyId")');
  });

  it("preserves evaluator output without free-form reasoning", () => {
    for (const field of [
      "assessmentVersion", "validityState", "temporalWindowState", "applicabilityState",
      "reasonCodes", "effectiveFromSnapshot", "effectiveToSnapshot", "humanReviewRequired", "confidence",
    ]) expect(model).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    expect(model).not.toMatch(/reasoning|explanation|prompt|completion/);
    expect(migration).toContain("temporal_assessment_reason_codes_ck");
  });

  it("uses fingerprint uniqueness only for deterministic idempotency", () => {
    expect(model).toContain('@@unique([inputFingerprint], map: "temporal_assessment_identity_uq")');
    expect(model).not.toMatch(/@@unique\(\[(?!inputFingerprint)/);
    expect(migration).toContain('CREATE UNIQUE INDEX "temporal_assessment_identity_uq"');
  });

  it("contains additive DDL only and does not alter canonical tables", () => {
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/im);
    expect(migration).not.toMatch(/^\s*(DROP|RENAME)\b/im);
    expect(migration).not.toMatch(/ALTER TABLE "(LegalSource|LegalExpressionVersion|LegalSourceVersion|LegalReferenceOfficialHit|LegalReferenceOfficialReconciliation)"/);
  });

  it("keeps every explicit PostgreSQL identifier within 63 bytes and unique", () => {
    const identifiers = [...migration.matchAll(/(?:CONSTRAINT|CREATE(?: UNIQUE)? INDEX|CREATE FUNCTION|CREATE TRIGGER) "([^"]+)"/g)]
      .map((match) => match[1]);
    expect(identifiers.every((identifier) => Buffer.byteLength(identifier, "utf8") <= 63)).toBe(true);
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });
});