import { createHash, randomBytes } from "node:crypto";

import {
  Prisma,
  type ResearchEvidenceBundleRecord,
  type ResearchExecutionAttempt,
  type ResearchMissionRecord,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import {
  RESEARCH_BRIDGE_VERSION,
  assessResearchBudget,
  validateResearchEvidenceBundle,
  validateResearchMission,
  type ResearchCompletionState,
  type ResearchEvidenceBundle,
  type ResearchMission,
  type ResearchMissionStatus,
} from "./bridge";
import {
  deriveFascicoloContextScope,
  projectBoundedFascicoloContext,
  projectResearchEvidenceBundleForContext,
  projectResearchMissionForMcp,
  researchPurposeReferences,
  type BoundedFascicoloContext,
  type FascicoloContextCandidate,
} from "./fascicolo-context";

export const RESEARCH_MISSION_EXECUTION_OPERATION = "LEGAL_RESEARCH.EXECUTE_V1" as const;
export const RESEARCH_MISSION_EXECUTION_PURPOSE = "LEGAL_RESEARCH_EXECUTION" as const;

export type ResearchPersistenceClient = Pick<
  Prisma.TransactionClient,
  "researchMissionRecord" | "researchExecutionAttempt" | "researchEvidenceBundleRecord"
>;

export type ResearchOperationalClock = Readonly<{ now(): Date }>;

export type ResearchPersistenceContext = Readonly<{
  client: ResearchPersistenceClient;
  transaction: <T>(operation: (tx: ResearchPersistenceClient) => Promise<T>) => Promise<T>;
  clock: ResearchOperationalClock;
  claimToken: () => string;
}>;

export type ResearchServiceActor = Readonly<{
  actorId: string;
  tenantId: string | null;
}>;

export type ResearchExecutorIdentity = Readonly<{
  kind: "CHATGPT" | "CONVERSATIONAL_RESEARCH_EXECUTOR" | "AUTHORIZED_WORKER";
  claimantId: string;
}>;

export type StoredResearchMission = Readonly<{
  mission: ResearchMission;
  payloadFingerprint: string;
  operational: Readonly<{
    status: ResearchMissionStatus;
    stateVersion: number;
    claimantId: string | null;
    claimExpiresAt: Date | null;
    activeExecutionId: string | null;
    completedAt: Date | null;
    deferredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}>;

export type ResearchMissionClaim = Readonly<{
  mission: StoredResearchMission;
  execution: ResearchExecutionAttempt;
  claimToken: string;
}>;

export type ResearchPersistenceErrorCode =
  | "AUTHORIZATION_REQUIRED"
  | "BUDGET_COUNTER_REGRESSION"
  | "BUDGET_OVERRUN"
  | "BUNDLE_IDEMPOTENCY_CONFLICT"
  | "CLAIM_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_BUNDLE"
  | "INVALID_CLAIM"
  | "INVALID_MISSION"
  | "INVALID_TRANSITION"
  | "MISSION_NOT_FOUND"
  | "STALE_CLAIM"
  | "WRONG_EXECUTION"
  | "WRONG_MISSION";

export class ResearchPersistenceError extends Error {
  constructor(readonly code: ResearchPersistenceErrorCode) {
    super(code);
    this.name = "ResearchPersistenceError";
  }
}

const defaultContext: ResearchPersistenceContext = {
  client: prisma,
  transaction: (operation) => runSerializableTransactionWithRetry(
    (tx) => operation(tx),
  ),
  clock: { now: () => new Date() },
  claimToken: () => randomBytes(32).toString("hex"),
};

function context(value?: Partial<ResearchPersistenceContext>): ResearchPersistenceContext {
  return { ...defaultContext, ...value };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function identifier(value: string): string {
  const parsed = value.trim();
  if (!parsed || parsed.length > 256) throw new ResearchPersistenceError("INVALID_CLAIM");
  return parsed;
}

function claimToken(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new ResearchPersistenceError("INVALID_CLAIM");
  return value;
}

function leaseDuration(value: number): number {
  if (!Number.isInteger(value) || value < 1_000 || value > 24 * 60 * 60 * 1_000) {
    throw new ResearchPersistenceError("INVALID_CLAIM");
  }
  return value;
}

function authorize(record: Pick<ResearchMissionRecord, "tenantId">, actor: ResearchServiceActor): void {
  if (!identifier(actor.actorId) || record.tenantId !== actor.tenantId) {
    throw new ResearchPersistenceError("AUTHORIZATION_REQUIRED");
  }
}

function missionFrom(record: ResearchMissionRecord): ResearchMission {
  return {
    ...(record.payload as unknown as ResearchMission),
    missionId: record.id,
    status: record.status,
    caseReference: {
      caseId: record.caseId,
      ...(record.fascicoloReference ? { fascicoloReference: record.fascicoloReference } : {}),
    },
  };
}

function storedMission(record: ResearchMissionRecord): StoredResearchMission {
  return {
    mission: missionFrom(record),
    payloadFingerprint: record.payloadFingerprint,
    operational: {
      status: record.status,
      stateVersion: record.stateVersion,
      claimantId: record.claimantId,
      claimExpiresAt: record.claimExpiresAt,
      activeExecutionId: record.activeExecutionId,
      completedAt: record.completedAt,
      deferredAt: record.deferredAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
  };
}

function p2002Target(error: unknown): { modelName: string; fields: readonly string[] } | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const meta = error.meta as {
    modelName?: unknown;
    target?: unknown;
    driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } };
  } | undefined;
  if (typeof meta?.modelName !== "string") return null;
  const target = meta.target ?? meta.driverAdapterError?.cause?.constraint?.fields;
  if (typeof target === "string") return { modelName: meta.modelName, fields: [target] };
  if (!Array.isArray(target) || target.some((item) => typeof item !== "string")) return null;
  return { modelName: meta.modelName, fields: target as string[] };
}

function isMissionIdentityP2002(error: unknown): boolean {
  const value = p2002Target(error);
  return value?.modelName === "ResearchMissionRecord"
    && value.fields.some((field) => [
      "id",
      "payloadFingerprint",
      "research_mission_payload_uq",
    ].includes(field));
}

function isBundleIdentityP2002(error: unknown): boolean {
  const value = p2002Target(error);
  return value?.modelName === "ResearchEvidenceBundleRecord"
    && value.fields.some((field) => ["id", "fingerprint", "research_bundle_fingerprint_uq"].includes(field));
}

function sameMission(record: ResearchMissionRecord, mission: ResearchMission, payloadFingerprint: string): boolean {
  return record.id === mission.missionId
    && record.payloadFingerprint === payloadFingerprint
    && record.contractVersion === mission.version;
}

export async function createResearchMissionRecord(
  input: Readonly<{ mission: ResearchMission; actor: ResearchServiceActor }>,
  overrides?: Partial<ResearchPersistenceContext>,
): Promise<Readonly<{ outcome: "CREATED" | "REUSED"; mission: StoredResearchMission }>> {
  const ctx = context(overrides);
  if (validateResearchMission(input.mission).length > 0 || input.mission.status !== "PENDING") {
    throw new ResearchPersistenceError("INVALID_MISSION");
  }
  identifier(input.actor.actorId);
  const payloadFingerprint = fingerprint(input.mission);
  const reuse = (record: ResearchMissionRecord) => {
    authorize(record, input.actor);
    if (!sameMission(record, input.mission, payloadFingerprint)) {
      throw new ResearchPersistenceError("IDEMPOTENCY_CONFLICT");
    }
    return { outcome: "REUSED" as const, mission: storedMission(record) };
  };
  const existing = await ctx.client.researchMissionRecord.findUnique({
    where: { id: input.mission.missionId },
  });
  if (existing) return reuse(existing);
  try {
    const created = await ctx.client.researchMissionRecord.create({
      data: {
        id: input.mission.missionId,
        tenantId: input.actor.tenantId,
        contractVersion: input.mission.version,
        caseId: input.mission.caseReference.caseId,
        fascicoloReference: input.mission.caseReference.fascicoloReference,
        referenceDate: new Date(input.mission.referenceDate),
        mode: input.mission.mode,
        payload: json(input.mission),
        payloadFingerprint,
      },
    });
    return { outcome: "CREATED", mission: storedMission(created) };
  } catch (cause) {
    if (!isMissionIdentityP2002(cause)) throw cause;
    const winner = await ctx.client.researchMissionRecord.findUnique({
      where: { id: input.mission.missionId },
    });
    if (!winner) throw new ResearchPersistenceError("IDEMPOTENCY_CONFLICT");
    return reuse(winner);
  }
}

export async function getResearchMission(
  missionId: string,
  actor: ResearchServiceActor,
  overrides?: Partial<ResearchPersistenceContext>,
): Promise<StoredResearchMission | null> {
  const ctx = context(overrides);
  const record = await ctx.client.researchMissionRecord.findUnique({ where: { id: identifier(missionId) } });
  if (!record) return null;
  authorize(record, actor);
  return storedMission(record);
}

export async function getResearchFascicoloContext(
  missionId: string,
  actor: ResearchServiceActor,
  overrides?: Partial<ResearchPersistenceContext>,
): Promise<BoundedFascicoloContext> {
  const ctx = context(overrides);
  const current = await ctx.client.researchMissionRecord.findUnique({
    where: { id: identifier(missionId) },
  });
  if (!current) throw new ResearchPersistenceError("MISSION_NOT_FOUND");
  authorize(current, actor);
  if (!current.tenantId) throw new ResearchPersistenceError("AUTHORIZATION_REQUIRED");
  const mission = missionFrom(current);
  const scope = deriveFascicoloContextScope({
    tenantId: current.tenantId,
    caseReference: mission.caseReference,
  });
  const priorRecords = await ctx.client.researchMissionRecord.findMany({
    where: {
      tenantId: current.tenantId,
      caseId: current.caseId,
      fascicoloReference: current.fascicoloReference,
      status: { in: ["COMPLETED", "BUDGET_EXHAUSTED"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });
  const priorMissions = priorRecords.filter((record) => record.id !== current.id);
  const bundleRecords = priorMissions.length > 0
    ? await ctx.client.researchEvidenceBundleRecord.findMany({
        where: { missionId: { in: priorMissions.map((record) => record.id) } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
      })
    : [];
  const missionById = new Map(priorMissions.map((record) => [record.id, missionFrom(record)]));
  const candidates: FascicoloContextCandidate[] = priorMissions.map((record) => {
    const priorMission = missionFrom(record);
    return {
      sourceType: "SAME_FASCICOLO_PRIOR_MISSION",
      sourceId: record.id,
      missionId: record.id,
      tenantId: record.tenantId!,
      caseReference: priorMission.caseReference,
      createdAt: record.createdAt.toISOString(),
      version: record.contractVersion,
      contentHash: record.payloadFingerprint,
      purposeReferences: researchPurposeReferences(priorMission),
      content: { mission: projectResearchMissionForMcp(priorMission) },
    };
  });
  for (const record of bundleRecords) {
    const priorMission = missionById.get(record.missionId);
    if (!priorMission) continue;
    candidates.push({
      sourceType: "SAME_FASCICOLO_ACCEPTED_BUNDLE",
      sourceId: record.id,
      missionId: record.missionId,
      tenantId: current.tenantId,
      caseReference: priorMission.caseReference,
      createdAt: record.createdAt.toISOString(),
      version: record.contractVersion,
      contentHash: record.fingerprint,
      purposeReferences: researchPurposeReferences(priorMission),
      content: {
        evidenceBundle: projectResearchEvidenceBundleForContext(
          record.payload as unknown as ResearchEvidenceBundle,
        ),
      },
    });
  }
  return projectBoundedFascicoloContext({
    scope,
    purposeReferences: researchPurposeReferences(mission),
    candidates,
  });
}

export async function listPendingResearchMissions(
  actor: ResearchServiceActor,
  overrides?: Partial<ResearchPersistenceContext>,
): Promise<readonly StoredResearchMission[]> {
  const ctx = context(overrides);
  identifier(actor.actorId);
  const now = ctx.clock.now();
  const records = await ctx.client.researchMissionRecord.findMany({
    where: {
      tenantId: actor.tenantId,
      OR: [
        { status: { in: ["PENDING", "DEFERRED"] } },
        { status: "IN_PROGRESS", claimExpiresAt: { lte: now } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return records.map(storedMission);
}

function leaseMatches(
  mission: ResearchMissionRecord,
  input: Readonly<{ executionId: string; claimantId: string; claimToken: string }>,
  now: Date,
): boolean {
  return mission.status === "IN_PROGRESS"
    && mission.activeExecutionId === input.executionId
    && mission.claimantId === input.claimantId
    && mission.claimToken === input.claimToken
    && mission.claimExpiresAt !== null
    && mission.claimExpiresAt.getTime() > now.getTime();
}

function requireLease(
  mission: ResearchMissionRecord,
  input: Readonly<{ executionId: string; claimantId: string; claimToken: string }>,
  now: Date,
): void {
  if (!leaseMatches(mission, input, now)) throw new ResearchPersistenceError("STALE_CLAIM");
}

export async function claimResearchMission(
  input: Readonly<{
    missionId: string;
    executionId: string;
    executor: ResearchExecutorIdentity;
    actor: ResearchServiceActor;
    leaseDurationMs: number;
  }>,
  overrides?: Partial<ResearchPersistenceContext>,
): Promise<Readonly<{ outcome: "CLAIMED" | "REUSED"; claim: ResearchMissionClaim }>> {
  const ctx = context(overrides);
  const missionId = identifier(input.missionId);
  const executionId = identifier(input.executionId);
  const claimantId = identifier(input.executor.claimantId);
  const duration = leaseDuration(input.leaseDurationMs);
  const claim = async (tx: ResearchPersistenceClient) => {
    const current = await tx.researchMissionRecord.findUnique({ where: { id: missionId } });
    if (!current) throw new ResearchPersistenceError("MISSION_NOT_FOUND");
    authorize(current, input.actor);
    const now = ctx.clock.now();
    if (["COMPLETED", "BUDGET_EXHAUSTED", "REJECTED"].includes(current.status)) {
      throw new ResearchPersistenceError("INVALID_TRANSITION");
    }
    if (current.status === "IN_PROGRESS" && current.claimExpiresAt && current.claimExpiresAt > now) {
      if (current.activeExecutionId !== executionId || current.claimantId !== claimantId) {
        throw new ResearchPersistenceError("CLAIM_CONFLICT");
      }
      const repeated = await tx.researchExecutionAttempt.findUnique({ where: { id: executionId } });
      if (!repeated || repeated.missionId !== missionId) throw new ResearchPersistenceError("CLAIM_CONFLICT");
      return {
        outcome: "REUSED" as const,
        claim: { mission: storedMission(current), execution: repeated, claimToken: repeated.claimToken },
      };
    }
    if (current.status === "IN_PROGRESS" && current.activeExecutionId) {
      await tx.researchExecutionAttempt.updateMany({
        where: { id: current.activeExecutionId, missionId, completionState: null },
        data: { completionState: "FAILED", completedAt: now, errorCode: "LEASE_EXPIRED" },
      });
    }
    const token = claimToken(ctx.claimToken());
    const expiresAt = new Date(now.getTime() + duration);
    const transitioned = await tx.researchMissionRecord.updateMany({
      where: { id: missionId, stateVersion: current.stateVersion, status: current.status },
      data: {
        status: "IN_PROGRESS",
        stateVersion: { increment: 1 },
        claimantId,
        claimToken: token,
        claimExpiresAt: expiresAt,
        activeExecutionId: executionId,
        completedAt: null,
        deferredAt: null,
      },
    });
    if (transitioned.count !== 1) throw new ResearchPersistenceError("CLAIM_CONFLICT");
    const attempt = await tx.researchExecutionAttempt.create({
      data: {
        id: executionId,
        missionId,
        executorKind: input.executor.kind,
        claimantId,
        claimToken: token,
        startedAt: now,
        leaseExpiresAt: expiresAt,
      },
    });
    const updated = await tx.researchMissionRecord.findUniqueOrThrow({ where: { id: missionId } });
    return {
      outcome: "CLAIMED" as const,
      claim: { mission: storedMission(updated), execution: attempt, claimToken: token },
    };
  };
  try {
    return await ctx.transaction(claim);
  } catch (cause) {
    if (!(cause instanceof ResearchPersistenceError) || cause.code !== "CLAIM_CONFLICT") throw cause;
    const [current, repeated] = await Promise.all([
      ctx.client.researchMissionRecord.findUnique({ where: { id: missionId } }),
      ctx.client.researchExecutionAttempt.findUnique({ where: { id: executionId } }),
    ]);
    const now = ctx.clock.now();
    if (!current || !repeated || repeated.missionId !== missionId
      || current.claimantId !== claimantId || !leaseMatches(current, {
        executionId,
        claimantId,
        claimToken: repeated.claimToken,
      }, now)) {
      throw cause;
    }
    authorize(current, input.actor);
    return {
      outcome: "REUSED",
      claim: { mission: storedMission(current), execution: repeated, claimToken: repeated.claimToken },
    };
  }
}

export async function releaseOrDeferResearchMission(
  input: Readonly<{
    missionId: string;
    executionId: string;
    claimantId: string;
    claimToken: string;
    actor: ResearchServiceActor;
    disposition: "RELEASE" | "DEFER";
    reasonCode: string;
  }>,
  overrides?: Partial<ResearchPersistenceContext>,
): Promise<StoredResearchMission> {
  const ctx = context(overrides);
  return ctx.transaction(async (tx) => {
    const current = await tx.researchMissionRecord.findUnique({ where: { id: identifier(input.missionId) } });
    if (!current) throw new ResearchPersistenceError("MISSION_NOT_FOUND");
    authorize(current, input.actor);
    const now = ctx.clock.now();
    requireLease(current, {
      executionId: identifier(input.executionId),
      claimantId: identifier(input.claimantId),
      claimToken: claimToken(input.claimToken),
    }, now);
    const completedAttempt = await tx.researchExecutionAttempt.updateMany({
      where: { id: input.executionId, missionId: input.missionId, completionState: null },
      data: {
        completionState: "DEFERRED",
        completedAt: now,
        deferReason: identifier(input.reasonCode),
      },
    });
    if (completedAttempt.count !== 1) throw new ResearchPersistenceError("INVALID_TRANSITION");
    const status = input.disposition === "DEFER" ? "DEFERRED" : "PENDING";
    const transitioned = await tx.researchMissionRecord.updateMany({
      where: { id: current.id, stateVersion: current.stateVersion, status: "IN_PROGRESS" },
      data: {
        status,
        stateVersion: { increment: 1 },
        claimantId: null,
        claimToken: null,
        claimExpiresAt: null,
        activeExecutionId: null,
        deferredAt: status === "DEFERRED" ? now : null,
      },
    });
    if (transitioned.count !== 1) throw new ResearchPersistenceError("STALE_CLAIM");
    return storedMission(await tx.researchMissionRecord.findUniqueOrThrow({ where: { id: current.id } }));
  });
}

export function researchEvidenceBundleFingerprint(bundle: ResearchEvidenceBundle): string {
  return fingerprint(bundle);
}

function bundleId(bundleFingerprint: string): string {
  return `research-bundle:${bundleFingerprint}`;
}

function sameBundle(
  record: ResearchEvidenceBundleRecord,
  bundle: ResearchEvidenceBundle,
  bundleFingerprint: string,
): boolean {
  return record.id === bundleId(bundleFingerprint)
    && record.fingerprint === bundleFingerprint
    && record.missionId === bundle.missionId
    && record.executionId === bundle.executionId
    && record.contractVersion === bundle.version;
}

export async function submitResearchEvidenceBundle(
  input: Readonly<{
    bundle: ResearchEvidenceBundle;
    claimantId: string;
    claimToken: string;
    actor: ResearchServiceActor;
  }>,
  overrides?: Partial<ResearchPersistenceContext>,
): Promise<Readonly<{ outcome: "CREATED" | "REUSED"; bundle: ResearchEvidenceBundleRecord }>> {
  const ctx = context(overrides);
  const bundleFingerprint = researchEvidenceBundleFingerprint(input.bundle);
  const id = bundleId(bundleFingerprint);
  const persist = async (tx: ResearchPersistenceClient) => {
    const missionRecord = await tx.researchMissionRecord.findUnique({ where: { id: input.bundle.missionId } });
    if (!missionRecord) throw new ResearchPersistenceError("MISSION_NOT_FOUND");
    authorize(missionRecord, input.actor);
    const mission = missionFrom(missionRecord);
    const validation = validateResearchEvidenceBundle(mission, input.bundle);
    if (validation.some((item) => item.code === "BUDGET_EXCEEDED")) {
      throw new ResearchPersistenceError("BUDGET_OVERRUN");
    }
    if (validation.length > 0) throw new ResearchPersistenceError("INVALID_BUNDLE");
    const existing = await tx.researchEvidenceBundleRecord.findUnique({ where: { fingerprint: bundleFingerprint } });
    if (existing) {
      if (!sameBundle(existing, input.bundle, bundleFingerprint)) {
        throw new ResearchPersistenceError("BUNDLE_IDEMPOTENCY_CONFLICT");
      }
      const priorAttempt = await tx.researchExecutionAttempt.findUnique({ where: { id: existing.executionId } });
      if (!priorAttempt
        || priorAttempt.claimantId !== identifier(input.claimantId)
        || priorAttempt.claimToken !== claimToken(input.claimToken)) {
        throw new ResearchPersistenceError("AUTHORIZATION_REQUIRED");
      }
      return { outcome: "REUSED" as const, bundle: existing };
    }
    const now = ctx.clock.now();
    requireLease(missionRecord, {
      executionId: input.bundle.executionId,
      claimantId: identifier(input.claimantId),
      claimToken: claimToken(input.claimToken),
    }, now);
    const attempt = await tx.researchExecutionAttempt.findUnique({ where: { id: input.bundle.executionId } });
    if (!attempt || attempt.missionId !== input.bundle.missionId) {
      throw new ResearchPersistenceError("WRONG_EXECUTION");
    }
    const usage = assessResearchBudget(mission.budget, input.bundle.researchToolExecutions);
    if (usage.exceeded) throw new ResearchPersistenceError("BUDGET_OVERRUN");
    if (usage.totalCalls < attempt.totalCalls
      || usage.moonlitCalls < attempt.moonlitCalls
      || usage.simpliciterCalls < attempt.simpliciterCalls
      || usage.legalDataHunterCalls < attempt.legalDataHunterCalls) {
      throw new ResearchPersistenceError("BUDGET_COUNTER_REGRESSION");
    }
    const created = await tx.researchEvidenceBundleRecord.create({
      data: {
        id,
        missionId: input.bundle.missionId,
        executionId: input.bundle.executionId,
        contractVersion: input.bundle.version,
        fingerprint: bundleFingerprint,
        payload: json(input.bundle),
        completionState: input.bundle.completionState,
        totalCalls: usage.totalCalls,
        moonlitCalls: usage.moonlitCalls,
        simpliciterCalls: usage.simpliciterCalls,
        legalDataHunterCalls: usage.legalDataHunterCalls,
        submittedByActorId: input.actor.actorId,
      },
    });
    const advanced = await tx.researchExecutionAttempt.updateMany({
      where: {
        id: attempt.id,
        missionId: attempt.missionId,
        completionState: null,
        totalCalls: { lte: usage.totalCalls },
        moonlitCalls: { lte: usage.moonlitCalls },
        simpliciterCalls: { lte: usage.simpliciterCalls },
        legalDataHunterCalls: { lte: usage.legalDataHunterCalls },
      },
      data: {
        totalCalls: usage.totalCalls,
        moonlitCalls: usage.moonlitCalls,
        simpliciterCalls: usage.simpliciterCalls,
        legalDataHunterCalls: usage.legalDataHunterCalls,
      },
    });
    if (advanced.count !== 1) throw new ResearchPersistenceError("BUDGET_COUNTER_REGRESSION");
    return { outcome: "CREATED" as const, bundle: created };
  };
  try {
    return await ctx.transaction(persist);
  } catch (cause) {
    if (!isBundleIdentityP2002(cause)) throw cause;
    const winner = await ctx.client.researchEvidenceBundleRecord.findUnique({
      where: { fingerprint: bundleFingerprint },
    });
    if (!winner || !sameBundle(winner, input.bundle, bundleFingerprint)) {
      throw new ResearchPersistenceError("BUNDLE_IDEMPOTENCY_CONFLICT");
    }
    return { outcome: "REUSED", bundle: winner };
  }
}

function missionStatusFor(completion: ResearchCompletionState): ResearchMissionStatus {
  if (completion === "COMPLETE") return "COMPLETED";
  if (completion === "BUDGET_EXHAUSTED") return "BUDGET_EXHAUSTED";
  return "DEFERRED";
}

export async function completeResearchMission(
  input: Readonly<{
    missionId: string;
    executionId: string;
    bundleId: string;
    claimantId: string;
    claimToken: string;
    actor: ResearchServiceActor;
  }>,
  overrides?: Partial<ResearchPersistenceContext>,
): Promise<Readonly<{ outcome: "COMPLETED" | "REUSED"; mission: StoredResearchMission }>> {
  const ctx = context(overrides);
  return ctx.transaction(async (tx) => {
    const [current, attempt, evidence] = await Promise.all([
      tx.researchMissionRecord.findUnique({ where: { id: identifier(input.missionId) } }),
      tx.researchExecutionAttempt.findUnique({ where: { id: identifier(input.executionId) } }),
      tx.researchEvidenceBundleRecord.findUnique({ where: { id: identifier(input.bundleId) } }),
    ]);
    if (!current) throw new ResearchPersistenceError("MISSION_NOT_FOUND");
    authorize(current, input.actor);
    if (!attempt || attempt.missionId !== current.id) throw new ResearchPersistenceError("WRONG_EXECUTION");
    if (!evidence || evidence.missionId !== current.id || evidence.executionId !== attempt.id) {
      throw new ResearchPersistenceError("WRONG_MISSION");
    }
    const expectedStatus = missionStatusFor(evidence.completionState);
    if (attempt.claimantId === input.claimantId
      && attempt.claimToken === input.claimToken
      && attempt.finalBundleId === evidence.id
      && attempt.completionState === evidence.completionState
      && current.status === expectedStatus) {
      return { outcome: "REUSED", mission: storedMission(current) };
    }
    const now = ctx.clock.now();
    requireLease(current, {
      executionId: input.executionId,
      claimantId: identifier(input.claimantId),
      claimToken: claimToken(input.claimToken),
    }, now);
    const completedAttempt = await tx.researchExecutionAttempt.updateMany({
      where: { id: attempt.id, missionId: current.id, completionState: null },
      data: {
        completionState: evidence.completionState,
        completedAt: now,
        finalBundleId: evidence.id,
      },
    });
    if (completedAttempt.count !== 1) throw new ResearchPersistenceError("INVALID_TRANSITION");
    const terminal = expectedStatus === "COMPLETED" || expectedStatus === "BUDGET_EXHAUSTED";
    const transitioned = await tx.researchMissionRecord.updateMany({
      where: { id: current.id, stateVersion: current.stateVersion, status: "IN_PROGRESS" },
      data: {
        status: expectedStatus,
        stateVersion: { increment: 1 },
        claimantId: null,
        claimToken: null,
        claimExpiresAt: null,
        activeExecutionId: null,
        completedAt: terminal ? now : null,
        deferredAt: terminal ? null : now,
      },
    });
    if (transitioned.count !== 1) throw new ResearchPersistenceError("INVALID_TRANSITION");
    const updated = await tx.researchMissionRecord.findUniqueOrThrow({ where: { id: current.id } });
    return { outcome: "COMPLETED", mission: storedMission(updated) };
  });
}

export async function rejectOrDeferResearchMission(
  input: Readonly<{
    missionId: string;
    executionId: string;
    claimantId: string;
    claimToken: string;
    actor: ResearchServiceActor;
    disposition: "REJECT" | "DEFER";
    reasonCode: string;
  }>,
  overrides?: Partial<ResearchPersistenceContext>,
): Promise<StoredResearchMission> {
  if (input.disposition === "DEFER") {
    return releaseOrDeferResearchMission({ ...input, disposition: "DEFER" }, overrides);
  }
  const ctx = context(overrides);
  return ctx.transaction(async (tx) => {
    const current = await tx.researchMissionRecord.findUnique({ where: { id: identifier(input.missionId) } });
    if (!current) throw new ResearchPersistenceError("MISSION_NOT_FOUND");
    authorize(current, input.actor);
    const now = ctx.clock.now();
    requireLease(current, {
      executionId: identifier(input.executionId),
      claimantId: identifier(input.claimantId),
      claimToken: claimToken(input.claimToken),
    }, now);
    const completedAttempt = await tx.researchExecutionAttempt.updateMany({
      where: { id: input.executionId, missionId: input.missionId, completionState: null },
      data: { completionState: "FAILED", completedAt: now, errorCode: identifier(input.reasonCode) },
    });
    if (completedAttempt.count !== 1) throw new ResearchPersistenceError("INVALID_TRANSITION");
    const transitioned = await tx.researchMissionRecord.updateMany({
      where: { id: current.id, stateVersion: current.stateVersion, status: "IN_PROGRESS" },
      data: {
        status: "REJECTED",
        stateVersion: { increment: 1 },
        claimantId: null,
        claimToken: null,
        claimExpiresAt: null,
        activeExecutionId: null,
        completedAt: now,
        deferredAt: null,
      },
    });
    if (transitioned.count !== 1) throw new ResearchPersistenceError("INVALID_TRANSITION");
    return storedMission(await tx.researchMissionRecord.findUniqueOrThrow({ where: { id: current.id } }));
  });
}

export function buildResearchMissionAsyncJobAdmission(input: Readonly<{
  mission: ResearchMission;
  actor: ResearchServiceActor & Readonly<{
    actorEmail: string | null;
    actorRole: string;
    initiatingUserId: string | null;
    admissionType: "AUTHENTICATED_USER" | "AUTHORIZED_SYSTEM";
  }>;
  correlationId: string;
  policyDecisionRef: string | null;
  availableAt: Date;
  maxAttempts: number;
}>): AsyncJobAdmissionInput {
  return {
    operation: RESEARCH_MISSION_EXECUTION_OPERATION,
    logicalOperationId: input.mission.missionId,
    purpose: RESEARCH_MISSION_EXECUTION_PURPOSE,
    correlationId: input.correlationId,
    policyDecisionRef: input.policyDecisionRef,
    inputReference: {
      referenceType: "LEGAL_RESEARCH_MISSION",
      referenceId: input.mission.missionId,
      referenceVersion: RESEARCH_BRIDGE_VERSION,
      metadata: { contractVersion: RESEARCH_BRIDGE_VERSION },
    },
    maxAttempts: input.maxAttempts,
    availableAt: input.availableAt,
    admission: input.actor.admissionType === "AUTHENTICATED_USER"
      ? {
          admissionType: "AUTHENTICATED_USER",
          tenantId: input.actor.tenantId,
          initiatingUserId: input.actor.initiatingUserId!,
          actor: {
            actorId: input.actor.actorId,
            actorEmail: input.actor.actorEmail,
            actorRole: input.actor.actorRole,
          },
        }
      : {
          admissionType: "AUTHORIZED_SYSTEM",
          tenantId: input.actor.tenantId,
          initiatingUserId: null,
          actor: {
            actorId: input.actor.actorId,
            actorEmail: input.actor.actorEmail,
            actorRole: input.actor.actorRole,
          },
        },
  };
}

export const FUTURE_MCP_RESEARCH_PERSISTENCE_MAPPING = Object.freeze({
  get_pending_research_missions: "listPendingResearchMissions",
  get_research_mission: "getResearchMission",
  claim_research_mission: "claimResearchMission",
  submit_research_evidence_bundle: "submitResearchEvidenceBundle",
  reject_or_defer_research_mission: "rejectOrDeferResearchMission",
  complete_research_mission: "completeResearchMission",
} as const);