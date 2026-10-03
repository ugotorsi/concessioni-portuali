import { createHash } from "node:crypto";

import pg from "pg";

const { Client } = pg;

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  console.error(JSON.stringify({ error: "DATABASE_URL_REQUIRED" }));
  process.exit(1);
}

const entityTables = {
  fascicoli: "FascicoloIntake",
  concessioni: "Concessione",
  documenti: "Documento",
  utenti: "User",
};

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

const client = new Client({ connectionString });

try {
  await client.connect();
  await client.query("BEGIN TRANSACTION READ ONLY");
  await client.query("SET LOCAL statement_timeout = '30s'");

  const { rows: tableRows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
  const { rows: columnRows } = await client.query(`
      SELECT table_name, column_name, ordinal_position, data_type, udt_name,
             is_nullable, column_default, character_maximum_length,
             numeric_precision, numeric_scale, datetime_precision
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
  const { rows: constraintRows } = await client.query(`
      SELECT relation.relname AS table_name, constraint_record.conname AS constraint_name,
             constraint_record.contype AS constraint_type,
             pg_get_constraintdef(constraint_record.oid, true) AS definition
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS relation ON relation.oid = constraint_record.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
      ORDER BY relation.relname, constraint_record.conname
    `);
  const { rows: indexRows } = await client.query(`
      SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `);
  const { rows: enumRows } = await client.query(`
      SELECT type_record.typname AS enum_name, enum_record.enumsortorder, enum_record.enumlabel
      FROM pg_type AS type_record
      JOIN pg_enum AS enum_record ON enum_record.enumtypid = type_record.oid
      JOIN pg_namespace AS namespace ON namespace.oid = type_record.typnamespace
      WHERE namespace.nspname = 'public'
      ORDER BY type_record.typname, enum_record.enumsortorder
    `);

  const tableNames = new Set(tableRows.map((row) => row.table_name));
  let migrationCount = 0;
  let appliedMigrationCount = 0;
  let migrationFingerprint = null;

  if (tableNames.has("_prisma_migrations")) {
    const { rows: migrationRows } = await client.query(`
      SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
             rolled_back_at IS NOT NULL AS rolled_back
      FROM public."_prisma_migrations"
      ORDER BY migration_name
    `);
    migrationCount = migrationRows.length;
    appliedMigrationCount = migrationRows.filter((row) => row.finished && !row.rolled_back).length;
    migrationFingerprint = fingerprint(migrationRows);
  }

  const entities = {};
  for (const [entity, tableName] of Object.entries(entityTables)) {
    if (!tableNames.has(tableName)) {
      entities[entity] = { table: tableName, present: false, count: null };
      continue;
    }
    const { rows } = await client.query(
      `SELECT COUNT(*)::integer AS count FROM public.${quoteIdentifier(tableName)}`,
    );
    entities[entity] = { table: tableName, present: true, count: rows[0].count };
  }

  const { rows: clockRows } = await client.query("SELECT CURRENT_TIMESTAMP AS captured_at");
  const schemaDefinition = {
    tables: tableRows,
    columns: columnRows,
    constraints: constraintRows,
    indexes: indexRows,
    enums: enumRows,
  };

  await client.query("COMMIT");
  process.stdout.write(`${JSON.stringify({
    capturedAt: clockRows[0].captured_at,
    tableCount: tableRows.length,
    migrationCount,
    appliedMigrationCount,
    migrationFingerprint,
    schemaFingerprint: fingerprint(schemaDefinition),
    schemaObjectCounts: {
      columns: columnRows.length,
      constraints: constraintRows.length,
      indexes: indexRows.length,
      enumValues: enumRows.length,
    },
    entities,
    sanityQuery: "PASS",
  }, null, 2)}\n`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(JSON.stringify({
    error: "NEON_RECOVERY_AUDIT_FAILED",
    code: error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN",
  }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}