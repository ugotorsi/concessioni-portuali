import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const initialMigration = readFileSync(resolve(
  "prisma/migrations/20261101_research_provider_oauth_credential/migration.sql",
), "utf8");
const legalDataHunterMigration = readFileSync(resolve(
  "prisma/migrations/20261123_legal_data_hunter_credential_provider/migration.sql",
), "utf8");
const databases: PGlite[] = [];

describe("research provider credential migration", () => {
  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()));
  });

  it("adds Legal Data Hunter without weakening the provider allowlist", async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(initialMigration);
    await database.exec(legalDataHunterMigration);

    for (const provider of ["MOONLIT", "SIMPLICITER", "LEGAL_DATA_HUNTER"]) {
      await database.query(
        `INSERT INTO "ResearchProviderOAuthCredential"
          ("provider", "encryptedPayload", "updatedAt")
        VALUES ($1, 'encrypted', CURRENT_TIMESTAMP)`,
        [provider],
      );
    }

    await expect(database.query(
      `INSERT INTO "ResearchProviderOAuthCredential"
        ("provider", "encryptedPayload", "updatedAt")
      VALUES ($1, 'encrypted', CURRENT_TIMESTAMP)`,
      ["UNSUPPORTED"],
    )).rejects.toThrow();
  });
});
