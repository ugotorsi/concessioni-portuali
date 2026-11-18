import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve("prisma/migrations/20260907_b2c9c2a1_legal_source_grounding_boundary/migration.sql"),
  "utf8",
);

const versionModel = schema.match(/model LegalSourceVersion \{[\s\S]*?\n\}/)?.[0] ?? "";
const acquisitionModel = schema.match(/model LegalSourceAcquisition \{[\s\S]*?\n\}/)?.[0] ?? "";
const legalSourceModel = schema.match(/model LegalSource \{[\s\S]*?\n\}/)?.[0] ?? "";
const legalRuleModel = schema.match(/model LegalRule \{[\s\S]*?\n\}/)?.[0] ?? "";
const normaFonteModel = schema.match(/model NormaFonte \{[\s\S]*?\n\}/)?.[0] ?? "";
const normaVersioneModel = schema.match(/model NormaVersione \{[\s\S]*?\n\}/)?.[0] ?? "";

function sqlFunction(name: string): string {
  return migration.match(new RegExp(`CREATE FUNCTION "${name}"\\(\\)[\\s\\S]*?\\$\\$;`))?.[0] ?? "";
}

function schemaRelation(model: string, field: string): string {
  return model.match(new RegExp(`^\\s*${field}\\s+[^\\n]+@relation\\([^\\n]+$`, "m"))?.[0] ?? "";
}

function sqlForeignKey(constraint: string): string {
  return migration.match(new RegExp(`^ALTER TABLE [^\\n]+ADD CONSTRAINT "${constraint}"[^\\n]+;$`, "m"))?.[0] ?? "";
}

describe("B2C9C2A1 legal source schema primitives", () => {
  it("keeps legacy LegalSource rows valid while requiring canonical identity all-or-none", () => {
    expect(migration).toContain('"identityNamespace" IS NULL');
    expect(migration).toContain('"identityScopeKind" IS NULL');
    expect(migration).toContain('"identityScopeKey" IS NULL');
    expect(migration).toContain('"canonicalKey" IS NULL');
    expect(migration).toContain('"identityNamespace" IS NOT NULL');
    expect(migration).toContain('"identityNamespace" ~ \'[^[:space:]]\'');
    expect(migration).toContain('"identityScopeKind" IS NOT NULL');
    expect(migration).toContain('"identityScopeKey" IS NOT NULL');
    expect(migration).toContain('"identityScopeKey" ~ \'[^[:space:]]\'');
    expect(migration).toContain('"canonicalKey" IS NOT NULL');
    expect(migration).toContain('"canonicalKey" ~ \'[^[:space:]]\'');
  });

  it("enforces coherent GLOBAL identity", () => {
    expect(migration).toContain('"identityScopeKind" = \'GLOBAL\'');
    expect(migration).toContain('"enteId" IS NULL');
    expect(migration).toContain('"identityScopeKey" = \'GLOBAL\'');
  });

  it("enforces coherent TENANT identity", () => {
    expect(migration).toContain('"identityScopeKind" = \'TENANT\'');
    expect(migration).toContain('"enteId" IS NOT NULL');
    expect(migration).toContain('"identityScopeKey" = \'TENANT:\' || "enteId"');
  });

  it("enforces canonical identity uniqueness while retaining sourceKey uniqueness", () => {
    expect(legalSourceModel).toContain("sourceKey            String                @unique");
    expect(legalSourceModel).toContain("@@unique([identityNamespace, identityScopeKey, canonicalKey])");
    expect(migration).toContain('ON "LegalSource"("identityNamespace", "identityScopeKey", "canonicalKey")');
  });

  it("defines byte versions by family and observed SHA", () => {
    expect(versionModel).toContain("observedSha256       String");
    expect(versionModel).toContain("@db.Char(64)");
    expect(versionModel).toContain("@@unique([sourceFamilyId, observedSha256])");
    expect(versionModel).toContain("@@unique([id, sourceFamilyId])");
    expect(versionModel).toContain("@@unique([id, sourceFamilyId, observedSha256])");
  });

  it("allows different observed hashes in the same family structurally", () => {
    expect(versionModel).not.toContain("sourceFamilyId       String                            @unique");
    expect(migration).not.toContain('UNIQUE INDEX "LegalSourceVersion_sourceFamilyId_key"');
  });

  it("checks version digest, size, MIME, and temporal coherence", () => {
    expect(migration).toContain("^[0-9a-f]{64}$");
    expect(migration).toContain('CHECK ("observedSizeBytes" > 0)');
    expect(migration).toContain('CHECK ("observedMimeType" ~ \'[^[:space:]]\')');
    expect(migration).toContain('"effectiveTo" >= "effectiveFrom"');
  });

  it("protects only immutable version content fields on update", () => {
    const updateGuard = sqlFunction("protect_legal_source_version_content_identity");
    for (const field of ["id", "sourceFamilyId", "observedSha256", "observedSizeBytes", "observedMimeType", "createdAt"]) {
      expect(updateGuard).toContain(`NEW."${field}" IS DISTINCT FROM OLD."${field}"`);
    }
    for (const field of ["legalLifecycleStatus", "effectiveFrom", "effectiveTo", "publicationDate", "versionLabel"]) {
      expect(updateGuard).not.toContain(`NEW."${field}" IS DISTINCT FROM OLD."${field}"`);
    }
  });

  it("enforces updatedAt for permitted direct SQL updates", () => {
    const updateGuard = sqlFunction("protect_legal_source_version_content_identity");
    expect(updateGuard).toContain('NEW."updatedAt" = CURRENT_TIMESTAMP;');
    expect(updateGuard).toContain("RETURN NEW;");
  });

  it("supports lifecycle and temporal metadata updates on the same byte version", () => {
    expect(versionModel).toContain("legalLifecycleStatus LegalSourceVersionLifecycleStatus");
    expect(versionModel).toContain("effectiveFrom        DateTime?");
    expect(versionModel).toContain("effectiveTo          DateTime?");
    expect(versionModel).toContain("updatedAt            DateTime");
  });

  it("rejects physical version deletion", () => {
    expect(migration).toContain('BEFORE DELETE ON "LegalSourceVersion"');
    expect(migration).toContain("LegalSourceVersion rows cannot be deleted");
  });

  it("keeps normalization fields outside LegalSourceVersion", () => {
    expect(versionModel).not.toContain("normalizationVersion");
    expect(versionModel).not.toContain("normalizedContentSha256");
  });

  it("models successful acquisition requirements", () => {
    expect(migration).toContain('"outcome" = \'ACQUIRED\'');
    expect(migration).toContain('"sourceVersionId" IS NOT NULL');
    expect(migration).toContain('"artifactLocator" IS NOT NULL');
    expect(migration).toContain('"artifactLocator" ~ \'[^[:space:]]\'');
    expect(migration).toContain('"observedSizeBytes" > 0');
    expect(migration).toContain('"observedMimeType" IS NOT NULL');
  });

  it("models missing acquisition without observed artifact metadata", () => {
    expect(migration).toContain('"outcome" = \'MISSING\'');
    expect(migration).toContain('"observedSha256" IS NULL');
    expect(migration).toContain('"observedSizeBytes" IS NULL');
    expect(migration).toContain('"observedMimeType" IS NULL');
  });

  it("models integrity mismatch with distinct observed and declared hashes", () => {
    expect(migration).toContain('"outcome" = \'INTEGRITY_MISMATCH\'');
    expect(migration).toContain('"observedSha256" <> "declaredSha256"');
  });

  it("models failed acquisition with no version and a failure code", () => {
    expect(migration).toContain('"outcome" = \'FAILED\'');
    expect(migration).toContain('"failureCode" IS NOT NULL');
    expect(migration).toContain('"failureCode" ~ \'[^[:space:]]\'');
  });

  it("requires actor or process provenance without inventing a user relation", () => {
    expect(migration).toContain('COALESCE("acquiredByActorId" ~ \'[^[:space:]]\', false)');
    expect(migration).toContain('COALESCE("acquiredByProcess" ~ \'[^[:space:]]\', false)');
    expect(acquisitionModel).not.toContain("acquiredByUser");
  });

  it("binds an acquired version to the same family and observed hash", () => {
    const relation = schemaRelation(acquisitionModel, "sourceVersion");
    const foreignKey = sqlForeignKey(
      "LegalSourceAcquisition_sourceVersionId_sourceFamilyId_observedSha256_fkey",
    );

    expect(relation).toContain("fields: [sourceVersionId, sourceFamilyId, observedSha256]");
    expect(relation).toContain("references: [id, sourceFamilyId, observedSha256]");
    expect(versionModel).toContain("@@unique([id, sourceFamilyId, observedSha256])");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "LegalSourceVersion_id_sourceFamilyId_observedSha256_key" ON "LegalSourceVersion"("id", "sourceFamilyId", "observedSha256");',
    );
    expect(foreignKey).toContain('FOREIGN KEY ("sourceVersionId", "sourceFamilyId", "observedSha256")');
    expect(foreignKey).toContain('REFERENCES "LegalSourceVersion"("id", "sourceFamilyId", "observedSha256")');
    expect(migration).not.toMatch(
      /ADD CONSTRAINT "LegalSourceAcquisition_[^"]+" FOREIGN KEY \("sourceVersionId", "sourceFamilyId"\) REFERENCES "LegalSourceVersion"/,
    );
  });

  it("keeps failed acquisitions representable without a version link", () => {
    expect(acquisitionModel).toContain("sourceVersionId          String?");
    expect(acquisitionModel).toContain("observedSha256           String?");
    expect(migration).toContain('"outcome" = \'INTEGRITY_MISMATCH\'');
    expect(migration).toContain('"sourceVersionId" IS NULL');
  });

  it("makes acquisitions append-only", () => {
    expect(migration).toContain('BEFORE UPDATE ON "LegalSourceAcquisition"');
    expect(migration).toContain('BEFORE DELETE ON "LegalSourceAcquisition"');
  });

  it("restricts deletion of a referenced ImportRun while allowing a nullable link", () => {
    expect(acquisitionModel).toContain("importRunId              String?");
    expect(acquisitionModel).toContain("onDelete: Restrict");
    expect(migration).toContain('REFERENCES "ImportRun"("id") ON DELETE RESTRICT');
  });

  it("keeps compatibility mappings nullable and non-unique", () => {
    expect(normaFonteModel).toContain("legalSourceId String?");
    expect(normaFonteModel).not.toContain("legalSourceId String? @unique");
    expect(normaVersioneModel).toContain("legalSourceVersionId String?");
    expect(normaVersioneModel).not.toContain("legalSourceVersionId String? @unique");
    expect(normaFonteModel).toContain("@@index([legalSourceId])");
    expect(normaVersioneModel).toContain("@@index([legalSourceVersionId])");
  });

  it("preserves the LegalRule source family reference", () => {
    expect(legalRuleModel).toContain("sourceId                String");
    expect(legalRuleModel).toContain("source                       LegalSource");
    expect(legalRuleModel).toContain("fields: [sourceId]");
    expect(legalRuleModel).toContain("references: [id]");
  });

  it("contains no legacy backfill or executable DML", () => {
    expect(migration).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE)\b/im);
  });
});
