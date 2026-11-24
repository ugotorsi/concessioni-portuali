import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import {
  buildDatasetClassificationRepairPlan,
  DatasetClassificationRepairError,
  type DatasetClassificationRepairPlan,
  type DatasetClassificationRoot,
} from "@/server/dataset-classification/repair-plan";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

export const DATASET_CLASSIFICATION_REPAIR_ACTION =
  "FASCICOLO_DATASET_CLASSIFICATION_REPAIRED";
export const DATASET_CLASSIFICATION_REPAIR_ENTITY = "Procedimento";
export const DATASET_CLASSIFICATION_REPAIR_CONFIRMATION =
  "REPAIR_FASCICOLO_DATASET_CLASSIFICATION";

type DatasetClassificationClient = Pick<
  Prisma.TransactionClient,
  "procedimento" | "concessione" | "fascicoloIntake"
>;

async function loadRepairPlan(
  procedimentoId: string,
  client: DatasetClassificationClient,
): Promise<DatasetClassificationRepairPlan> {
  const selected = await client.procedimento.findUnique({
    where: { id: procedimentoId },
    select: {
      id: true,
      enteId: true,
      datasetClass: true,
      concessioneId: true,
      ente: { select: { codice: true } },
      fascicoloIntake: {
        select: { id: true, enteId: true, datasetClass: true },
      },
    },
  });
  if (!selected) {
    throw new DatasetClassificationRepairError(
      "DATASET_CLASSIFICATION_PROCEDURE_NOT_FOUND",
    );
  }

  const roots: DatasetClassificationRoot[] = [];
  if (selected.concessioneId) {
    const [concessione, procedimenti, intakes] = await Promise.all([
      client.concessione.findUnique({
        where: { id: selected.concessioneId },
        select: { id: true, enteId: true, datasetClass: true },
      }),
      client.procedimento.findMany({
        where: { concessioneId: selected.concessioneId },
        orderBy: { id: "asc" },
        select: {
          id: true,
          enteId: true,
          datasetClass: true,
        },
      }),
      client.fascicoloIntake.findMany({
        where: {
          OR: [
            { concessioneId: selected.concessioneId },
            { procedimento: { concessioneId: selected.concessioneId } },
          ],
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          enteId: true,
          datasetClass: true,
          concessioneId: true,
          procedimento: { select: { concessioneId: true } },
        },
      }),
    ]);
    if (!concessione) {
      throw new DatasetClassificationRepairError(
        "DATASET_CLASSIFICATION_CONCESSION_NOT_FOUND",
      );
    }
    if (!concessione.enteId) {
      throw new DatasetClassificationRepairError(
        "DATASET_CLASSIFICATION_CONCESSION_TENANT_MISSING",
      );
    }
    roots.push({
      kind: "CONCESSIONE",
      id: concessione.id,
      tenantId: concessione.enteId,
      datasetClass: concessione.datasetClass,
    });
    for (const procedimento of procedimenti) {
      roots.push({
        kind: "PROCEDIMENTO",
        id: procedimento.id,
        tenantId: procedimento.enteId,
        datasetClass: procedimento.datasetClass,
      });
    }
    for (const intake of intakes) {
      if (
        (intake.concessioneId && intake.concessioneId !== selected.concessioneId) ||
        (
          intake.procedimento &&
          intake.procedimento.concessioneId !== selected.concessioneId
        )
      ) {
        throw new DatasetClassificationRepairError(
          "DATASET_CLASSIFICATION_INTAKE_AGGREGATE_MISMATCH",
        );
      }
      roots.push({
        kind: "FASCICOLO_INTAKE",
        id: intake.id,
        tenantId: intake.enteId,
        datasetClass: intake.datasetClass,
      });
    }
  } else {
    roots.push({
      kind: "PROCEDIMENTO",
      id: selected.id,
      tenantId: selected.enteId,
      datasetClass: selected.datasetClass,
    });
    if (selected.fascicoloIntake) {
      roots.push({
        kind: "FASCICOLO_INTAKE",
        id: selected.fascicoloIntake.id,
        tenantId: selected.fascicoloIntake.enteId,
        datasetClass: selected.fascicoloIntake.datasetClass,
      });
    }
  }

  return buildDatasetClassificationRepairPlan({
    tenantId: selected.enteId,
    tenantCode: selected.ente.codice,
    selectedProcedureId: selected.id,
    roots,
  });
}

export function previewDatasetClassificationRepair(
  procedimentoId: string,
  client: DatasetClassificationClient = prisma,
): Promise<DatasetClassificationRepairPlan> {
  return loadRepairPlan(procedimentoId, client);
}

interface DatasetClassificationRepairDependencies {
  readonly transaction: <T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
  readonly audit: typeof createAuditLogInTransaction;
}

const defaultDependencies: DatasetClassificationRepairDependencies = {
  transaction: (operation) => runSerializableTransactionWithRetry(operation),
  audit: createAuditLogInTransaction,
};

export async function repairDatasetClassification(input: {
  readonly procedimentoId: string;
  readonly expectedFingerprint: string;
  readonly reason: string;
  readonly actor: {
    readonly id: string;
    readonly email: string;
    readonly role: "ADMIN";
  };
}, dependencies: DatasetClassificationRepairDependencies = defaultDependencies) {
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 1_000) {
    throw new DatasetClassificationRepairError(
      "DATASET_CLASSIFICATION_REASON_INVALID",
    );
  }

  return dependencies.transaction(async (tx) => {
    const plan = await loadRepairPlan(input.procedimentoId, tx);
    if (plan.fingerprint !== input.expectedFingerprint) {
      throw new DatasetClassificationRepairError(
        "DATASET_CLASSIFICATION_FINGERPRINT_MISMATCH",
      );
    }
    if (plan.changes.length === 0) {
      throw new DatasetClassificationRepairError(
        "DATASET_CLASSIFICATION_ALREADY_ALIGNED",
      );
    }

    const concessionIds = plan.changes
      .filter((root) => root.kind === "CONCESSIONE")
      .map((root) => root.id);
    const procedureIds = plan.changes
      .filter((root) => root.kind === "PROCEDIMENTO")
      .map((root) => root.id);
    const intakeIds = plan.changes
      .filter((root) => root.kind === "FASCICOLO_INTAKE")
      .map((root) => root.id);
    const updateCounts = await Promise.all([
      concessionIds.length === 0
        ? Promise.resolve({ count: 0 })
        : tx.concessione.updateMany({
            where: { id: { in: concessionIds } },
            data: { datasetClass: plan.targetClass },
          }),
      procedureIds.length === 0
        ? Promise.resolve({ count: 0 })
        : tx.procedimento.updateMany({
            where: { id: { in: procedureIds } },
            data: { datasetClass: plan.targetClass },
          }),
      intakeIds.length === 0
        ? Promise.resolve({ count: 0 })
        : tx.fascicoloIntake.updateMany({
            where: { id: { in: intakeIds } },
            data: { datasetClass: plan.targetClass },
          }),
    ]);
    if (
      updateCounts[0].count !== concessionIds.length
      || updateCounts[1].count !== procedureIds.length
      || updateCounts[2].count !== intakeIds.length
    ) {
      throw new DatasetClassificationRepairError(
        "DATASET_CLASSIFICATION_UPDATE_COUNT_MISMATCH",
      );
    }

    const concessionId = plan.roots.find((root) => root.kind === "CONCESSIONE")?.id;
    await dependencies.audit(tx, {
      azione: DATASET_CLASSIFICATION_REPAIR_ACTION,
      entita: DATASET_CLASSIFICATION_REPAIR_ENTITY,
      entitaId: input.procedimentoId,
      enteId: plan.tenantId,
      concessioneId: concessionId ?? null,
      esito: "SUCCESS",
      actor: {
        userId: input.actor.id,
        userEmail: input.actor.email,
        userRole: input.actor.role,
      },
      metadata: {
        reason,
        expectedFingerprint: input.expectedFingerprint,
        tenantCode: plan.tenantCode,
        targetClass: plan.targetClass,
        targetScope: plan.targetScope,
        roots: plan.roots.map((root) => ({
          kind: root.kind,
          id: root.id,
          previousClass: root.datasetClass,
          targetClass: plan.targetClass,
        })),
        preservedChildren: true,
        providerCalled: false,
        workerActivated: false,
      },
    });

    return {
      tenantId: plan.tenantId,
      procedimentoId: plan.selectedProcedureId,
      targetClass: plan.targetClass,
      targetScope: plan.targetScope,
      changedRootCount: plan.changes.length,
    };
  });
}
