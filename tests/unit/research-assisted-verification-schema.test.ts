import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(path.join(root, "prisma", "schema.prisma"), "utf8");
const migration = readFileSync(path.join(
  root,
  "prisma",
  "migrations",
  "20260926_assisted_verification_persistence",
  "migration.sql",
), "utf8");

function schemaBlock(name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  if (start < 0) throw new Error(`Missing model ${name}`);
  const end = schema.indexOf("\n}", start);
  if (end < 0) throw new Error(`Unclosed model ${name}`);
  return schema.slice(start, end + 2);
}

describe("assisted verification persistence schema", () => {
  it("stores a tenant-scoped immutable snapshot with actor provenance", () => {
    const model = schemaBlock("ResearchAssistedVerificationRecord");
    for (const field of [
      "missionId",
      "tenantId",
      "contractVersion",
      "fingerprint",
      "payload",
      "recordedByActorId",
      "createdAt",
    ]) expect(model).toContain(field);
    expect(model).toContain('map: "research_assisted_verification_mission_tenant_fk"');
    expect(model).toContain('map: "research_assisted_verification_tenant_fk"');
  });

  it("creates mission and tenant foreign keys", () => {
    expect(migration).toContain('CREATE TABLE "ResearchAssistedVerificationRecord"');
    expect(migration).toContain('CONSTRAINT "research_assisted_verification_mission_tenant_fk"');
    expect(migration).toContain('REFERENCES "ResearchMissionRecord"("id", "tenantId")');
    expect(migration).toContain('CONSTRAINT "research_assisted_verification_tenant_fk"');
    expect(migration).toContain('REFERENCES "Ente"("id")');
  });

  it("enforces fingerprint, payload-size, and append-only audit constraints", () => {
    expect(migration).toContain('CONSTRAINT "research_assisted_verification_hash_ck"');
    expect(migration).toContain('CONSTRAINT "research_assisted_verification_payload_size_ck"');
    expect(migration).toContain('CREATE TRIGGER "research_assisted_verification_update_trg"');
    expect(migration).toContain('CREATE TRIGGER "research_assisted_verification_delete_trg"');
    expect(migration.match(/EXECUTE FUNCTION "reject_research_assisted_verification_mutation"\(\)/g))
      .toHaveLength(2);
  });

  it("contains additive DDL only", () => {
    expect(migration).not.toMatch(/^\s*DROP\s+/gim);
    expect(migration).not.toMatch(/^\s*DELETE\s+/gim);
    expect(migration).not.toMatch(/^\s*UPDATE\s+/gim);
  });
});