export type ReconciliationRow = {
  key: string;
  table: string;
  primaryKey: string;
  row: Record<string, unknown>;
};

export type ReconciliationForeignKey = {
  constraintName: string;
  childTable: string;
  childColumns: string[];
  parentTable: string;
  parentColumns: string[];
};

export type DeferredReference = {
  rowKey: string;
  table: string;
  primaryKey: string;
  primaryValue: unknown;
  constraintName: string;
  values: Array<{ column: string; value: unknown }>;
};

export type ReconciliationLayer = {
  index: number;
  rows: ReconciliationRow[];
  atomicSameTableCycle: boolean;
};

export type ReconciliationPlan = {
  layers: ReconciliationLayer[];
  deferredReferences: DeferredReference[];
  dependencyCount: number;
  externalDependencyCount: number;
  iterationCount: number;
};

type Dependency = {
  childKey: string;
  parentKey: string;
  foreignKey: ReconciliationForeignKey;
};

export class ReconciliationPlanError extends Error {
  readonly diagnostics: unknown;

  constructor(code: string, diagnostics: unknown) {
    super(code);
    this.name = "ReconciliationPlanError";
    this.diagnostics = diagnostics;
  }
}

export function referenceIdentity(
  table: string,
  columns: readonly string[],
  values: readonly unknown[],
): string {
  return JSON.stringify([table, columns, values]);
}

export function classifyLegacyDocumentExtractionRetries(
  rows: readonly ReconciliationRow[],
  allowedRelationships: ReadonlySet<string>,
): ReadonlySet<string> {
  const attempts = rows.filter((row) => row.table === "DocumentExtractionAttempt");
  const attemptsById = new Map(attempts.map((row) => [String(row.row.id), row]));
  const legacyRows = new Set<string>();
  const scopeColumns = [
    "documentoId",
    "documentFileVersionId",
    "tenantId",
    "procedimentoId",
    "policyVersion",
  ] as const;

  for (const attempt of attempts) {
    const retryOfAttemptId = attempt.row.retryOfAttemptId;
    const retryAuthorizationId = attempt.row.retryAuthorizationId;
    if ((retryOfAttemptId == null) !== (retryAuthorizationId == null)) {
      throw new ReconciliationPlanError("RECONCILIATION_RETRY_COORDINATION_INVALID", {
        row: attempt.key,
      });
    }
    if (retryOfAttemptId == null) continue;
    const source = attemptsById.get(String(retryOfAttemptId));
    if (!source) {
      throw new ReconciliationPlanError("RECONCILIATION_RETRY_SOURCE_MISSING", {
        row: attempt.key,
        retryOfAttemptId,
      });
    }
    if (
      source.row.outcome !== "FAILED"
      || scopeColumns.some((column) => source.row[column] !== attempt.row[column])
    ) {
      throw new ReconciliationPlanError("RECONCILIATION_RETRY_SOURCE_INVALID", {
        row: attempt.key,
        retryOfAttemptId,
      });
    }
    if (attempt.row.policyVersion === "DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2") {
      throw new ReconciliationPlanError("RECONCILIATION_OCR_RETRY_REQUIRES_OCR_RUN", {
        row: attempt.key,
        retryOfAttemptId,
      });
    }
    if (
      source.row.failureCode === "STORAGE_READ_FAILURE"
      || source.row.failureCode === "INTERNAL_EXTRACTION_FAILURE"
    ) {
      continue;
    }
    if (source.row.failureCode !== "BUCKET_MISMATCH") {
      throw new ReconciliationPlanError("RECONCILIATION_LEGACY_RETRY_POLICY_UNSUPPORTED", {
        row: attempt.key,
        retryOfAttemptId,
        failureCode: source.row.failureCode,
      });
    }
    const relationship = `${String(retryOfAttemptId)}\0${String(attempt.row.id)}`;
    if (!allowedRelationships.has(relationship)) {
      throw new ReconciliationPlanError("RECONCILIATION_LEGACY_RETRY_NOT_ALLOWLISTED", {
        row: attempt.key,
        retryOfAttemptId,
      });
    }
    legacyRows.add(attempt.key);
  }
  return legacyRows;
}

function stronglyConnectedComponents(
  keys: ReadonlySet<string>,
  dependencies: readonly Dependency[],
): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const key of keys) adjacency.set(key, []);
  for (const dependency of dependencies) {
    if (keys.has(dependency.childKey) && keys.has(dependency.parentKey)) {
      adjacency.get(dependency.childKey)!.push(dependency.parentKey);
    }
  }
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (key: string): void => {
    indexes.set(key, nextIndex);
    lowLinks.set(key, nextIndex);
    nextIndex += 1;
    stack.push(key);
    onStack.add(key);
    for (const adjacent of adjacency.get(key) ?? []) {
      if (!indexes.has(adjacent)) {
        visit(adjacent);
        lowLinks.set(key, Math.min(lowLinks.get(key)!, lowLinks.get(adjacent)!));
      } else if (onStack.has(adjacent)) {
        lowLinks.set(key, Math.min(lowLinks.get(key)!, indexes.get(adjacent)!));
      }
    }
    if (lowLinks.get(key) !== indexes.get(key)) return;
    const component: string[] = [];
    for (;;) {
      const current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
      if (current === key) break;
    }
    components.push(component.sort());
  };

  for (const key of [...keys].sort()) {
    if (!indexes.has(key)) visit(key);
  }
  return components;
}

export function planReconciliation(input: {
  rows: readonly ReconciliationRow[];
  foreignKeys: readonly ReconciliationForeignKey[];
  nullableColumns: ReadonlySet<string>;
  availableExternalReferences: ReadonlySet<string>;
  coordinatedNullableConstraints?: ReadonlySet<string>;
  maxIterations?: number;
}): ReconciliationPlan {
  const rowsByKey = new Map(input.rows.map((row) => [row.key, row]));
  if (rowsByKey.size !== input.rows.length) {
    throw new ReconciliationPlanError("RECONCILIATION_DUPLICATE_ROW_KEY", {});
  }
  const parentIndexes = new Map<string, Map<string, string>>();
  for (const foreignKey of input.foreignKeys) {
    const index = new Map<string, string>();
    for (const row of input.rows.filter((candidate) => candidate.table === foreignKey.parentTable)) {
      const values = foreignKey.parentColumns.map((column) => row.row[column]);
      if (values.some((value) => value == null)) continue;
      const identity = referenceIdentity(foreignKey.parentTable, foreignKey.parentColumns, values);
      const previous = index.get(identity);
      if (previous && previous !== row.key) {
        throw new ReconciliationPlanError("RECONCILIATION_PARENT_IDENTITY_AMBIGUOUS", {
          constraint: foreignKey.constraintName,
          identity,
          rows: [previous, row.key],
        });
      }
      index.set(identity, row.key);
    }
    parentIndexes.set(foreignKey.constraintName, index);
  }

  const dependencies: Dependency[] = [];
  let externalDependencyCount = 0;
  const missing: unknown[] = [];
  for (const row of input.rows) {
    for (const foreignKey of input.foreignKeys.filter((key) => key.childTable === row.table)) {
      const values = foreignKey.childColumns.map((column) => row.row[column]);
      if (values.some((value) => value == null)) continue;
      const identity = referenceIdentity(foreignKey.parentTable, foreignKey.parentColumns, values);
      const parentKey = parentIndexes.get(foreignKey.constraintName)?.get(identity);
      if (parentKey) {
        dependencies.push({ childKey: row.key, parentKey, foreignKey });
      } else if (input.availableExternalReferences.has(identity)) {
        externalDependencyCount += 1;
      } else {
        missing.push({
          row: row.key,
          table: row.table,
          constraint: foreignKey.constraintName,
          parentTable: foreignKey.parentTable,
          parentColumns: foreignKey.parentColumns,
        });
      }
    }
  }
  if (missing.length > 0) {
    throw new ReconciliationPlanError("RECONCILIATION_EXTERNAL_DEPENDENCY_MISSING", missing);
  }

  const remaining = new Set(rowsByKey.keys());
  const activeDependencies = [...dependencies];
  const deferredReferences: DeferredReference[] = [];
  const layers: ReconciliationLayer[] = [];
  const coordinated = input.coordinatedNullableConstraints ?? new Set<string>();
  const maxIterations = input.maxIterations ?? input.rows.length + dependencies.length + 1;
  let iterationCount = 0;

  while (remaining.size > 0) {
    iterationCount += 1;
    if (iterationCount > maxIterations) {
      throw new ReconciliationPlanError("RECONCILIATION_PLAN_ITERATION_LIMIT", {
        maxIterations,
        remaining: [...remaining].map((key) => rowsByKey.get(key)!.table),
      });
    }
    const ready = [...remaining].filter((key) => !activeDependencies.some(
      (dependency) => dependency.childKey === key && remaining.has(dependency.parentKey),
    )).sort();
    if (ready.length > 0) {
      layers.push({
        index: layers.length,
        rows: ready.map((key) => rowsByKey.get(key)!),
        atomicSameTableCycle: false,
      });
      for (const key of ready) remaining.delete(key);
      continue;
    }

    const components = stronglyConnectedComponents(remaining, activeDependencies);
    const componentByKey = new Map<string, string[]>();
    for (const component of components) {
      for (const key of component) componentByKey.set(key, component);
    }
    const cyclicDependencies = activeDependencies.filter((dependency) => {
      const component = componentByKey.get(dependency.childKey);
      return (
        component
        && component.includes(dependency.parentKey)
        && (component.length > 1 || dependency.childKey === dependency.parentKey)
      );
    });
    const breakable = cyclicDependencies.filter((dependency) => (
      !coordinated.has(dependency.foreignKey.constraintName)
      && dependency.foreignKey.childColumns.some(
        (column) => input.nullableColumns.has(`${dependency.foreignKey.childTable}.${column}`),
      )
    ));
    if (breakable.length > 0) {
      const deferredKeys = new Set<string>();
      for (const dependency of breakable) {
        const deferredKey = `${dependency.childKey}\0${dependency.foreignKey.constraintName}`;
        if (!deferredKeys.has(deferredKey)) {
          const row = rowsByKey.get(dependency.childKey)!;
          const deferredColumn = dependency.foreignKey.childColumns.find(
            (column) => (
              column !== row.primaryKey
              && input.nullableColumns.has(`${dependency.foreignKey.childTable}.${column}`)
            ),
          );
          if (!deferredColumn) {
            throw new ReconciliationPlanError("RECONCILIATION_CYCLE_BREAK_COLUMN_MISSING", {
              row: row.key,
              constraint: dependency.foreignKey.constraintName,
            });
          }
          deferredReferences.push({
            rowKey: row.key,
            table: row.table,
            primaryKey: row.primaryKey,
            primaryValue: row.row[row.primaryKey],
            constraintName: dependency.foreignKey.constraintName,
            values: [{ column: deferredColumn, value: row.row[deferredColumn] }],
          });
          row.row[deferredColumn] = null;
          deferredKeys.add(deferredKey);
        }
      }
      for (let index = activeDependencies.length - 1; index >= 0; index -= 1) {
        if (breakable.includes(activeDependencies[index])) activeDependencies.splice(index, 1);
      }
      continue;
    }

    const sinkComponent = components
      .filter((component) => component.length > 1 || activeDependencies.some(
        (dependency) => dependency.childKey === component[0] && dependency.parentKey === component[0],
      ))
      .find((component) => !activeDependencies.some(
        (dependency) => (
          component.includes(dependency.childKey)
          && remaining.has(dependency.parentKey)
          && !component.includes(dependency.parentKey)
        ),
      ));
    if (sinkComponent) {
      const tables = new Set(sinkComponent.map((key) => rowsByKey.get(key)!.table));
      if (tables.size === 1) {
        layers.push({
          index: layers.length,
          rows: sinkComponent.map((key) => rowsByKey.get(key)!),
          atomicSameTableCycle: true,
        });
        for (const key of sinkComponent) remaining.delete(key);
        continue;
      }
    }
    throw new ReconciliationPlanError("RECONCILIATION_UNRESOLVABLE_CYCLE", {
      components: components
        .filter((component) => component.length > 1)
        .map((component) => ({
          rows: component,
          tables: [...new Set(component.map((key) => rowsByKey.get(key)!.table))],
          constraints: cyclicDependencies
            .filter((dependency) => component.includes(dependency.childKey))
            .map((dependency) => dependency.foreignKey.constraintName),
        })),
    });
  }

  return {
    layers,
    deferredReferences,
    dependencyCount: dependencies.length,
    externalDependencyCount,
    iterationCount,
  };
}
