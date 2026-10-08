import { adverseSearchBasis } from "./adverse-search";
import { createHash, randomBytes } from "node:crypto";

import {
  Prisma,
  type ResearchAssistedVerificationRecord,
  type ResearchEvidenceBundleRecord,
  type ResearchExecutionAttempt,
  type ResearchMissionRecord,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import { readAssistedDocumentEvidence } from "./assisted-document-evidence";
import { readDocumentFileBoundedFromProvider } from "@/server/documents/storage";
import { persistResearchQuestionResults } from "./question-results";

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
import {
  ASSISTED_VERIFICATION_VERSION,
  assistedVerificationPreClaimStatus,
  parseAssistedVerificationSnapshot,
  verifyResearchEvidence,
  type AssistedVerificationResult,
  type AssistedVerificationPreClaimStatus,
  type AssistedVerificationSnapshot,
} from "./assisted-verification";

export const RESEARCH_MISSION_EXECUTION_OPERATION = "LEGAL_RESEARCH.EXECUTE_V1" as const;
export const RESEARCH_MISSION_EXECUTION_PURPOSE = "LEGAL_RESEARCH_EXECUTION" as const;

export type ResearchPersistenceClient = Pick<
  Prisma.TransactionClient,
  | "researchMissionRecord"
  | "researchExecutionAttempt"
  | "researchEvidenceBundleRecord"
  | "researchAssistedVerificationRecord"
  | "documentFileVersion"
  | "legalSourceVersion"
>;

export type ResearchOperationalClock = Readonly<{ now(): Date }>;

export type ResearchPersistenceContext = Readonly<{
  client: ResearchPersistenceClient;
  transaction: <T>(operation: (tx: ResearchPersistenceClient) => Promise<T>) => Promise<T>;
  clock: ResearchOperationalClock;
  claimToken: () => string;
  readAssistedDocuments?: typeof readAssistedDocumentEvidence;
  persistQuestionResults: typeof persistResearchQuestionResults;
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

export type StoredAssistedVerification = Readonly<{
  recordId: string;
  snapshot: AssistedVerificationSnapshot;
  result: AssistedVerificationResult;
  preClaimStatus: AssistedVerificationPreClaimStatus;
  fingerprint: string;
  recordedByActorId: string;
  createdAt: Date;
}>;

export type ResearchPersistenceErrorCode =
  | "ASSISTED_VERIFICATION_CONFLICT"
  | "AUTHORIZATION_REQUIRED"
  | "BUDGET_COUNTER_REGRESSION"
  | "BUDGET_OVERRUN"
  | "BUNDLE_IDEMPOTENCY_CONFLICT"
  | "CLAIM_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_BUNDLE"
  | "INVALID_CLAIM"
  | "INVALID_ASSISTED_VERIFICATION"
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
  persistQuestionResults: persistResearchQuestionResults,
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

function authorize(
  record: Pick<ResearchMissionRecord, "tenantId" | "assignedActorId">,
  actor: ResearchServiceActor,
): void {
  if (
    record.tenantId !== actor.tenantId
    || record.assignedActorId !== identifier(actor.actorId)
  ) {
    throw new ResearchPersistenceError("AUTHORIZATION_REQUIRED");
  }
}

function authorizeMissionCreation(
  record: Pick<ResearchMissionRecord, "tenantId" | "assignedActorId">,
  actor: ResearchServiceActor,
  assignedActorId: string,
): void {
  if (
    record.tenantId !== actor.tenantId
    || record.assignedActorId !== assignedActorId
  ) {
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

function isAssistedVerificationIdentityP2002(error: unknown): boolean {
  const value = p2002Target(error);
  return value?.modelName === "ResearchAssistedVerificationRecord"
    && value.fields.some((field) => [
      "id",
      "fingerprint",
      "research_assisted_verification_fingerprint_uq",
    ].includes(field));
}

function sameMission(
  record: ResearchMissionRecord,
  mission: ResearchMission,
  payloadFingerprint: string,
  assignedActorId: string,
): boolean {
  return record.id === mission.missionId
    && record.payloadFingerprint === payloadFingerprint
    && record.contractVersion === mission.version
    && record.assignedActorId === assignedActorId;
}

export async function createResearchMissionRecord(
  input: Readonly<{
    mission: ResearchMission;
    actor: ResearchServiceActor;
    assignedActorId?: string;
  }>,
  overrides?: Partial<ResearchPersistenceContext>,
): Promise<Readonly<{ outcome: "CREATED" | "REUSED"; mission: StoredResearchMission }>> {
  const ctx = context(overrides);
  if (validateResearchMission(input.mission).length > 0 || input.mission.status !== "PENDING") {
    throw new ResearchPersistenceError("INVALID_MISSION");
  }
  identifier(input.actor.actorId);
  const assignedActorId = identifier(input.assignedActorId ?? input.actor.actorId);
  const payloadFingerprint = fingerprint(input.mission);
  const reuse = (record: ResearchMissionRecord) => {
    authorizeMissionCreation(record, input.actor, assignedActorId);
    if (!sameMission(record, input.mission, payloadFingerprint, assignedActorId)) {
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
        assignedActorId,
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

function assistedVerificationId(value: string): string {
  return `research-verification:${value}`;
}

async function storedAssistedVerification(
  record: ResearchAssistedVerificationRecord,
  mission: ResearchMission,
  ctx: ResearchPersistenceContext,
): Promise<StoredAssistedVerification> {
  const snapshot = parseAssistedVerificationSnapshot(record.payload);
  if (
    !snapshot
    || snapshot.missionId !== mission.missionId
    || record.contractVersion !== ASSISTED_VERIFICATION_VERSION
    || record.fingerprint !== fingerprint(snapshot)
  ) throw new ResearchPersistenceError("INVALID_ASSISTED_VERIFICATION");
  const verifiedDocuments = await (ctx.readAssistedDocuments ?? readAssistedDocumentEvidence)(mission, record.tenantId, snapshot.sources, {
    client: ctx.client, read: readDocumentFileBoundedFromProvider,
  });
  const result = verifyResearchEvidence({ mission, ...snapshot, verifiedDocuments });
  return {
    recordId: record.id,
    snapshot,
    result,
    preClaimStatus: assistedVerificationPreClaimStatus(mission, result),
    fingerprint: record.fingerprint,
    recordedByActorId: record.recordedByActorId,
    createdAt: record.createdAt,
  };
}

function sameAssistedVerification(
  record: ResearchAssistedVerificationRecord,
  snapshot: AssistedVerificationSnapshot,
  snapshotFingerprint: string,
  tenantId: string,
): boolean {
  return record.id === assistedVerificationId(snapshotFingerprint)
    && record.missionId === snapshot.missionId
    && record.tenantId === tenantId
    && record.contractVersion === snapshot.version
    && record.fingerprint === snapshotFingerprint;
}

export async function persistAssistedVerification(
  input: Readonly<{
    snapshot: AssistedVerificationSnapshot;
    actor: ResearchServiceActor;
    expectedPreviousRecordId?: string | null;
    approveAdverseSearch?: boolean;
  }>,
  overrides?: Partial<ResearchPersistenceContext>,
): Promise<Readonly<{ outcome: "CREATED" | "REUSED"; verification: StoredAssistedVerification }>> {
  const ctx = context(overrides);
  const snapshot = parseAssistedVerificationSnapshot(input.snapshot);
  if (!snapshot) {
    throw new ResearchPersistenceError("INVALID_ASSISTED_VERIFICATION");
  }
  if (input.approveAdverseSearch) {
    if (!snapshot.adverseSearch) throw new ResearchPersistenceError("INVALID_ASSISTED_VERIFICATION");
    Object.assign(snapshot, { adverseSearchReview: {
      reviewedByActorId: input.actor.actorId,
      reviewedAt: ctx.clock.now().toISOString(),
      basisFingerprint: adverseSearchBasis(snapshot.adverseSearch, snapshot.sources),
    } });
  }
  const snapshotFingerprint = fingerprint(snapshot);
  const id = assistedVerificationId(snapshotFingerprint);
  const persist = async (tx: ResearchPersistenceClient) => {
    const missionRecord = await tx.researchMissionRecord.findUnique({
      where: { id: identifier(snapshot.missionId) },
    });
    if (!missionRecord) throw new ResearchPersistenceError("MISSION_NOT_FOUND");
    authorize(missionRecord, input.actor);
    const tenantId = missionRecord.tenantId;
    if (!tenantId) throw new ResearchPersistenceError("AUTHORIZATION_REQUIRED");
    const mission = missionFrom(missionRecord);
    const previous = await tx.researchAssistedVerificationRecord.findFirst({
      where: { missionId: missionRecord.id, tenantId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (input.expectedPreviousRecordId !== undefined
      && (previous?.id ?? null) !== input.expectedPreviousRecordId) {
      throw new ResearchPersistenceError("ASSISTED_VERIFICATION_CONFLICT");
    }
    if (previous && input.expectedPreviousRecordId === undefined && previous.fingerprint !== snapshotFingerprint) {
      throw new ResearchPersistenceError("ASSISTED_VERIFICATION_CONFLICT");
    }
    const previousSnapshot = previous ? parseAssistedVerificationSnapshot(previous.payload) : null;
    const unchanged = (value: unknown, prior: unknown) => value !== undefined && prior !== undefined && fingerprint(value) === fingerprint(prior);
    if (snapshot.adverseSearchReview && !input.approveAdverseSearch
      && (!unchanged(snapshot.adverseSearchReview, previousSnapshot?.adverseSearchReview)
        || !snapshot.adverseSearch
        || snapshot.adverseSearchReview.basisFingerprint !== adverseSearchBasis(snapshot.adverseSearch, snapshot.sources))) {
      throw new ResearchPersistenceError("INVALID_ASSISTED_VERIFICATION");
    }
    if (snapshot.sources.some((source) => (
      source.reviewerAttestation.reviewedByActorId !== input.actor.actorId
      && !unchanged(source, previousSnapshot?.sources.find((item) => item.evidenceSourceId === source.evidenceSourceId))
    )) || snapshot.researchSuggestions?.some((suggestion) => (
      suggestion.reviewedByActorId !== input.actor.actorId
      && !previousSnapshot?.researchSuggestions?.some((item) => unchanged(suggestion, item))
    )) || (snapshot.adverseReview
      && snapshot.adverseReview.reviewedByActorId !== input.actor.actorId
      && !unchanged(snapshot.adverseReview, previousSnapshot?.adverseReview))) {
      throw new ResearchPersistenceError("INVALID_ASSISTED_VERIFICATION");
    }
    const verifiedDocuments = await (ctx.readAssistedDocuments ?? readAssistedDocumentEvidence)(mission, tenantId, snapshot.sources, {
      client: tx, read: readDocumentFileBoundedFromProvider,
    });
    const verificationResult = verifyResearchEvidence({ mission, ...snapshot, verifiedDocuments });
    if (input.approveAdverseSearch && verificationResult.adverseSearchState !== "COMPLETED_NO_ADVERSE_FOUND") {
      throw new ResearchPersistenceError("INVALID_ASSISTED_VERIFICATION");
    }
    if (snapshot.gapResolutions?.some((resolution) => (
      !previousSnapshot?.gapResolutions?.some((prior) => unchanged(resolution, prior))
      && !verificationResult.resolvedGaps?.some((resolved) => unchanged(resolution, resolved))
    ))) throw new ResearchPersistenceError("INVALID_ASSISTED_VERIFICATION");
    const sourceChanged = (evidenceSourceId: string) => {
      const prior = previousSnapshot?.sources.find((source) => source.evidenceSourceId === evidenceSourceId);
      const next = snapshot.sources.find((source) => source.evidenceSourceId === evidenceSourceId);
      return prior !== undefined && !unchanged(next, prior);
    };
    const relationSourceChanged = snapshot.citationRelation && previousSnapshot?.sources.some((source) => (
      [snapshot.citationRelation?.sourceAuthorityId, snapshot.citationRelation?.targetAuthorityId].includes(source.authorityId)
      && sourceChanged(source.evidenceSourceId)
    ));
    if ((snapshot.adverseReview && unchanged(snapshot.adverseReview, previousSnapshot?.adverseReview)
      && (sourceChanged(snapshot.adverseReview.evidenceSourceId) || relationSourceChanged
        || !unchanged(snapshot.citationRelation, previousSnapshot?.citationRelation)))
      || (snapshot.citationRelation && unchanged(snapshot.citationRelation, previousSnapshot?.citationRelation) && relationSourceChanged)
      || snapshot.researchSuggestions?.some((suggestion) => (
        previousSnapshot?.researchSuggestions?.some((prior) => unchanged(suggestion, prior))
        && sourceChanged(suggestion.evidenceSourceId)
      ))) {
      throw new ResearchPersistenceError("INVALID_ASSISTED_VERIFICATION");
    }
    const previousSuggestionFingerprints = new Set(
      (previousSnapshot?.researchSuggestions ?? []).map((suggestion) => fingerprint(suggestion)),
    );
    if (snapshot.researchSuggestions?.some((suggestion) => (
      !previousSuggestionFingerprints.has(fingerprint(suggestion))
      && !verificationResult.legalResearchSuggestions.some((verified) => verified.originatingGapId === suggestion.originatingGapId
        && verified.evidenceSourceIds.includes(suggestion.evidenceSourceId))
    ))) throw new ResearchPersistenceError("INVALID_ASSISTED_VERIFICATION");
    const activeGapIds = new Set(verificationResult.evidenceGaps.map((item) => item.gapId));
    if (snapshot.researchSuggestions?.some((suggestion) => (
      !previousSuggestionFingerprints.has(fingerprint(suggestion))
      && !activeGapIds.has(suggestion.originatingGapId)
    ))) {
      throw new ResearchPersistenceError("INVALID_ASSISTED_VERIFICATION");
    }
    if (snapshot.adverseReview && !unchanged(snapshot.adverseReview, previousSnapshot?.adverseReview)) {
      const review = snapshot.adverseReview;
      const documentedObservation = verificationResult.citationObservations.some((observation) => (
        observation.sourceAuthorityId === review.observationSourceAuthorityId
        && observation.targetAuthorityId === review.observationTargetAuthorityId
        && observation.provenance.evidenceSourceId === review.evidenceSourceId
      ));
      if (
        !documentedObservation
        || !mission.legalPropositionIds.includes(review.legalPropositionId)
        || (review.decision === "ADVERSE" && verificationResult.adverseAssessments.length === 0)
      ) throw new ResearchPersistenceError("INVALID_ASSISTED_VERIFICATION");
    }
    const existing = await tx.researchAssistedVerificationRecord.findUnique({
      where: { fingerprint: snapshotFingerprint },
    });
    if (existing) {
      if (!sameAssistedVerification(existing, snapshot, snapshotFingerprint, tenantId)) {
        throw new ResearchPersistenceError("IDEMPOTENCY_CONFLICT");
      }
      return {
        outcome: "REUSED" as const,
        verification: await storedAssistedVerification(existing, mission, { ...ctx, client: tx }),
      };
    }
    const created = await tx.researchAssistedVerificationRecord.create({
      data: {
        id,
        missionId: snapshot.missionId,
        tenantId,
        contractVersion: snapshot.version,
        fingerprint: snapshotFingerprint,
        payload: json(snapshot),
        recordedByActorId: input.actor.actorId,
        createdAt: new Date(Math.max(ctx.clock.now().getTime(), (previous?.createdAt.getTime() ?? -1) + 1)),
      },
    });
    return {
      outcome: "CREATED" as const,
      verification: await storedAssistedVerification(created, mission, { ...ctx, client: tx }),
    };
  };
  try {
    return await ctx.transaction(persist);
  } catch (cause) {
    if (!isAssistedVerificationIdentityP2002(cause)) throw cause;
    const missionRecord = await ctx.client.researchMissionRecord.findUnique({
      where: { id: snapshot.missionId },
    });
    if (!missionRecord) throw new ResearchPersistenceError("MISSION_NOT_FOUND");
    authorize(missionRecord, input.actor);
    const tenantId = missionRecord.tenantId;
    if (!tenantId) throw new ResearchPersistenceError("AUTHORIZATION_REQUIRED");
    const winner = await ctx.client.researchAssistedVerificationRecord.findUnique({
      where: { fingerprint: snapshotFingerprint },
    });
    if (!winner || !sameAssistedVerification(
      winner,
      snapshot,
      snapshotFingerprint,
      tenantId,
    )) throw new ResearchPersistenceError("IDEMPOTENCY_CONFLICT");
    return {
      outcome: "REUSED",
      verification: await storedAssistedVerification(winner, missionFrom(missionRecord), ctx),
    };
  }
}

export async function getLatestAssistedVerification(
  missionId: string,
  actor: ResearchServiceActor,
  overrides?: Partial<ResearchPersistenceContext>,
): Promise<StoredAssistedVerification | null> {
  const ctx = context(overrides);
  const missionRecord = await ctx.client.researchMissionRecord.findUnique({
    where: { id: identifier(missionId) },
  });
  if (!missionRecord) return null;
  authorize(missionRecord, actor);
  const tenantId = missionRecord.tenantId;
  if (!tenantId) throw new ResearchPersistenceError("AUTHORIZATION_REQUIRED");
  const record = await ctx.client.researchAssistedVerificationRecord.findFirst({
    where: { missionId: missionRecord.id, tenantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return record ? storedAssistedVerification(record, missionFrom(missionRecord), ctx) : null;
}

export function createAssistedVerificationReader(
  actor: ResearchServiceActor,
  overrides?: Partial<ResearchPersistenceContext>,
): (mission: ResearchMission) => Promise<AssistedVerificationResult | null> {
  return async (mission) => (
    await getLatestAssistedVerification(mission.missionId, actor, overrides)
  )?.result ?? null;
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
      assignedActorId: identifier(actor.actorId),
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
      assignedActorId: identifier(actor.actorId),
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

async function requireDocumentaryEvidence(
  mission: ResearchMission,
  actor: ResearchServiceActor,
  ctx: ResearchPersistenceContext,
): Promise<StoredAssistedVerification | null> {
  if (!mission.requiredOutput.fullTextRequired && !mission.requiredOutput.citationObservations) return null;
  const verification = await getLatestAssistedVerification(mission.missionId, actor, ctx);
  if (!verification || verification.result.evidenceGaps.length > 0
    || (mission.requiredOutput.fullTextRequired && verification.result.verifiedFullTexts.length === 0)
    || (mission.requiredOutput.citationObservations && verification.result.citationObservations.length === 0)
    || (mission.requiredOutput.authorityCandidates && verification.result.authorityCandidates.length === 0)
    || (mission.requiredOutput.legalResearchSuggestions && verification.result.legalResearchSuggestions.length === 0)
    || (mission.executionPlan?.requiredCapabilities.includes("ADVERSE_AUTHORITY_DISCOVERY") && !(verification.result.adverseSearchCompleted ?? verification.result.adverseAuthorityVerified))) {
    throw new ResearchPersistenceError("INVALID_TRANSITION");
  }
  return verification;
}

async function requirePreClaimDocumentaryEvidence(
  mission: ResearchMission,
  actor: ResearchServiceActor,
  ctx: ResearchPersistenceContext,
): Promise<void> {
  if (mission.mode === "EXACT_SOURCE_RECOVERY") return;
  await requireDocumentaryEvidence(mission, actor, ctx);
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
    await requirePreClaimDocumentaryEvidence(missionFrom(current), input.actor, { ...ctx, client: tx });
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
    await requirePreClaimDocumentaryEvidence(missionFrom(current), input.actor, ctx);
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

function verifiedBundleCandidates(bundle: ResearchEvidenceBundle) {
  return bundle.authorityCandidates.filter((candidate) => (
    candidate.verificationState === "OFFICIALLY_VERIFIED" || candidate.toolId === "ASSISTED_VERIFICATION"
  ));
}

function hasStructuredQuestionLink(record: ResearchMissionRecord): boolean {
  return typeof record.tenantId === "string" && record.tenantId.length > 0
    && typeof record.missionFingerprint === "string"
    && typeof record.legalIssueSemanticKey === "string"
    && typeof record.researchQuestionSemanticKey === "string";
}

function verifiedBundleCandidatesMatch(
  bundle: ResearchEvidenceBundle,
  verification: AssistedVerificationResult | undefined,
): boolean {
  const candidates = verifiedBundleCandidates(bundle);
  if (candidates.length === 0) return true;
  if (!verification || !bundle.assistedVerificationFingerprint
    || bundle.assistedVerificationFingerprint !== verification.assistedVerificationFingerprint) return false;
  const verified = new Set(verification.authorityCandidates.map(fingerprint));
  return candidates.every((candidate) => verified.has(fingerprint(candidate)));
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
    if (verifiedBundleCandidates(input.bundle).length > 0) {
      const verification = await getLatestAssistedVerification(mission.missionId, input.actor, { ...ctx, client: tx });
      if (!verifiedBundleCandidatesMatch(input.bundle, verification?.result)) {
        throw new ResearchPersistenceError("INVALID_BUNDLE");
      }
    }
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
      return { outcome: "REUSED" as const, bundle: existing, linkQuestionResults: hasStructuredQuestionLink(missionRecord) };
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
    return { outcome: "CREATED" as const, bundle: created, linkQuestionResults: hasStructuredQuestionLink(missionRecord) };
  };
  let stored: Readonly<{ outcome: "CREATED" | "REUSED"; bundle: ResearchEvidenceBundleRecord; linkQuestionResults: boolean }>;
  try {
    stored = await ctx.transaction(persist);
  } catch (cause) {
    if (!isBundleIdentityP2002(cause)) throw cause;
    const winner = await ctx.client.researchEvidenceBundleRecord.findUnique({
      where: { fingerprint: bundleFingerprint },
    });
    if (!winner || !sameBundle(winner, input.bundle, bundleFingerprint)) {
      throw new ResearchPersistenceError("BUNDLE_IDEMPOTENCY_CONFLICT");
    }
    const missionRecord = await ctx.client.researchMissionRecord.findUnique({ where: { id: input.bundle.missionId } });
    stored = { outcome: "REUSED", bundle: winner, linkQuestionResults: missionRecord !== null && hasStructuredQuestionLink(missionRecord) };
  }
  if (stored.linkQuestionResults) {
    await ctx.persistQuestionResults({
      missionId: input.bundle.missionId,
      bundleId: stored.bundle.id,
      candidates: input.bundle.authorityCandidates,
    });
  }
  return { outcome: stored.outcome, bundle: stored.bundle };
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
    if (evidence.completionState === "COMPLETE") {
      const completedMission = missionFrom(current);
      const completedBundle = evidence.payload as unknown as ResearchEvidenceBundle;
      if ((completedMission.requiredOutput.fullTextRequired || completedMission.requiredOutput.citationObservations)
        && (completedBundle.evidenceGaps.length > 0
          || (completedMission.requiredOutput.authorityCandidates && completedBundle.authorityCandidates.length === 0)
          || (completedMission.requiredOutput.citationObservations && completedBundle.citationObservations.length === 0)
          || (completedMission.requiredOutput.legalResearchSuggestions && completedBundle.legalResearchSuggestions.length === 0))) {
        throw new ResearchPersistenceError("INVALID_BUNDLE");
      }
      const documentaryVerification = await requireDocumentaryEvidence(completedMission, input.actor, { ...ctx, client: tx });
      const verification = documentaryVerification ?? (verifiedBundleCandidates(completedBundle).length > 0
        ? await getLatestAssistedVerification(completedMission.missionId, input.actor, { ...ctx, client: tx }) : null);
      if (!verifiedBundleCandidatesMatch(completedBundle, verification?.result)) {
        throw new ResearchPersistenceError("INVALID_BUNDLE");
      }
      if (verification) {
        const containsEvidence = (actual: readonly unknown[], expected: readonly unknown[]) => {
          const fingerprints = new Set(actual.map(fingerprint));
          return expected.every((item) => fingerprints.has(fingerprint(item)));
        };
        if (!sameBundle(evidence, completedBundle, researchEvidenceBundleFingerprint(completedBundle))
          || completedBundle.completionState !== evidence.completionState
          || !completedBundle.assistedVerificationFingerprint
          || completedBundle.assistedVerificationFingerprint !== verification.result.assistedVerificationFingerprint
          || !containsEvidence(completedBundle.authorityCandidates, verification.result.authorityCandidates)
          || !containsEvidence(completedBundle.citationObservations, verification.result.citationObservations)
          || !containsEvidence(completedBundle.legalResearchSuggestions, verification.result.legalResearchSuggestions)) {
          throw new ResearchPersistenceError("INVALID_BUNDLE");
        }
      }
    }
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
    procedimentoId: input.mission.caseReference.caseId,
    priority: "NORMAL",
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