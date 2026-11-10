import { describe, expect, it } from "vitest";

import {
  classifyLegacyDocumentExtractionRetries,
  planReconciliation,
  ReconciliationPlanError,
  referenceIdentity,
  type ReconciliationForeignKey,
  type ReconciliationRow,
} from "@/server/release/reconciliationPlanner";

function row(key: string, table: string, values: Record<string, unknown>): ReconciliationRow {
  return { key, table, primaryKey: "id", row: { id: key, ...values } };
}

describe("reconciliation planner", () => {
  it("orders required simple and composite dependencies deterministically", () => {
    const rows = [
      row("child", "Evidence", { parentId: "parent", tenantId: "tenant-1" }),
      row("parent", "Document", { tenantId: "tenant-1" }),
    ];
    const foreignKeys: ReconciliationForeignKey[] = [{
      constraintName: "evidence_document_scope_fk",
      childTable: "Evidence",
      childColumns: ["parentId", "tenantId"],
      parentTable: "Document",
      parentColumns: ["id", "tenantId"],
    }];

    const plan = planReconciliation({
      rows,
      foreignKeys,
      nullableColumns: new Set(),
      availableExternalReferences: new Set(),
    });

    expect(plan.layers.map((layer) => layer.rows.map((value) => value.key)))
      .toEqual([["parent"], ["child"]]);
    expect(plan.iterationCount).toBe(2);
  });

  it("defers nullable cross-table cycles and records exact restoration values", () => {
    const rows = [
      row("document", "Document", { currentVersionId: "version" }),
      row("version", "Version", { documentId: "document" }),
    ];
    const foreignKeys: ReconciliationForeignKey[] = [
      {
        constraintName: "document_current_version_fk",
        childTable: "Document",
        childColumns: ["currentVersionId"],
        parentTable: "Version",
        parentColumns: ["id"],
      },
      {
        constraintName: "version_document_fk",
        childTable: "Version",
        childColumns: ["documentId"],
        parentTable: "Document",
        parentColumns: ["id"],
      },
    ];

    const plan = planReconciliation({
      rows,
      foreignKeys,
      nullableColumns: new Set(["Document.currentVersionId"]),
      availableExternalReferences: new Set(),
    });

    expect(plan.deferredReferences).toEqual([expect.objectContaining({
      rowKey: "document",
      constraintName: "document_current_version_fk",
      values: [{ column: "currentVersionId", value: "version" }],
    })]);
    expect(rows[0].row.currentVersionId).toBeNull();
    expect(plan.layers.flatMap((layer) => layer.rows.map((value) => value.key)))
      .toEqual(["document", "version"]);
  });

  it("keeps coordinated retry fields together and orders the retry after its parent", () => {
    const rows = [
      row("retry", "Attempt", {
        retryOfAttemptId: "original",
        retryAuthorizationId: "authorization",
      }),
      row("original", "Attempt", {
        retryOfAttemptId: null,
        retryAuthorizationId: null,
      }),
    ];
    const foreignKeys: ReconciliationForeignKey[] = [{
      constraintName: "attempt_retry_fk",
      childTable: "Attempt",
      childColumns: ["retryOfAttemptId"],
      parentTable: "Attempt",
      parentColumns: ["id"],
    }];

    const plan = planReconciliation({
      rows,
      foreignKeys,
      nullableColumns: new Set(["Attempt.retryOfAttemptId"]),
      availableExternalReferences: new Set(),
      coordinatedNullableConstraints: new Set(["attempt_retry_fk"]),
    });

    expect(plan.deferredReferences).toHaveLength(0);
    expect(plan.layers.map((layer) => layer.rows.map((value) => value.key)))
      .toEqual([["original"], ["retry"]]);
    expect(rows[0].row.retryAuthorizationId).toBe("authorization");
  });

  it("classifies only the known BUCKET_MISMATCH retry as a legacy policy exception", () => {
    const rows = [
      row("source", "DocumentExtractionAttempt", {
        outcome: "FAILED",
        failureCode: "BUCKET_MISMATCH",
        documentoId: "document",
        documentFileVersionId: "version",
        tenantId: "tenant",
        procedimentoId: "procedure",
        policyVersion: "DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1",
        retryOfAttemptId: null,
        retryAuthorizationId: null,
      }),
      row("retry", "DocumentExtractionAttempt", {
        outcome: "SUCCEEDED",
        failureCode: null,
        documentoId: "document",
        documentFileVersionId: "version",
        tenantId: "tenant",
        procedimentoId: "procedure",
        policyVersion: "DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1",
        retryOfAttemptId: "source",
        retryAuthorizationId: "authorization",
      }),
    ];

    expect([...classifyLegacyDocumentExtractionRetries(
      rows,
      new Set(["source\0retry"]),
    )]).toEqual(["retry"]);
    expect(() => classifyLegacyDocumentExtractionRetries(rows, new Set()))
      .toThrowError("RECONCILIATION_LEGACY_RETRY_NOT_ALLOWLISTED");
  });

  it("rejects uncoordinated or unknown legacy retry relationships", () => {
    const uncoordinated = [row("retry", "DocumentExtractionAttempt", {
      retryOfAttemptId: "source",
      retryAuthorizationId: null,
    })];
    expect(() => classifyLegacyDocumentExtractionRetries(uncoordinated, new Set()))
      .toThrowError("RECONCILIATION_RETRY_COORDINATION_INVALID");

    const unsupported = [
      row("source", "DocumentExtractionAttempt", {
        outcome: "FAILED",
        failureCode: "INTEGRITY_FAILURE",
        documentoId: "document",
        documentFileVersionId: "version",
        tenantId: "tenant",
        procedimentoId: "procedure",
        policyVersion: "DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1",
        retryOfAttemptId: null,
        retryAuthorizationId: null,
      }),
      row("retry", "DocumentExtractionAttempt", {
        documentoId: "document",
        documentFileVersionId: "version",
        tenantId: "tenant",
        procedimentoId: "procedure",
        policyVersion: "DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1",
        retryOfAttemptId: "source",
        retryAuthorizationId: "authorization",
      }),
    ];
    expect(() => classifyLegacyDocumentExtractionRetries(unsupported, new Set()))
      .toThrowError("RECONCILIATION_LEGACY_RETRY_POLICY_UNSUPPORTED");
  });

  it("accepts mapped parents already present in the canonical database", () => {
    const rows = [row("procedure", "Procedure", { concessionId: "canonical-concession" })];
    const foreignKeys: ReconciliationForeignKey[] = [{
      constraintName: "procedure_concession_fk",
      childTable: "Procedure",
      childColumns: ["concessionId"],
      parentTable: "Concession",
      parentColumns: ["id"],
    }];

    const plan = planReconciliation({
      rows,
      foreignKeys,
      nullableColumns: new Set(),
      availableExternalReferences: new Set([
        referenceIdentity("Concession", ["id"], ["canonical-concession"]),
      ]),
    });

    expect(plan.externalDependencyCount).toBe(1);
    expect(plan.layers).toHaveLength(1);
  });

  it("fails immediately with the missing table and constraint", () => {
    const rows = [row("child", "Child", { parentId: "missing" })];
    const foreignKeys: ReconciliationForeignKey[] = [{
      constraintName: "child_parent_fk",
      childTable: "Child",
      childColumns: ["parentId"],
      parentTable: "Parent",
      parentColumns: ["id"],
    }];

    expect(() => planReconciliation({
      rows,
      foreignKeys,
      nullableColumns: new Set(),
      availableExternalReferences: new Set(),
    })).toThrowError(expect.objectContaining<Partial<ReconciliationPlanError>>({
      message: "RECONCILIATION_EXTERNAL_DEPENDENCY_MISSING",
    }));
  });

  it("fails on an unbreakable cross-table cycle within the bounded iteration count", () => {
    const rows = [
      row("a", "A", { bId: "b" }),
      row("b", "B", { aId: "a" }),
    ];
    const foreignKeys: ReconciliationForeignKey[] = [
      {
        constraintName: "a_b_fk",
        childTable: "A",
        childColumns: ["bId"],
        parentTable: "B",
        parentColumns: ["id"],
      },
      {
        constraintName: "b_a_fk",
        childTable: "B",
        childColumns: ["aId"],
        parentTable: "A",
        parentColumns: ["id"],
      },
    ];

    expect(() => planReconciliation({
      rows,
      foreignKeys,
      nullableColumns: new Set(),
      availableExternalReferences: new Set(),
      maxIterations: 3,
    })).toThrowError("RECONCILIATION_UNRESOLVABLE_CYCLE");
  });
});
