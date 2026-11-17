import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260926_assisted_verification_persistence",
  "migration.sql",
), "utf8");

describe("assisted verification migration on disposable PostgreSQL", () => {
  it("creates the registry, enforces tenant pairing, and rejects mutation", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE TABLE "Ente" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "ResearchMissionRecord" (
          "id" VARCHAR(96) PRIMARY KEY,
          "tenantId" TEXT
        );
        INSERT INTO "Ente" ("id") VALUES ('tenant-a'), ('tenant-b');
        INSERT INTO "ResearchMissionRecord" ("id", "tenantId") VALUES ('mission-a', 'tenant-a');
      `);
      await database.exec(migration);
      await database.exec(`
        INSERT INTO "ResearchAssistedVerificationRecord" (
          "id", "missionId", "tenantId", "contractVersion",
          "fingerprint", "payload", "recordedByActorId"
        ) VALUES (
          'verification-a', 'mission-a', 'tenant-a', 'ASSISTED_VERIFICATION_V1',
          '${"a".repeat(64)}', '{}'::jsonb, 'actor-a'
        );
      `);

      await expect(database.exec(`
        INSERT INTO "ResearchAssistedVerificationRecord" (
          "id", "missionId", "tenantId", "contractVersion",
          "fingerprint", "payload", "recordedByActorId"
        ) VALUES (
          'verification-b', 'mission-a', 'tenant-b', 'ASSISTED_VERIFICATION_V1',
          '${"b".repeat(64)}', '{}'::jsonb, 'actor-b'
        );
      `)).rejects.toThrow();
      await expect(database.exec(`
        UPDATE "ResearchAssistedVerificationRecord"
        SET "recordedByActorId" = 'actor-b'
        WHERE "id" = 'verification-a';
      `)).rejects.toThrow(/append-only/i);
      await expect(database.exec(`
        DELETE FROM "ResearchAssistedVerificationRecord"
        WHERE "id" = 'verification-a';
      `)).rejects.toThrow(/append-only/i);

      const persisted = await database.query<{ id: string; tenantId: string }>(`
        SELECT "id", "tenantId"
        FROM "ResearchAssistedVerificationRecord";
      `);
      expect(persisted.rows).toEqual([{ id: "verification-a", tenantId: "tenant-a" }]);
    } finally {
      await database.close();
    }
  });
});