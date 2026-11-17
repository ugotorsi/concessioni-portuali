import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = await readFile(
  new URL("../../prisma/migrations/20261018_technical_source_research/migration.sql", import.meta.url),
  "utf8",
);

describe("technical source research migration", () => {
  it("enforces tenant, procedure, mission, and requester scope in PostgreSQL", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE TABLE "Ente" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "Procedimento" (
          "id" TEXT NOT NULL,
          "enteId" TEXT NOT NULL,
          UNIQUE ("id", "enteId")
        );
        CREATE TABLE "ResearchMissionRecord" (
          "id" VARCHAR(96) NOT NULL,
          "tenantId" TEXT,
          UNIQUE ("id", "tenantId")
        );
        CREATE TABLE "User" ("id" TEXT PRIMARY KEY);
        INSERT INTO "Ente" VALUES ('tenant-a'), ('tenant-b');
        INSERT INTO "Procedimento" VALUES ('procedure-a', 'tenant-a'), ('procedure-b', 'tenant-b');
        INSERT INTO "ResearchMissionRecord" VALUES ('mission-a', 'tenant-a'), ('mission-b', 'tenant-b');
        INSERT INTO "User" VALUES ('user-a');
      `);
      await database.exec(migration);

      await database.query(`
        INSERT INTO "TechnicalSourceResearchRecord" (
          "id", "tenantId", "procedimentoId", "missionId", "requestedByUserId",
          "questionSnapshot", "toolName", "requestPayload", "responsePayload", "serviceVersion"
        ) VALUES (
          'record-a', 'tenant-a', 'procedure-a', 'mission-a', 'user-a',
          'question', 'search', '{"query":"term"}', '{"count":0}', '0.5.0'
        )
      `);

      const count = await database.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM "TechnicalSourceResearchRecord"',
      );
      expect(count.rows[0]?.count).toBe(1);

      await expect(database.query(`
        INSERT INTO "TechnicalSourceResearchRecord" (
          "id", "tenantId", "procedimentoId", "missionId", "requestedByUserId",
          "questionSnapshot", "toolName", "requestPayload", "responsePayload", "serviceVersion"
        ) VALUES (
          'record-cross-tenant', 'tenant-b', 'procedure-a', 'mission-a', 'user-a',
          'question', 'search', '{}', '{}', '0.5.0'
        )
      `)).rejects.toThrow();

      await expect(database.query(`
        INSERT INTO "TechnicalSourceResearchRecord" (
          "id", "tenantId", "procedimentoId", "missionId", "requestedByUserId",
          "questionSnapshot", "toolName", "requestPayload", "responsePayload", "serviceVersion"
        ) VALUES (
          'record-cross-mission', 'tenant-a', 'procedure-a', 'mission-b', 'user-a',
          'question', 'search', '{}', '{}', '0.5.0'
        )
      `)).rejects.toThrow();

      const defaults = await database.query<{ verificationStatus: string }>(
        `SELECT "verificationStatus" FROM "TechnicalSourceResearchRecord" WHERE "id" = 'record-a'`,
      );
      expect(defaults.rows[0]?.verificationStatus).toBe("DA_VERIFICARE_SU_FONTE_ORIGINALE");

      const invalidRows = [
        `'record-bad-tool', 'tenant-a', 'procedure-a', 'mission-a', 'user-a', 'q', 'shell', '{}', '{}', '0.5.0', 'DA_VERIFICARE_SU_FONTE_ORIGINALE'`,
        `'record-bad-status', 'tenant-a', 'procedure-a', 'mission-a', 'user-a', 'q', 'search', '{}', '{}', '0.5.0', 'VERIFICATO'`,
        `'record-bad-user', 'tenant-a', 'procedure-a', 'mission-a', 'user-missing', 'q', 'search', '{}', '{}', '0.5.0', 'DA_VERIFICARE_SU_FONTE_ORIGINALE'`,
        `'record-null-tenant', NULL, 'procedure-a', 'mission-a', 'user-a', 'q', 'search', '{}', '{}', '0.5.0', 'DA_VERIFICARE_SU_FONTE_ORIGINALE'`,
      ];
      for (const values of invalidRows) {
        await expect(database.query(`
          INSERT INTO "TechnicalSourceResearchRecord" (
            "id", "tenantId", "procedimentoId", "missionId", "requestedByUserId",
            "questionSnapshot", "toolName", "requestPayload", "responsePayload", "serviceVersion",
            "verificationStatus"
          ) VALUES (${values})
        `)).rejects.toThrow();
      }

      await expect(database.query(`DELETE FROM "ResearchMissionRecord" WHERE "id" = 'mission-a'`)).rejects.toThrow();
      await expect(database.query(`DELETE FROM "Procedimento" WHERE "id" = 'procedure-a'`)).rejects.toThrow();

      const indexes = await database.query<{ indexname: string; indexdef: string }>(`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'TechnicalSourceResearchRecord' ORDER BY indexname
      `);
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        "TechnicalSourceResearchRecord_pkey",
        "technical_source_research_actor_idx",
        "technical_source_research_mission_idx",
      ]);
      expect(indexes.rows.find((row) => row.indexname === "technical_source_research_mission_idx")?.indexdef)
        .toContain('("tenantId", "procedimentoId", "missionId", "retrievedAt")');

      const constraints = await database.query<{ conname: string }>(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = '"TechnicalSourceResearchRecord"'::regclass ORDER BY conname
      `);
      expect(constraints.rows.map((row) => row.conname)).toEqual([
        "TechnicalSourceResearchRecord_pkey",
        "TechnicalSourceResearchRecord_tenantId_fkey",
        "technical_source_research_mission_fk",
        "technical_source_research_procedure_fk",
        "technical_source_research_tool_ck",
        "technical_source_research_user_fk",
        "technical_source_research_verification_ck",
      ]);

      // Documented rollback: purely additive table, no data in pre-existing tables is touched.
      await database.exec('DROP TABLE "TechnicalSourceResearchRecord";');
      const parents = await database.query<{ count: number }>(`
        SELECT (SELECT COUNT(*) FROM "Procedimento")::int + (SELECT COUNT(*) FROM "ResearchMissionRecord")::int AS count
      `);
      expect(parents.rows[0]?.count).toBe(4);
    } finally {
      await database.close();
    }
  });
});
