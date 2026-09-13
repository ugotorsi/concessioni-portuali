import { randomBytes } from "node:crypto";

import { z } from "zod";

import { Prisma, type AsyncJob } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import {
  type AsyncJobAdmissionInput,
  type AsyncJobFailure,
  normalizeAsyncJobAdmission,
  normalizeAsyncJobFailure,
  normalizeAsyncJobResultMetadata,
} from "./domain";
import type {
  AsyncJobTerminalFailureHook,
  AsyncJobTerminalFailureResolution,
} from "./registry";

const identifier = z.string().trim().min(1).max(256);
const jobId = identifier;
const leaseToken = z.string().regex(/^[0-9a-f]{64}$/);
const durationMs = z.number().int().min(1_000).max(24 * 60 * 60 * 1_000);
const retryDelayMs = z.number().int().min(0).max(30 * 24 * 60 * 60 * 1_000);

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isIdempotencyP2002(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const meta = error.meta as { modelName?: unknown; target?: unknown } | undefined;
  if (meta?.modelName !== "AsyncJob") return false;
  const target = meta.target;
  return target === "AsyncJob_idempotencyKey_key"
    || target === "idempotencyKey"
    || (Array.isArray(target) && target.length === 1 && target[0] === "idempotencyKey");
}

export class AsyncJobIdempotencyConflictError extends Error {
  readonly code = "ASYNC_JOB_IDEMPOTENCY_CONFLICT" as const;

  constructor() {
    super("ASYNC_JOB_IDEMPOTENCY_CONFLICT");
    this.name = "AsyncJobIdempotencyConflictError";
  }
}

export class AsyncJobLeaseConflictError extends Error {
  readonly code = "ASYNC_JOB_LEASE_CONFLICT" as const;

  constructor() {
    super("ASYNC_JOB_LEASE_CONFLICT");
    this.name = "AsyncJobLeaseConflictError";
  }
}

function reuseOrConflict(existing: AsyncJob, requestFingerprint: string) {
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new AsyncJobIdempotencyConflictError();
  }
  return { outcome: "REUSED" as const, job: existing };
}

export async function admitAsyncJobInTransaction(
  tx: Prisma.TransactionClient,
  rawInput: AsyncJobAdmissionInput,
) {
  const input = normalizeAsyncJobAdmission(rawInput);
  const existing = await tx.asyncJob.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return reuseOrConflict(existing, input.requestFingerprint);
  const job = await tx.asyncJob.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      operation: input.operation,
      logicalOperationId: input.logicalOperationId,
      purpose: input.purpose,
      correlationId: input.correlationId,
      policyDecisionRef: input.policyDecisionRef,
      inputReference: json(input.inputReference),
      admissionType: input.admission.admissionType,
      tenantId: input.admission.tenantId,
      initiatingUserId: input.admission.initiatingUserId,
      actorId: input.admission.actor.actorId,
      actorEmail: input.admission.actor.actorEmail,
      actorRole: input.admission.actor.actorRole,
      maxAttempts: input.maxAttempts,
      availableAt: input.availableAt,
    },
  });
  await createAuditLogInTransaction(tx, {
    azione: "ASYNC_JOB_ADMITTED",
    entita: "AsyncJob",
    entitaId: job.id,
    enteId: input.admission.tenantId,
    esito: "SUCCESS",
    actor: {
      userId: input.admission.initiatingUserId,
      userEmail: input.admission.actor.actorEmail,
      userRole: input.admission.actor.actorRole,
    },
    metadata: {
      admissionType: input.admission.admissionType,
      actorId: input.admission.actor.actorId,
      operation: input.operation,
      purpose: input.purpose,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    },
  });
  return { outcome: "CREATED" as const, job };
}

export async function admitAsyncJob(input: AsyncJobAdmissionInput) {
  const normalized = normalizeAsyncJobAdmission(input);
  try {
    return await runSerializableTransactionWithRetry((tx) => admitAsyncJobInTransaction(tx, input));
  } catch (error) {
    if (!isIdempotencyP2002(error)) throw error;
    const existing = await prisma.asyncJob.findUnique({ where: { idempotencyKey: normalized.idempotencyKey } });
    if (!existing) throw error;
    return reuseOrConflict(existing, normalized.requestFingerprint);
  }
}

export interface AsyncJobClaimInput {
  workerId: string;
  leaseDurationMs: number;
  resolveTerminalFailureHook?: (operation: string) => AsyncJobTerminalFailureHook | undefined;
}

async function resolveTerminalFailureInTransaction(
  tx: Prisma.TransactionClient,
  job: AsyncJob,
  failure: AsyncJobFailure,
  hook?: AsyncJobTerminalFailureHook,
): Promise<AsyncJobTerminalFailureResolution> {
  if (!hook) return { outcome: "TERMINAL_FAILED" };
  return hook(tx, {
    jobId: job.id,
    operation: job.operation,
    tenantId: job.tenantId,
    correlationId: job.correlationId,
    inputReference: job.inputReference,
    attempt: job.attemptCount,
    maxAttempts: job.maxAttempts,
    failure,
  });
}

async function finalizeExpiredJobInTransaction(
  tx: Prisma.TransactionClient,
  job: AsyncJob,
  failure: AsyncJobFailure,
  hook?: AsyncJobTerminalFailureHook,
) {
  const resolution = await resolveTerminalFailureInTransaction(tx, job, failure, hook);
  const resultReference = resolution.outcome === "SUCCEEDED"
    ? JSON.stringify(normalizeAsyncJobResultMetadata(resolution.resultReference))
    : null;
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE "AsyncJob"
    SET "status" = ${resolution.outcome}::"AsyncJobStatus",
        "completedAt" = CURRENT_TIMESTAMP,
        "leaseOwner" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL,
        "lastHeartbeatAt" = NULL,
        "failureCategory" = ${resolution.outcome === "TERMINAL_FAILED" ? failure.category : null},
        "failureCode" = ${resolution.outcome === "TERMINAL_FAILED" ? failure.code : null},
        "resultReference" = ${resultReference}::jsonb,
        "stateVersion" = "stateVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${job.id} AND "status" = 'RUNNING'
      AND "leaseExpiresAt" <= CURRENT_TIMESTAMP
      AND "attemptCount" >= "maxAttempts"
  `);
  requireTransition(count);
}

async function reconcileGuardedExpiredJobs(input: AsyncJobClaimInput): Promise<void> {
  if (!input.resolveTerminalFailureHook) return;
  const candidates = await prisma.$queryRaw<Array<Pick<AsyncJob, "id" | "operation">>>(Prisma.sql`
    SELECT "id", "operation" FROM "AsyncJob"
    WHERE "status" = 'RUNNING'
      AND "leaseExpiresAt" <= CURRENT_TIMESTAMP
      AND "attemptCount" >= "maxAttempts"
    ORDER BY "createdAt" ASC, "id" ASC
  `);
  for (const candidate of candidates) {
    const hook = input.resolveTerminalFailureHook(candidate.operation);
    if (!hook) continue;
    try {
      await runSerializableTransactionWithRetry(async (tx) => {
        const rows = await tx.$queryRaw<AsyncJob[]>(Prisma.sql`
          SELECT * FROM "AsyncJob"
          WHERE "id" = ${candidate.id}
            AND "status" = 'RUNNING'
            AND "leaseExpiresAt" <= CURRENT_TIMESTAMP
            AND "attemptCount" >= "maxAttempts"
          FOR UPDATE
        `);
        const job = rows[0];
        if (!job) return;
        await finalizeExpiredJobInTransaction(tx, job, {
          retryable: true,
          category: "CRASH_RECOVERY",
          code: "RETRY_EXHAUSTED",
        }, hook);
      });
    } catch {
      // The guarded transaction rolled back; a later drain retries this recovery.
    }
  }
}

export async function claimNextAsyncJob(input: AsyncJobClaimInput): Promise<AsyncJob | null> {
  const workerId = identifier.parse(input.workerId);
  const leaseMs = durationMs.parse(input.leaseDurationMs);
  const token = randomBytes(32).toString("hex");

  await reconcileGuardedExpiredJobs(input);
  return runSerializableTransactionWithRetry(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "AsyncJob"
      SET "status" = 'CANCELLED', "completedAt" = CURRENT_TIMESTAMP,
          "leaseOwner" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL,
          "lastHeartbeatAt" = NULL, "stateVersion" = "stateVersion" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "status" = 'CANCELLATION_REQUESTED'
        AND "leaseExpiresAt" <= CURRENT_TIMESTAMP
    `);
    if (!input.resolveTerminalFailureHook) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "AsyncJob"
        SET "status" = 'TERMINAL_FAILED', "completedAt" = CURRENT_TIMESTAMP,
            "leaseOwner" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL,
            "lastHeartbeatAt" = NULL, "failureCategory" = 'CRASH_RECOVERY',
            "failureCode" = 'RETRY_EXHAUSTED', "stateVersion" = "stateVersion" + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "status" = 'RUNNING'
          AND "leaseExpiresAt" <= CURRENT_TIMESTAMP
          AND "attemptCount" >= "maxAttempts"
      `);
    } else {
      const exhausted = await tx.$queryRaw<AsyncJob[]>(Prisma.sql`
        SELECT * FROM "AsyncJob"
        WHERE "status" = 'RUNNING'
          AND "leaseExpiresAt" <= CURRENT_TIMESTAMP
          AND "attemptCount" >= "maxAttempts"
        FOR UPDATE
      `);
      for (const job of exhausted) {
        if (input.resolveTerminalFailureHook(job.operation)) continue;
        await finalizeExpiredJobInTransaction(tx, job, {
          retryable: true,
          category: "CRASH_RECOVERY",
          code: "RETRY_EXHAUSTED",
        });
      }
    }
    const claimed = await tx.$queryRaw<AsyncJob[]>(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "AsyncJob"
        WHERE "attemptCount" < "maxAttempts"
          AND (
            ("status" IN ('QUEUED', 'RETRY_WAIT') AND "availableAt" <= CURRENT_TIMESTAMP)
            OR ("status" = 'RUNNING' AND "leaseExpiresAt" <= CURRENT_TIMESTAMP)
          )
        ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "AsyncJob" AS job
      SET "status" = 'RUNNING', "attemptCount" = job."attemptCount" + 1,
          "leaseOwner" = ${workerId}, "leaseToken" = ${token},
          "leaseExpiresAt" = CURRENT_TIMESTAMP + (${leaseMs} * INTERVAL '1 millisecond'),
          "lastHeartbeatAt" = CURRENT_TIMESTAMP,
          "startedAt" = COALESCE(job."startedAt", CURRENT_TIMESTAMP),
          "failureCategory" = NULL, "failureCode" = NULL,
          "stateVersion" = job."stateVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING job.*
    `);
    return claimed[0] ?? null;
  });
}

interface LeaseInput {
  jobId: string;
  workerId: string;
  leaseToken: string;
}

export type AsyncJobCancellationReconciliationOutcome =
  | "CURRENT_LEASE_CANCELLATION_REQUESTED"
  | "TERMINAL_CANCELLED_OBSERVED"
  | "LEASE_AUTHORITY_LOST"
  | "NOT_RECONCILABLE";

function parseLease(input: LeaseInput) {
  return {
    jobId: jobId.parse(input.jobId),
    workerId: identifier.parse(input.workerId),
    leaseToken: leaseToken.parse(input.leaseToken),
  };
}

function requireTransition(count: number): void {
  if (count !== 1) throw new AsyncJobLeaseConflictError();
}

export async function heartbeatAsyncJob(input: LeaseInput & { leaseDurationMs: number }) {
  const lease = parseLease(input);
  const leaseMs = durationMs.parse(input.leaseDurationMs);
  const count = await prisma.$executeRaw(Prisma.sql`
    UPDATE "AsyncJob"
    SET "leaseExpiresAt" = CURRENT_TIMESTAMP + (${leaseMs} * INTERVAL '1 millisecond'),
        "lastHeartbeatAt" = CURRENT_TIMESTAMP, "stateVersion" = "stateVersion" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${lease.jobId}
      AND "status" IN ('RUNNING', 'CANCELLATION_REQUESTED')
      AND "leaseOwner" = ${lease.workerId}
      AND "leaseToken" = ${lease.leaseToken}
      AND "leaseExpiresAt" > CURRENT_TIMESTAMP
  `);
  requireTransition(count);
}

export async function succeedAsyncJob(input: LeaseInput & { resultReference: unknown }) {
  const lease = parseLease(input);
  const resultReference = normalizeAsyncJobResultMetadata(input.resultReference);
  const serializedResult = JSON.stringify(resultReference);
  const count = await prisma.$executeRaw(Prisma.sql`
    UPDATE "AsyncJob"
    SET "status" = 'SUCCEEDED', "completedAt" = CURRENT_TIMESTAMP,
        "resultReference" = ${serializedResult}::jsonb,
        "leaseOwner" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL,
        "lastHeartbeatAt" = NULL, "stateVersion" = "stateVersion" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${lease.jobId} AND "status" = 'RUNNING'
      AND "cancellationRequestedAt" IS NULL
      AND "leaseOwner" = ${lease.workerId} AND "leaseToken" = ${lease.leaseToken}
      AND "leaseExpiresAt" > CURRENT_TIMESTAMP
  `);
  requireTransition(count);
}

export async function failAsyncJob(input: LeaseInput & {
  failure: AsyncJobFailure;
  retryDelayMs: number;
  beforeTerminalFailureInTransaction?: AsyncJobTerminalFailureHook;
}) {
  const lease = parseLease(input);
  const failure = normalizeAsyncJobFailure(input.failure);
  const delay = retryDelayMs.parse(input.retryDelayMs);
  return runSerializableTransactionWithRetry(async (tx) => {
    const rows = await tx.$queryRaw<AsyncJob[]>(Prisma.sql`
      SELECT *
      FROM "AsyncJob"
      WHERE "id" = ${lease.jobId} AND "status" = 'RUNNING'
        AND "leaseOwner" = ${lease.workerId} AND "leaseToken" = ${lease.leaseToken}
        AND "leaseExpiresAt" > CURRENT_TIMESTAMP
      FOR UPDATE
    `);
    const current = rows[0];
    if (!current) throw new AsyncJobLeaseConflictError();
    const willRetry = failure.retryable && current.attemptCount < current.maxAttempts;
    let terminalResolution: AsyncJobTerminalFailureResolution = { outcome: "TERMINAL_FAILED" };
    if (!willRetry) {
      terminalResolution = await resolveTerminalFailureInTransaction(
        tx,
        current,
        failure,
        input.beforeTerminalFailureInTransaction,
      );
    }
    const resultReference = terminalResolution.outcome === "SUCCEEDED"
      ? JSON.stringify(normalizeAsyncJobResultMetadata(terminalResolution.resultReference))
      : null;
    const transition = willRetry
      ? await tx.$executeRaw(Prisma.sql`
          UPDATE "AsyncJob"
          SET "status" = 'RETRY_WAIT',
              "availableAt" = CURRENT_TIMESTAMP + (${delay} * INTERVAL '1 millisecond'),
              "failureCategory" = ${failure.category}, "failureCode" = ${failure.code},
              "leaseOwner" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL,
              "lastHeartbeatAt" = NULL, "stateVersion" = "stateVersion" + 1,
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${lease.jobId} AND "status" = 'RUNNING'
            AND "leaseOwner" = ${lease.workerId} AND "leaseToken" = ${lease.leaseToken}
            AND "leaseExpiresAt" > CURRENT_TIMESTAMP
        `)
      : await tx.$executeRaw(Prisma.sql`
          UPDATE "AsyncJob"
            SET "status" = ${terminalResolution.outcome}::"AsyncJobStatus",
              "completedAt" = CURRENT_TIMESTAMP,
              "failureCategory" = ${terminalResolution.outcome === "TERMINAL_FAILED" ? failure.category : null},
              "failureCode" = ${terminalResolution.outcome === "TERMINAL_FAILED" ? failure.code : null},
              "resultReference" = ${resultReference}::jsonb,
              "leaseOwner" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL,
              "lastHeartbeatAt" = NULL, "stateVersion" = "stateVersion" + 1,
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${lease.jobId} AND "status" = 'RUNNING'
            AND "leaseOwner" = ${lease.workerId} AND "leaseToken" = ${lease.leaseToken}
            AND "leaseExpiresAt" > CURRENT_TIMESTAMP
        `);
    requireTransition(transition);
    return { outcome: willRetry ? "RETRY_SCHEDULED" as const : terminalResolution.outcome };
  });
}

export async function requestAsyncJobCancellation(id: string) {
  const parsedId = jobId.parse(id);
  return runSerializableTransactionWithRetry(async (tx) => {
    const current = await tx.asyncJob.findUnique({ where: { id: parsedId } });
    if (!current) return { outcome: "NOT_FOUND" as const };
    if (["SUCCEEDED", "TERMINAL_FAILED", "CANCELLED"].includes(current.status)) {
      return { outcome: "TERMINAL" as const, job: current };
    }
    const queued = current.status === "QUEUED" || current.status === "RETRY_WAIT";
    if (current.status === "CANCELLATION_REQUESTED") {
      return { outcome: "REQUESTED" as const, job: current };
    }
    const transition = await tx.$executeRaw(Prisma.sql`
      UPDATE "AsyncJob"
      SET "status" = ${queued ? "CANCELLED" : "CANCELLATION_REQUESTED"}::"AsyncJobStatus",
          "cancellationRequestedAt" = CURRENT_TIMESTAMP,
          "completedAt" = CASE WHEN ${queued} THEN CURRENT_TIMESTAMP ELSE "completedAt" END,
          "failureCategory" = CASE WHEN ${queued} THEN NULL ELSE "failureCategory" END,
          "failureCode" = CASE WHEN ${queued} THEN NULL ELSE "failureCode" END,
          "stateVersion" = "stateVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${current.id} AND "status" = ${current.status}::"AsyncJobStatus"
        AND "stateVersion" = ${current.stateVersion}
    `);
    requireTransition(transition);
    const job = await tx.asyncJob.findUniqueOrThrow({ where: { id: current.id } });
    return { outcome: queued ? "CANCELLED" as const : "REQUESTED" as const, job };
  });
}

export async function finalizeAsyncJobCancellation(input: LeaseInput) {
  const lease = parseLease(input);
  const count = await prisma.$executeRaw(Prisma.sql`
    UPDATE "AsyncJob"
    SET "status" = 'CANCELLED', "completedAt" = CURRENT_TIMESTAMP,
        "leaseOwner" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL,
        "lastHeartbeatAt" = NULL, "stateVersion" = "stateVersion" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${lease.jobId} AND "status" = 'CANCELLATION_REQUESTED'
      AND "leaseOwner" = ${lease.workerId} AND "leaseToken" = ${lease.leaseToken}
      AND "leaseExpiresAt" > CURRENT_TIMESTAMP
  `);
  requireTransition(count);
}

export async function isAsyncJobCancellationRequested(input: LeaseInput): Promise<boolean> {
  const lease = parseLease(input);
  const rows = await prisma.$queryRaw<Array<Pick<AsyncJob, "status">>>(Prisma.sql`
    SELECT "status"
    FROM "AsyncJob"
    WHERE "id" = ${lease.jobId}
      AND "status" IN ('RUNNING', 'CANCELLATION_REQUESTED')
      AND "leaseOwner" = ${lease.workerId} AND "leaseToken" = ${lease.leaseToken}
      AND "leaseExpiresAt" > CURRENT_TIMESTAMP
  `);
  const job = rows[0];
  if (!job) throw new AsyncJobLeaseConflictError();
  return job.status === "CANCELLATION_REQUESTED";
}

export async function reconcileAsyncJobCancellationAfterLeaseConflict(
  input: LeaseInput,
): Promise<AsyncJobCancellationReconciliationOutcome> {
  const lease = parseLease(input);
  const rows = await prisma.$queryRaw<Array<{
    status: AsyncJob["status"];
    leaseOwnerMatches: boolean;
    leaseTokenMatches: boolean;
    leaseIsValid: boolean;
  }>>(Prisma.sql`
    SELECT "status",
      "leaseOwner" = ${lease.workerId} AS "leaseOwnerMatches",
      "leaseToken" = ${lease.leaseToken} AS "leaseTokenMatches",
      COALESCE("leaseExpiresAt" > CURRENT_TIMESTAMP, FALSE) AS "leaseIsValid"
    FROM "AsyncJob"
    WHERE "id" = ${lease.jobId}
  `);
  const job = rows[0];
  if (!job) return "LEASE_AUTHORITY_LOST";
  if (job.status === "CANCELLED") {
    return "TERMINAL_CANCELLED_OBSERVED";
  }
  if (!job.leaseOwnerMatches || !job.leaseTokenMatches || !job.leaseIsValid) {
    return "LEASE_AUTHORITY_LOST";
  }
  return job.status === "CANCELLATION_REQUESTED"
    ? "CURRENT_LEASE_CANCELLATION_REQUESTED"
    : "NOT_RECONCILABLE";
}