import { createHash } from "node:crypto";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJob } from "@/server/async-jobs/persistence";

import {
  DOCUMENT_EXTRACTION_OPERATION,
  DOCUMENT_EXTRACTION_PURPOSE,
} from "./documentExtractionAdmission";
import { DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1 } from "./documentExtractionPolicy";
import {
  issueDocumentExtractionRetryPermit,
  verifyDocumentExtractionRetryPermit,
  type DocumentExtractionRetryPermit,
} from "./documentExtractionRetryPermit";
import { isRetryableDocumentExtractionFailure } from "./documentExtractionRetryability";

const identifier = z.string().trim().min(1).max(256);
const terminalRecoveryFailureCodes = new Set([
  "UNHANDLED_ERROR",
  "UNEXPECTED_HANDLER_ERROR",
  "UNEXPECTED_TYPE_ERROR",
  "UNEXPECTED_REFERENCE_ERROR",
  "UNEXPECTED_RANGE_ERROR",
  "DOCUMENT_EXTRACTION_JOB_LOOKUP_FAILED",
  "DOCUMENT_EXTRACTION_RETRY_PERMIT_VERIFICATION_FAILED",
  "DOCUMENT_EXTRACTION_EXECUTION_FAILED",
  "DOCUMENT_EXTRACTION_PERSISTENCE_FAILED",
]);
const TERMINAL_RECOVERY_AUTHORIZATION = "DOCUMENT_EXTRACTION_TERMINAL_RECOVERY_AUTHORIZED";

export function isRecoverableTerminalDocumentExtractionFailure(
  failureCode: string | null,
): boolean {
  return failureCode !== null && terminalRecoveryFailureCodes.has(failureCode);
}

// Kept free of extractor imports so web server actions can admit retries without bundling OCR.
function buildAuthorizedRetryAdmission(
  permit: DocumentExtractionRetryPermit,
  recoveryKey?: string,
): AsyncJobAdmissionInput {
  const retryIdentity = recoveryKey
    ? `recovery:${recoveryKey}`
    : `retry:${permit.failedAttemptId}:${permit.permitRef}`;
  return {
    operation: DOCUMENT_EXTRACTION_OPERATION,
    logicalOperationId: [
      permit.documentoId,
      permit.documentFileVersionId,
      DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
      retryIdentity,
    ].join(":"),
    purpose: DOCUMENT_EXTRACTION_PURPOSE,
    correlationId: recoveryKey
      ? `document-extraction-recovery:${recoveryKey}`
      : `document-extraction-retry:${permit.permitRef}`,
    procedimentoId: permit.procedimentoId,
    policyDecisionRef: permit.permitRef,
    inputReference: {
      referenceType: "DOCUMENT_FILE_VERSION",
      referenceId: permit.documentFileVersionId,
      referenceVersion: "V1",
      metadata: {
        documentoId: permit.documentoId,
        procedimentoId: permit.procedimentoId,
        policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
        retryAttemptId: permit.failedAttemptId,
        retryPermitRef: permit.permitRef,
      },
    },
    maxAttempts: 1,
    availableAt: permit.createdAt,
    admission: {
      admissionType: "AUTHENTICATED_USER",
      tenantId: permit.tenantId,
      initiatingUserId: permit.actor.userId,
      actor: {
        actorId: permit.actor.userId,
        actorEmail: permit.actor.userEmail,
        actorRole: permit.actor.userRole,
      },
    },
  };
}

export async function ensureAuthorizedDocumentExtractionRetryJob(
  failedAttemptId: string,
) {
  const permit = await issueDocumentExtractionRetryPermit(failedAttemptId);
  await verifyDocumentExtractionRetryPermit({
    permitRef: permit.permitRef,
    failedAttemptId: permit.failedAttemptId,
    documentoId: permit.documentoId,
    documentFileVersionId: permit.documentFileVersionId,
    tenantId: permit.tenantId,
    procedimentoId: permit.procedimentoId,
    actorUserId: permit.actor.userId,
    actorRole: permit.actor.userRole,
  });
  return admitAsyncJob(buildAuthorizedRetryAdmission(permit));
}

function referenceMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = (value as { metadata?: unknown }).metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : null;
}

async function authorizeTerminalRecovery(input: {
  terminalJobId: string;
  failedAttemptId: string;
  recoveryKey: string;
  permit: DocumentExtractionRetryPermit;
  reason: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT TRUE AS "acquired"
      FROM pg_advisory_xact_lock(
        hashtext('document-extraction-terminal-recovery:v1'),
        hashtext(${input.terminalJobId})
      )
    `;
    if (lockRows.length !== 1 || lockRows[0]?.acquired !== true) {
      throw new Error("DOCUMENT_EXTRACTION_TERMINAL_RECOVERY_LOCK_FAILED");
    }
    const existing = await tx.activityLog.findFirst({
      where: {
        azione: TERMINAL_RECOVERY_AUTHORIZATION,
        entita: "AsyncJob",
        entitaId: input.terminalJobId,
        esito: "SUCCESS",
      },
      select: { userId: true, metadata: true },
    });
    if (existing) {
      const metadata = existing.metadata && typeof existing.metadata === "object"
        && !Array.isArray(existing.metadata)
        ? existing.metadata as Record<string, unknown>
        : null;
      if (
        existing.userId !== input.permit.actor.userId
        || metadata?.failedAttemptId !== input.failedAttemptId
        || metadata?.recoveryKey !== input.recoveryKey
      ) {
        throw new Error("DOCUMENT_EXTRACTION_TERMINAL_RECOVERY_ALREADY_AUTHORIZED");
      }
      return;
    }
    await createAuditLogInTransaction(tx, {
      azione: TERMINAL_RECOVERY_AUTHORIZATION,
      entita: "AsyncJob",
      entitaId: input.terminalJobId,
      enteId: input.permit.tenantId,
      esito: "SUCCESS",
      actor: {
        userId: input.permit.actor.userId,
        userEmail: input.permit.actor.userEmail,
        userRole: input.permit.actor.userRole,
      },
      metadata: {
        failedAttemptId: input.failedAttemptId,
        documentFileVersionId: input.permit.documentFileVersionId,
        recoveryKey: input.recoveryKey,
        reason: input.reason,
      },
    });
  });
}

export async function ensureAuthorizedTerminalDocumentExtractionRecoveryJob(input: {
  terminalJobId: string;
  failedAttemptId: string;
  reason: string;
}) {
  const terminalJobId = identifier.parse(input.terminalJobId);
  const failedAttemptId = identifier.parse(input.failedAttemptId);
  const reason = z.string().trim().min(10).max(500).parse(input.reason);
  const sourceJob = await prisma.asyncJob.findUnique({
    where: { id: terminalJobId },
    select: {
      operation: true,
      status: true,
      failureCode: true,
      tenantId: true,
      procedimentoId: true,
      inputReference: true,
    },
  });
  const metadata = referenceMetadata(sourceJob?.inputReference);
  if (
    !sourceJob
    || sourceJob.operation !== DOCUMENT_EXTRACTION_OPERATION
    || sourceJob.status !== "TERMINAL_FAILED"
    || !isRecoverableTerminalDocumentExtractionFailure(sourceJob.failureCode)
    || metadata?.retryAttemptId !== failedAttemptId
    || typeof metadata.retryPermitRef !== "string"
  ) {
    throw new Error("DOCUMENT_EXTRACTION_TERMINAL_RECOVERY_NOT_ELIGIBLE");
  }
  const permit = await issueDocumentExtractionRetryPermit(failedAttemptId);
  if (
    !sourceJob.tenantId
    || sourceJob.tenantId !== permit.tenantId
    || sourceJob.procedimentoId !== permit.procedimentoId
    || metadata.retryPermitRef !== permit.permitRef
  ) {
    throw new Error("DOCUMENT_EXTRACTION_TERMINAL_RECOVERY_SCOPE_MISMATCH");
  }
  await verifyDocumentExtractionRetryPermit({
    permitRef: permit.permitRef,
    failedAttemptId: permit.failedAttemptId,
    documentoId: permit.documentoId,
    documentFileVersionId: permit.documentFileVersionId,
    tenantId: permit.tenantId,
    procedimentoId: permit.procedimentoId,
    actorUserId: permit.actor.userId,
    actorRole: permit.actor.userRole,
  });

  const recoveryKey = createHash("sha256").update([
    terminalJobId,
    failedAttemptId,
    permit.permitRef,
  ].join("\n"), "utf8").digest("hex");
  await authorizeTerminalRecovery({
    terminalJobId,
    failedAttemptId,
    recoveryKey,
    permit,
    reason,
  });
  return admitAsyncJob(buildAuthorizedRetryAdmission(permit, recoveryKey));
}

export interface RecoverableFascicoloTerminalExtraction {
  readonly terminalJobId: string;
  readonly failedAttemptId: string;
}

export async function listRecoverableFascicoloTerminalDocumentExtractions(input: {
  tenantId: string;
  procedimentoId: string;
  limit?: number;
}): Promise<RecoverableFascicoloTerminalExtraction[]> {
  const limit = z.number().int().min(1).max(5).parse(input.limit ?? 5);
  const jobs = await prisma.asyncJob.findMany({
    where: {
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      operation: DOCUMENT_EXTRACTION_OPERATION,
      status: "TERMINAL_FAILED",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true,
      failureCode: true,
      inputReference: true,
    },
  });
  const candidates = jobs.flatMap((job) => {
    const metadata = referenceMetadata(job.inputReference);
    return isRecoverableTerminalDocumentExtractionFailure(job.failureCode)
      && typeof metadata?.retryAttemptId === "string"
      && typeof metadata.retryPermitRef === "string"
      ? [{
          terminalJobId: job.id,
          failedAttemptId: metadata.retryAttemptId,
        }]
      : [];
  });
  const attemptIds = [...new Set(candidates.map((candidate) => candidate.failedAttemptId))];
  if (attemptIds.length === 0) return [];

  const attempts = await prisma.documentExtractionAttempt.findMany({
    where: {
      id: { in: attemptIds },
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      outcome: "FAILED",
      documento: { statoDocumento: "ATTIVO" },
    },
    select: {
      id: true,
      failureCode: true,
      documentFileVersionId: true,
      documento: {
        select: { currentFileVersionId: true },
      },
    },
  });
  const eligibleAttemptIds = new Set(attempts.flatMap((attempt) =>
    attempt.documento.currentFileVersionId === attempt.documentFileVersionId
      && isRetryableDocumentExtractionFailure(attempt.failureCode)
      ? [attempt.id]
      : []));
  const selected: RecoverableFascicoloTerminalExtraction[] = [];
  const selectedAttemptIds = new Set<string>();
  for (const candidate of candidates) {
    if (
      eligibleAttemptIds.has(candidate.failedAttemptId)
      && !selectedAttemptIds.has(candidate.failedAttemptId)
    ) {
      selected.push(candidate);
      selectedAttemptIds.add(candidate.failedAttemptId);
    }
    if (selected.length === limit) break;
  }
  return selected;
}

interface FascicoloTerminalRecoveryDependencies {
  list: typeof listRecoverableFascicoloTerminalDocumentExtractions;
  recover: typeof ensureAuthorizedTerminalDocumentExtractionRecoveryJob;
}

const defaultFascicoloTerminalRecoveryDependencies: FascicoloTerminalRecoveryDependencies = {
  list: listRecoverableFascicoloTerminalDocumentExtractions,
  recover: ensureAuthorizedTerminalDocumentExtractionRecoveryJob,
};

export async function ensureAuthorizedFascicoloTerminalDocumentExtractionRecoveries(
  input: {
    tenantId: string;
    procedimentoId: string;
    reason: string;
    limit?: number;
  },
  dependencies: FascicoloTerminalRecoveryDependencies = defaultFascicoloTerminalRecoveryDependencies,
) {
  const targets = await dependencies.list({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    limit: input.limit,
  });
  const admissions = [];
  for (const target of targets) {
    admissions.push(await dependencies.recover({
      terminalJobId: target.terminalJobId,
      failedAttemptId: target.failedAttemptId,
      reason: input.reason,
    }));
  }
  return {
    targetCount: targets.length,
    createdJobCount: admissions.filter((admission) => admission.outcome === "CREATED").length,
    reusedJobCount: admissions.filter((admission) => admission.outcome === "REUSED").length,
  };
}

export async function ensureAuthorizedFascicoloTerminalDocumentExtractionRecovery(
  input: {
    tenantId: string;
    procedimentoId: string;
    failedAttemptId: string;
    reason: string;
  },
  dependencies: FascicoloTerminalRecoveryDependencies = defaultFascicoloTerminalRecoveryDependencies,
) {
  const failedAttemptId = identifier.parse(input.failedAttemptId);
  const targets = await dependencies.list({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    limit: 5,
  });
  const target = targets.find((candidate) => candidate.failedAttemptId === failedAttemptId);
  if (!target) {
    throw new Error("DOCUMENT_EXTRACTION_TERMINAL_RECOVERY_NOT_ELIGIBLE");
  }
  return dependencies.recover({
    terminalJobId: target.terminalJobId,
    failedAttemptId: target.failedAttemptId,
    reason: input.reason,
  });
}
