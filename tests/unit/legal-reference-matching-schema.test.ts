import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationDirectory = "20260914_b2c11_block3b6b_legal_reference_matching";
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve("prisma/migrations", migrationDirectory, "migration.sql"), "utf8");
const model = schema.match(/model LegalReferenceMatch \{[\s\S]*?\n\}/)?.[0] ?? "";
const generated = {
  client: readFileSync(resolve("src/generated/prisma/client.ts"), "utf8"),
  enums: readFileSync(resolve("src/generated/prisma/enums.ts"), "utf8"),
  models: readFileSync(resolve("src/generated/prisma/models.ts"), "utf8"),
  mention: readFileSync(resolve("src/generated/prisma/models/LegalReferenceMention.ts"), "utf8"),
  source: readFileSync(resolve("src/generated/prisma/models/LegalSource.ts"), "utf8"),
};

describe("B2C11 Block 3B.6B machine matching persistence", () => {
  it("keeps machine matching separate from human candidate resolution", () => {
    expect(model).toContain("mentionId        String");
    expect(model).toContain("matchingVersion  String");
    expect(model).toContain("legalSourceId    String?");
    expect(model).not.toMatch(/reviewedBy|reviewNote|admissionId/);
  });

  it("enforces bounded matched, ambiguous, and no-match outcomes", () => {
    expect(migration).toContain("legal_reference_match_outcome_ck");
    expect(migration).toContain("\"status\" = 'MATCHED'");
    expect(migration).toContain("\"legalSourceId\" IS NOT NULL AND \"candidateCount\" = 1");
    expect(migration).toContain("\"status\" = 'AMBIGUOUS'");
    expect(migration).toContain("\"legalSourceId\" IS NULL AND \"candidateCount\" > 1");
    expect(migration).toContain("\"status\" = 'NO_MATCH'");
  });

  it("makes one immutable snapshot per mention and matching version", () => {
    expect(model).toContain("@@unique([mentionId, matchingVersion])");
    expect(migration).toContain("LegalReferenceMatch_mentionId_matchingVersion_key");
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "LegalReferenceMatch"');
  });

  it("adds exactly one unapplied DDL-only 3B.6B migration", () => {
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
    expect(readdirSync(resolve("prisma/migrations")).filter((name) => name.includes("block3b6b")))
      .toEqual([migrationDirectory]);
  });

  it("does not modify the previous discovery migration or human resolution table", () => {
    expect(migration).not.toMatch(/ALTER TABLE "LegalReferenceMention"/);
    expect(migration).not.toMatch(/LegalSourceCandidateResolution/);
    expect(migration).not.toMatch(/ALTER TABLE "LegalSource"/);
  });

  it("exposes the generated model, enums, and owning relations", () => {
    expect(generated.client).toContain("export type LegalReferenceMatch = Prisma.LegalReferenceMatchModel");
    expect(generated.enums).toContain("export const LegalReferenceMatchStatus");
    expect(generated.enums).toContain("export const LegalReferenceMatchReason");
    expect(generated.models).toContain("export type * from './models/LegalReferenceMatch'");
    expect(generated.mention).toContain("matches: Prisma.$LegalReferenceMatchPayload");
    expect(generated.source).toContain("legalReferenceMatches: Prisma.$LegalReferenceMatchPayload");
  });
});