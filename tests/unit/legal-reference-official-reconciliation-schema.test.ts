import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationDirectory = "20260916_b2c14_block3b8b_official_hit_reconciliation";
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve("prisma/migrations", migrationDirectory, "migration.sql"),
  "utf8",
);

function schemaBlock(kind: "model" | "enum", name: string): string {
  return schema.match(new RegExp(`${kind} ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

describe("B2C14 Block 3B.8B official hit reconciliation schema", () => {
  it("adds exactly one additive DDL-only migration", () => {
    expect(readdirSync(resolve("prisma/migrations")).filter((name) => name.includes("block3b8b")))
      .toEqual([migrationDirectory]);
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/im);
    expect(migration).not.toMatch(/^\s*(DROP|RENAME)\b/im);
  });

  it("scopes reconciliation by mention and permits null fingerprints only in valid states", () => {
    const reconciliation = schemaBlock("model", "LegalReferenceOfficialReconciliation");
    expect(reconciliation).toContain("identityFingerprint   String?");
    expect(reconciliation).toContain(
      '@@unique([mentionId, identityVersion], map: "LegalReferenceOfficialReconciliation_mentionId_identityVersion_")',
    );
    expect(reconciliation).toContain(
      '@@index([identityVersion, identityFingerprint], map: "LegalReferenceOfficialReconciliation_identityVersion_identityFi")',
    );
    expect(migration).toContain("legal_reference_official_reconciliation_identity_ck");
    expect(migration).toContain("\"state\" = 'INCOMPLETE' AND \"identityFingerprint\" IS NULL");
    expect(migration).toContain("\"state\" IN ('CONFLICTED', 'REJECTED')");
  });

  it("admits each hit once per identity version", () => {
    const evidence = schemaBlock("model", "LegalReferenceOfficialReconciliationEvidence");
    expect(evidence).toContain("officialHitId");
    expect(evidence).toContain(
      '@@unique([officialHitId, identityVersion], map: "LegalReferenceOfficialReconciliationEvidence_officialHitId_iden")',
    );
    expect(evidence).toContain("officialHit    LegalReferenceOfficialHit");
    expect(schemaBlock("model", "LegalReferenceOfficialReconciliation"))
      .toContain("@@unique([id, identityVersion])");
    expect(evidence).toContain(
      "@relation(fields: [reconciliationId, identityVersion], references: [id, identityVersion]",
    );
    expect(migration).toContain('FOREIGN KEY ("reconciliationId", "identityVersion")');
    expect(migration).toContain(
      'REFERENCES "LegalReferenceOfficialReconciliation"("id", "identityVersion")',
    );
  });

  it("enforces source, reviewer, fingerprint, payload, and revision invariants", () => {
    expect(migration).toContain("legal_reference_official_reconciliation_source_ck");
    expect(migration).toContain("legal_reference_official_reconciliation_reviewer_ck");
    expect(migration).toContain("legal_reference_official_reconciliation_evidence_fingerprint_ck");
    expect(migration).toContain("legal_reference_official_reconciliation_payload_ck");
    expect(migration).toContain("legal_reference_official_reconciliation_revision_ck");
    expect(migration.match(/FOREIGN KEY/g)).toHaveLength(5);
    expect(migration).toContain("LegalReferenceOfficialReconciliation_mentionId_fkey");
    expect(migration).toContain("'REJECTED', 'CONFLICTED'");
  });

  it("does not add another canonical source family", () => {
    expect(schema).not.toMatch(/model Canonical(?:Legal)?Source/);
    expect(schemaBlock("model", "LegalSource")).toContain(
      "officialReconciliations      LegalReferenceOfficialReconciliation[]",
    );
  });
});