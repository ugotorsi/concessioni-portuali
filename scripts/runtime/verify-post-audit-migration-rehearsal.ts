import { Pool, type PoolClient } from "pg";

import { databaseIdentityFingerprint } from "../../src/server/release/previewIsolation";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function expectedCount(name: string): number {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name}_INVALID`);
  return value;
}

async function main(): Promise<void> {
  if (!process.argv.slice(2).includes("--confirm-isolated-rehearsal")) {
    throw new Error("MIGRATION_REHEARSAL_CONFIRMATION_REQUIRED");
  }
  if (required("NOETRA_REHEARSAL_DATA_CLASSIFICATION") !== "PRODUCTION_SNAPSHOT_ISOLATED") {
    throw new Error("MIGRATION_REHEARSAL_CLASSIFICATION_REQUIRED");
  }
  const connectionString = required("NOETRA_REHEARSAL_DATABASE_URL");
  const actualFingerprint = databaseIdentityFingerprint(connectionString);
  if (actualFingerprint !== required("NOETRA_REHEARSAL_DATABASE_FINGERPRINT")) {
    throw new Error("MIGRATION_REHEARSAL_DATABASE_IDENTITY_MISMATCH");
  }
  if (actualFingerprint === required("NOETRA_PRODUCTION_DATABASE_FINGERPRINT")) {
    throw new Error("MIGRATION_REHEARSAL_PRODUCTION_DATABASE_FORBIDDEN");
  }
  const expectedConcessions = expectedCount("NOETRA_EXPECTED_CONCESSION_COUNT");
  const expectedProcedures = expectedCount("NOETRA_EXPECTED_PROCEDURE_COUNT");
  const pool = new Pool({ connectionString, max: 1 });
  let client: PoolClient | undefined;
  let transactionOpen = false;
  try {
    const connectedClient = await pool.connect();
    client = connectedClient;
    await connectedClient.query("BEGIN READ ONLY");
    transactionOpen = true;
    const { rows } = await connectedClient.query<{
      concessionCount: number;
      procedureCount: number;
      duplicateGroups: number;
      orphanProcedures: number;
      indexValid: boolean;
      migrationApplied: boolean;
    }>(`
      WITH duplicate_groups AS (
        SELECT 1
        FROM "Concessione"
        WHERE "enteId" IS NOT NULL
        GROUP BY "enteId", lower(regexp_replace("numeroAtto", '\\s+', '', 'g'))
        HAVING count(*) > 1
      )
      SELECT
        (SELECT count(*)::integer FROM "Concessione") AS "concessionCount",
        (SELECT count(*)::integer FROM "Procedimento") AS "procedureCount",
        (SELECT count(*)::integer FROM duplicate_groups) AS "duplicateGroups",
        (
          SELECT count(*)::integer
          FROM "Procedimento" p
          LEFT JOIN "Concessione" c ON c."id" = p."concessioneId"
          WHERE p."concessioneId" IS NOT NULL AND c."id" IS NULL
        ) AS "orphanProcedures",
        COALESCE((
          SELECT
            i.indisvalid
            AND i.indisunique
            AND i.indnkeyatts = 2
            AND i.indexprs IS NOT NULL
            AND pg_get_expr(i.indpred, i.indrelid) = '("enteId" IS NOT NULL)'
            AND pg_get_indexdef(i.indexrelid) LIKE '%lower(regexp_replace("numeroAtto"%'
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = 'concessione_tenant_normalized_numero_atto_uq'
            AND i.indrelid = 'public."Concessione"'::regclass
        ), false) AS "indexValid",
        EXISTS (
          SELECT 1 FROM "_prisma_migrations"
          WHERE migration_name = '20261110_concession_normalized_identity'
            AND finished_at IS NOT NULL AND rolled_back_at IS NULL
        ) AS "migrationApplied"
    `);
    await connectedClient.query("ROLLBACK");
    transactionOpen = false;
    const result = rows[0];
    if (!result) throw new Error("MIGRATION_REHEARSAL_RESULT_MISSING");
    const valid = result.concessionCount === expectedConcessions
      && result.procedureCount === expectedProcedures
      && result.duplicateGroups === 0
      && result.orphanProcedures === 0
      && result.indexValid
      && result.migrationApplied;
    console.info(`NOETRA_POST_AUDIT_MIGRATION_REHEARSAL=${JSON.stringify({
      valid,
      databaseIdentityFingerprint: actualFingerprint,
      ...result,
    })}`);
    if (!valid) throw new Error("POST_AUDIT_MIGRATION_REHEARSAL_BLOCKED");
  } catch (error) {
    if (transactionOpen && client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "POST_AUDIT_MIGRATION_REHEARSAL_ROLLBACK_FAILED",
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
  console.error(error instanceof Error ? error.message : "POST_AUDIT_MIGRATION_REHEARSAL_FAILED");
  process.exitCode = 1;
});
