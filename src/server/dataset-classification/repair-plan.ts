import { createHash } from "node:crypto";

import type { DatasetClass } from "@/generated/prisma/client";
import type { DatasetScope } from "@/lib/dataset-visibility";
import { resolveTenantDatasetClass } from "@/lib/tenant";

export type DatasetClassificationRootKind =
  | "CONCESSIONE"
  | "PROCEDIMENTO"
  | "FASCICOLO_INTAKE";

export interface DatasetClassificationRoot {
  readonly kind: DatasetClassificationRootKind;
  readonly id: string;
  readonly tenantId: string;
  readonly datasetClass: DatasetClass;
}

export interface DatasetClassificationRepairPlan {
  readonly tenantId: string;
  readonly tenantCode: string;
  readonly selectedProcedureId: string;
  readonly targetClass: DatasetClass;
  readonly targetScope: Exclude<DatasetScope, "ALL">;
  readonly fingerprint: string;
  readonly roots: readonly DatasetClassificationRoot[];
  readonly changes: readonly DatasetClassificationRoot[];
}

export class DatasetClassificationRepairError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DatasetClassificationRepairError";
  }
}

export function buildDatasetClassificationRepairPlan(input: {
  readonly tenantId: string;
  readonly tenantCode: string;
  readonly selectedProcedureId: string;
  readonly roots: readonly DatasetClassificationRoot[];
}): DatasetClassificationRepairPlan {
  const roots = [...input.roots].sort((left, right) => (
    left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
  ));
  if (
    roots.length === 0
    || !roots.some(
      (root) => root.kind === "PROCEDIMENTO" && root.id === input.selectedProcedureId,
    )
  ) {
    throw new DatasetClassificationRepairError("DATASET_CLASSIFICATION_ROOTS_INCOMPLETE");
  }
  if (roots.some((root) => root.tenantId !== input.tenantId)) {
    throw new DatasetClassificationRepairError(
      "DATASET_CLASSIFICATION_ROOT_TENANT_MISMATCH",
    );
  }
  const identities = new Set(roots.map((root) => `${root.kind}:${root.id}`));
  if (identities.size !== roots.length) {
    throw new DatasetClassificationRepairError("DATASET_CLASSIFICATION_ROOT_DUPLICATE");
  }

  const targetClass = resolveTenantDatasetClass(input.tenantCode);
  const targetScope = targetClass === "PROFESSIONAL" ? "PROFESSIONAL" : "SYNTHETIC";
  const fingerprint = createHash("sha256").update(JSON.stringify({
    schemaVersion: 1,
    tenantId: input.tenantId,
    tenantCode: input.tenantCode,
    selectedProcedureId: input.selectedProcedureId,
    targetClass,
    roots: roots.map((root) => [root.kind, root.id, root.datasetClass]),
  })).digest("hex");

  return {
    tenantId: input.tenantId,
    tenantCode: input.tenantCode,
    selectedProcedureId: input.selectedProcedureId,
    targetClass,
    targetScope,
    fingerprint,
    roots,
    changes: roots.filter((root) => root.datasetClass !== targetClass),
  };
}
