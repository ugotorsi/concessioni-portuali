import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "prisma/migrations/20261009_unified_fascicolo/migration.sql",
), "utf8");

async function createLegacyBaseline(database: PGlite) {
  await database.exec(`
    CREATE TABLE "Ente" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Concessione" (
      "id" TEXT PRIMARY KEY,
      "enteId" TEXT REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    );
    CREATE TABLE "Procedimento" (
      "id" TEXT PRIMARY KEY,
      "concessioneId" TEXT NOT NULL,
      CONSTRAINT "Procedimento_concessioneId_fkey"
        FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE TABLE "FascicoloIntake" (
      "id" TEXT PRIMARY KEY
    );
  `);
}

describe("unified fascicolo migration", () => {
  it("backfills the canonical tenant and permits a procedure without a concession", async () => {
    const database = new PGlite();
    try {
      await createLegacyBaseline(database);
      await database.exec(`
        INSERT INTO "Ente" ("id") VALUES ('ente-1');
        INSERT INTO "Concessione" ("id","enteId") VALUES ('concessione-1','ente-1');
        INSERT INTO "Procedimento" ("id","concessioneId") VALUES ('legacy-1','concessione-1');
        INSERT INTO "FascicoloIntake" ("id") VALUES ('intake-1'),('intake-2');
      `);

      await database.exec(migration);
      const legacy = await database.query<{ enteId: string; concessioneId: string | null }>(`
        SELECT "enteId", "concessioneId" FROM "Procedimento" WHERE "id"='legacy-1'
      `);
      expect(legacy.rows).toEqual([{ enteId: "ente-1", concessioneId: "concessione-1" }]);

      await database.exec(`
        INSERT INTO "Procedimento" ("id","enteId","concessioneId")
          VALUES ('senza-titolo','ente-1',NULL);
        UPDATE "FascicoloIntake" SET "procedimentoId"='senza-titolo' WHERE "id"='intake-1';
      `);
      await expect(database.exec(`
        UPDATE "FascicoloIntake" SET "procedimentoId"='senza-titolo' WHERE "id"='intake-2'
      `)).rejects.toThrow();
      await expect(database.exec(`
        DELETE FROM "Concessione" WHERE "id"='concessione-1'
      `)).rejects.toThrow();
      await expect(database.exec(`
        INSERT INTO "Procedimento" ("id","concessioneId") VALUES ('tenant-mancante',NULL)
      `)).rejects.toThrow();
    } finally {
      await database.close();
    }
  });

  it("aborts instead of inventing a tenant for anomalous legacy procedures", async () => {
    const database = new PGlite();
    try {
      await createLegacyBaseline(database);
      await database.exec(`
        ALTER TABLE "Procedimento" DROP CONSTRAINT "Procedimento_concessioneId_fkey";
        INSERT INTO "Procedimento" ("id","concessioneId") VALUES ('orphan','missing');
        ALTER TABLE "Procedimento"
          ADD CONSTRAINT "Procedimento_concessioneId_fkey"
          FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id")
          NOT VALID;
      `);

      await expect(database.exec(migration)).rejects.toThrow(
        /Cannot backfill Procedimento\.enteId: 1 legacy procedure/,
      );
      await database.exec("ROLLBACK");
      const columns = await database.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name IN ('Procedimento','FascicoloIntake')
          AND column_name IN ('enteId','procedimentoId')
      `);
      expect(columns.rows).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it("changes the destructive title cascade to explicit restriction", () => {
    expect(migration).toContain('ALTER COLUMN "concessioneId" DROP NOT NULL');
    expect(migration).toContain('ALTER COLUMN "enteId" SET NOT NULL');
    expect(migration).toContain('CONSTRAINT "Procedimento_concessioneId_fkey"');
    expect(migration).toMatch(
      /FOREIGN KEY \("concessioneId"\) REFERENCES "Concessione"\("id"\)\s+ON DELETE RESTRICT/,
    );
    expect(migration).toContain('CREATE UNIQUE INDEX "FascicoloIntake_procedimentoId_key"');
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
  });
});
