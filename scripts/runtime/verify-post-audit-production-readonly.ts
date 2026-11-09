import { Pool, type PoolClient } from "pg";

import { runPostAuditProductionPreflight } from "../../src/server/release/postAuditProductionPreflight";
import { databaseIdentityFingerprint } from "../../src/server/release/previewIsolation";

const confirmation = "--confirm-production-read-only";

async function main(): Promise<void> {
  if (!process.argv.slice(2).includes(confirmation)) {
    throw new Error("PRODUCTION_PREFLIGHT_CONFIRMATION_REQUIRED");
  }
  const connectionString = process.env.NOETRA_PRODUCTION_READONLY_DATABASE_URL;
  if (!connectionString) throw new Error("PRODUCTION_READONLY_DATABASE_URL_REQUIRED");
  const pool = new Pool({ connectionString, max: 1 });
  let client: PoolClient | undefined;
  let transactionOpen = false;
  try {
    const connectedClient = await pool.connect();
    client = connectedClient;
    await connectedClient.query("BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ");
    transactionOpen = true;
    await connectedClient.query("SET LOCAL statement_timeout = '60s'");
    await connectedClient.query("SET LOCAL lock_timeout = '5s'");
    const result = await runPostAuditProductionPreflight({
      query: async <T>(sql: string, params: readonly unknown[] = []) => ({
        rows: (await connectedClient.query(sql, [...params])).rows as T[],
      }),
    });
    await connectedClient.query("ROLLBACK");
    transactionOpen = false;
    console.info(`NOETRA_POST_AUDIT_PRODUCTION_PREFLIGHT=${JSON.stringify({
      ...result,
      productionDatabaseIdentityFingerprint: databaseIdentityFingerprint(connectionString),
    })}`);
    if (!result.safeToMigrate) throw new Error("POST_AUDIT_PRODUCTION_PREFLIGHT_BLOCKED");
  } catch (error) {
    if (transactionOpen && client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "POST_AUDIT_PRODUCTION_PREFLIGHT_ROLLBACK_FAILED",
        );
      }
    }
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "POST_AUDIT_PRODUCTION_PREFLIGHT_FAILED");
  process.exitCode = 1;
});
