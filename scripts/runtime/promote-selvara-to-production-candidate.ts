import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const PROCEDURE_ID = "procedimento-intake-9e04f4d4cdbf092845b57c66";
const APPROVAL = "NOETRA-V7-PRODUCTION-SELVARA-PROMOTION-2026-10-29";
const EXCLUDED_OPERATIONAL_TABLES = new Set([
  "AsyncJob",
  "DocumentExtractionAttempt",
  "DocumentExtractionPage",
  "DocumentOcrRun",
  "RuntimeBudgetPolicy",
  "RuntimeCostReservation",
]);
const EXCLUDED_REFERENCE_COLUMNS = new Map([
  ["FascicoloKnowledgeEvidence", new Set(["documentExtractionAttemptId"])],
]);

interface ForeignKey {
  childTable: string;
  childColumns: string[];
  parentTable: string;
  parentColumns: string[];
}

interface SelectedRow {
  table: string;
  row: Record<string, unknown>;
  primaryKey: string;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

function rowKey(table: string, primaryKey: string, row: Record<string, unknown>): string {
  return `${table}:${JSON.stringify(row[primaryKey])}`;
}

async function loadMetadata(client: PoolClient): Promise<{
  foreignKeys: ForeignKey[];
  primaryKeys: Map<string, string>;
  nullableColumns: Set<string>;
  jsonColumns: Set<string>;
  insertableColumns: Map<string, string[]>;
}> {
  const [foreignKeysResult, primaryKeysResult, columnsResult] = await Promise.all([
    client.query<ForeignKey>(`
      SELECT
        child.relname AS "childTable",
        array_agg(child_attribute.attname::text ORDER BY keys.ordinality)::text[] AS "childColumns",
        parent.relname AS "parentTable",
        array_agg(parent_attribute.attname::text ORDER BY keys.ordinality)::text[] AS "parentColumns"
      FROM pg_constraint constraint_record
      JOIN pg_class child ON child.oid = constraint_record.conrelid
      JOIN pg_class parent ON parent.oid = constraint_record.confrelid
      JOIN unnest(constraint_record.conkey, constraint_record.confkey)
        WITH ORDINALITY AS keys(child_number, parent_number, ordinality) ON true
      JOIN pg_attribute child_attribute
        ON child_attribute.attrelid = child.oid AND child_attribute.attnum = keys.child_number
      JOIN pg_attribute parent_attribute
        ON parent_attribute.attrelid = parent.oid AND parent_attribute.attnum = keys.parent_number
      JOIN pg_namespace namespace_record ON namespace_record.oid = child.relnamespace
      WHERE constraint_record.contype = 'f' AND namespace_record.nspname = 'public'
      GROUP BY child.relname, parent.relname, constraint_record.oid
    `),
    client.query<{ table: string; column: string }>(`
      SELECT table_record.relname AS table, attribute_record.attname AS column
      FROM pg_index index_record
      JOIN pg_class table_record ON table_record.oid = index_record.indrelid
      JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
      JOIN pg_attribute attribute_record
        ON attribute_record.attrelid = table_record.oid
       AND attribute_record.attnum = ANY(index_record.indkey)
      WHERE index_record.indisprimary
        AND array_length(index_record.indkey, 1) = 1
        AND namespace_record.nspname = 'public'
    `),
    client.query<{
      table_name: string;
      column_name: string;
      is_nullable: "YES" | "NO";
      is_generated: "ALWAYS" | "NEVER";
      data_type: string;
    }>(`
      SELECT table_name, column_name, is_nullable, is_generated, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `),
  ]);

  const primaryKeys = new Map(primaryKeysResult.rows.map((row) => [row.table, row.column]));
  const nullableColumns = new Set(
    columnsResult.rows
      .filter((row) => row.is_nullable === "YES")
      .map((row) => `${row.table_name}.${row.column_name}`),
  );
  const jsonColumns = new Set(
    columnsResult.rows
      .filter((row) => row.data_type === "json" || row.data_type === "jsonb")
      .map((row) => `${row.table_name}.${row.column_name}`),
  );
  const insertableColumns = new Map<string, string[]>();
  for (const column of columnsResult.rows) {
    if (column.is_generated === "ALWAYS") continue;
    const existing = insertableColumns.get(column.table_name) ?? [];
    existing.push(column.column_name);
    insertableColumns.set(column.table_name, existing);
  }
  return {
    foreignKeys: foreignKeysResult.rows,
    primaryKeys,
    nullableColumns,
    jsonColumns,
    insertableColumns,
  };
}

async function selectPromotionGraph(client: PoolClient): Promise<{
  rows: Map<string, SelectedRow>;
  metadata: Awaited<ReturnType<typeof loadMetadata>>;
}> {
  const metadata = await loadMetadata(client);
  const rows = new Map<string, SelectedRow>();
  const procedureTablesResult = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'procedimentoId'
    ORDER BY table_name
  `);

  const addRows = (table: string, candidates: Record<string, unknown>[]): void => {
    if (table === "User" || EXCLUDED_OPERATIONAL_TABLES.has(table)) return;
    const primaryKey = metadata.primaryKeys.get(table);
    if (!primaryKey) throw new Error(`PROMOTION_PRIMARY_KEY_UNSUPPORTED:${table}`);
    for (const row of candidates) {
      rows.set(rowKey(table, primaryKey, row), { table, row, primaryKey });
    }
  };

  const procedureResult = await client.query<Record<string, unknown>>(
    `SELECT * FROM "Procedimento" WHERE "id" = $1`,
    [PROCEDURE_ID],
  );
  if (procedureResult.rowCount !== 1) throw new Error("SELVARA_PROCEDURE_NOT_FOUND");
  addRows("Procedimento", procedureResult.rows);

  for (const entry of procedureTablesResult.rows) {
    if (EXCLUDED_OPERATIONAL_TABLES.has(entry.table_name)) continue;
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(entry.table_name)} WHERE "procedimentoId" = $1`,
      [PROCEDURE_ID],
    );
    addRows(entry.table_name, result.rows);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const selected of [...rows.values()]) {
      const foreignKeys = metadata.foreignKeys.filter((key) => key.childTable === selected.table);
      for (const foreignKey of foreignKeys) {
        if (foreignKey.parentTable === "User") {
          for (const column of foreignKey.childColumns) {
            if (selected.row[column] == null) continue;
            if (!metadata.nullableColumns.has(`${selected.table}.${column}`)) {
              throw new Error(`PROMOTION_REQUIRED_USER_REFERENCE:${selected.table}.${column}`);
            }
            selected.row[column] = null;
          }
          continue;
        }
        const values = foreignKey.childColumns.map((column) => selected.row[column]);
        if (values.some((value) => value == null)) continue;
        const predicates = foreignKey.parentColumns
          .map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`)
          .join(" AND ");
        const parentResult = await client.query<Record<string, unknown>>(
          `SELECT * FROM ${quoteIdentifier(foreignKey.parentTable)} WHERE ${predicates}`,
          values,
        );
        const previousSize = rows.size;
        addRows(foreignKey.parentTable, parentResult.rows);
        if (rows.size > previousSize) changed = true;
      }
    }
  }
  return { rows, metadata };
}

async function insertPromotionGraph(
  client: PoolClient,
  selectedRows: Map<string, SelectedRow>,
  metadata: Awaited<ReturnType<typeof loadMetadata>>,
): Promise<Map<string, number>> {
  const pending = [...selectedRows.values()];
  const inserted = new Map<string, number>();
  const blockedReasons = new Map<string, Set<string>>();
  const restorations = new Map<string, {
    table: string;
    primaryKey: string;
    primaryValue: unknown;
    values: Map<string, unknown>;
  }>();
  let pass = 0;
  while (pending.length > 0) {
    pass += 1;
    blockedReasons.clear();
    let progress = 0;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const selected = pending[index];
      const columns = metadata.insertableColumns.get(selected.table) ?? [];
      const insertRow = { ...selected.row };
      for (const column of columns) {
        if (
          column.toLowerCase().endsWith("userid")
          && metadata.nullableColumns.has(`${selected.table}.${column}`)
        ) {
          insertRow[column] = null;
        }
      }
      for (const column of EXCLUDED_REFERENCE_COLUMNS.get(selected.table) ?? []) {
        if (!metadata.nullableColumns.has(`${selected.table}.${column}`)) {
          throw new Error(`PROMOTION_REQUIRED_EXCLUDED_REFERENCE:${selected.table}.${column}`);
        }
        insertRow[column] = null;
      }
      for (const foreignKey of metadata.foreignKeys.filter(
        (key) => (
          key.childTable === selected.table
          && key.parentTable !== "User"
          && !EXCLUDED_OPERATIONAL_TABLES.has(key.parentTable)
        ),
      )) {
        for (const column of foreignKey.childColumns) {
          if (
            insertRow[column] == null
            || !metadata.nullableColumns.has(`${selected.table}.${column}`)
          ) {
            continue;
          }
          const key = rowKey(selected.table, selected.primaryKey, selected.row);
          const restoration = restorations.get(key) ?? {
            table: selected.table,
            primaryKey: selected.primaryKey,
            primaryValue: selected.row[selected.primaryKey],
            values: new Map<string, unknown>(),
          };
          restoration.values.set(column, insertRow[column]);
          restorations.set(key, restoration);
          insertRow[column] = null;
        }
      }
      const values = columns.map((column) => {
        const value = insertRow[column];
        return value != null && metadata.jsonColumns.has(`${selected.table}.${column}`)
          ? JSON.stringify(value)
          : value;
      });
      const placeholders = columns.map((_column, valueIndex) => `$${valueIndex + 1}`);
      await client.query("SAVEPOINT promotion_row");
      try {
        const result = await client.query(
          `INSERT INTO ${quoteIdentifier(selected.table)}
           (${columns.map(quoteIdentifier).join(", ")})
           VALUES (${placeholders.join(", ")})
           ON CONFLICT DO NOTHING`,
          values,
        );
        await client.query("RELEASE SAVEPOINT promotion_row");
        inserted.set(selected.table, (inserted.get(selected.table) ?? 0) + (result.rowCount ?? 0));
        pending.splice(index, 1);
        progress += 1;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT promotion_row");
        const databaseError = error as {
          code?: unknown;
          constraint?: unknown;
          where?: unknown;
        };
        const parameterMatch = typeof databaseError.where === "string"
          ? databaseError.where.match(/parameter \$(\d+)/)
          : null;
        const parameterIndex = parameterMatch ? Number(parameterMatch[1]) - 1 : -1;
        const column = parameterIndex >= 0 ? columns[parameterIndex] : undefined;
        const reason = [
          typeof databaseError.code === "string" ? databaseError.code : "UNKNOWN",
          typeof databaseError.constraint === "string" ? databaseError.constraint : "NO_CONSTRAINT",
          column ?? "NO_COLUMN",
        ].join(":");
        const reasons = blockedReasons.get(selected.table) ?? new Set<string>();
        reasons.add(reason);
        blockedReasons.set(selected.table, reasons);
      }
    }
    if (progress === 0 || pass > selectedRows.size + 1) {
      const blockedTables = [...new Set(pending.map((row) => row.table))].sort();
      throw new Error(`PROMOTION_FOREIGN_KEY_BLOCKED:${JSON.stringify(
        blockedTables.map((table) => ({
          table,
          reasons: [...(blockedReasons.get(table) ?? [])].sort(),
        })),
      )}`);
    }
  }
  for (const restoration of restorations.values()) {
    const entries = [...restoration.values.entries()];
    if (entries.length === 0) continue;
    const assignments = entries.map(
      ([column], index) => `${quoteIdentifier(column)} = $${index + 1}`,
    );
    await client.query(
      `UPDATE ${quoteIdentifier(restoration.table)}
       SET ${assignments.join(", ")}
       WHERE ${quoteIdentifier(restoration.primaryKey)} = $${entries.length + 1}`,
      [...entries.map(([, value]) => value), restoration.primaryValue],
    );
  }
  return inserted;
}

async function main(): Promise<void> {
  const targetUrl = process.env.NOETRA_PRODUCTION_CANDIDATE_DATABASE_URL;
  if (
    process.env.VERCEL_ENV !== "preview"
    || process.env.NOETRA_PRODUCTION_PROMOTION_APPROVAL !== APPROVAL
    || !process.env.DATABASE_URL
    || !targetUrl
  ) {
    throw new Error("SELVARA_PROMOTION_SCOPE_MISMATCH");
  }
  if (new URL(process.env.DATABASE_URL).host === new URL(targetUrl).host) {
    throw new Error("SELVARA_PROMOTION_DATABASES_NOT_ISOLATED");
  }

  const sourcePool = new Pool({ connectionString: process.env.DATABASE_URL });
  const targetPool = new Pool({ connectionString: targetUrl });
  const source = await sourcePool.connect();
  const target = await targetPool.connect();
  try {
    await source.query("BEGIN READ ONLY");
    await target.query("BEGIN");
    const { rows, metadata } = await selectPromotionGraph(source);
    const inserted = await insertPromotionGraph(target, rows, metadata);
    const verification = await target.query<{
      currentRevisions: number;
      currentReports: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM "FascicoloKnowledgeRevision"
         WHERE "procedimentoId" = $1 AND "status" = 'CURRENT') AS "currentRevisions",
        (SELECT COUNT(*)::int FROM "StructuredFascicoloReportSnapshot"
         WHERE "procedimentoId" = $1 AND "status" = 'CURRENT') AS "currentReports"
    `, [PROCEDURE_ID]);
    if (
      verification.rows[0].currentRevisions < 1
      || verification.rows[0].currentReports < 1
    ) {
      throw new Error("SELVARA_PROMOTION_VERIFICATION_FAILED");
    }
    await target.query("COMMIT");
    await source.query("COMMIT");
    const summary = [...inserted.entries()]
      .filter(([, count]) => count > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([table, count]) => ({ table, count }));
    console.info(`NOETRA_SELVARA_PROMOTION=${JSON.stringify({
      procedureId: PROCEDURE_ID,
      selectedRows: rows.size,
      inserted: summary,
      currentRevisions: verification.rows[0].currentRevisions,
      currentReports: verification.rows[0].currentReports,
      fingerprint: createHash("sha256").update(JSON.stringify(summary)).digest("hex"),
    })}`);
  } catch (error) {
    await source.query("ROLLBACK").catch(() => undefined);
    await target.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    source.release();
    target.release();
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "SELVARA_PROMOTION_FAILED");
  process.exitCode = 1;
});
