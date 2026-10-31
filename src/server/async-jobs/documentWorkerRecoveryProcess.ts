import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  activateDocumentWorker,
  documentWorkerKindForOperation,
  DocumentWorkerActivationError,
  DOCUMENT_WORKER_OPERATIONS,
  type DocumentWorkerActivationRequest,
  type DocumentWorkerKind,
} from "./documentWorkerActivation";

const RECOVERABLE_OPERATIONS = [
  DOCUMENT_WORKER_OPERATIONS.documentExtraction,
  DOCUMENT_WORKER_OPERATIONS.documentOcrCoordinator,
  DOCUMENT_WORKER_OPERATIONS.documentOcrPageBatch,
  DOCUMENT_WORKER_OPERATIONS.documentAnalysis,
] as const;

interface RecoverableJob {
  readonly id: string;
  readonly operation: string;
  readonly tenantId: string | null;
  readonly procedimentoId: string | null;
}

interface RecoveryDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly listRecoverableJobs?: (
    procedimentoIds: readonly string[],
  ) => Promise<readonly RecoverableJob[]>;
  readonly activate?: typeof activateDocumentWorker;
  readonly disconnect?: () => Promise<void>;
  readonly report?: (event: Readonly<Record<string, unknown>>) => void;
  readonly markFailure?: () => void;
}

function procedimentoAllowlist(environment: Readonly<Record<string, string | undefined>>) {
  const parsed = [...new Set(
    (environment.DOCUMENT_WORKER_RECOVERY_PROCEDIMENTO_ALLOWLIST ?? "")
      .split(/[,\r\n]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  )];
  if (
    parsed.length === 0
    || parsed.some((value) => !/^[A-Za-z0-9_-]{1,256}$/.test(value))
  ) {
    throw new Error("DOCUMENT_WORKER_RECOVERY_INVALID_CONFIGURATION");
  }
  return parsed;
}

async function defaultListRecoverableJobs(
  procedimentoIds: readonly string[],
): Promise<readonly RecoverableJob[]> {
  const { prisma } = await import("@/lib/prisma");
  return prisma.asyncJob.findMany({
    where: {
      operation: { in: [...RECOVERABLE_OPERATIONS] },
      procedimentoId: { in: [...procedimentoIds] },
      OR: [
        {
          status: { in: ["QUEUED", "RETRY_WAIT"] },
          availableAt: { lte: new Date() },
        },
        {
          status: { in: ["RUNNING", "CANCELLATION_REQUESTED"] },
          leaseExpiresAt: { lte: new Date() },
        },
      ],
    },
    select: { id: true, operation: true, tenantId: true, procedimentoId: true },
  });
}

export async function runDocumentWorkerRecoveryProcess(
  dependencies: RecoveryDependencies = {},
): Promise<void> {
  const report = dependencies.report ?? ((event) => console.log(JSON.stringify(event)));
  let failed = false;
  try {
    const allowedProcedimenti = procedimentoAllowlist(dependencies.environment ?? process.env);
    const jobs = await (dependencies.listRecoverableJobs ?? defaultListRecoverableJobs)(
      allowedProcedimenti,
    );
    const activations = new Map<string, DocumentWorkerActivationRequest>();
    for (const job of jobs) {
      const kind = documentWorkerKindForOperation(job.operation);
      if (!kind || !job.procedimentoId || !allowedProcedimenti.includes(job.procedimentoId)) continue;
      if (kind === "DOCUMENT_ANALYSIS") {
        if (!job.tenantId) {
          failed = true;
          report({
            event: "DOCUMENT_WORKER_RECOVERY_FAILED",
            kind,
            procedimentoId: job.procedimentoId,
            applicationJobId: job.id,
            errorCode: "TARGET_AUTHORITY_MISMATCH",
          });
          continue;
        }
        activations.set(`${kind}:${job.id}`, {
          kind,
          applicationJobId: job.id,
          tenantId: job.tenantId,
          procedimentoId: job.procedimentoId,
        });
        continue;
      }
      activations.set(`${kind}:${job.procedimentoId}`, { kind, procedimentoId: job.procedimentoId });
    }
    for (const activation of activations.values()) {
      try {
        const result = await (dependencies.activate ?? activateDocumentWorker)(
          activation,
          { environment: dependencies.environment },
        );
        if (result.outcome === "REQUESTED" || result.outcome === "ALREADY_REQUESTED") {
          report({
            event: "DOCUMENT_WORKER_RECOVERY_REQUESTED",
            kind: activation.kind,
            procedimentoId: activation.procedimentoId,
            ...("applicationJobId" in activation
              ? { applicationJobId: activation.applicationJobId }
              : {}),
          });
          continue;
        }
        failed = true;
        report({
          event: "DOCUMENT_WORKER_RECOVERY_FAILED",
          kind: activation.kind,
          procedimentoId: activation.procedimentoId,
          errorCode: "ACTIVATION_DISABLED",
        });
      } catch (error) {
        failed = true;
        report({
          event: "DOCUMENT_WORKER_RECOVERY_FAILED",
          kind: activation.kind,
          procedimentoId: activation.procedimentoId,
          errorCode: error instanceof DocumentWorkerActivationError
            ? error.code
            : "UNEXPECTED_FAILURE",
        });
      }
    }
    if (activations.size === 0) report({ event: "DOCUMENT_WORKER_RECOVERY_IDLE" });
  } catch (error) {
    failed = true;
    report({
      event: "DOCUMENT_WORKER_RECOVERY_FAILED",
      errorCode: error instanceof Error
        ? error.message.slice(0, 128)
        : "UNEXPECTED_FAILURE",
    });
  } finally {
    try {
      await (dependencies.disconnect ?? (async () => {
        const { prisma } = await import("@/lib/prisma");
        await prisma.$disconnect();
      }))();
    } catch {
      failed = true;
      report({
        event: "DOCUMENT_WORKER_RECOVERY_FAILED",
        errorCode: "DATABASE_DISCONNECT_FAILED",
      });
    }
  }
  if (failed) (dependencies.markFailure ?? (() => { process.exitCode = 1; }))();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runDocumentWorkerRecoveryProcess();
}
