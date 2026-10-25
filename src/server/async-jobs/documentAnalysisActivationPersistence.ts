import { randomBytes } from "node:crypto";

import { z } from "zod";

import { Prisma, type AsyncJob } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

const identifier = z.string().trim().min(1).max(256);
const activationAttemptId = z.string().regex(/^[0-9a-f]{32}$/);
const renderJobId = z.string().regex(/^job-[a-z0-9]+$/);

export const documentAnalysisActivationTargetSchema = z.object({
  applicationJobId: identifier,
  tenantId: identifier,
  procedimentoId: identifier,
}).strict();

export type DocumentAnalysisActivationTarget = z.output<
  typeof documentAnalysisActivationTargetSchema
>;

export type DocumentAnalysisActivationState =
  | "NOT_REQUESTED"
  | "REQUESTING"
  | "CONFIRMED"
  | "REMOTE_UNKNOWN"
  | "FAILED_VERIFIED";

const activationActions = Object.freeze({
  NOT_REQUESTED: "DOCUMENT_ANALYSIS_ACTIVATION_NOT_REQUESTED",
  REQUESTING: "DOCUMENT_ANALYSIS_ACTIVATION_REQUESTING",
  CONFIRMED: "DOCUMENT_ANALYSIS_ACTIVATION_CONFIRMED",
  REMOTE_UNKNOWN: "DOCUMENT_ANALYSIS_ACTIVATION_REMOTE_UNKNOWN",
  FAILED_VERIFIED: "DOCUMENT_ANALYSIS_ACTIVATION_FAILED_VERIFIED",
} satisfies Record<DocumentAnalysisActivationState, string>);

const activationActionValues = Object.values(activationActions);

export interface DocumentAnalysisActivationSnapshot {
  readonly state: DocumentAnalysisActivationState;
  readonly activationAttemptId: string | null;
  readonly renderJobId: string | null;
  readonly failureCode: string | null;
}

interface StoredActivationSnapshot extends DocumentAnalysisActivationSnapshot {
  readonly sequence: number;
}

interface LockedActivationJob {
  readonly job: AsyncJob;
  readonly databaseNow: Date;
}

function publicSnapshot(
  current: StoredActivationSnapshot,
): DocumentAnalysisActivationSnapshot {
  return {
    state: current.state,
    activationAttemptId: current.activationAttemptId,
    renderJobId: current.renderJobId,
    failureCode: current.failureCode,
  };
}

export class DocumentAnalysisActivationTargetError extends Error {
  constructor(
    readonly code:
      | "TARGET_NOT_FOUND"
      | "TARGET_SCOPE_MISMATCH"
      | "TARGET_AUTHORITY_MISMATCH"
      | "TARGET_NOT_ELIGIBLE"
      | "TARGET_DEPENDENCY_NOT_READY"
      | "ACTIVATION_STATE_CONFLICT",
  ) {
    super(code);
    this.name = "DocumentAnalysisActivationTargetError";
  }
}

function record(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : null;
}

function stateForAction(action: string): DocumentAnalysisActivationState | null {
  const entry = Object.entries(activationActions)
    .find(([, candidate]) => candidate === action);
  return entry?.[0] as DocumentAnalysisActivationState | undefined ?? null;
}

function snapshot(
  action: string | undefined,
  metadata: Prisma.JsonValue | null | undefined,
): StoredActivationSnapshot {
  const state = action ? stateForAction(action) : null;
  if (!state) {
    return {
      state: "NOT_REQUESTED",
      activationAttemptId: null,
      renderJobId: null,
      failureCode: null,
      sequence: 0,
    };
  }
  const values = record(metadata ?? null);
  const attempt = typeof values?.activationAttemptId === "string"
    && activationAttemptId.safeParse(values.activationAttemptId).success
    ? values.activationAttemptId
    : null;
  const remoteId = typeof values?.renderJobId === "string"
    && renderJobId.safeParse(values.renderJobId).success
    ? values.renderJobId
    : null;
  return {
    state,
    activationAttemptId: attempt,
    renderJobId: remoteId,
    failureCode: typeof values?.failureCode === "string" ? values.failureCode : null,
    sequence: typeof values?.activationSequence === "number"
      && Number.isSafeInteger(values.activationSequence)
      && values.activationSequence > 0
      ? values.activationSequence
      : 0,
  };
}

async function lockTarget(
  tx: Prisma.TransactionClient,
  target: DocumentAnalysisActivationTarget,
): Promise<LockedActivationJob> {
  const rows = await tx.$queryRaw<Array<AsyncJob & { databaseNow: Date }>>(Prisma.sql`
    SELECT job.*, CURRENT_TIMESTAMP AS "databaseNow"
    FROM "AsyncJob" AS job
    WHERE "id" = ${target.applicationJobId}
    FOR UPDATE
  `);
  const locked = rows[0];
  if (!locked) throw new DocumentAnalysisActivationTargetError("TARGET_NOT_FOUND");
  const { databaseNow, ...job } = locked;
  if (
    job.operation !== "FASCICOLO.AUTOMATIC_ANALYSIS_V1"
    || job.tenantId !== target.tenantId
    || job.procedimentoId !== target.procedimentoId
  ) {
    throw new DocumentAnalysisActivationTargetError("TARGET_SCOPE_MISMATCH");
  }
  const inputReference = record(job.inputReference);
  const metadata = record(inputReference?.metadata ?? null);
  if (
    metadata?.procedimentoId !== target.procedimentoId
    || (
      job.admissionType === "AUTHENTICATED_USER"
      && (!job.initiatingUserId || job.actorId !== job.initiatingUserId)
    )
    || (
      job.admissionType === "AUTHORIZED_SYSTEM"
      && (job.initiatingUserId !== null || !job.policyDecisionRef)
    )
  ) {
    throw new DocumentAnalysisActivationTargetError("TARGET_AUTHORITY_MISMATCH");
  }
  return { job: job as AsyncJob, databaseNow };
}

async function latestSnapshot(
  tx: Prisma.TransactionClient,
  applicationJobId: string,
): Promise<StoredActivationSnapshot> {
  const entries = await tx.activityLog.findMany({
    where: {
      entita: "AsyncJob",
      entitaId: applicationJobId,
      azione: { in: activationActionValues },
    },
    select: { azione: true, metadata: true },
  });
  return entries
    .map((entry) => snapshot(entry.azione, entry.metadata))
    .reduce<StoredActivationSnapshot>(
      (latest, candidate) => candidate.sequence > latest.sequence ? candidate : latest,
      snapshot(undefined, undefined),
    );
}

async function requireEligible(
  tx: Prisma.TransactionClient,
  job: AsyncJob,
  databaseNow: Date,
): Promise<void> {
  if (
    !["QUEUED", "RETRY_WAIT"].includes(job.status)
    || job.attemptCount >= job.maxAttempts
    || job.availableAt.getTime() > databaseNow.getTime()
  ) {
    throw new DocumentAnalysisActivationTargetError("TARGET_NOT_ELIGIBLE");
  }
  if (!job.dependsOnJobId) return;
  const dependency = await tx.asyncJob.findUnique({
    where: { id: job.dependsOnJobId },
    select: { status: true },
  });
  if (dependency?.status !== "SUCCEEDED") {
    throw new DocumentAnalysisActivationTargetError("TARGET_DEPENDENCY_NOT_READY");
  }
}

async function appendState(
  tx: Prisma.TransactionClient,
  job: AsyncJob,
  state: DocumentAnalysisActivationState,
  input: {
    activationAttemptId?: string | null;
    renderJobId?: string | null;
    failureCode?: string | null;
    reconciled?: boolean;
    sequence: number;
  },
): Promise<void> {
  await createAuditLogInTransaction(tx, {
    azione: activationActions[state],
    entita: "AsyncJob",
    entitaId: job.id,
    enteId: job.tenantId,
    esito: state === "CONFIRMED" || state === "REQUESTING" || state === "NOT_REQUESTED"
      ? "SUCCESS"
      : "FAILURE",
    actor: {
      userId: job.initiatingUserId,
      userEmail: job.actorEmail,
      userRole: job.actorRole,
    },
    metadata: {
      activationAttemptId: input.activationAttemptId ?? null,
      activationSequence: input.sequence,
      renderJobId: input.renderJobId ?? null,
      failureCode: input.failureCode ?? null,
      reconciled: input.reconciled ?? false,
      operation: job.operation,
      procedimentoId: job.procedimentoId,
    },
  });
}

export async function beginDocumentAnalysisActivation(
  rawTarget: DocumentAnalysisActivationTarget,
) {
  const target = documentAnalysisActivationTargetSchema.parse(rawTarget);
  return runSerializableTransactionWithRetry(async (tx) => {
    const { job, databaseNow } = await lockTarget(tx, target);
    const current = await latestSnapshot(tx, job.id);
    if (current.state !== "NOT_REQUESTED") {
      return { outcome: "EXISTING" as const, snapshot: publicSnapshot(current) };
    }
    await requireEligible(tx, job, databaseNow);
    const attemptId = randomBytes(16).toString("hex");
    await appendState(tx, job, "REQUESTING", {
      activationAttemptId: attemptId,
      sequence: current.sequence + 1,
    });
    return {
      outcome: "RESERVED" as const,
      snapshot: {
        state: "REQUESTING" as const,
        activationAttemptId: attemptId,
        renderJobId: null,
        failureCode: null,
      },
    };
  });
}

export async function completeDocumentAnalysisActivation(input: {
  target: DocumentAnalysisActivationTarget;
  activationAttemptId: string;
  state: "CONFIRMED" | "REMOTE_UNKNOWN" | "FAILED_VERIFIED";
  renderJobId?: string | null;
  failureCode?: string | null;
}) {
  const target = documentAnalysisActivationTargetSchema.parse(input.target);
  const attemptId = activationAttemptId.parse(input.activationAttemptId);
  const remoteId = input.renderJobId == null ? null : renderJobId.parse(input.renderJobId);
  return runSerializableTransactionWithRetry(async (tx) => {
    const { job } = await lockTarget(tx, target);
    const current = await latestSnapshot(tx, job.id);
    if (
      current.state !== "REQUESTING"
      || current.activationAttemptId !== attemptId
    ) {
      throw new DocumentAnalysisActivationTargetError("ACTIVATION_STATE_CONFLICT");
    }
    if (input.state === "CONFIRMED" && !remoteId) {
      throw new DocumentAnalysisActivationTargetError("ACTIVATION_STATE_CONFLICT");
    }
    await appendState(tx, job, input.state, {
      activationAttemptId: attemptId,
      renderJobId: remoteId,
      failureCode: input.failureCode ?? null,
      sequence: current.sequence + 1,
    });
    return {
      state: input.state,
      activationAttemptId: attemptId,
      renderJobId: remoteId,
      failureCode: input.failureCode ?? null,
    } satisfies DocumentAnalysisActivationSnapshot;
  });
}

export async function reconcileDocumentAnalysisActivation(input: {
  target: DocumentAnalysisActivationTarget;
  state: "NOT_REQUESTED" | "CONFIRMED" | "FAILED_VERIFIED";
  renderJobId?: string | null;
  failureCode?: string | null;
}) {
  const target = documentAnalysisActivationTargetSchema.parse(input.target);
  const remoteId = input.renderJobId == null ? null : renderJobId.parse(input.renderJobId);
  return runSerializableTransactionWithRetry(async (tx) => {
    const { job } = await lockTarget(tx, target);
    const current = await latestSnapshot(tx, job.id);
    if (!["REQUESTING", "REMOTE_UNKNOWN", "FAILED_VERIFIED"].includes(current.state)) {
      throw new DocumentAnalysisActivationTargetError("ACTIVATION_STATE_CONFLICT");
    }
    if (input.state === "CONFIRMED" && !remoteId) {
      throw new DocumentAnalysisActivationTargetError("ACTIVATION_STATE_CONFLICT");
    }
    await appendState(tx, job, input.state, {
      activationAttemptId: current.activationAttemptId,
      renderJobId: remoteId,
      failureCode: input.failureCode ?? null,
      reconciled: true,
      sequence: current.sequence + 1,
    });
    return {
      state: input.state,
      activationAttemptId: current.activationAttemptId,
      renderJobId: remoteId,
      failureCode: input.failureCode ?? null,
    } satisfies DocumentAnalysisActivationSnapshot;
  });
}

export async function resetDocumentAnalysisActivationInTransaction(
  tx: Prisma.TransactionClient,
  job: AsyncJob,
): Promise<void> {
  if (job.operation !== "FASCICOLO.AUTOMATIC_ANALYSIS_V1") return;
  const current = await latestSnapshot(tx, job.id);
  if (current.state === "NOT_REQUESTED") return;
  await appendState(tx, job, "NOT_REQUESTED", {
    activationAttemptId: current.activationAttemptId,
    failureCode: "MANUAL_JOB_RETRY",
    reconciled: true,
    sequence: current.sequence + 1,
  });
}

export async function readDocumentAnalysisActivation(
  applicationJobId: string,
): Promise<DocumentAnalysisActivationSnapshot> {
  const parsedId = identifier.parse(applicationJobId);
  const current = await prisma.$transaction((tx) => latestSnapshot(tx, parsedId));
  return publicSnapshot(current);
}
