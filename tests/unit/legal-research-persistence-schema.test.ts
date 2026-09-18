import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(path.join(root, "prisma", "schema.prisma"), "utf8");
const migrationPath = path.join(
  root,
  "prisma",
  "migrations",
  "20260917_block3b13b_research_persistence",
  "migration.sql",
);
const migration = readFileSync(migrationPath, "utf8");

function schemaBlock(kind: "model" | "enum", name: string): string {
  const start = schema.indexOf(`${kind} ${name} {`);
  if (start < 0) throw new Error(`Missing ${kind} ${name}`);
  const end = schema.indexOf("\n}", start);
  if (end < 0) throw new Error(`Unclosed ${kind} ${name}`);
  return schema.slice(start, end + 2);
}

function declaredPhysicalNames(sql: string): string[] {
  return [...sql.matchAll(
    /^\s*(?:CREATE\s+(?:UNIQUE\s+)?INDEX|CREATE\s+FUNCTION|CREATE\s+TRIGGER|CONSTRAINT)\s+"([^"]+)"/gim,
  )].map((match) => match[1]);
}

describe("Block 3B.13B research persistence schema", () => {
  it("uses the exact accepted mission lifecycle values", () => {
    expect(schemaBlock("enum", "ResearchMissionStatus")).toContain([
      "PENDING",
      "IN_PROGRESS",
      "COMPLETED",
      "BUDGET_EXHAUSTED",
      "DEFERRED",
      "REJECTED",
    ].join("\n  "));
  });

  it("uses the exact accepted evidence-bundle completion values", () => {
    const completion = schemaBlock("enum", "ResearchCompletionState");
    for (const value of ["COMPLETE", "PARTIAL", "BUDGET_EXHAUSTED", "FAILED", "HUMAN_DECISION_REQUIRED"]) {
      expect(completion).toContain(value);
    }
    expect(completion).not.toContain("DEFERRED");
  });

  it("stores legal referenceDate separately from operational timestamps", () => {
    const mission = schemaBlock("model", "ResearchMissionRecord");
    expect(mission).toContain("referenceDate       DateTime");
    expect(mission).toContain("createdAt           DateTime");
    expect(mission).toContain("updatedAt           DateTime");
  });

  it("stores an immutable mission payload and fingerprint", () => {
    expect(schemaBlock("model", "ResearchMissionRecord")).toContain("payloadFingerprint");
    expect(migration).toContain('CREATE FUNCTION "protect_research_mission_snapshot"()');
    expect(migration).toContain('CREATE TRIGGER "research_mission_snapshot_trg"');
  });

  it("models one active mission lease and append-only attempts", () => {
    const mission = schemaBlock("model", "ResearchMissionRecord");
    expect(mission).toContain("claimantId");
    expect(mission).toContain("claimToken");
    expect(mission).toContain("claimExpiresAt");
    expect(mission).toContain("activeExecutionId");
    expect(schemaBlock("model", "ResearchExecutionAttempt")).toContain("finalBundleId");
  });

  it("binds every bundle to its mission execution with a composite foreign key", () => {
    expect(schemaBlock("model", "ResearchEvidenceBundleRecord")).toContain(
      "@relation(fields: [executionId, missionId], references: [id, missionId]",
    );
    expect(migration).toContain('CONSTRAINT "research_bundle_attempt_fk" FOREIGN KEY ("executionId", "missionId")');
  });

  it("enforces nonnegative persisted call counters", () => {
    expect(migration).toContain('CONSTRAINT "research_attempt_calls_ck"');
    expect(migration).toContain('CONSTRAINT "research_bundle_calls_ck"');
    expect(migration).toContain('"moonlitCalls" + "simpliciterCalls" + "legalDataHunterCalls" <= "totalCalls"');
  });

  it("makes evidence bundles append-only at the database boundary", () => {
    expect(migration).toContain('CREATE TRIGGER "research_bundle_update_trg"');
    expect(migration).toContain('CREATE TRIGGER "research_bundle_delete_trg"');
    expect(migration.match(/EXECUTE FUNCTION "reject_research_bundle_mutation"\(\)/g)).toHaveLength(2);
  });

  it("contains only additive DDL and no canonical-source tables", () => {
    expect(migration).not.toMatch(/^\s*DROP\s+/gim);
    expect(migration).not.toContain('ALTER TABLE "LegalSource"');
    expect(migration).not.toContain('ALTER TABLE "LegalExpressionVersion"');
    expect(migration).not.toContain('ALTER TABLE "LegalReferenceOfficialHit"');
  });

  it("keeps every declared PostgreSQL identifier unique and within 63 bytes", () => {
    const names = declaredPhysicalNames(migration);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => Buffer.byteLength(name, "utf8") > 63)).toEqual([]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("uses explicit short map names for every Prisma index and unique constraint", () => {
    for (const model of [
      schemaBlock("model", "ResearchMissionRecord"),
      schemaBlock("model", "ResearchExecutionAttempt"),
      schemaBlock("model", "ResearchEvidenceBundleRecord"),
    ]) {
      for (const line of model.split("\n").filter((value) => value.includes("@@index") || value.includes("@@unique"))) {
        expect(line).toMatch(/map: "[a-z0-9_]+"/);
      }
    }
    expect(schemaBlock("model", "ResearchMissionRecord")).toContain('map: "research_mission_tenant_fk"');
    expect(schemaBlock("model", "ResearchExecutionAttempt")).toContain('map: "research_attempt_mission_fk"');
    expect(schemaBlock("model", "ResearchEvidenceBundleRecord")).toContain('map: "research_bundle_attempt_fk"');
  });

  it("pins the reviewed migration bytes", () => {
    expect(createHash("sha256").update(readFileSync(migrationPath)).digest("hex"))
      .toBe("5dbab4692b023d9846a17402e16f8ab59572dd64b7d5a8b2ea0119f85c03f1b6");
  });
});