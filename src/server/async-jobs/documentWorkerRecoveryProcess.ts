import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  activateDocumentWorker,
  documentWorkerKindForOperation,
  DocumentWorkerActivationError,
  DOCUMENT_WORKER_OPERATIONS,
  type DocumentWorkerKind,
} from "./documentWorkerActivation";

const RECOVERABLE_OPERATIONS = [
  DOCUMENT_WORKER_OPERATIONS.documentExtraction,
  DOCUMENT_WORKER_OPERATIONS.documentOcrCoordinator,
  DOCUMENT_WORKER_OPERATIONS.documentOcrPageBatch,
  DOCUMENT_WORKER_OPERATIONS.documentAnalysis,
] as const;

interface RecoverableJob {
  readonly operation: string;
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
    select: { operation: true, procedimentoId: true },
    distinct: ["operation", "procedimentoId"],
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
    const activations = new Map<string, { kind: DocumentWorkerKind; procedimentoId: string }>();
    for (const job of jobs) {
      const kind = documentWorkerKindForOperation(job.operation);
      if (!kind || !job.procedimentoId || !allowedProcedimenti.includes(job.procedimentoId)) continue;
      activations.set(`${kind}:${job.procedimentoId}`, {
        kind,
        procedimentoId: job.procedimentoId,
      });
    }
    for (const activation of activations.values()) {
      try {
        const result = await (dependencies.activate ?? activateDocumentWorker)(
          activation.kind,
          activation.procedimentoId,
          { environment: dependencies.environment },
        );
        if (result.outcome === "REQUESTED") {
          report({
            event: "DOCUMENT_WORKER_RECOVERY_REQUESTED",
            kind: activation.kind,
            procedimentoId: activation.procedimentoId,
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
