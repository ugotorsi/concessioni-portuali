import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationDirectory = "20260914_b2c10_block3b6a_legal_reference_discovery";
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve("prisma/migrations", migrationDirectory, "migration.sql"), "utf8");
const model = schema.match(/model LegalReferenceMention \{[\s\S]*?\n\}/)?.[0] ?? "";
const generated = {
  client: readFileSync(resolve("src/generated/prisma/client.ts"), "utf8"),
  enums: readFileSync(resolve("src/generated/prisma/enums.ts"), "utf8"),
  models: readFileSync(resolve("src/generated/prisma/models.ts"), "utf8"),
  attempt: readFileSync(resolve("src/generated/prisma/models/NeutralIntakeExtractionAttempt.ts"), "utf8"),
  page: readFileSync(resolve("src/generated/prisma/models/NeutralIntakeExtractionPage.ts"), "utf8"),
};

describe("B2C10 Block 3B.6A legal reference persistence", () => {
  it("binds each bounded occurrence to an existing extraction page and attempt", () => {
    expect(model).toContain("extractionAttemptId String");
    expect(model).toContain("extractionPageId    String");
    expect(model).toContain("observedText        String             @db.VarChar(500)");
    expect(model).toContain("characterStart      Int");
    expect(model).toContain("characterEnd        Int");
    expect(model).toContain("fields: [extractionPageId, extractionAttemptId]");
    expect(migration).toContain('REFERENCES "NeutralIntakeExtractionPage"("id", "extractionAttemptId")');
  });

  it("uses occurrence-preserving deterministic uniqueness for retry deduplication", () => {
    expect(model).toContain(
      '@@unique([extractionPageId, discoveryVersion, characterStart, characterEnd, normalizedKey], map: "LegalReferenceMention_occurrence_key")',
    );
    expect(migration).toContain('CREATE UNIQUE INDEX "LegalReferenceMention_occurrence_key"');
    expect(migration).toContain('"characterEnd" > "characterStart"');
  });

  it("separates observed text from bounded normalized components", () => {
    for (const field of [
      "normalizedKey", "authorityHint", "actType", "actNumber", "year", "article", "subArticle", "chamberSection",
    ]) {
      expect(model).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }
    expect(model).not.toMatch(/legalSourceId|canonicalSource|validity|applicability|bindingForce|precedentialWeight/);
  });

  it("creates no canonical source relation and makes mentions immutable", () => {
    expect(model).not.toMatch(/\bLegalSource\??\b/);
    expect(migration).not.toMatch(/ALTER TABLE "LegalSource"|CREATE TABLE "LegalSource"/);
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "LegalReferenceMention"');
  });

  it("contains DDL only in exactly one unapplied Block 3B.6A migration", () => {
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
    expect(readdirSync(resolve("prisma/migrations")).filter((name) => name.includes("block3b6a")))
      .toEqual([migrationDirectory]);
  });

  it("exposes the generated enum, model, and extraction relations", () => {
    expect(generated.enums).toContain("export const LegalReferenceKind");
    expect(generated.models).toContain("export type * from './models/LegalReferenceMention'");
    expect(generated.client).toContain("export type LegalReferenceMention = Prisma.LegalReferenceMentionModel");
    expect(generated.attempt).toContain("legalReferenceMentions: Prisma.$LegalReferenceMentionPayload");
    expect(generated.page).toContain("legalReferenceMentions: Prisma.$LegalReferenceMentionPayload");
  });
});