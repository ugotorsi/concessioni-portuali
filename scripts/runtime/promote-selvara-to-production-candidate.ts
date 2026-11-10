import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

import {
  verifyAuditHashLinks,
  verifyHistoricalAuditHashRecords,
  type AuditHashRecord,
} from "../../src/server/audit/hash";
import { databaseIdentityFingerprint } from "../../src/server/release/previewIsolation";
import {
  classifyLegacyDocumentExtractionRetries,
  planReconciliation,
  ReconciliationPlanError,
  referenceIdentity,
  type ReconciliationPlan,
  type ReconciliationRow,
} from "../../src/server/release/reconciliationPlanner";

interface PromotionScope {
  procedureIds: readonly string[];
  approval: string;
  // Research data is keyed by caseId/missionId (not foreign keys to Procedimento) and must be followed explicitly.
  includeResearchAndChildren: boolean;
  requiredEnteCodePrefix?: string;
  // Knowledge evidence of document-extraction provenance requires its extraction attempt and pages.
  includeDocumentExtraction?: boolean;
  mapExistingConcession?: boolean;
  preserveUserReferences?: boolean;
  archiveHistoricalActivityLog?: boolean;
  allowProductionPersonalData?: boolean;
}

const PROMOTION_SCOPES: Record<string, PromotionScope> = {
  SELVARA: {
    procedureIds: ["procedimento-intake-9e04f4d4cdbf092845b57c66"],
    approval: "NOETRA-V7-PRODUCTION-SELVARA-PROMOTION-2026-10-29",
    includeResearchAndChildren: false,
  },
  DEMO_CP058_2019: {
    procedureIds: ["cmvxr3st5003920udtvom8ebv"],
    approval: "NOETRA-V7-PRODUCTION-DEMO-CP058-2019-PRESERVATION",
    includeResearchAndChildren: true,
    requiredEnteCodePrefix: "DEMO-",
    includeDocumentExtraction: true,
  },
  UNIFY_CP058_2019: {
    procedureIds: [
      "cmvxr3st5003920udtvom8ebv",
      "procedimento-intake-9e04f4d4cdbf092845b57c66",
    ],
    approval: "NOETRA-PRODUCTION-DATABASE-UNIFICATION-CP058-2019",
    includeResearchAndChildren: true,
    requiredEnteCodePrefix: "DEMO-",
    includeDocumentExtraction: true,
    mapExistingConcession: true,
    preserveUserReferences: true,
    archiveHistoricalActivityLog: true,
    allowProductionPersonalData: true,
  },
};
const SCOPE_NAME = process.env.NOETRA_PROMOTION_SCOPE ?? "SELVARA";
const SCOPE: PromotionScope | undefined = PROMOTION_SCOPES[SCOPE_NAME];
const PROCEDURE_IDS = SCOPE?.procedureIds ?? [];
const APPROVAL = SCOPE?.approval ?? "";
const ALLOWED_LEGACY_EXTRACTION_RETRIES = new Set([
  "fca5ad8f-14c0-49b0-8dc1-7b3ea0da1f4e\0"
  + "8d06ceb3-4d68-4142-ac5b-be0e239f877b",
]);
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
interface ForeignKey {
  constraintName: string;
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
        constraint_record.conname AS "constraintName",
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
    `SELECT * FROM "Procedimento" WHERE "id" = ANY($1)`,
    [PROCEDURE_IDS],
  );
  if (procedureResult.rowCount !== PROCEDURE_IDS.length) {
    throw new Error("SELVARA_PROCEDURE_NOT_FOUND");
  }
  addRows("Procedimento", procedureResult.rows);

  for (const entry of procedureTablesResult.rows) {
    if (EXCLUDED_OPERATIONAL_TABLES.has(entry.table_name)) continue;
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(entry.table_name)} WHERE "procedimentoId" = ANY($1)`,
      [PROCEDURE_IDS],
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
        `SELECT * FROM ${quoteIdentifier(entry.table_name)} WHERE "caseId" = ANY($1)`,
        [PROCEDURE_IDS],
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
          if (SCOPE?.preserveUserReferences) continue;
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

async function resolveExternalReferences(
  client: PoolClient,
  selectedRows: Map<string, SelectedRow>,
  metadata: Awaited<ReturnType<typeof loadMetadata>>,
): Promise<Set<string>> {
  const available = new Set<string>();
  const batchSize = 100;
  for (const foreignKey of metadata.foreignKeys) {
    const tuples = new Map<string, unknown[]>();
    for (const selected of selectedRows.values()) {
      if (selected.table !== foreignKey.childTable) continue;
      const values = foreignKey.childColumns.map((column) => selected.row[column]);
      if (values.some((value) => value == null)) continue;
      tuples.set(JSON.stringify(values), values);
    }
    const values = [...tuples.values()];
    for (let offset = 0; offset < values.length; offset += batchSize) {
      const batch = values.slice(offset, offset + batchSize);
      const parameters: unknown[] = [];
      const tupleSql = batch.map((tuple) => {
        const placeholders = tuple.map((value) => {
          parameters.push(value);
          return `$${parameters.length}`;
        });
        return `(${placeholders.join(", ")})`;
      });
      const columns = foreignKey.parentColumns.map(quoteIdentifier);
      const result = await client.query<Record<string, unknown>>(
        `SELECT ${columns.join(", ")}
         FROM ${quoteIdentifier(foreignKey.parentTable)}
         WHERE (${columns.join(", ")}) IN (${tupleSql.join(", ")})`,
        parameters,
      );
      for (const row of result.rows) {
        const parentValues = foreignKey.parentColumns.map((column) => row[column]);
        available.add(referenceIdentity(
          foreignKey.parentTable,
          foreignKey.parentColumns,
          parentValues,
        ));
      }
    }
  }
  return available;
}

function reconciliationRows(selectedRows: Map<string, SelectedRow>): ReconciliationRow[] {
  return [...selectedRows.entries()].map(([key, selected]) => ({
    key,
    table: selected.table,
    primaryKey: selected.primaryKey,
    row: selected.row,
  }));
}

function assertWithinDeadline(deadline: number): void {
  if (Date.now() > deadline) throw new Error("RECONCILIATION_RUNTIME_TIMEOUT");
}

function comparableRow(
  row: Record<string, unknown>,
  columns: readonly string[],
): string {
  return JSON.stringify(Object.fromEntries(columns.map((column) => [column, row[column]])));
}

async function assertLegacyRetryTriggerEnabled(client: PoolClient): Promise<void> {
  const result = await client.query<{ enabled: boolean }>(`
    SELECT trigger.tgenabled = 'O' AS enabled
    FROM pg_trigger trigger
    JOIN pg_class table_class ON table_class.oid = trigger.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
    WHERE namespace.nspname = 'public'
      AND table_class.relname = 'DocumentExtractionAttempt'
      AND trigger.tgname = 'document_extraction_attempt_validate_retry'
      AND NOT trigger.tgisinternal
  `);
  if (result.rows.length !== 1 || result.rows[0].enabled !== true) {
    throw new Error("RECONCILIATION_LEGACY_RETRY_TRIGGER_NOT_ENABLED");
  }
}

async function insertReconciliationPlan(
  client: PoolClient,
  plan: ReconciliationPlan,
  metadata: Awaited<ReturnType<typeof loadMetadata>>,
  deadline: number,
): Promise<{
  inserted: Map<string, number>;
  legacyRetryTriggerBypasses: number;
}> {
  const inserted = new Map<string, number>();
  const legacyRetryRows = classifyLegacyDocumentExtractionRetries(
    plan.layers.flatMap((layer) => layer.rows),
    ALLOWED_LEGACY_EXTRACTION_RETRIES,
  );
  await assertLegacyRetryTriggerEnabled(client);
  console.info(`NOETRA_RECONCILIATION_LEGACY_RETRIES=${JSON.stringify({
    rows: legacyRetryRows.size,
    preservedFields: ["retryOfAttemptId", "retryAuthorizationId"],
    bypassedTrigger: "document_extraction_attempt_validate_retry",
  })}`);
  let processed = 0;
  const total = plan.layers.reduce((sum, layer) => sum + layer.rows.length, 0);
  for (const layer of plan.layers) {
    assertWithinDeadline(deadline);
    const byTable = new Map<string, ReconciliationRow[]>();
    for (const row of layer.rows) {
      byTable.set(row.table, [...(byTable.get(row.table) ?? []), row]);
    }
    for (const [table, tableRows] of [...byTable.entries()].sort(([left], [right]) => (
      left.localeCompare(right)
    ))) {
      const columns = metadata.insertableColumns.get(table) ?? [];
      if (columns.length === 0) throw new Error(`RECONCILIATION_COLUMNS_MISSING:${table}`);
      const rowGroups = table === "DocumentExtractionAttempt"
        ? [
            tableRows.filter((row) => !legacyRetryRows.has(row.key)),
            tableRows.filter((row) => legacyRetryRows.has(row.key)),
          ].filter((rows) => rows.length > 0)
        : [tableRows];
      for (const rowGroup of rowGroups) {
      for (let offset = 0; offset < rowGroup.length; offset += 100) {
        assertWithinDeadline(deadline);
        const batch = rowGroup.slice(offset, offset + 100);
        const bypassLegacyRetryPolicy = batch.some((row) => legacyRetryRows.has(row.key));
        const parameters: unknown[] = [];
        const rowsSql = batch.map((selected) => {
          const placeholders = columns.map((column) => {
            const value = selected.row[column];
            parameters.push(
              value != null && metadata.jsonColumns.has(`${table}.${column}`)
                ? JSON.stringify(value)
                : value,
            );
            return `$${parameters.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        let result;
        try {
          if (bypassLegacyRetryPolicy) {
            await client.query(`
              ALTER TABLE "DocumentExtractionAttempt"
              DISABLE TRIGGER "document_extraction_attempt_validate_retry"
            `);
          }
          result = await client.query<Record<string, unknown>>(
            `INSERT INTO ${quoteIdentifier(table)}
             (${columns.map(quoteIdentifier).join(", ")})
             VALUES ${rowsSql.join(", ")}
             ON CONFLICT DO NOTHING
             RETURNING ${quoteIdentifier(batch[0].primaryKey)}`,
            parameters,
          );
          if (bypassLegacyRetryPolicy) {
            await client.query(`
              ALTER TABLE "DocumentExtractionAttempt"
              ENABLE TRIGGER "document_extraction_attempt_validate_retry"
            `);
            await assertLegacyRetryTriggerEnabled(client);
          }
        } catch (error) {
          const databaseError = error as {
            code?: string;
            constraint?: string;
            detail?: string;
            message?: string;
          };
          throw new Error(`RECONCILIATION_BATCH_INSERT_FAILED:${JSON.stringify({
            layer: layer.index,
            table,
            rows: batch.length,
            code: databaseError.code ?? "UNKNOWN",
            constraint: databaseError.constraint ?? null,
            detail: databaseError.detail ?? null,
            message: databaseError.message ?? "UNKNOWN",
          })}`);
        }
        const returned = new Set(result.rows.map((row) => String(row[batch[0].primaryKey])));
        for (const selected of batch) {
          const primaryValue = selected.row[selected.primaryKey];
          if (returned.has(String(primaryValue))) continue;
          const existing = await client.query<Record<string, unknown>>(
            `SELECT ${columns.map(quoteIdentifier).join(", ")}
             FROM ${quoteIdentifier(table)}
             WHERE ${quoteIdentifier(selected.primaryKey)} = $1`,
            [primaryValue],
          );
          if (
            existing.rows.length !== 1
            || comparableRow(existing.rows[0], columns) !== comparableRow(selected.row, columns)
          ) {
            throw new Error(`RECONCILIATION_CONFLICT_MISMATCH:${table}:${String(primaryValue)}`);
          }
        }
        inserted.set(table, (inserted.get(table) ?? 0) + result.rows.length);
        processed += batch.length;
      }
      }
    }
    console.info(`NOETRA_RECONCILIATION_PROGRESS=${JSON.stringify({
      layer: layer.index + 1,
      layers: plan.layers.length,
      processed,
      remaining: total - processed,
      tables: [...byTable.entries()]
        .map(([table, rows]) => ({ table, rows: rows.length }))
        .sort((left, right) => left.table.localeCompare(right.table)),
      atomicSameTableCycle: layer.atomicSameTableCycle,
    })}`);
  }
  for (const deferred of plan.deferredReferences) {
    assertWithinDeadline(deadline);
    const assignments = deferred.values.map(
      (value, index) => `${quoteIdentifier(value.column)} = $${index + 1}`,
    );
    try {
      const result = await client.query(
        `UPDATE ${quoteIdentifier(deferred.table)}
         SET ${assignments.join(", ")}
         WHERE ${quoteIdentifier(deferred.primaryKey)} = $${deferred.values.length + 1}`,
        [...deferred.values.map((value) => value.value), deferred.primaryValue],
      );
      if (result.rowCount !== 1) {
        throw new Error("ROW_NOT_FOUND");
      }
    } catch (error) {
      const databaseError = error as {
        code?: string;
        constraint?: string;
        detail?: string;
        message?: string;
      };
      throw new Error(`RECONCILIATION_DEFERRED_REFERENCE_FAILED:${JSON.stringify({
        table: deferred.table,
        constraint: deferred.constraintName,
        code: databaseError.code ?? "UNKNOWN",
        databaseConstraint: databaseError.constraint ?? null,
        detail: databaseError.detail ?? null,
        message: databaseError.message ?? "UNKNOWN",
      })}`);
    }
  }
  return {
    inserted,
    legacyRetryTriggerBypasses: legacyRetryRows.size,
  };
}

/*
 * The old retry-per-row importer intentionally no longer exists. Planning must
 * complete before the first INSERT, and execution follows the finite plan only.
 */
async function buildReconciliationPlan(
  client: PoolClient,
  selectedRows: Map<string, SelectedRow>,
  metadata: Awaited<ReturnType<typeof loadMetadata>>,
): Promise<ReconciliationPlan> {
  const availableExternalReferences = await resolveExternalReferences(
    client,
    selectedRows,
    metadata,
  );
  try {
    return planReconciliation({
      rows: reconciliationRows(selectedRows),
      foreignKeys: metadata.foreignKeys,
      nullableColumns: metadata.nullableColumns,
      availableExternalReferences,
      coordinatedNullableConstraints: new Set([
        "DocumentExtractionAttempt_retryOfAttemptId_fkey",
      ]),
      maxIterations: selectedRows.size + metadata.foreignKeys.length + 1,
    });
  } catch (error) {
    if (error instanceof ReconciliationPlanError) {
      throw new Error(`${error.message}:${JSON.stringify(error.diagnostics)}`);
    }
    throw error;
  }
}

async function insertPromotionGraph(
  client: PoolClient,
  selectedRows: Map<string, SelectedRow>,
  metadata: Awaited<ReturnType<typeof loadMetadata>>,
  deadline: number,
): Promise<{
  inserted: Map<string, number>;
  legacyRetryTriggerBypasses: number;
  plan: ReconciliationPlan;
}> {
  const plan = await buildReconciliationPlan(client, selectedRows, metadata);
  console.info(`NOETRA_RECONCILIATION_PLAN=${JSON.stringify({
    selectedRows: selectedRows.size,
    layers: plan.layers.length,
    dependencies: plan.dependencyCount,
    externalDependencies: plan.externalDependencyCount,
    deferredReferences: plan.deferredReferences.length,
    iterations: plan.iterationCount,
    rowsByLayer: plan.layers.map((layer) => layer.rows.length),
  })}`);
  const execution = await insertReconciliationPlan(client, plan, metadata, deadline);
  return {
    inserted: execution.inserted,
    legacyRetryTriggerBypasses: execution.legacyRetryTriggerBypasses,
    plan,
  };
}

function normalizeHistoricalConstraintDrift(rows: Map<string, SelectedRow>): {
  linkedFascicoloExtractionEvidence: number;
} {
  const attempts = [...rows.values()]
    .filter((selected) => selected.table === "DocumentExtractionAttempt")
    .map((selected) => selected.row);
  let linkedFascicoloExtractionEvidence = 0;
  for (const selected of rows.values()) {
    if (
      selected.table !== "FascicoloKnowledgeEvidence"
      || selected.row.provenanceType !== "FASCICOLO_DOCUMENT_EXTRACTION"
      || selected.row.documentExtractionAttemptId != null
    ) {
      continue;
    }
    const candidates = attempts.filter((attempt) => (
      attempt.documentFileVersionId === selected.row.documentFileVersionId
      && attempt.tenantId === selected.row.tenantId
      && attempt.procedimentoId === selected.row.procedimentoId
      && attempt.outcome === "SUCCEEDED"
    ));
    if (candidates.length !== 1 || selected.row.extractionAttemptId != null) {
      throw new Error("UNIFICATION_FASCICOLO_EXTRACTION_EVIDENCE_AMBIGUOUS");
    }
    selected.row.documentExtractionAttemptId = candidates[0].id;
    linkedFascicoloExtractionEvidence += 1;
  }
  return { linkedFascicoloExtractionEvidence };
}

async function assertDemoScope(client: PoolClient): Promise<void> {
  if (!SCOPE?.requiredEnteCodePrefix) return;
  const result = await client.query<{ codice: string | null }>(
    `SELECT DISTINCT e."codice"
     FROM "Procedimento" p
     JOIN "Ente" e ON e."id" = p."enteId"
     WHERE p."id" = ANY($1)`,
    [PROCEDURE_IDS],
  );
  if (
    result.rows.length !== 1
    || !result.rows[0]?.codice?.startsWith(SCOPE.requiredEnteCodePrefix)
  ) {
    throw new Error("DEMO_PROMOTION_ENTE_NOT_MARKED_DEMO");
  }
}

async function remapExistingConcession(
  client: PoolClient,
  rows: Map<string, SelectedRow>,
): Promise<{ sourceConcessionId: string; targetConcessionId: string } | null> {
  if (!SCOPE?.mapExistingConcession) return null;
  const sourceConcessions = [...rows.values()].filter(
    (selected) => selected.table === "Concessione",
  );
  if (sourceConcessions.length !== 1) throw new Error("UNIFICATION_SOURCE_CONCESSION_INVALID");
  const source = sourceConcessions[0];
  const sourceId = source.row.id;
  const enteId = source.row.enteId;
  const numeroAtto = source.row.numeroAtto;
  if (
    typeof sourceId !== "string"
    || typeof enteId !== "string"
    || typeof numeroAtto !== "string"
  ) {
    throw new Error("UNIFICATION_SOURCE_CONCESSION_IDENTITY_INVALID");
  }
  const sourceRowKey = rowKey(source.table, source.primaryKey, source.row);
  const target = await client.query<{ id: string }>(`
    SELECT "id"
    FROM "Concessione"
    WHERE "enteId" = $1
      AND lower(regexp_replace("numeroAtto", '\\s+', '', 'g'))
        = lower(regexp_replace($2, '\\s+', '', 'g'))
  `, [enteId, numeroAtto]);
  if (target.rows.length !== 1) throw new Error("UNIFICATION_TARGET_CONCESSION_NOT_UNIQUE");
  const targetId = target.rows[0].id;
  for (const selected of rows.values()) {
    for (const [column, value] of Object.entries(selected.row)) {
      if (value === sourceId) selected.row[column] = targetId;
    }
  }
  rows.delete(sourceRowKey);
  for (const selected of [...rows.values()]) {
    if (selected.table === "Concessionario") {
      rows.delete(rowKey(selected.table, selected.primaryKey, selected.row));
    }
  }
  return { sourceConcessionId: sourceId, targetConcessionId: targetId };
}

async function remapExistingUsers(
  source: PoolClient,
  target: PoolClient,
  rows: Map<string, SelectedRow>,
  metadata: Awaited<ReturnType<typeof loadMetadata>>,
): Promise<{ mappedReferences: number; mappedUsers: number }> {
  if (!SCOPE?.preserveUserReferences) return { mappedReferences: 0, mappedUsers: 0 };
  const mappings = new Map<string, string>();
  let mappedReferences = 0;
  for (const selected of rows.values()) {
    for (const foreignKey of metadata.foreignKeys.filter(
      (key) => key.childTable === selected.table && key.parentTable === "User",
    )) {
      if (foreignKey.childColumns.length !== 1 || foreignKey.parentColumns[0] !== "id") {
        throw new Error(`UNIFICATION_USER_REFERENCE_UNSUPPORTED:${selected.table}`);
      }
      const column = foreignKey.childColumns[0];
      const sourceUserId = selected.row[column];
      if (typeof sourceUserId !== "string") continue;
      let targetUserId = mappings.get(sourceUserId);
      if (!targetUserId) {
        const sourceUser = await source.query<{ email: string }>(
          `SELECT "email" FROM "User" WHERE "id" = $1`,
          [sourceUserId],
        );
        const email = sourceUser.rows[0]?.email;
        if (!email) throw new Error("UNIFICATION_SOURCE_USER_NOT_FOUND");
        const targetUser = await target.query<{ id: string }>(
          `SELECT "id" FROM "User" WHERE lower("email") = lower($1)`,
          [email],
        );
        if (targetUser.rows.length !== 1) throw new Error("UNIFICATION_TARGET_USER_NOT_UNIQUE");
        targetUserId = targetUser.rows[0].id;
        mappings.set(sourceUserId, targetUserId);
      }
      selected.row[column] = targetUserId;
      mappedReferences += 1;
    }
  }
  return { mappedReferences, mappedUsers: mappings.size };
}

async function archiveHistoricalActivityLog(
  source: PoolClient,
  target: PoolClient,
): Promise<{
  archiveId: string;
  recordCount: number;
  insertedRecords: number;
  finalHash: string;
  contentSha256: string;
  verificationMode: "FULL_PAYLOAD_HASH" | "CHAIN_LINKS_AND_CONTENT_SHA256";
  payloadHashVerifiedCount: number;
  payloadHashIssueCode: string | null;
  payloadHashIssueRecordId: string | null;
}> {
  if (!SCOPE?.archiveHistoricalActivityLog) {
    throw new Error("UNIFICATION_AUDIT_ARCHIVE_SCOPE_REQUIRED");
  }
  const archiveId = process.env.NOETRA_SOURCE_AUDIT_ARCHIVE_ID?.trim();
  const sourceProjectId = process.env.NOETRA_SOURCE_NEON_PROJECT_ID?.trim();
  const sourceBranchId = process.env.NOETRA_SOURCE_NEON_BRANCH_ID?.trim();
  const sourceBackupBranchId = process.env.NOETRA_SOURCE_BACKUP_BRANCH_ID?.trim();
  const sourceUrl = process.env.DATABASE_URL;
  if (!archiveId || !sourceProjectId || !sourceBranchId || !sourceBackupBranchId || !sourceUrl) {
    throw new Error("UNIFICATION_AUDIT_ARCHIVE_IDENTITY_REQUIRED");
  }
  const records = (await source.query<AuditHashRecord>(`
    SELECT
      "id", "createdAt", "userId", "userEmail", "userRole", "azione", "entita",
      "entitaId", "enteId", "concessioneId", "esito", "metadata", "previousHash", "currentHash"
    FROM "ActivityLog"
    ORDER BY "createdAt", "id"
  `)).rows;
  const verification = verifyHistoricalAuditHashRecords(records);
  const linkVerification = verifyAuditHashLinks(records);
  if (!linkVerification.valid || !linkVerification.finalHash) {
    throw new Error(`UNIFICATION_SOURCE_AUDIT_LINKS_INVALID:${linkVerification.issue?.code ?? "UNKNOWN"}`);
  }
  const finalHash = verification.valid && verification.finalHash
    ? verification.finalHash
    : linkVerification.finalHash;
  const verificationMode = verification.valid
    ? "FULL_PAYLOAD_HASH"
    : "CHAIN_LINKS_AND_CONTENT_SHA256";
  const payloads = records.map((record) => JSON.stringify(record));
  const contentSha256 = createHash("sha256").update(payloads.join("\n")).digest("hex");
  const archiveSchema = await target.query<{
    manifestExists: boolean;
    recordExists: boolean;
  }>(`
    SELECT
      to_regclass('public."HistoricalActivityLogArchiveManifest"') IS NOT NULL
        AS "manifestExists",
      to_regclass('public."HistoricalActivityLogArchiveRecord"') IS NOT NULL
        AS "recordExists"
  `);
  const { manifestExists, recordExists } = archiveSchema.rows[0];
  if (manifestExists !== recordExists) {
    throw new Error("UNIFICATION_AUDIT_ARCHIVE_SCHEMA_PARTIAL");
  }
  if (!manifestExists) {
    const migrationSql = readFileSync(resolve(
      process.cwd(),
      "prisma/migrations/20261110_historical_activity_log_archive/migration.sql",
    ), "utf8");
    await target.query(migrationSql);
  }
  const manifestResult = await target.query(`
    INSERT INTO "HistoricalActivityLogArchiveManifest" (
      "id", "sourceDatabaseFingerprint", "sourceProjectId", "sourceBranchId",
      "sourceBackupBranchId", "recordCount", "firstRecordId", "finalRecordId",
      "finalHash", "contentSha256", "verificationMode", "payloadHashVerifiedCount",
      "payloadHashIssueCode", "payloadHashIssueRecordId", "capturedAt"
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
    ON CONFLICT ("id") DO NOTHING
  `, [
    archiveId,
    databaseIdentityFingerprint(sourceUrl),
    sourceProjectId,
    sourceBranchId,
    sourceBackupBranchId,
    records.length,
    records[0]?.id ?? null,
    records.at(-1)?.id ?? null,
    finalHash,
    contentSha256,
    verificationMode,
    verification.verifiedCount,
    verification.issue?.code ?? null,
    verification.issue?.recordId ?? null,
  ]);
  if ((manifestResult.rowCount ?? 0) === 0) {
    const existing = await target.query<{
      recordCount: number;
      finalHash: string;
      contentSha256: string;
      verificationMode: string;
      payloadHashVerifiedCount: number;
      payloadHashIssueCode: string | null;
      payloadHashIssueRecordId: string | null;
    }>(`
      SELECT "recordCount", "finalHash", "contentSha256", "verificationMode",
             "payloadHashVerifiedCount", "payloadHashIssueCode", "payloadHashIssueRecordId"
      FROM "HistoricalActivityLogArchiveManifest"
      WHERE "id" = $1
    `, [archiveId]);
    const manifest = existing.rows[0];
    if (
      !manifest
      || manifest.recordCount !== records.length
      || manifest.finalHash !== finalHash
      || manifest.contentSha256 !== contentSha256
      || manifest.verificationMode !== verificationMode
      || manifest.payloadHashVerifiedCount !== verification.verifiedCount
      || manifest.payloadHashIssueCode !== (verification.issue?.code ?? null)
      || manifest.payloadHashIssueRecordId !== (verification.issue?.recordId ?? null)
    ) {
      throw new Error("UNIFICATION_AUDIT_ARCHIVE_CONFLICT");
    }
  }
  let insertedRecords = 0;
  for (let offset = 0; offset < records.length; offset += 100) {
    const batch = records.slice(offset, offset + 100);
    const parameters: unknown[] = [];
    const rowsSql = batch.map((record, index) => {
      const values = [
        archiveId,
        offset + index + 1,
        record.id,
        record.createdAt,
        record.previousHash,
        record.currentHash,
        payloads[offset + index],
      ];
      const placeholders = values.map((value, valueIndex) => {
        parameters.push(value);
        const parameter = `$${parameters.length}`;
        return valueIndex === 6 ? `${parameter}::jsonb` : parameter;
      });
      return `(${placeholders.join(", ")})`;
    });
    const result = await target.query(`
      INSERT INTO "HistoricalActivityLogArchiveRecord" (
        "archiveId", "ordinal", "originalId", "createdAt", "previousHash", "currentHash", "payload"
      ) VALUES ${rowsSql.join(", ")}
      ON CONFLICT DO NOTHING
    `, parameters);
    insertedRecords += result.rowCount ?? 0;
  }
  return {
    archiveId,
    recordCount: records.length,
    insertedRecords,
    finalHash,
    contentSha256,
    verificationMode,
    payloadHashVerifiedCount: verification.verifiedCount,
    payloadHashIssueCode: verification.issue?.code ?? null,
    payloadHashIssueRecordId: verification.issue?.recordId ?? null,
  };
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

async function targetActivityAnchor(client: PoolClient): Promise<{
  count: number;
  finalId: string | null;
  finalHash: string | null;
}> {
  return (await client.query<{
    count: number;
    finalId: string | null;
    finalHash: string | null;
  }>(`
    SELECT
      count(*)::int AS count,
      (array_agg("id" ORDER BY "createdAt" DESC, "id" DESC))[1] AS "finalId",
      (array_agg("currentHash" ORDER BY "createdAt" DESC, "id" DESC))[1] AS "finalHash"
    FROM "ActivityLog"
  `)).rows[0];
}

async function verifyReconciliationResult(input: {
  client: PoolClient;
  rows: Map<string, SelectedRow>;
  metadata: Awaited<ReturnType<typeof loadMetadata>>;
  concessionRemapping: { sourceConcessionId: string; targetConcessionId: string } | null;
  activityLogArchive: Awaited<ReturnType<typeof archiveHistoricalActivityLog>> | null;
  activityBefore: Awaited<ReturnType<typeof targetActivityAnchor>>;
  targetStorageBucket: string | undefined;
}): Promise<{
  verifiedRows: number;
  verifiedTables: number;
  normalizedDuplicateGroups: number;
  mappedProcedures: number;
  storageReferences: number;
  activityLogCount: number;
  archivedActivityLogCount: number;
}> {
  await input.client.query("SET CONSTRAINTS ALL IMMEDIATE");
  let verifiedRows = 0;
  let verifiedTables = 0;
  const rowsByTable = new Map<string, SelectedRow[]>();
  for (const selected of input.rows.values()) {
    rowsByTable.set(selected.table, [...(rowsByTable.get(selected.table) ?? []), selected]);
  }
  for (const [table, rows] of rowsByTable) {
    const primaryKey = input.metadata.primaryKeys.get(table);
    if (!primaryKey) throw new Error(`RECONCILIATION_VERIFY_PRIMARY_KEY_MISSING:${table}`);
    const ids = rows.map((row) => row.row[primaryKey]);
    const result = await input.client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM ${quoteIdentifier(table)}
       WHERE ${quoteIdentifier(primaryKey)} = ANY($1)`,
      [ids],
    );
    if (result.rows[0].count !== ids.length) {
      throw new Error(`RECONCILIATION_VERIFY_ROW_COUNT_MISMATCH:${table}`);
    }
    verifiedRows += ids.length;
    verifiedTables += 1;
  }
  const duplicateResult = await input.client.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM (
      SELECT 1
      FROM "Concessione"
      WHERE "enteId" IS NOT NULL
      GROUP BY "enteId", lower(regexp_replace("numeroAtto", '\\s+', '', 'g'))
      HAVING count(*) > 1
    ) duplicate_groups
  `);
  const normalizedDuplicateGroups = duplicateResult.rows[0].count;
  if (normalizedDuplicateGroups !== 0) {
    throw new Error("RECONCILIATION_VERIFY_NORMALIZED_CONCESSION_DUPLICATES");
  }
  let mappedProcedures = 0;
  if (input.concessionRemapping) {
    const result = await input.client.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM "Procedimento"
      WHERE "id" = ANY($1) AND "concessioneId" = $2
    `, [PROCEDURE_IDS, input.concessionRemapping.targetConcessionId]);
    mappedProcedures = result.rows[0].count;
    const expected = [...input.rows.values()].filter(
      (row) => row.table === "Procedimento" && row.row.concessioneId != null,
    ).length;
    if (mappedProcedures !== expected) {
      throw new Error("RECONCILIATION_VERIFY_PROCEDURE_CONCESSION_MAPPING");
    }
  }
  const evidenceIds = [...input.rows.values()]
    .filter((row) => row.table === "FascicoloKnowledgeEvidence")
    .map((row) => row.row.id);
  const invalidEvidence = await input.client.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM "FascicoloKnowledgeEvidence"
    WHERE "id" = ANY($1)
      AND "provenanceType" = 'FASCICOLO_DOCUMENT_EXTRACTION'
      AND (
        "documentFileVersionId" IS NULL
        OR "extractionAttemptId" IS NOT NULL
        OR "documentExtractionAttemptId" IS NULL
        OR "basisRef" IS NULL
      )
  `, [evidenceIds]);
  if (invalidEvidence.rows[0].count !== 0) {
    throw new Error("RECONCILIATION_VERIFY_FASCICOLO_EXTRACTION_EVIDENCE");
  }
  const attemptIds = [...input.rows.values()]
    .filter((row) => row.table === "DocumentExtractionAttempt")
    .map((row) => row.row.id);
  const invalidRetries = await input.client.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM "DocumentExtractionAttempt"
    WHERE "id" = ANY($1)
      AND (
        ("retryOfAttemptId" IS NULL) <> ("retryAuthorizationId" IS NULL)
        OR "retryOfAttemptId" = "id"
      )
  `, [attemptIds]);
  if (invalidRetries.rows[0].count !== 0) {
    throw new Error("RECONCILIATION_VERIFY_RETRY_COORDINATION");
  }
  const storageRows = [...input.rows.values()].filter(
    (row) => (
      (row.table === "Documento" || row.table === "DocumentFileVersion")
      && row.row.storageKey != null
    ),
  );
  if (input.targetStorageBucket) {
    const invalidStorage = storageRows.filter(
      (row) => row.row.storageBucket !== input.targetStorageBucket,
    );
    if (invalidStorage.length > 0) {
      throw new Error("RECONCILIATION_VERIFY_STORAGE_BUCKET_MAPPING");
    }
  }
  const activityAfter = await targetActivityAnchor(input.client);
  if (JSON.stringify(activityAfter) !== JSON.stringify(input.activityBefore)) {
    throw new Error("RECONCILIATION_VERIFY_CANONICAL_ACTIVITY_LOG_CHANGED");
  }
  let archivedActivityLogCount = 0;
  if (input.activityLogArchive) {
    const archived = await input.client.query<{
      count: number;
      finalHash: string | null;
    }>(`
      SELECT
        count(*)::int AS count,
        (array_agg("currentHash" ORDER BY "ordinal" DESC))[1] AS "finalHash"
      FROM "HistoricalActivityLogArchiveRecord"
      WHERE "archiveId" = $1
    `, [input.activityLogArchive.archiveId]);
    archivedActivityLogCount = archived.rows[0].count;
    if (
      archivedActivityLogCount !== input.activityLogArchive.recordCount
      || archived.rows[0].finalHash !== input.activityLogArchive.finalHash
    ) {
      throw new Error("RECONCILIATION_VERIFY_HISTORICAL_ACTIVITY_ARCHIVE");
    }
  }
  return {
    verifiedRows,
    verifiedTables,
    normalizedDuplicateGroups,
    mappedProcedures,
    storageReferences: storageRows.length,
    activityLogCount: activityAfter.count,
    archivedActivityLogCount,
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
        procedureIds: PROCEDURE_IDS,
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

  const runtimeTimeoutMs = Number(process.env.NOETRA_RECONCILIATION_TIMEOUT_MS ?? "120000");
  if (
    !Number.isSafeInteger(runtimeTimeoutMs)
    || runtimeTimeoutMs < 10_000
    || runtimeTimeoutMs > 600_000
  ) {
    throw new Error("RECONCILIATION_TIMEOUT_INVALID");
  }
  const deadline = Date.now() + runtimeTimeoutMs;
  const sourcePool = new Pool({ connectionString: process.env.DATABASE_URL });
  const targetPool = new Pool({ connectionString: targetUrl });
  const source = await sourcePool.connect();
  const target = await targetPool.connect();
  try {
    await source.query("BEGIN READ ONLY");
    await source.query("SET LOCAL statement_timeout = '30s'");
    await source.query("SET LOCAL lock_timeout = '5s'");
    await source.query("SET LOCAL idle_in_transaction_session_timeout = '5min'");
    await target.query("BEGIN");
    await target.query("SET LOCAL statement_timeout = '30s'");
    await target.query("SET LOCAL lock_timeout = '5s'");
    await target.query("SET LOCAL idle_in_transaction_session_timeout = '2min'");
    const activityBefore = await targetActivityAnchor(target);
    await assertDemoScope(source);
    const { rows, metadata } = await selectPromotionGraph(source);
    if (
      SCOPE.requiredEnteCodePrefix
      && !SCOPE.allowProductionPersonalData
      && promotionInventory(rows).nonDemoEmailDomains.length > 0
    ) {
      throw new Error("DEMO_PROMOTION_NON_DEMO_PERSONAL_DATA");
    }
    const tenantRemapping = await remapExistingDemoTenant(target, rows);
    const concessionRemapping = await remapExistingConcession(target, rows);
    const userRemapping = await remapExistingUsers(source, target, rows, metadata);
    const historicalNormalization = normalizeHistoricalConstraintDrift(rows);
    if (targetStorageBucket) {
      for (const selected of rows.values()) {
        if (selected.row.storageKey && selected.row.storageBucket) {
          selected.row.storageBucket = targetStorageBucket;
        }
      }
    }
    if (process.env.NOETRA_RECONCILIATION_PLAN_ONLY === "true") {
      const plan = await buildReconciliationPlan(target, rows, metadata);
      console.info(`NOETRA_RECONCILIATION_STATIC_PLAN=${JSON.stringify({
        selectedRows: rows.size,
        layers: plan.layers.length,
        dependencies: plan.dependencyCount,
        externalDependencies: plan.externalDependencyCount,
        deferredReferences: plan.deferredReferences.length,
        iterations: plan.iterationCount,
        rowsByLayer: plan.layers.map((layer) => layer.rows.length),
        tablesByLayer: plan.layers.map((layer) => (
          [...new Set(layer.rows.map((row) => row.table))].sort()
        )),
        tenantRemapping,
        concessionRemapping,
        userRemapping,
        historicalNormalization,
      })}`);
      await target.query("ROLLBACK");
      await source.query("ROLLBACK");
      return;
    }
    const reconciliation = await insertPromotionGraph(target, rows, metadata, deadline);
    const inserted = reconciliation.inserted;
    const activityLogArchive = SCOPE.archiveHistoricalActivityLog
      ? await archiveHistoricalActivityLog(source, target)
      : null;
    const reconciliationVerification = await verifyReconciliationResult({
      client: target,
      rows,
      metadata,
      concessionRemapping,
      activityLogArchive,
      activityBefore,
      targetStorageBucket,
    });
    const verification = await target.query<{
      currentRevisions: number;
      currentReports: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM "FascicoloKnowledgeRevision"
         WHERE "procedimentoId" = ANY($1) AND "status" = 'CURRENT') AS "currentRevisions",
        (SELECT COUNT(*)::int FROM "StructuredFascicoloReportSnapshot"
         WHERE "procedimentoId" = ANY($1) AND "status" = 'CURRENT') AS "currentReports"
    `, [PROCEDURE_IDS]);
    if (
      verification.rows[0].currentRevisions < 1
      || verification.rows[0].currentReports < 1
    ) {
      throw new Error("SELVARA_PROMOTION_VERIFICATION_FAILED");
    }
    const commitApproved = process.env.NOETRA_PROMOTION_COMMIT_APPROVAL
      === "NOETRA-PRODUCTION-DATABASE-UNIFICATION-COMMIT";
    if (SCOPE_NAME === "UNIFY_CP058_2019" && !commitApproved) {
      await target.query("ROLLBACK");
      await source.query("ROLLBACK");
    } else {
      await target.query("COMMIT");
      await source.query("COMMIT");
    }
    await assertLegacyRetryTriggerEnabled(target);
    const summary = [...inserted.entries()]
      .filter(([, count]) => count > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([table, count]) => ({ table, count }));
    console.info(`NOETRA_SELVARA_PROMOTION=${JSON.stringify({
      procedureIds: PROCEDURE_IDS,
      transaction: SCOPE_NAME === "UNIFY_CP058_2019" && !commitApproved ? "ROLLED_BACK" : "COMMITTED",
      selectedRows: rows.size,
      inserted: summary,
      currentRevisions: verification.rows[0].currentRevisions,
      currentReports: verification.rows[0].currentReports,
      tenantRemapping,
      concessionRemapping,
      userRemapping,
      activityLogArchive,
      historicalNormalization,
      reconciliationPlan: {
        layers: reconciliation.plan.layers.length,
        dependencies: reconciliation.plan.dependencyCount,
        externalDependencies: reconciliation.plan.externalDependencyCount,
        deferredReferences: reconciliation.plan.deferredReferences.length,
        iterations: reconciliation.plan.iterationCount,
        legacyRetryTriggerBypasses: reconciliation.legacyRetryTriggerBypasses,
      },
      reconciliationVerification,
      fingerprint: createHash("sha256").update(JSON.stringify(summary)).digest("hex"),
    })}`);
  } catch (error) {
    await source.query("ROLLBACK").catch(() => undefined);
    await target.query("ROLLBACK").catch(() => undefined);
    await assertLegacyRetryTriggerEnabled(target);
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
