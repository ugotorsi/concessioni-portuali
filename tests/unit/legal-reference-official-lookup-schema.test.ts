import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationDirectory = "20260915_b2c12_block3b6c_official_source_lookup";
const legalDataHunterMigrationDirectory = "20260915_b2c13_block3b6d_legal_data_hunter";
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve("prisma/migrations", migrationDirectory, "migration.sql"), "utf8");
const legalDataHunterMigration = readFileSync(
  resolve("prisma/migrations", legalDataHunterMigrationDirectory, "migration.sql"),
  "utf8",
);

describe("B2C12 Block 3B.6C official lookup persistence", () => {
  it("adds exactly one additive DDL-only 3B.6C migration", () => {
    expect(readdirSync(resolve("prisma/migrations")).filter((name) => name.includes("block3b6c")))
      .toEqual([migrationDirectory]);
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/im);
    expect(migration).not.toMatch(/^\s*(DROP|RENAME)\b/im);
  });

  it("relates lookup provenance through the mention without a redundant Fascicolo key", () => {
    const lookup = schema.match(/model LegalReferenceOfficialLookup \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(lookup).toContain("mentionId");
    expect(lookup).toContain("provider");
    expect(lookup).toContain("lookupVersion");
    expect(lookup).toContain("@@unique([mentionId, provider, lookupVersion])");
    expect(lookup).not.toMatch(/fascicoloId|procedimentoId|enteId|tenantId/);
  });

  it("persists only bounded official metadata rather than raw provider bodies", () => {
    const hit = schema.match(/model LegalReferenceOfficialHit \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(hit).toContain("providerRecordId");
    expect(hit).toContain("denominazioneAtto");
    expect(hit).toContain("numeroProvvedimento");
    expect(hit).toContain("annoProvvedimento");
    expect(hit).not.toMatch(/raw|html|response|payload|body/i);
  });

  it("enforces status/count semantics and both foreign keys", () => {
    expect(migration).toContain("legal_reference_official_lookup_count_ck");
    expect(migration.match(/FOREIGN KEY/g)).toHaveLength(2);
    expect(migration).toContain("FOUND_UNIQUE");
    expect(migration).toContain("AMBIGUOUS");
    expect(migration).toContain("NOT_FOUND");
  });

  it("adds exactly one additive DDL-only 3B.6D migration on the existing hit family", () => {
    expect(readdirSync(resolve("prisma/migrations")).filter((name) => name.includes("block3b6d")))
      .toEqual([legalDataHunterMigrationDirectory]);
    expect(legalDataHunterMigration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/im);
    expect(legalDataHunterMigration).not.toMatch(/^\s*(DROP TABLE|DROP COLUMN|RENAME)\b/im);
    expect(legalDataHunterMigration).not.toMatch(/CREATE TABLE/i);
  });

  it("persists bounded provider-neutral case-law identity without provider bodies", () => {
    const hit = schema.match(/model LegalReferenceOfficialHit \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(hit).toContain("documentKind");
    expect(hit).toContain("providerSourceId");
    expect(hit).toContain("authority");
    expect(hit).toContain("decisionNumber");
    expect(hit).toContain("decisionYear");
    expect(hit).toContain("chamberSection");
    expect(hit).toContain("sourceUrl");
    expect(hit).not.toMatch(/raw|html|response|payload|body|snippet/i);
    expect(legalDataHunterMigration).toContain("legal_reference_official_hit_identity_ck");
  });
});