import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(
  "prisma/migrations/20260912_b2c9_block3b1_neutral_intake_core/migration.sql",
), "utf8");
const model = schema.match(/model NeutralIntake \{[\s\S]*?\n\}/)?.[0] ?? "";
const statusEnum = schema.match(/enum NeutralIntakeStatus \{[\s\S]*?\n\}/)?.[0] ?? "";

function statements(sql: string): string[] {
  return sql.replace(/--.*$/gm, "").split(";").map((value) => value.trim()).filter(Boolean);
}

function checkExpression(constraintName: string): string {
  const marker = `CONSTRAINT "${constraintName}" CHECK (`;
  const start = migration.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);

  let depth = 1;
  let cursor = start + marker.length;
  for (; cursor < migration.length && depth > 0; cursor += 1) {
    if (migration[cursor] === "(") depth += 1;
    if (migration[cursor] === ")") depth -= 1;
  }
  expect(depth).toBe(0);

  return migration.slice(start + marker.length, cursor - 1).replace(/\s+/g, " ").trim();
}

describe("B2C9 Block 3B.1 neutral intake schema", () => {
  it("defines the exact lifecycle state universe", () => {
    expect(statusEnum.match(/^\s+[A-Z_]+$/gm)?.map((value) => value.trim())).toEqual([
      "RECEIVED",
      "EVIDENCE_READY",
      "REVIEW_REQUIRED",
      "ROUTED",
      "FAILED_EXTRACTION",
      "FAILED_CLASSIFICATION",
      "FAILED_HANDOFF",
    ]);
  });

  it("defines the exact required and optional intake fields", () => {
    for (const field of [
      "id", "idempotencyKey", "storageProvider", "storageKey", "sha256", "mimeType",
      "sizeBytes", "ingressChannel", "receivedByActorId", "receivedByRole", "receivedAt",
      "status", "statusVersion",
    ]) {
      expect(model).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }
    for (const field of ["storageBucket", "originalName", "originReference", "enteId", "receivedByUserId"]) {
      expect(model).toMatch(new RegExp(`^\\s*${field}\\s+String\\?`, "m"));
    }
    expect(model).toContain("idempotencyKey    String              @unique @db.Char(64)");
    expect(model).toContain("sha256            String              @db.Char(64)");
  });

  it("keeps tenant and user relations optional while restricting deletion of referenced provenance", () => {
    expect(model).toContain("ente           Ente? @relation(fields: [enteId], references: [id], onDelete: Restrict)");
    expect(model).toContain('receivedByUser User? @relation("NeutralIntakeReceivedBy", fields: [receivedByUserId], references: [id], onDelete: Restrict)');
  });

  it("keeps ingressChannel open-ended and storageProvider technical", () => {
    expect(model).toContain("ingressChannel    String");
    expect(schema).not.toMatch(/enum\s+NeutralIntakeIngressChannel/);
    expect(migration).toContain('CHECK ("storageProvider" IN (\'local\', \'s3\'))');
  });

  it("contains no canonical legal, case, or destination fields", () => {
    for (const forbidden of [
      "LegalSourceId", "canonicalSourceKey", "sourceType", "legalRank", "territorialScope",
      "fascicoloId", "protocollo", "documentType", "procedimentoId", "DocumentFileVersion",
      "legalSourceAcquisitionId", "documentFileVersionId", "DocumentoId", "destinationDomain",
    ]) {
      expect(model).not.toContain(forbidden);
    }
  });

  it("enforces key, hash, size, version, and text constraints", () => {
    expect(migration).toContain('"idempotencyKey" CHAR(64) NOT NULL');
    expect(migration).toContain('"sha256" CHAR(64) NOT NULL');
    expect(checkExpression("neutral_intake_required_text_ck")).toBe([
      '"storageProvider" ~ \'[^[:space:]]\'',
      'AND "storageKey" ~ \'[^[:space:]]\'',
      'AND "mimeType" ~ \'[^[:space:]]\'',
      'AND "ingressChannel" ~ \'[^[:space:]]\'',
      'AND "receivedByActorId" ~ \'[^[:space:]]\'',
      'AND "receivedByRole" ~ \'[^[:space:]]\'',
    ].join(" "));
    expect(checkExpression("neutral_intake_optional_text_ck")).toBe([
      '("storageBucket" IS NULL OR "storageBucket" ~ \'[^[:space:]]\')',
      'AND ("originalName" IS NULL OR "originalName" ~ \'[^[:space:]]\')',
      'AND ("originReference" IS NULL OR "originReference" ~ \'[^[:space:]]\')',
    ].join(" "));
    expect(checkExpression("neutral_intake_idempotency_key_ck")).toBe('"idempotencyKey" ~ \'^[0-9a-f]{64}$\'');
    expect(checkExpression("neutral_intake_sha256_ck")).toBe('"sha256" ~ \'^[0-9a-f]{64}$\'');
    expect(checkExpression("neutral_intake_size_ck")).toBe('"sizeBytes" > 0');
    expect(checkExpression("neutral_intake_status_version_ck")).toBe('"statusVersion" >= 0');
  });

  it("uses one unique event key without making the artifact locator unique", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "NeutralIntake_idempotencyKey_key"');
    expect(migration).toContain('CREATE INDEX "NeutralIntake_storageProvider_storageKey_idx"');
    expect(migration).not.toContain('CREATE UNIQUE INDEX "NeutralIntake_storageProvider_storageKey');
    expect(migration).not.toMatch(/"idempotencyKey"[^\n]+DEFAULT/);
  });

  it("protects provenance updates while permitting lifecycle projection fields", () => {
    for (const field of [
      "idempotencyKey", "storageProvider", "storageBucket", "storageKey", "sha256", "mimeType",
      "sizeBytes", "originalName", "ingressChannel", "originReference", "enteId",
      "receivedByUserId", "receivedByActorId", "receivedByRole", "receivedAt",
    ]) {
      expect(migration).toContain(`NEW."${field}" IS DISTINCT FROM OLD."${field}"`);
    }
    expect(migration).not.toContain('NEW."status" IS DISTINCT FROM OLD."status"');
    expect(migration).not.toContain('NEW."statusVersion" IS DISTINCT FROM OLD."statusVersion"');
    expect(migration).toMatch(
      /CREATE TRIGGER "neutral_intake_reject_provenance_update"\s+BEFORE UPDATE ON "NeutralIntake"\s+FOR EACH ROW EXECUTE FUNCTION "reject_neutral_intake_provenance_mutation"\(\);/,
    );
    expect(migration).not.toMatch(/BEFORE DELETE ON "NeutralIntake"/);
  });

  it("contains DDL only and changes no existing domain table", () => {
    expect(statements(migration).some((statement) => /^(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(statement))).toBe(false);
    const alteredTables = [...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(alteredTables)).toEqual(new Set(["NeutralIntake"]));
    expect(migration).not.toMatch(/\b(CREATE|ALTER|DROP)\b[^;]*"(Documento|DocumentFileVersion|LegalSource|LegalSourceAcquisition|LegalExpressionVersion|LegalSourceVersion)"/i);
  });

  it("creates and immediately uses a new enum without altering an existing enum", () => {
    expect(migration).toContain('CREATE TYPE "NeutralIntakeStatus" AS ENUM');
    expect(migration).toContain('"status" "NeutralIntakeStatus" NOT NULL DEFAULT \'RECEIVED\'');
    expect(migration).not.toMatch(/ALTER\s+TYPE/i);
  });

  it("is the only Block 3B.1 migration and sorts after both Block 3A migrations", () => {
    const migrations = readdirSync(resolve("prisma/migrations")).sort();
    const block3a = [
      "20260912_b2c9_block3a_01_pending_identity_enum",
      "20260912_b2c9_block3a_02_precanonical_acquisition",
    ];
    const block3b1 = migrations.filter((name) => name.includes("b2c9_block3b1"));

    expect(migrations).toEqual(expect.arrayContaining(block3a));
    expect(block3b1).toEqual(["20260912_b2c9_block3b1_neutral_intake_core"]);
    expect(block3a.every((name) => name < block3b1[0])).toBe(true);
  });
});
