import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { Pool, type PoolClient } from "pg";

type BackupTarget = {
  label: "historical" | "canonical";
  connectionString: string;
  projectId: string;
  sourceBranchId: string;
  backupBranchId: string;
  backupBranchName: string;
  parentLsn: string;
  protected: boolean;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function target(prefix: "HISTORICAL" | "CANONICAL"): BackupTarget {
  return {
    label: prefix === "HISTORICAL" ? "historical" : "canonical",
    connectionString: required(`NOETRA_${prefix}_DATABASE_URL`),
    projectId: required(`NOETRA_${prefix}_NEON_PROJECT_ID`),
    sourceBranchId: required(`NOETRA_${prefix}_SOURCE_BRANCH_ID`),
    backupBranchId: required(`NOETRA_${prefix}_BACKUP_BRANCH_ID`),
    backupBranchName: required(`NOETRA_${prefix}_BACKUP_BRANCH_NAME`),
    parentLsn: required(`NOETRA_${prefix}_BACKUP_PARENT_LSN`),
    protected: process.env[`NOETRA_${prefix}_BACKUP_PROTECTED`] === "true",
  };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

async function tableDigest(
  client: PoolClient,
  table: string,
  primaryKeyColumns: string[],
): Promise<{ table: string; rowCount: number; contentSha256: string }> {
  const order = primaryKeyColumns.length > 0
    ? primaryKeyColumns.map(quoteIdentifier).join(", ")
    : "to_jsonb(source_row)::text";
  const result = await client.query<{ row_hash: string }>(
    `SELECT md5(to_jsonb(source_row)::text) AS row_hash
     FROM ${quoteIdentifier(table)} source_row
     ORDER BY ${order}`,
  );
  const digest = createHash("sha256");
  for (const row of result.rows) digest.update(row.row_hash).update("\n");
  return {
    table,
    rowCount: result.rows.length,
    contentSha256: digest.digest("hex"),
  };
}

async function inspectDatabase(input: BackupTarget) {
  const pool = new Pool({ connectionString: input.connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ");
    const identity = (await client.query<{
      database: string;
      user: string;
      transactionReadOnly: string;
    }>(`
      SELECT
        current_database() AS database,
        current_user AS user,
        current_setting('transaction_read_only') AS "transactionReadOnly"
    `)).rows[0];
    const tables = (await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)).rows.map((row) => row.table_name);
    const keyRows = (await client.query<{ table_name: string; column_name: string }>(`
      SELECT table_record.relname AS table_name, attribute_record.attname AS column_name
      FROM pg_index index_record
      JOIN pg_class table_record ON table_record.oid = index_record.indrelid
      JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
      JOIN unnest(index_record.indkey) WITH ORDINALITY AS key_column(attnum, ordinality) ON true
      JOIN pg_attribute attribute_record
        ON attribute_record.attrelid = table_record.oid
       AND attribute_record.attnum = key_column.attnum
      WHERE index_record.indisprimary AND namespace_record.nspname = 'public'
      ORDER BY table_record.relname, key_column.ordinality
    `)).rows;
    const primaryKeys = new Map<string, string[]>();
    for (const row of keyRows) {
      primaryKeys.set(row.table_name, [...(primaryKeys.get(row.table_name) ?? []), row.column_name]);
    }
    const tableDigests = [];
    for (const table of tables) {
      tableDigests.push(await tableDigest(client, table, primaryKeys.get(table) ?? []));
    }
    const migrations = tables.includes("_prisma_migrations")
      ? (await client.query<{
          migration_name: string;
          checksum: string;
          finished_at: Date | null;
          rolled_back_at: Date | null;
        }>(`
          SELECT migration_name, checksum, finished_at, rolled_back_at
          FROM "_prisma_migrations"
          ORDER BY migration_name
        `)).rows
      : [];
    const audit = tables.includes("ActivityLog")
      ? (await client.query<{
          recordCount: number;
          firstRecordId: string | null;
          finalRecordId: string | null;
          finalHash: string | null;
        }>(`
          SELECT
            count(*)::int AS "recordCount",
            (array_agg("id" ORDER BY "createdAt", "id"))[1] AS "firstRecordId",
            (array_agg("id" ORDER BY "createdAt" DESC, "id" DESC))[1] AS "finalRecordId",
            (array_agg("currentHash" ORDER BY "createdAt" DESC, "id" DESC))[1] AS "finalHash"
          FROM "ActivityLog"
        `)).rows[0]
      : null;
    await client.query("ROLLBACK");
    return {
      label: input.label,
      neon: {
        projectId: input.projectId,
        sourceBranchId: input.sourceBranchId,
        backupBranchId: input.backupBranchId,
        backupBranchName: input.backupBranchName,
        parentLsn: input.parentLsn,
        protected: input.protected,
      },
      identity,
      tableDigests,
      migrations,
      audit,
    };
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const output = required("NOETRA_BACKUP_MANIFEST_OUTPUT");
  const databases = [
    await inspectDatabase(target("HISTORICAL")),
    await inspectDatabase(target("CANONICAL")),
  ];
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    databases,
  };
  const canonical = JSON.stringify(manifest);
  const envelope = {
    ...manifest,
    manifestSha256: createHash("sha256").update(canonical).digest("hex"),
  };
  await writeFile(output, `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx" });
  console.info(`NOETRA_BACKUP_MANIFEST=${JSON.stringify({
    output,
    manifestSha256: envelope.manifestSha256,
    databases: databases.map((database) => ({
      label: database.label,
      backupBranchId: database.neon.backupBranchId,
      tableCount: database.tableDigests.length,
      rowCount: database.tableDigests.reduce((sum, table) => sum + table.rowCount, 0),
      migrationCount: database.migrations.length,
      activityLogCount: database.audit?.recordCount ?? 0,
    })),
  })}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "BACKUP_MANIFEST_FAILED");
  process.exitCode = 1;
});
