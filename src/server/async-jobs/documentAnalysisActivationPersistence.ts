import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import { Prisma, type AsyncJob } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  SELVARA_V3_RECOVERY_AUTHORIZATION,
} from "@/server/async-jobs/selvaraV3RecoveryAuthorization";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

const identifier = z.string().trim().min(1).max(256);
const activationAttemptId = z.string().regex(/^[0-9a-f]{32}$/);
const renderJobId = z.string().regex(/^job-[a-z0-9]+$/);

export const SELVARA_FAILED_ACTIVATION_RECOVERY = Object.freeze({
  applicationJobId: "cmvnr60jd000007jpj8ipy5hj",
  renderJobId: "job-dbeujlss728c73dgk8o0",
  renderServiceId: "srv-dberb7vb9u1s73amjqsg",
  renderStartCommand: [
    "ASYNC_WORKER_CONCURRENCY=1",
    "ASYNC_WORKER_DEDICATED_MODE=true",
    "ASYNC_WORKER_EXIT_ON_IDLE=true",
    "ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST=procedimento-intake-9e04f4d4cdbf092845b57c66",
    "ASYNC_WORKER_BOOTSTRAP_TIME_WATCHES=false",
    "ASYNC_WORKER_MAX_PROCESSED_JOBS=1",
    "ASYNC_WORKER_TARGET_JOB_ID=cmvnr60jd000007jpj8ipy5hj",
    "ASYNC_WORKER_TARGET_TENANT_ID=cmrzd08yp000dqwudd9dvaidl",
    "ASYNC_WORKER_OPERATION_ALLOWLIST=FASCICOLO.AUTOMATIC_ANALYSIS_V1",
    "ASYNC_PROVIDER_EXECUTION_ENABLED=true",
    "npm run worker:async",
  ].join(" "),
  failureEvent: "ASYNC_WORKER_FATAL_CONFIGURATION",
  failureCode: "RENDER_ONE_OFF_FAILED_BEFORE_WORKER_START",
} as const);

const selvaraRecoveryInputSchema = z.object({
  actor: z.object({
    userId: identifier,
    userEmail: z.string().email(),
    userRole: z.literal("ADMIN"),
  }).strict(),
}).strict();

const selvaraRecoveryEvidenceSchema = z.object({
  approvalId: z.literal(SELVARA_V3_RECOVERY_AUTHORIZATION.approvalId),
  corpusFingerprint: z.literal(SELVARA_V3_RECOVERY_AUTHORIZATION.corpusFingerprint),
  renderServiceId: z.literal(SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId),
  renderJobId: z.literal(SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId),
  renderStatus: z.literal("failed"),
  renderFinishedAt: z.string().datetime({ offset: true }),
  renderStartCommandSha256: z.string().regex(/^[0-9a-f]{64}$/),
  failureEvent: z.literal(SELVARA_FAILED_ACTIVATION_RECOVERY.failureEvent),
  failureEventTimestamp: z.string().datetime({ offset: true }),
  inspectedRenderJobCount: z.number().int().positive(),
  inspectedLogEntryCount: z.number().int().positive(),
  verifiedAt: z.string().datetime({ offset: true }),
  reason: z.literal("RENDER_CONFIGURATION_FAILURE_BEFORE_RUNTIME_CREATION"),
}).strict();

type SelvaraRecoveryEvidence = z.output<typeof selvaraRecoveryEvidenceSchema>;

const renderServiceSchema = z.object({
  id: z.literal(SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId),
  ownerId: identifier,
  suspended: z.literal("suspended"),
}).passthrough();

const renderJobSchema = z.object({
  id: renderJobId,
  serviceId: z.literal(SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId),
  startCommand: z.string().min(1),
  status: z.enum(["pending", "running", "succeeded", "failed", "canceled"]),
  createdAt: z.string().datetime({ offset: true }),
  startedAt: z.string().datetime({ offset: true }).nullish(),
  finishedAt: z.string().datetime({ offset: true }).nullish(),
}).passthrough();

const renderJobPageSchema = z.array(z.object({
  job: renderJobSchema,
  cursor: z.string().min(1),
}).strict());

const renderLogEntrySchema = z.object({
  id: z.string().min(1),
  message: z.string(),
  timestamp: z.string().datetime({ offset: true }),
  labels: z.array(z.object({
    name: z.string().min(1),
    value: z.string(),
  }).passthrough()),
}).strict();

const renderLogPageSchema = z.object({
  hasMore: z.boolean(),
  nextStartTime: z.string().datetime({ offset: true }),
  nextEndTime: z.string().datetime({ offset: true }),
  logs: z.array(renderLogEntrySchema),
}).strict();

export class SelvaraActivationRecoveryVerificationError extends Error {
  readonly code = "SELVARA_ACTIVATION_RECOVERY_VERIFICATION_FAILED" as const;

  constructor() {
    super("SELVARA_ACTIVATION_RECOVERY_VERIFICATION_FAILED");
    this.name = "SelvaraActivationRecoveryVerificationError";
  }
}

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
      | "ACTIVATION_STATE_CONFLICT"
      | "RECOVERY_EVIDENCE_INVALID"
      | "RECOVERY_SCOPE_MISMATCH"
      | "RECOVERY_COMPETING_WORK",
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
    actor?: {
      userId: string;
      userEmail: string;
      userRole: "ADMIN";
    };
    recoveryEvidence?: SelvaraRecoveryEvidence;
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
      userId: input.actor?.userId ?? job.initiatingUserId,
      userEmail: input.actor?.userEmail ?? job.actorEmail,
      userRole: input.actor?.userRole ?? job.actorRole,
    },
    metadata: {
      activationAttemptId: input.activationAttemptId ?? null,
      activationSequence: input.sequence,
      renderJobId: input.renderJobId ?? null,
      failureCode: input.failureCode ?? null,
      reconciled: input.reconciled ?? false,
      operation: job.operation,
      procedimentoId: job.procedimentoId,
      ...(input.recoveryEvidence ? { recoveryEvidence: input.recoveryEvidence } : {}),
    },
  });
}

function corpusFingerprint(job: Pick<AsyncJob, "inputReference">): string | null {
  const inputReference = record(job.inputReference);
  const metadata = record(inputReference?.metadata ?? null);
  if (
    inputReference?.referenceType !== "FASCICOLO_DOCUMENT_CORPUS"
    || inputReference.referenceId !== metadata?.corpusHash
  ) {
    return null;
  }
  return typeof metadata.corpusHash === "string" ? metadata.corpusHash : null;
}

function assertSelvaraRecoveryScope(
  job: AsyncJob,
  evidence: SelvaraRecoveryEvidence,
): void {
  if (
    job.id !== SELVARA_FAILED_ACTIVATION_RECOVERY.applicationJobId
    || job.tenantId !== SELVARA_V3_RECOVERY_AUTHORIZATION.tenantId
    || job.procedimentoId !== SELVARA_V3_RECOVERY_AUTHORIZATION.procedimentoId
    || job.operation !== SELVARA_V3_RECOVERY_AUTHORIZATION.operation
    || job.purpose !== SELVARA_V3_RECOVERY_AUTHORIZATION.purpose
    || corpusFingerprint(job) !== SELVARA_V3_RECOVERY_AUTHORIZATION.corpusFingerprint
    || evidence.corpusFingerprint !== SELVARA_V3_RECOVERY_AUTHORIZATION.corpusFingerprint
  ) {
    throw new DocumentAnalysisActivationTargetError("RECOVERY_SCOPE_MISMATCH");
  }
}

function assertUnclaimedRecoveryTarget(job: AsyncJob): void {
  if (
    job.status !== "QUEUED"
    || job.attemptCount !== 0
    || job.startedAt !== null
    || job.completedAt !== null
    || job.leaseOwner !== null
    || job.leaseToken !== null
    || job.leaseExpiresAt !== null
    || job.lastHeartbeatAt !== null
    || job.failureCategory !== null
    || job.failureCode !== null
    || job.blockedReason !== null
    || job.resultReference !== null
  ) {
    throw new DocumentAnalysisActivationTargetError("RECOVERY_EVIDENCE_INVALID");
  }
}

function hasSameCorpus(
  job: Pick<AsyncJob, "id" | "purpose" | "inputReference">,
): boolean {
  return job.id !== SELVARA_FAILED_ACTIVATION_RECOVERY.applicationJobId
    && job.purpose === SELVARA_V3_RECOVERY_AUTHORIZATION.purpose
    && corpusFingerprint(job) === SELVARA_V3_RECOVERY_AUTHORIZATION.corpusFingerprint;
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

function renderVerificationError(): never {
  throw new SelvaraActivationRecoveryVerificationError();
}

function assertRecoveryEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  if (
    environment.RENDER_APPLICATION_WORKER_SERVICE_ID
      !== SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId
    || !environment.RENDER_WORKER_API_KEY?.trim()
    || environment.DOCUMENT_WORKER_ACTIVATION_MODE !== "DISABLED"
    || environment.AI_REAL_DATA_ENABLED !== "false"
    || environment.ASYNC_PROVIDER_EXECUTION_ENABLED !== "false"
    || environment.AUTOMATIC_RESEARCH_EXECUTION_ENABLED !== "false"
    || environment.AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED !== "false"
  ) {
    return renderVerificationError();
  }
  return environment.RENDER_WORKER_API_KEY.trim();
}

async function fetchRenderJson(url: URL, apiKey: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return renderVerificationError();
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 2 * 1024 * 1024) {
      return renderVerificationError();
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return renderVerificationError();
    }
  } catch {
    return renderVerificationError();
  } finally {
    clearTimeout(timer);
  }
}

async function listAllRenderJobs(apiKey: string): Promise<readonly z.output<typeof renderJobSchema>[]> {
  const jobs: z.output<typeof renderJobSchema>[] = [];
  const seenJobIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
    const url = new URL(
      `https://api.render.com/v1/services/${SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId}/jobs`,
    );
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = renderJobPageSchema.safeParse(await fetchRenderJson(url, apiKey));
    if (!page.success) return renderVerificationError();
    if (page.data.length === 0) return jobs;
    for (const item of page.data) {
      if (seenJobIds.has(item.job.id)) return renderVerificationError();
      seenJobIds.add(item.job.id);
      jobs.push(item.job);
    }
    const nextCursor = page.data.at(-1)?.cursor;
    if (!nextCursor || seenCursors.has(nextCursor)) return renderVerificationError();
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return renderVerificationError();
}

async function listAllRenderLogs(input: {
  apiKey: string;
  ownerId: string;
  startTime: string;
  endTime: string;
}): Promise<readonly z.output<typeof renderLogEntrySchema>[]> {
  const logs: z.output<typeof renderLogEntrySchema>[] = [];
  const seenLogIds = new Set<string>();
  const seenPages = new Set<string>();
  let startTime = input.startTime;
  let endTime = input.endTime;
  for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
    const url = new URL("https://api.render.com/v1/logs");
    url.searchParams.set("ownerId", input.ownerId);
    url.searchParams.set("resource", SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId);
    url.searchParams.set("startTime", startTime);
    url.searchParams.set("endTime", endTime);
    url.searchParams.set("direction", "forward");
    url.searchParams.set("limit", "100");
    const page = renderLogPageSchema.safeParse(await fetchRenderJson(url, input.apiKey));
    if (!page.success) return renderVerificationError();
    for (const log of page.data.logs) {
      const resource = log.labels.find((label) => label.name === "resource")?.value;
      if (
        resource !== SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId
        || seenLogIds.has(log.id)
      ) {
        return renderVerificationError();
      }
      seenLogIds.add(log.id);
      logs.push(log);
    }
    if (!page.data.hasMore) return logs;
    const nextPage = `${page.data.nextStartTime}\n${page.data.nextEndTime}`;
    if (seenPages.has(nextPage) || page.data.logs.length === 0) {
      return renderVerificationError();
    }
    seenPages.add(nextPage);
    startTime = page.data.nextStartTime;
    endTime = page.data.nextEndTime;
  }
  return renderVerificationError();
}

function fatalConfigurationEvent(message: string): {
  event: string;
  errorName: string;
  errorCode: string;
  timestamp: string;
} | null {
  try {
    const parsed = z.object({
      event: z.literal(SELVARA_FAILED_ACTIVATION_RECOVERY.failureEvent),
      errorName: z.literal("ApplicationAsyncWorkerConfigurationError"),
      errorCode: z.literal("INVALID_CONFIGURATION"),
      timestamp: z.string().datetime({ offset: true }),
    }).strict().safeParse(JSON.parse(message));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function verifyConfigurationFailureLogs(
  logs: readonly z.output<typeof renderLogEntrySchema>[],
  job: z.output<typeof renderJobSchema>,
): SelvaraRecoveryEvidence {
  const ordered = [...logs].sort((left, right) => (
    new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  ));
  const normalizedMessages = ordered.map((log) => (
    log.message.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
  ));
  const commandIndex = normalizedMessages.findIndex((message) => (
    message.includes(`Running '${SELVARA_FAILED_ACTIVATION_RECOVERY.renderStartCommand}'`)
  ));
  const processIndex = normalizedMessages.findIndex((message) => (
    message.trim() === "> tsx src/server/async-jobs/applicationWorkerProcess.ts"
  ));
  const fatalEvents = ordered
    .map((log, index) => ({ log, index, event: fatalConfigurationEvent(log.message) }))
    .filter((entry): entry is typeof entry & {
      event: NonNullable<ReturnType<typeof fatalConfigurationEvent>>;
    } => entry.event !== null);
  if (
    commandIndex < 0
    || processIndex <= commandIndex
    || fatalEvents.length !== 1
    || fatalEvents[0]!.index <= processIndex
    || normalizedMessages.some((message) => message.includes("\"event\":\"ASYNC_WORKER_STARTED\""))
    || normalizedMessages.slice(fatalEvents[0]!.index + 1).some((message) => message.trim() !== "")
  ) {
    return renderVerificationError();
  }
  const fatal = fatalEvents[0]!;
  const fatalAt = new Date(fatal.event.timestamp).getTime();
  const fatalLogAt = new Date(fatal.log.timestamp).getTime();
  const finishedAt = new Date(job.finishedAt!).getTime();
  if (
    !Number.isFinite(fatalAt)
    || !Number.isFinite(fatalLogAt)
    || !Number.isFinite(finishedAt)
    || fatalAt > finishedAt
    || fatalLogAt < fatalAt
    || fatalLogAt - fatalAt > 1_000
  ) {
    return renderVerificationError();
  }
  return selvaraRecoveryEvidenceSchema.parse({
    approvalId: SELVARA_V3_RECOVERY_AUTHORIZATION.approvalId,
    corpusFingerprint: SELVARA_V3_RECOVERY_AUTHORIZATION.corpusFingerprint,
    renderServiceId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId,
    renderJobId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId,
    renderStatus: "failed",
    renderFinishedAt: job.finishedAt,
    renderStartCommandSha256: createHash("sha256")
      .update(job.startCommand, "utf8")
      .digest("hex"),
    failureEvent: SELVARA_FAILED_ACTIVATION_RECOVERY.failureEvent,
    failureEventTimestamp: fatal.event.timestamp,
    inspectedRenderJobCount: 1,
    inspectedLogEntryCount: ordered.length,
    verifiedAt: new Date().toISOString(),
    reason: "RENDER_CONFIGURATION_FAILURE_BEFORE_RUNTIME_CREATION",
  });
}

async function verifySelvaraFailedRenderActivation(): Promise<SelvaraRecoveryEvidence> {
  const apiKey = assertRecoveryEnvironment(process.env);
  const serviceUrl = new URL(
    `https://api.render.com/v1/services/${SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId}`,
  );
  const service = renderServiceSchema.safeParse(await fetchRenderJson(serviceUrl, apiKey));
  if (!service.success) return renderVerificationError();
  const jobUrl = new URL(
    `https://api.render.com/v1/services/${SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId}`
      + `/jobs/${SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId}`,
  );
  const job = renderJobSchema.safeParse(await fetchRenderJson(jobUrl, apiKey));
  if (
    !job.success
    || job.data.id !== SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId
    || job.data.status !== "failed"
    || !job.data.finishedAt
    || job.data.startCommand !== SELVARA_FAILED_ACTIVATION_RECOVERY.renderStartCommand
  ) {
    return renderVerificationError();
  }
  const jobs = await listAllRenderJobs(apiKey);
  const exactJobs = jobs.filter((candidate) => (
    candidate.id === SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId
  ));
  const competingJobs = jobs.filter((candidate) => (
    candidate.id !== SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId
    && candidate.startCommand.includes(
      `ASYNC_WORKER_TARGET_JOB_ID=${SELVARA_FAILED_ACTIVATION_RECOVERY.applicationJobId}`,
    )
  ));
  if (
    exactJobs.length !== 1
    || competingJobs.length !== 0
    || exactJobs[0]!.status !== job.data.status
    || exactJobs[0]!.finishedAt !== job.data.finishedAt
    || exactJobs[0]!.startCommand !== job.data.startCommand
  ) {
    return renderVerificationError();
  }
  const startTime = new Date(new Date(job.data.createdAt).getTime() - 60_000).toISOString();
  const endTime = new Date(new Date(job.data.finishedAt).getTime() + 60_000).toISOString();
  const logs = await listAllRenderLogs({
    apiKey,
    ownerId: service.data.ownerId,
    startTime,
    endTime,
  });
  const evidence = verifyConfigurationFailureLogs(logs, job.data);
  return {
    ...evidence,
    inspectedRenderJobCount: jobs.length,
  };
}

async function persistVerifiedSelvaraFailedActivationRecovery(input: {
  actor: z.output<typeof selvaraRecoveryInputSchema>["actor"];
  evidence: SelvaraRecoveryEvidence;
}) {
  const target = documentAnalysisActivationTargetSchema.parse({
    applicationJobId: SELVARA_FAILED_ACTIVATION_RECOVERY.applicationJobId,
    tenantId: SELVARA_V3_RECOVERY_AUTHORIZATION.tenantId,
    procedimentoId: SELVARA_V3_RECOVERY_AUTHORIZATION.procedimentoId,
  });
  return runSerializableTransactionWithRetry(async (tx) => {
    const { job } = await lockTarget(tx, target);
    assertSelvaraRecoveryScope(job, input.evidence);
    assertUnclaimedRecoveryTarget(job);
    const current = await latestSnapshot(tx, job.id);
    if (
      current.state !== "CONFIRMED"
      || current.renderJobId !== input.evidence.renderJobId
      || current.activationAttemptId === null
    ) {
      throw new DocumentAnalysisActivationTargetError("ACTIVATION_STATE_CONFLICT");
    }
    const activeCandidates = await tx.asyncJob.findMany({
      where: {
        tenantId: SELVARA_V3_RECOVERY_AUTHORIZATION.tenantId,
        procedimentoId: SELVARA_V3_RECOVERY_AUTHORIZATION.procedimentoId,
        operation: SELVARA_V3_RECOVERY_AUTHORIZATION.operation,
        status: { in: ["QUEUED", "RETRY_WAIT", "RUNNING"] },
      },
      select: {
        id: true,
        purpose: true,
        inputReference: true,
      },
    });
    if (activeCandidates.some(hasSameCorpus)) {
      throw new DocumentAnalysisActivationTargetError("RECOVERY_COMPETING_WORK");
    }
    await appendState(tx, job, "NOT_REQUESTED", {
      activationAttemptId: current.activationAttemptId,
      renderJobId: current.renderJobId,
      failureCode: SELVARA_FAILED_ACTIVATION_RECOVERY.failureCode,
      reconciled: true,
      sequence: current.sequence + 1,
      actor: input.actor,
      recoveryEvidence: input.evidence,
    });
    return {
      state: "NOT_REQUESTED",
      activationAttemptId: current.activationAttemptId,
      renderJobId: current.renderJobId,
      failureCode: SELVARA_FAILED_ACTIVATION_RECOVERY.failureCode,
    } satisfies DocumentAnalysisActivationSnapshot;
  });
}

export async function recoverSelvaraFailedDocumentAnalysisActivation(
  rawInput: z.input<typeof selvaraRecoveryInputSchema>,
) {
  const input = selvaraRecoveryInputSchema.parse(rawInput);
  const evidence = await verifySelvaraFailedRenderActivation();
  return persistVerifiedSelvaraFailedActivationRecovery({
    actor: input.actor,
    evidence,
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
