import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationDirectory = "20260914_b2c9_block3b5a_candidate_resolution";
const migrationPath = `prisma/migrations/${migrationDirectory}/migration.sql`;
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve("prisma/migrations", migrationDirectory, "migration.sql"),
  "utf8",
);
const resolution = schema.match(/model LegalSourceCandidateResolution \{[\s\S]*?\n\}/)?.[0] ?? "";
const admission = schema.match(/model LegalSourceCandidateAdmission \{[\s\S]*?\n\}/)?.[0] ?? "";
const legalSource = schema.match(/model LegalSource \{[\s\S]*?\n\}/)?.[0] ?? "";
const outcome = schema.match(/enum LegalSourceCandidateResolutionOutcome \{[\s\S]*?\n\}/)?.[0] ?? "";

// Git delta isolation is enforced by block audit gates, not by the durable schema unit contract.

describe("B2C9 Block 3B.5A candidate resolution persistence", () => {
  it("defines one optional resolution per admission", () => {
    expect(resolution).toMatch(/^\s*admissionId\s+String\s+@unique$/m);
    expect(resolution).toMatch(/^\s*admission\s+LegalSourceCandidateAdmission\s+@relation/m);
    expect(admission).toContain("resolution            LegalSourceCandidateResolution?");
    expect(migration).toContain('CREATE UNIQUE INDEX "LegalSourceCandidateResolution_admissionId_key"');
  });

  it("reuses the canonical LegalSource universe with an optional protected link", () => {
    expect(resolution).toMatch(/^\s*legalSourceId\s+String\?$/m);
    expect(resolution).toMatch(/^\s*legalSource\s+LegalSource\?\s+@relation/m);
    expect(resolution).toContain("onDelete: Restrict");
    expect(legalSource).toContain("candidateResolutions         LegalSourceCandidateResolution[]");
    expect(migration).toContain('REFERENCES "LegalSource"("id") ON DELETE RESTRICT');
    expect(schema).not.toMatch(/model (CanonicalLegalSource|VerifiedLegalSource|CandidateLegalSource) \{/);
  });

  it("defines exactly the two current outcomes", () => {
    expect(outcome.match(/^\s+[A-Z_]+$/gm)?.map((value) => value.trim())).toEqual([
      "LINKED",
      "NO_MATCH",
    ]);
    expect(migration).toContain(
      'CREATE TYPE "LegalSourceCandidateResolutionOutcome" AS ENUM (\'LINKED\', \'NO_MATCH\')',
    );
  });

  it("enforces outcome and canonical-source coherence in the database", () => {
    expect(migration).toContain('CONSTRAINT "legal_source_candidate_resolution_outcome_source_ck"');
    expect(migration).toContain('"outcome" = \'LINKED\' AND "legalSourceId" IS NOT NULL');
    expect(migration).toContain('"outcome" = \'NO_MATCH\' AND "legalSourceId" IS NULL');
  });

  it("reuses reviewer snapshots and bounds the optional review note", () => {
    for (const field of [
      "reviewedByUserId", "reviewedByActorId", "reviewedByEmail", "reviewedByRole",
      "resolvedAt", "reviewNote",
    ]) {
      expect(resolution).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }
    expect(resolution).toMatch(/^\s*reviewNote\s+String\?\s+@db\.VarChar\(2000\)$/m);
    expect(resolution).toMatch(/^\s*reviewedByUser\s+User\?\s+@relation\("LegalSourceCandidateResolutionReviewedBy"/m);
    expect(migration).toContain('REFERENCES "User"("id") ON DELETE SET NULL');
    expect(migration).toContain('"reviewNote" VARCHAR(2000)');
  });

  it("protects both authoritative parents from destructive deletion", () => {
    expect(migration).toContain('REFERENCES "LegalSourceCandidateAdmission"("id") ON DELETE RESTRICT');
    expect(migration).toContain('REFERENCES "LegalSource"("id") ON DELETE RESTRICT');
  });

  it("adds neither redundant Fascicolo identity nor admission status", () => {
    expect(resolution).not.toMatch(/procedimentoId|fascicoloId|enteId/);
    expect(admission).not.toMatch(/resolutionStatus|canonicalized|verified|reviewed/);
  });

  it("creates exactly one migration for this block without executable DML", () => {
    const migrations = readdirSync(resolve("prisma/migrations"));
    expect(migrations.filter((name) => name.includes("block3b5a"))).toEqual([migrationDirectory]);
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
  });

  it("exposes the enum, model, and relations in the generated Prisma client", () => {
    const enums = readFileSync(resolve("src/generated/prisma/enums.ts"), "utf8");
    const models = readFileSync(resolve("src/generated/prisma/models.ts"), "utf8");
    const admissionModel = readFileSync(
      resolve("src/generated/prisma/models/LegalSourceCandidateAdmission.ts"),
      "utf8",
    );
    const legalSourceModel = readFileSync(resolve("src/generated/prisma/models/LegalSource.ts"), "utf8");
    const resolutionModelPath = resolve(
      "src/generated/prisma/models/LegalSourceCandidateResolution.ts",
    );

    expect(enums).toContain("LegalSourceCandidateResolutionOutcome");
    expect(models).toContain("LegalSourceCandidateResolution");
    expect(existsSync(resolutionModelPath)).toBe(true);
    expect(admissionModel).toContain("resolution");
    expect(legalSourceModel).toContain("candidateResolutions");
  });
});