import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsRoot = resolve("prisma/migrations");
const block3aDirectories = readdirSync(migrationsRoot)
  .filter((name) => name.includes("b2c9_block3a"))
  .sort();
const enumMigrationPath = resolve(
  migrationsRoot,
  "20260912_b2c9_block3a_01_pending_identity_enum/migration.sql",
);
const acquisitionMigrationPath = resolve(
  migrationsRoot,
  "20260912_b2c9_block3a_02_precanonical_acquisition/migration.sql",
);
const enumMigration = readFileSync(enumMigrationPath, "utf8");
const acquisitionMigration = readFileSync(acquisitionMigrationPath, "utf8");
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");

const acquisitionModel = schema.match(/model LegalSourceAcquisition \{[\s\S]*?\n\}/)?.[0] ?? "";
const outcomeEnum = schema.match(/enum LegalSourceAcquisitionOutcome \{[\s\S]*?\n\}/)?.[0] ?? "";
const pendingStart = acquisitionMigration.indexOf('"outcome" = \'PENDING_IDENTITY\'');
const pendingEnd = acquisitionMigration.indexOf(
  'ADD CONSTRAINT "legal_source_acquisition_local_pack_pending_ck"',
);
const universalPendingBranch = acquisitionMigration.slice(pendingStart, pendingEnd);
const localPackCheck = acquisitionMigration.match(
  /ADD CONSTRAINT "legal_source_acquisition_local_pack_pending_ck" CHECK \(([\s\S]*?)\n\);/,
)?.[1] ?? "";

function executableStatements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

type PendingEnvelope = {
  sourceFamilyId: string | null;
  sourceVersionId: string | null;
  enteId: string | null;
  importRunId: string | null;
  originClass: string;
  providerOrChannel: string;
  originalUrl: string | null;
  externalSourceId: string | null;
  artifactLocator: string | null;
  originalFilename: string | null;
  observedSha256: string | null;
  declaredSha256: string | null;
  observedSizeBytes: number | null;
  declaredSizeBytes: number | null;
  observedMimeType: string | null;
  failureCode: string | null;
};

const sha256 = "a".repeat(64);
const validLocalPack: PendingEnvelope = {
  sourceFamilyId: null,
  sourceVersionId: null,
  enteId: "tenant-1",
  importRunId: "run-1",
  originClass: "LOCAL_DOMAIN_DOCUMENT",
  providerOrChannel: "LOCAL_PACK_ENTRY",
  originalUrl: null,
  externalSourceId: "ARPAC-ACT",
  artifactLocator: "data/legal-rule-packs/adsp-mtc/ARPAC.pdf",
  originalFilename: "ARPAC.pdf",
  observedSha256: sha256,
  declaredSha256: sha256,
  observedSizeBytes: 1,
  declaredSizeBytes: 1,
  observedMimeType: "application/pdf",
  failureCode: null,
};

const nonBlank = (value: string | null) => value !== null && /\S/.test(value);
const validHash = (value: string | null) => value !== null && /^[0-9a-f]{64}$/.test(value);

function satisfiesUniversalPending(value: PendingEnvelope): boolean {
  return value.sourceFamilyId === null
    && value.sourceVersionId === null
    && value.failureCode === null
    && nonBlank(value.originClass)
    && nonBlank(value.providerOrChannel)
    && (
      nonBlank(value.originalUrl)
      || nonBlank(value.externalSourceId)
      || nonBlank(value.artifactLocator)
    );
}

function satisfiesLocalPackSpecialization(value: PendingEnvelope): boolean {
  if (value.providerOrChannel !== "LOCAL_PACK_ENTRY") {
    return true;
  }

  return value.originClass === "LOCAL_DOMAIN_DOCUMENT"
    && value.enteId !== null
    && value.importRunId !== null
    && nonBlank(value.externalSourceId)
    && nonBlank(value.artifactLocator)
    && nonBlank(value.originalFilename)
    && validHash(value.observedSha256)
    && validHash(value.declaredSha256)
    && value.observedSha256 === value.declaredSha256
    && value.observedSizeBytes !== null
    && value.declaredSizeBytes !== null
    && value.observedSizeBytes > 0
    && value.declaredSizeBytes > 0
    && value.observedSizeBytes === value.declaredSizeBytes
    && nonBlank(value.observedMimeType)
    && value.failureCode === null;
}

describe("B2C9 Block 3A pre-canonical acquisition schema", () => {
  it("splits enum creation from its first executable use", () => {
    expect(block3aDirectories).toEqual([
      "20260912_b2c9_block3a_01_pending_identity_enum",
      "20260912_b2c9_block3a_02_precanonical_acquisition",
    ]);
    expect(existsSync(resolve(migrationsRoot, "20260912_b2c9_block3a_precanonical_acquisition"))).toBe(false);
    expect(executableStatements(enumMigration)).toEqual([
      'ALTER TYPE "LegalSourceAcquisitionOutcome" ADD VALUE \'PENDING_IDENTITY\'',
    ]);
    expect(enumMigration).not.toMatch(/ALTER\s+TABLE|CHECK\s*\(/i);
    expect(acquisitionMigration).not.toMatch(/ALTER\s+TYPE[\s\S]*ADD\s+VALUE/i);
    expect(acquisitionMigration).toContain("'PENDING_IDENTITY'");
  });

  it("prevents enum addition and first use from sharing a migration", () => {
    for (const sql of [enumMigration, acquisitionMigration]) {
      const addsPending = /ADD\s+VALUE\s+'PENDING_IDENTITY'/i.test(sql);
      const usesPending = /CHECK\s*\([\s\S]*'PENDING_IDENTITY'/i.test(sql);
      expect(addsPending && usesPending).toBe(false);
    }
  });

  it("preserves the exact Prisma contract", () => {
    expect(outcomeEnum.match(/^\s+[A-Z_]+$/gm)?.map((value) => value.trim())).toEqual([
      "ACQUIRED",
      "MISSING",
      "INTEGRITY_MISMATCH",
      "FAILED",
      "PENDING_IDENTITY",
    ]);
    expect(acquisitionModel).toContain("sourceFamilyId           String?");
    expect(acquisitionModel).toContain("sourceVersionId          String?");
    expect(acquisitionModel).toContain("enteId                   String?");
    expect(acquisitionModel).toContain("idempotencyKey           String");
    expect(acquisitionModel).toContain("@unique @db.Char(64)");
    expect(acquisitionModel).toContain("sourceFamily LegalSource?");
    expect(acquisitionModel).toContain("ente         Ente?");
    expect(acquisitionModel).toContain("@@index([enteId, outcome, acquiredAt])");
  });

  it("defines provider-neutral universal pending invariants", () => {
    for (const clause of [
      '"sourceFamilyId" IS NULL',
      '"sourceVersionId" IS NULL',
      '"failureCode" IS NULL',
      'COALESCE("originalUrl" ~ \'[^[:space:]]\', false)',
      'COALESCE("externalSourceId" ~ \'[^[:space:]]\', false)',
      'COALESCE("artifactLocator" ~ \'[^[:space:]]\', false)',
    ]) {
      expect(universalPendingBranch).toContain(clause);
    }
    for (const localOnlyClause of [
      '"enteId" IS NOT NULL',
      '"importRunId" IS NOT NULL',
      '"originClass" = \'LOCAL_DOMAIN_DOCUMENT\'',
      '"providerOrChannel" = \'LOCAL_PACK_ENTRY\'',
      '"originalFilename" IS NOT NULL',
      '"declaredSha256" IS NOT NULL',
    ]) {
      expect(universalPendingBranch).not.toContain(localOnlyClause);
    }
  });

  it("accepts a tenantless future provider with one provenance anchor", () => {
    const futureProvider: PendingEnvelope = {
      ...validLocalPack,
      enteId: null,
      importRunId: null,
      originClass: "INSTITUTIONAL_SOURCE",
      providerOrChannel: "TEST_FUTURE_PROVIDER",
      originalUrl: "https://example.invalid/legal-source",
      externalSourceId: null,
      artifactLocator: null,
      originalFilename: null,
      observedSha256: null,
      declaredSha256: null,
      observedSizeBytes: null,
      declaredSizeBytes: null,
      observedMimeType: null,
    };
    expect(satisfiesUniversalPending(futureProvider)).toBe(true);
    expect(satisfiesLocalPackSpecialization(futureProvider)).toBe(true);
  });

  it.each([
    ["family present", { sourceFamilyId: "family-1" }],
    ["version present", { sourceVersionId: "version-1" }],
    ["failure present", { failureCode: "FAILED" }],
    ["origin blank", { originClass: " " }],
    ["provider blank", { providerOrChannel: " " }],
    ["no anchor", { originalUrl: null, externalSourceId: null, artifactLocator: null }],
  ] satisfies Array<[string, Partial<PendingEnvelope>]>) (
    "rejects invalid universal pending state: %s",
    (_name, override) => {
      expect(satisfiesUniversalPending({ ...validLocalPack, ...override })).toBe(false);
    },
  );

  it("scopes the strong local-pack implication to pending local-pack acquisitions", () => {
    expect(localPackCheck).toContain('"outcome" <> \'PENDING_IDENTITY\'');
    expect(localPackCheck).toContain('"providerOrChannel" <> \'LOCAL_PACK_ENTRY\'');
    expect(satisfiesLocalPackSpecialization(validLocalPack)).toBe(true);
    expect(satisfiesLocalPackSpecialization({ ...validLocalPack, providerOrChannel: "TEST_FUTURE_PROVIDER", enteId: null })).toBe(true);
  });

  it.each([
    ["wrong origin", { originClass: "OTHER" }],
    ["tenant missing", { enteId: null }],
    ["import run missing", { importRunId: null }],
    ["external ID blank", { externalSourceId: " " }],
    ["locator blank", { artifactLocator: " " }],
    ["filename blank", { originalFilename: " " }],
    ["observed hash missing", { observedSha256: null }],
    ["declared hash missing", { declaredSha256: null }],
    ["hash mismatch", { declaredSha256: "b".repeat(64) }],
    ["observed size missing", { observedSizeBytes: null }],
    ["declared size non-positive", { declaredSizeBytes: 0 }],
    ["size mismatch", { declaredSizeBytes: 2 }],
    ["MIME blank", { observedMimeType: " " }],
    ["failure populated", { failureCode: "READ_FAILED" }],
  ] satisfies Array<[string, Partial<PendingEnvelope>]>) (
    "rejects invalid local-pack pending state: %s",
    (_name, override) => {
      expect(satisfiesLocalPackSpecialization({ ...validLocalPack, ...override })).toBe(false);
    },
  );

  it("retains legacy outcomes, global checks, and version-family integrity", () => {
    for (const outcome of ["ACQUIRED", "MISSING", "INTEGRITY_MISMATCH", "FAILED"]) {
      const branch = acquisitionMigration.match(
        new RegExp(`"outcome" = '${outcome}'[\\s\\S]*?(?=\\n    \\)|\\n    OR)`),
      )?.[0] ?? "";
      expect(branch).toContain('"sourceFamilyId" IS NOT NULL');
    }
    for (const check of ["hashes", "sizes", "actor_process", "required_text"]) {
      expect(acquisitionMigration).not.toContain(`DROP CONSTRAINT "legal_source_acquisition_${check}_ck"`);
    }
    expect(acquisitionMigration).toContain('CHECK ("sourceVersionId" IS NULL OR "sourceFamilyId" IS NOT NULL)');
    expect(acquisitionMigration).not.toContain("LegalSourceAcquisition_sourceVersionId_sourceFamilyId_observedSha256_fkey");
  });

  it("contains no DML, unrelated DDL, trigger weakening, or document coupling", () => {
    for (const sql of [enumMigration, acquisitionMigration]) {
      const statements = executableStatements(sql);
      expect(statements.some((statement) => /^(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(statement))).toBe(false);
      expect(sql).not.toMatch(/DROP\s+TRIGGER|DISABLE\s+TRIGGER/i);
      expect(sql).not.toContain("documentFileVersionId");
    }
    expect(acquisitionMigration).not.toMatch(
      /^\s*ALTER\s+TABLE\s+"(LegalSource|LegalSourceVersion|LegalExpressionVersion|LegalSourceIdentityAssertion|NormaFonte|NormaVersione|Documento|DocumentFileVersion|ImportRun|Ente)"/im,
    );
    expect(acquisitionMigration).not.toMatch(/\b(CREATE TABLE|DROP TABLE)\b/i);
  });
});
