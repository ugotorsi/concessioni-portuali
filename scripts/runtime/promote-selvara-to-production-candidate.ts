import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";

interface PromotionScope {
  procedureId: string;
  approval: string;
  // Research data is keyed by caseId/missionId (not foreign keys to Procedimento) and must be followed explicitly.
  includeResearchAndChildren: boolean;
  requiredEnteCodePrefix?: string;
  // Knowledge evidence of document-extraction provenance requires its extraction attempt and pages.
  includeDocumentExtraction?: boolean;
}

const PROMOTION_SCOPES: Record<string, PromotionScope> = {
  SELVARA: {
    procedureId: "procedimento-intake-9e04f4d4cdbf092845b57c66",
    approval: "NOETRA-V7-PRODUCTION-SELVARA-PROMOTION-2026-10-29",
    includeResearchAndChildren: false,
  },
  DEMO_CP058_2019: {
    procedureId: "cmvxr3st5003920udtvom8ebv",
    approval: "NOETRA-V7-PRODUCTION-DEMO-CP058-2019-PRESERVATION",
    includeResearchAndChildren: true,
    requiredEnteCodePrefix: "DEMO-",
    includeDocumentExtraction: true,
  },
};
const SCOPE_NAME = process.env.NOETRA_PROMOTION_SCOPE ?? "SELVARA";
const SCOPE: PromotionScope | undefined = PROMOTION_SCOPES[SCOPE_NAME];
const PROCEDURE_ID = SCOPE?.procedureId ?? "";
const APPROVAL = SCOPE?.approval ?? "";
const RESEARCH_CHILD_TABLES = new Set([
  "DocumentExtractionPage",
  "DocumentFileVersion",
  "FascicoloKnowledgeIdentity",
  "ResearchAdverseRequirement",
  "ResearchAssistedVerificationRecord",
  "ResearchEvidenceBundleRecord",
  "ResearchExecutionAttempt",
  "ResearchQuestionResultRecord",
  "ResearchSourceAssessmentRecord",
  "TechnicalSourceResearchRecord",
]);
const EXCLUDED_OPERATIONAL_TABLES = new Set([
  "AsyncJob",
  ...(SCOPE?.includeDocumentExtraction ? [] : ["DocumentExtractionAttempt", "DocumentExtractionPage"]),
  "DocumentOcrRun",
  "RuntimeBudgetPolicy",
  "RuntimeCostReservation",
]);
const EXCLUDED_REFERENCE_COLUMNS = new Map(SCOPE?.includeDocumentExtraction ? [] : [
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
      const key = rowKey(table, primaryKey, row);
      // Keep the first selected copy so user references already cleared are not restored by a later lookup.
      if (!rows.has(key)) rows.set(key, { table, row, primaryKey });
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

  if (SCOPE?.includeResearchAndChildren) {
    const caseTablesResult = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'caseId'
      ORDER BY table_name
    `);
    for (const entry of caseTablesResult.rows) {
      if (EXCLUDED_OPERATIONAL_TABLES.has(entry.table_name)) continue;
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdentifier(entry.table_name)} WHERE "caseId" = $1`,
        [PROCEDURE_ID],
      );
      addRows(entry.table_name, result.rows);
    }
    const missionIds = [...rows.values()]
      .filter((selected) => selected.table === "ResearchMissionRecord")
      .map((selected) => selected.row.id);
    const missionTablesResult = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'missionId'
      ORDER BY table_name
    `);
    for (const entry of missionTablesResult.rows) {
      if (!RESEARCH_CHILD_TABLES.has(entry.table_name) || missionIds.length === 0) continue;
      const result = await client.query<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdentifier(entry.table_name)} WHERE "missionId" = ANY($1)`,
        [missionIds],
      );
      addRows(entry.table_name, result.rows);
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const foreignKey of metadata.foreignKeys) {
        if (!RESEARCH_CHILD_TABLES.has(foreignKey.childTable) || foreignKey.childColumns.length !== 1) continue;
        const parentValues = [...rows.values()]
          .filter((selected) => selected.table === foreignKey.parentTable)
          .map((selected) => selected.row[foreignKey.parentColumns[0]])
          .filter((value) => value != null);
        if (parentValues.length === 0) continue;
        const result = await client.query<Record<string, unknown>>(
          `SELECT * FROM ${quoteIdentifier(foreignKey.childTable)}
           WHERE ${quoteIdentifier(foreignKey.childColumns[0])} = ANY($1)`,
          [parentValues],
        );
        const previousSize = rows.size;
        addRows(foreignKey.childTable, result.rows);
        if (rows.size > previousSize) grew = true;
      }
    }
  }
  let changed = true;
  const lookedUpParents = new Set<string>();
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
        const lookupKey = JSON.stringify([foreignKey.parentTable, foreignKey.parentColumns, values]);
        if (lookedUpParents.has(lookupKey)) continue;
        lookedUpParents.add(lookupKey);
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
  // Strict passes keep every reference; only when they stall is one relaxed pass allowed to defer nullable
  // references (restored afterwards) to break reference cycles. Deferring eagerly breaks composite keys and checks.
  let relaxed = false;
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
          relaxed
          && key.childTable === selected.table
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
    if (progress === 0 && !relaxed) {
      relaxed = true;
      continue;
    }
    relaxed = false;
    await applyRestorations(client, restorations, false);
    if (progress === 0 || pass > 2 * selectedRows.size + 2) {
      const blockedTables = [...new Set(pending.map((row) => row.table))].sort();
      throw new Error(`PROMOTION_FOREIGN_KEY_BLOCKED:${JSON.stringify(
        blockedTables.map((table) => ({
          table,
          reasons: [...(blockedReasons.get(table) ?? [])].sort(),
        })),
      )}`);
    }
  }
  await applyRestorations(client, restorations, true);
  return inserted;
}

// Restores deferred references as soon as their parents exist, so later rows can satisfy composite keys.
async function applyRestorations(
  client: PoolClient,
  restorations: Map<string, { table: string; primaryKey: string; primaryValue: unknown; values: Map<string, unknown> }>,
  required: boolean,
): Promise<void> {
  for (const [key, restoration] of [...restorations.entries()]) {
    const entries = [...restoration.values.entries()];
    if (entries.length === 0) {
      restorations.delete(key);
      continue;
    }
    const assignments = entries.map(
      ([column], index) => `${quoteIdentifier(column)} = $${index + 1}`,
    );
    const statement = `UPDATE ${quoteIdentifier(restoration.table)}
       SET ${assignments.join(", ")}
       WHERE ${quoteIdentifier(restoration.primaryKey)} = $${entries.length + 1}`;
    const parameters = [...entries.map(([, value]) => value), restoration.primaryValue];
    if (required) {
      await client.query(statement, parameters);
      restorations.delete(key);
      continue;
    }
    await client.query("SAVEPOINT promotion_restore");
    try {
      const result = await client.query(statement, parameters);
      await client.query("RELEASE SAVEPOINT promotion_restore");
      if ((result.rowCount ?? 0) > 0) restorations.delete(key);
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT promotion_restore");
    }
  }
}

async function assertDemoScope(client: PoolClient): Promise<void> {
  if (!SCOPE?.requiredEnteCodePrefix) return;
  const result = await client.query<{ codice: string | null }>(
    `SELECT e."codice" FROM "Procedimento" p JOIN "Ente" e ON e."id" = p."enteId" WHERE p."id" = $1`,
    [PROCEDURE_ID],
  );
  if (!result.rows[0]?.codice?.startsWith(SCOPE.requiredEnteCodePrefix)) {
    throw new Error("DEMO_PROMOTION_ENTE_NOT_MARKED_DEMO");
  }
}

async function remapExistingDemoTenant(
  client: PoolClient,
  rows: Map<string, SelectedRow>,
): Promise<{ sourceTenantId: string; targetTenantId: string } | null> {
  if (!SCOPE?.requiredEnteCodePrefix) return null;
  const sourceTenants = [...rows.values()].filter(
    (selected) => (
      selected.table === "Ente"
      && typeof selected.row.id === "string"
      && typeof selected.row.codice === "string"
      && selected.row.codice.startsWith(SCOPE.requiredEnteCodePrefix ?? "")
    ),
  );
  if (sourceTenants.length !== 1) {
    throw new Error("DEMO_PROMOTION_SOURCE_TENANT_INVALID");
  }
  const sourceTenantId = sourceTenants[0].row.id as string;
  const code = sourceTenants[0].row.codice as string;
  const existing = await client.query<{ id: string }>(
    `SELECT "id" FROM "Ente" WHERE "codice" = $1`,
    [code],
  );
  if (existing.rows.length === 0 || existing.rows[0].id === sourceTenantId) return null;
  const targetTenantId = existing.rows[0].id;
  for (const selected of rows.values()) {
    for (const [column, value] of Object.entries(selected.row)) {
      if (value === sourceTenantId) selected.row[column] = targetTenantId;
    }
  }
  return { sourceTenantId, targetTenantId };
}

const DEMO_EMAIL_DOMAINS = /\.(demo|local|example|invalid|test)$/i;

function promotionInventory(rows: Map<string, SelectedRow>) {
  const tables = new Map<string, number>();
  const nonDemoEmailDomains = new Set<string>();
  const storageObjects: { bucket: unknown; key: unknown }[] = [];
  for (const selected of rows.values()) {
    tables.set(selected.table, (tables.get(selected.table) ?? 0) + 1);
    for (const match of JSON.stringify(selected.row).matchAll(/(?:^|[^\w.+@-])[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) {
      if (!DEMO_EMAIL_DOMAINS.test(match[1])) nonDemoEmailDomains.add(match[1].toLowerCase());
    }
    if (selected.row.storageKey) {
      storageObjects.push({ bucket: selected.row.storageBucket, key: selected.row.storageKey });
    }
  }
  return {
    tables: [...tables.entries()].sort(([left], [right]) => left.localeCompare(right)),
    nonDemoEmailDomains: [...nonDemoEmailDomains].sort(),
    storageObjects,
  };
}

async function main(): Promise<void> {
  if (!SCOPE) throw new Error("PROMOTION_SCOPE_UNKNOWN");
  if (process.env.NOETRA_PROMOTION_DRY_RUN === "true") {
    if (!process.env.DATABASE_URL) throw new Error("PROMOTION_DRY_RUN_SOURCE_MISSING");
    const dryRunPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await dryRunPool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = 0");
      await assertDemoScope(client);
      const { rows } = await selectPromotionGraph(client);
      console.info(`NOETRA_PROMOTION_DRY_RUN=${JSON.stringify({
        scope: SCOPE_NAME,
        procedureId: PROCEDURE_ID,
        selectedRows: rows.size,
        ...promotionInventory(rows),
      })}`);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      await dryRunPool.end();
    }
    return;
  }
  const targetUrl = process.env.NOETRA_PRODUCTION_CANDIDATE_DATABASE_URL;
  const targetStorageBucket = process.env.NOETRA_PRODUCTION_STORAGE_BUCKET?.trim();
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
  if (
    SCOPE.requiredEnteCodePrefix
    && (!targetStorageBucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(targetStorageBucket))
  ) {
    throw new Error("DEMO_PROMOTION_TARGET_STORAGE_BUCKET_REQUIRED");
  }

  const sourcePool = new Pool({ connectionString: process.env.DATABASE_URL });
  const targetPool = new Pool({ connectionString: targetUrl });
  const source = await sourcePool.connect();
  const target = await targetPool.connect();
  try {
    await source.query("BEGIN READ ONLY");
    await source.query("SET LOCAL idle_in_transaction_session_timeout = 0");
    await target.query("BEGIN");
    await assertDemoScope(source);
    const { rows, metadata } = await selectPromotionGraph(source);
    if (SCOPE.requiredEnteCodePrefix && promotionInventory(rows).nonDemoEmailDomains.length > 0) {
      throw new Error("DEMO_PROMOTION_NON_DEMO_PERSONAL_DATA");
    }
    const tenantRemapping = await remapExistingDemoTenant(target, rows);
    if (targetStorageBucket) {
      for (const selected of rows.values()) {
        if (selected.row.storageKey && selected.row.storageBucket) {
          selected.row.storageBucket = targetStorageBucket;
        }
      }
    }
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
      tenantRemapping,
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
