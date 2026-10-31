import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20261023_fascicolo_knowledge_stable_identity_contract/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Fascicolo knowledge stable identity migration", () => {
  it("is additive and leaves all legacy identities untouched", () => {
    expect(migration).not.toMatch(/^\s*(?:DELETE|DROP|TRUNCATE|UPDATE)\b/im);
    expect(migration).not.toContain("SET \"identityId\"");
    expect(migration).not.toContain("SET \"identityState\"");
    expect(migration).toContain('ADD COLUMN "identityState" "FascicoloKnowledgeIdentityState"');
    expect(migration).toContain('ADD COLUMN "identityCommandFingerprint" CHAR(64)');
  });

  it("uses a canonical identity table scoped to tenant, fascicolo, kind, and revision", () => {
    expect(migration).toContain('CREATE TABLE "FascicoloKnowledgeIdentity"');
    expect(migration).toContain(
      'FOREIGN KEY ("identityId", "tenantId", "procedimentoId", "kind")',
    );
    expect(migration).toContain(
      'REFERENCES "FascicoloKnowledgeIdentity" ("id", "tenantId", "procedimentoId", "kind")',
    );
    expect(migration).toContain(
      '("revisionId", "identityId")',
    );
    expect(migration).toContain('"fascicolo_knowledge_item_verified_new_identity_uq"');
  });

  it("keeps ambiguity without a canonical identity", () => {
    expect(migration).toMatch(
      /"identityState" = 'AMBIGUOUS'[\s\S]*?"identityId" IS NULL[\s\S]*?"identityBasis" IS NOT NULL/,
    );
  });

  it("requires a command fingerprint only for server-managed identity states", () => {
    expect(migration).toMatch(
      /"identityState" = 'AMBIGUOUS'[\s\S]*?"identityCommandFingerprint" IS NOT NULL/,
    );
    expect(migration).toMatch(
      /"identityState" = 'VERIFIED_NEW'[\s\S]*?"identityCommandFingerprint" IS NOT NULL/,
    );
    expect(migration).toMatch(
      /"identityState" = 'LEGACY_UNVERIFIED'[\s\S]*?"identityCommandFingerprint" IS NULL/,
    );
  });

  it("adds scoped provenance without validating or rewriting legacy rows", () => {
    expect(migration).toContain('"fascicolo_knowledge_evidence_document_scope_fk"');
    expect(migration).toContain('"fascicolo_knowledge_evidence_file_version_scope_fk"');
    expect(migration).toContain('"fascicolo_knowledge_evidence_document_attempt_scope_fk"');
    expect(migration.match(/\bNOT VALID\b/g)).toHaveLength(5);
  });

  it("models repeated occurrences as child spans without replacing legacy uniqueness", () => {
    expect(migration).toContain('CREATE TABLE "FascicoloKnowledgeEvidenceSpan"');
    expect(migration).toContain(
      'ON "FascicoloKnowledgeEvidenceSpan" ("evidenceId", "startOffset", "endOffset")',
    );
    expect(migration).not.toContain('DROP INDEX "fascicolo_knowledge_evidence_identity_uq"');
    expect(migration).toMatch(
      /"startOffset" >= 0[\s\S]*?"endOffset" > "startOffset"/,
    );
  });
});
