import type { DatasetClass, Prisma } from "@/generated/prisma/client";

export const DATASET_SCOPE_VALUES = ["PROFESSIONAL", "SYNTHETIC", "ALL"] as const;

export type DatasetScope = (typeof DATASET_SCOPE_VALUES)[number];

export function getDatasetScope(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DatasetScope {
  const configured = environment.NOETRA_DATASET_SCOPE?.trim().toUpperCase();
  return DATASET_SCOPE_VALUES.includes(configured as DatasetScope)
    ? configured as DatasetScope
    : "PROFESSIONAL";
}

function datasetClassFilter(
  scope = getDatasetScope(),
): DatasetClass | { in: DatasetClass[] } | null {
  if (scope === "ALL") {
    return null;
  }

  return scope === "SYNTHETIC"
    ? { in: ["DEMO", "E2E"] }
    : "PROFESSIONAL";
}

export function isDatasetClassVisible(
  datasetClass: DatasetClass,
  scope = getDatasetScope(),
): boolean {
  if (scope === "ALL") {
    return true;
  }
  if (scope === "SYNTHETIC") {
    return datasetClass === "DEMO" || datasetClass === "E2E";
  }
  return datasetClass === "PROFESSIONAL";
}

export function buildDatasetConcessioneWhere(
  scope = getDatasetScope(),
): Prisma.ConcessioneWhereInput {
  const datasetClass = datasetClassFilter(scope);
  return datasetClass ? { datasetClass } : {};
}

export function buildDatasetProcedimentoWhere(
  scope = getDatasetScope(),
): Prisma.ProcedimentoWhereInput {
  const datasetClass = datasetClassFilter(scope);
  return datasetClass ? { datasetClass } : {};
}

export function buildDatasetProcedimentoUniqueWhere(
  id: string,
  scope = getDatasetScope(),
): Prisma.ProcedimentoWhereUniqueInput {
  const datasetClass = datasetClassFilter(scope);
  return datasetClass ? { id, datasetClass } : { id };
}

export function buildDatasetFascicoloIntakeWhere(
  scope = getDatasetScope(),
): Prisma.FascicoloIntakeWhereInput {
  const datasetClass = datasetClassFilter(scope);
  return datasetClass ? { datasetClass } : {};
}

export function buildDatasetDocumentoWhere(
  scope = getDatasetScope(),
): Prisma.DocumentoWhereInput {
  if (scope === "ALL") {
    return {};
  }

  const allowed = datasetClassFilter(scope);
  if (!allowed) {
    return {};
  }

  return {
    AND: [
      {
        OR: [
          { concessione: { is: { datasetClass: allowed } } },
          { procedimento: { is: { datasetClass: allowed } } },
          { fascicoloIntake: { is: { datasetClass: allowed } } },
        ],
      },
      {
        OR: [
          { concessioneId: null },
          { concessione: { is: { datasetClass: allowed } } },
        ],
      },
      {
        OR: [
          { procedimentoId: null },
          { procedimento: { is: { datasetClass: allowed } } },
        ],
      },
      {
        OR: [
          { fascicoloIntakeId: null },
          { fascicoloIntake: { is: { datasetClass: allowed } } },
        ],
      },
    ],
  };
}
