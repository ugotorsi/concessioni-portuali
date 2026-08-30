import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, isBackofficeRole } from "@/lib/auth";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import {
  AiFascicoloHumanReviewError,
  buildAiFascicoloHumanReviewEventV1,
  type AiFascicoloCompanyReviewDispositionV1,
  type AiFascicoloHumanReviewActorV1,
  type AiFascicoloHumanReviewCommandV1,
  type AiFascicoloHumanReviewEventV1,
} from "@/server/ai/fascicoloHumanReview";
import {
  AI_FASCICOLO_TRUSTED_REVIEW_V1_SCHEMA_VERSION,
  parseAiFascicoloTrustedReviewV1,
  type AiFascicoloTrustedReviewV1,
} from "@/server/ai/fascicoloTrustedReview";
import {
  AI_FASCICOLO_TRUSTED_REVIEW_MATERIAL_V1_SCHEMA_VERSION,
  buildAiFascicoloTrustedReviewMaterialIdentityV1,
  parseAiFascicoloTrustedReviewMaterialLineageV1,
} from "@/server/ai/fascicoloTrustedReviewIdentity";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

const INPUT_FIELDS = ["materialId", "statementPath", "idempotencyKey", "command"] as const;
const CANONICAL_ENVELOPE_FIELDS = ["schemaVersion", "lineage", "trustedReview"] as const;
const MAX_RACE_RECONCILIATIONS = 3;

type HumanReviewPersistenceErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED_ACTOR"
  | "MATERIAL_NOT_FOUND"
  | "TENANT_MISMATCH"
  | "INVALID_TRUSTED_MATERIAL"
  | "STATEMENT_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "CONCURRENT_REVIEW_CONFLICT"
  | "PERSISTENCE_FAILURE";

export class AiFascicoloHumanReviewPersistenceError extends Error {
  constructor(readonly code: HumanReviewPersistenceErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = "AiFascicoloHumanReviewPersistenceError";
  }
}

export interface AiFascicoloHumanReviewPersistenceInput {
  readonly materialId: string;
  readonly statementPath: string;
  readonly idempotencyKey: string;
  readonly command: AiFascicoloHumanReviewCommandV1;
}

export interface AiFascicoloHumanReviewPersistenceResult {
  readonly outcome: "APPLIED" | "REUSED";
  readonly materialId: string;
  readonly statementPath: string;
  readonly event: {
    readonly id: string;
    readonly sequence: number;
    readonly disposition: AiFascicoloCompanyReviewDispositionV1;
  };
  readonly state: {
    readonly id: string;
    readonly version: number;
    readonly latestDisposition: AiFascicoloCompanyReviewDispositionV1;
  };
}

interface ParsedServiceInput {
  readonly materialId: string;
  readonly statementPath: string;
  readonly idempotencyKey: string;
  readonly command: AiFascicoloHumanReviewCommandV1;
}

interface PersistedMaterial {
  readonly id: string;
  readonly enteId: string;
  readonly procedimentoId: string;
  readonly identityContractVersion: string;
  readonly canonicalizationVersion: string;
  readonly fingerprintAlgorithm: string;
  readonly fingerprint: string;
  readonly canonicalPayload: string;
  readonly trustedReviewSchemaVersion: string;
  readonly analysisSchemaVersion: string;
  readonly snapshotSchemaVersion: string;
  readonly outboundSchemaVersion: string;
  readonly sourceSnapshotContentHash: string;
  readonly outboundProjectionHash: string;
  readonly outboundProjectionHashAlgorithm: string;
  readonly procedimento: {
    readonly id: string;
    readonly concessione: { readonly enteId: string | null } | null;
  };
}

interface CurrentState {
  readonly id: string;
  readonly materialId: string;
  readonly enteId: string;
  readonly procedimentoId: string;
  readonly statementPath: string;
  readonly version: number;
  readonly latestDisposition: AiFascicoloCompanyReviewDispositionV1 | null;
}

const MATERIAL_SELECT = {
  id: true,
  enteId: true,
  procedimentoId: true,
  identityContractVersion: true,
  canonicalizationVersion: true,
  fingerprintAlgorithm: true,
  fingerprint: true,
  canonicalPayload: true,
  trustedReviewSchemaVersion: true,
  analysisSchemaVersion: true,
  snapshotSchemaVersion: true,
  outboundSchemaVersion: true,
  sourceSnapshotContentHash: true,
  outboundProjectionHash: true,
  outboundProjectionHashAlgorithm: true,
  procedimento: {
    select: {
      id: true,
      concessione: { select: { enteId: true } },
    },
  },
} as const;

const STATE_SELECT = {
  id: true,
  materialId: true,
  enteId: true,
  procedimentoId: true,
  statementPath: true,
  version: true,
  latestDisposition: true,
} as const;

const EVENT_SELECT = {
  id: true,
  stateId: true,
  materialId: true,
  enteId: true,
  procedimentoId: true,
  statementPath: true,
  sequence: true,
  disposition: true,
  commandFingerprint: true,
} as const;

class RetryableReviewRaceError extends Error {}

type HumanReviewP2002Race =
  | "STATE_IDENTITY_RACE"
  | "EVENT_IDEMPOTENCY_RACE"
  | "EVENT_SEQUENCE_RACE";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactDataFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.getOwnPropertyNames(value);
  return names.length === fields.length && fields.every((field) => {
    const descriptor = descriptors[field];
    return descriptor?.enumerable === true && "value" in descriptor;
  });
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasExactCommandShape(command: Record<string, unknown>): boolean {
  switch (command.disposition) {
    case "COMPANY_ACCEPTED":
      return hasExactDataFields(
        command,
        Object.hasOwn(command, "note") ? ["disposition", "note"] : ["disposition"],
      );
    case "COMPANY_REJECTED":
    case "COMPANY_NEEDS_VERIFICATION":
      return hasExactDataFields(command, ["disposition", "reason"]);
    case "COMPANY_AMENDED": {
      if (!hasExactDataFields(command, ["disposition", "amendment"])) {
        return false;
      }
      const amendment = command.amendment;
      return isPlainRecord(amendment)
        && hasExactDataFields(amendment, ["text", "reason"]);
    }
    default:
      return false;
  }
}

function parseServiceInput(input: unknown): ParsedServiceInput {
  if (!isPlainRecord(input) || !hasExactDataFields(input, INPUT_FIELDS)) {
    throw new AiFascicoloHumanReviewPersistenceError("INVALID_INPUT");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const materialId = descriptors.materialId.value;
  const statementPath = descriptors.statementPath.value;
  const idempotencyKey = descriptors.idempotencyKey.value;
  const command = descriptors.command.value;
  if (
    !nonEmpty(materialId)
    || !nonEmpty(statementPath)
    || !nonEmpty(idempotencyKey)
    || !isPlainRecord(command)
    || !hasExactCommandShape(command)
  ) {
    throw new AiFascicoloHumanReviewPersistenceError("INVALID_INPUT");
  }
  return {
    materialId,
    statementPath,
    idempotencyKey,
    command: command as unknown as AiFascicoloHumanReviewCommandV1,
  };
}

function parseTrustedMaterial(material: PersistedMaterial): AiFascicoloTrustedReviewV1 {
  try {
    const envelope: unknown = JSON.parse(material.canonicalPayload);
    if (
      !isPlainRecord(envelope)
      || !hasExactDataFields(envelope, CANONICAL_ENVELOPE_FIELDS)
      || envelope.schemaVersion !== AI_FASCICOLO_TRUSTED_REVIEW_MATERIAL_V1_SCHEMA_VERSION
    ) {
      throw new Error("Invalid canonical envelope");
    }
    const lineage = parseAiFascicoloTrustedReviewMaterialLineageV1(envelope.lineage);
    const trustedReview = parseAiFascicoloTrustedReviewV1(envelope.trustedReview);
    const identity = buildAiFascicoloTrustedReviewMaterialIdentityV1({ trustedReview, lineage });
    if (
      material.identityContractVersion !== identity.schemaVersion
      || material.canonicalizationVersion !== identity.canonicalizationVersion
      || material.fingerprintAlgorithm !== identity.fingerprintAlgorithm
      || material.fingerprint !== identity.fingerprint
      || material.canonicalPayload !== identity.canonicalPayload
      || material.trustedReviewSchemaVersion !== AI_FASCICOLO_TRUSTED_REVIEW_V1_SCHEMA_VERSION
      || material.analysisSchemaVersion !== lineage.analysisSchemaVersion
      || material.snapshotSchemaVersion !== lineage.snapshotSchemaVersion
      || material.outboundSchemaVersion !== lineage.outboundSchemaVersion
      || material.sourceSnapshotContentHash !== lineage.sourceSnapshotContentHash
      || material.outboundProjectionHash !== lineage.outboundProjectionHash
      || material.outboundProjectionHashAlgorithm !== lineage.outboundProjectionHashAlgorithm
    ) {
      throw new Error("Inconsistent trusted material");
    }
    return trustedReview;
  } catch (error) {
    throw new AiFascicoloHumanReviewPersistenceError("INVALID_TRUSTED_MATERIAL", error);
  }
}

function buildDomainEvent(input: {
  readonly trustedReview: AiFascicoloTrustedReviewV1;
  readonly parsed: ParsedServiceInput;
  readonly actor: AiFascicoloHumanReviewActorV1;
  readonly occurredAt: string;
}): AiFascicoloHumanReviewEventV1 {
  try {
    return buildAiFascicoloHumanReviewEventV1({
      trustedReview: input.trustedReview,
      statementPath: input.parsed.statementPath,
      actor: input.actor,
      occurredAt: input.occurredAt,
      command: input.parsed.command,
    });
  } catch (error) {
    if (error instanceof AiFascicoloHumanReviewError) {
      if (error.code === "INVALID_REVIEW_TARGET") {
        throw new AiFascicoloHumanReviewPersistenceError("STATEMENT_NOT_FOUND", error);
      }
      if (error.code === "INVALID_HUMAN_ACTOR") {
        throw new AiFascicoloHumanReviewPersistenceError("UNAUTHENTICATED_ACTOR", error);
      }
      throw new AiFascicoloHumanReviewPersistenceError("INVALID_INPUT", error);
    }
    throw new AiFascicoloHumanReviewPersistenceError("INVALID_INPUT", error);
  }
}

function fingerprintCommand(input: {
  readonly materialId: string;
  readonly statementPath: string;
  readonly actor: AiFascicoloHumanReviewActorV1;
  readonly event: AiFascicoloHumanReviewEventV1;
}): string {
  const command = (() => {
    switch (input.event.disposition) {
      case "COMPANY_ACCEPTED":
        return { disposition: input.event.disposition, note: input.event.note ?? null };
      case "COMPANY_REJECTED":
      case "COMPANY_NEEDS_VERIFICATION":
        return { disposition: input.event.disposition, reason: input.event.reason };
      case "COMPANY_AMENDED":
        return {
          disposition: input.event.disposition,
          amendment: {
            text: input.event.amendment?.text,
            reason: input.event.amendment?.reason,
          },
        };
    }
  })();
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: input.event.schemaVersion,
    materialId: input.materialId,
    statementPath: input.statementPath,
    actor: input.actor,
    command,
  })).digest("hex");
}

function result(input: {
  readonly outcome: AiFascicoloHumanReviewPersistenceResult["outcome"];
  readonly materialId: string;
  readonly statementPath: string;
  readonly event: {
    readonly id: string;
    readonly sequence: number;
    readonly disposition: AiFascicoloCompanyReviewDispositionV1;
  };
  readonly state: {
    readonly id: string;
    readonly version: number;
    readonly latestDisposition: AiFascicoloCompanyReviewDispositionV1;
  };
}): AiFascicoloHumanReviewPersistenceResult {
  return Object.freeze({
    outcome: input.outcome,
    materialId: input.materialId,
    statementPath: input.statementPath,
    event: Object.freeze({ ...input.event }),
    state: Object.freeze({ ...input.state }),
  });
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeConstraintFields(fields: unknown): string[] | null {
  if (!Array.isArray(fields)) {
    return null;
  }
  const normalized = fields.map((field) => {
    if (typeof field !== "string") {
      return null;
    }
    return field.startsWith('"') && field.endsWith('"')
      ? field.slice(1, -1)
      : field;
  });
  return normalized.some((field) => field === null)
    ? null
    : normalized as string[];
}

function p2002Identity(error: unknown): { readonly modelName: string; readonly fields: string[] } | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return null;
  }
  const meta = error.meta;
  if (!isPlainRecord(meta) || typeof meta.modelName !== "string") {
    return null;
  }
  const target = meta?.target;
  if (typeof target === "string") {
    return { modelName: meta.modelName, fields: [target] };
  }
  if (target !== undefined) {
    const fields = normalizeConstraintFields(target);
    return fields ? { modelName: meta.modelName, fields } : null;
  }
  const adapter = meta.driverAdapterError;
  if (!isRecordLike(adapter)) {
    return null;
  }
  const cause = adapter.cause;
  if (
    !isPlainRecord(cause)
    || cause.kind !== "UniqueConstraintViolation"
    || cause.originalCode !== "23505"
    || !isPlainRecord(cause.constraint)
  ) {
    return null;
  }
  const fields = normalizeConstraintFields(cause.constraint.fields);
  if (!fields) {
    return null;
  }
  return {
    modelName: meta.modelName,
    fields,
  };
}

function sameFields(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && new Set(actual).size === expected.length
    && expected.every((field) => actual.includes(field));
}

function classifyHumanReviewP2002(error: unknown): HumanReviewP2002Race | null {
  const violation = p2002Identity(error);
  if (!violation) {
    return null;
  }
  if (
    violation.modelName === "AiFascicoloHumanReviewState"
    && ((violation.fields.length === 1 && violation.fields[0] === "materialId_statementPath")
      || sameFields(violation.fields, ["materialId", "statementPath"]))
  ) {
    return "STATE_IDENTITY_RACE";
  }
  if (violation.modelName !== "AiFascicoloHumanReviewEvent") {
    return null;
  }
  if (
    (violation.fields.length === 1 && violation.fields[0] === "enteId_idempotencyKey")
    || sameFields(violation.fields, ["enteId", "idempotencyKey"])
  ) {
    return "EVENT_IDEMPOTENCY_RACE";
  }
  if (
    (violation.fields.length === 1 && violation.fields[0] === "materialId_statementPath_sequence")
    || sameFields(violation.fields, ["materialId", "statementPath", "sequence"])
  ) {
    return "EVENT_SEQUENCE_RACE";
  }
  return null;
}

function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

async function applyInTransaction(input: {
  readonly tx: Prisma.TransactionClient;
  readonly parsed: ParsedServiceInput;
  readonly actor: AiFascicoloHumanReviewActorV1;
  readonly tenantContext: NonNullable<Awaited<ReturnType<typeof getCurrentTenantContext>>>;
  readonly occurredAt: string;
}): Promise<AiFascicoloHumanReviewPersistenceResult> {
  const material = await input.tx.aiFascicoloTrustedReviewMaterial.findUnique({
    where: { id: input.parsed.materialId },
    select: MATERIAL_SELECT,
  }) as PersistedMaterial | null;
  if (!material) {
    throw new AiFascicoloHumanReviewPersistenceError("MATERIAL_NOT_FOUND");
  }
  const canonicalEnteId = material.procedimento.concessione?.enteId;
  if (
    !canonicalEnteId
    || material.enteId !== canonicalEnteId
    || material.procedimentoId !== material.procedimento.id
  ) {
    throw new AiFascicoloHumanReviewPersistenceError("TENANT_MISMATCH");
  }
  try {
    requireTenantAccess(input.tenantContext, canonicalEnteId, {
      mode: "write",
      allowWhenEnteMissing: false,
    });
  } catch (error) {
    throw new AiFascicoloHumanReviewPersistenceError("TENANT_MISMATCH", error);
  }

  const trustedReview = parseTrustedMaterial(material);
  const domainEvent = buildDomainEvent({
    trustedReview,
    parsed: input.parsed,
    actor: input.actor,
    occurredAt: input.occurredAt,
  });
  const commandFingerprint = fingerprintCommand({
    materialId: material.id,
    statementPath: input.parsed.statementPath,
    actor: input.actor,
    event: domainEvent,
  });

  const existingEvent = await input.tx.aiFascicoloHumanReviewEvent.findUnique({
    where: {
      enteId_idempotencyKey: {
        enteId: canonicalEnteId,
        idempotencyKey: input.parsed.idempotencyKey,
      },
    },
    select: EVENT_SELECT,
  });
  if (existingEvent) {
    if (
      existingEvent.commandFingerprint !== commandFingerprint
      || existingEvent.materialId !== material.id
      || existingEvent.procedimentoId !== material.procedimentoId
      || existingEvent.statementPath !== input.parsed.statementPath
    ) {
      throw new AiFascicoloHumanReviewPersistenceError("IDEMPOTENCY_CONFLICT");
    }
    const existingState = await input.tx.aiFascicoloHumanReviewState.findUnique({
      where: {
        materialId_statementPath: {
          materialId: material.id,
          statementPath: input.parsed.statementPath,
        },
      },
      select: STATE_SELECT,
    }) as CurrentState | null;
    if (
      !existingState
      || existingState.id !== existingEvent.stateId
      || existingState.enteId !== canonicalEnteId
      || existingState.procedimentoId !== material.procedimentoId
      || existingState.version < existingEvent.sequence
      || existingState.latestDisposition === null
    ) {
      throw new AiFascicoloHumanReviewPersistenceError("PERSISTENCE_FAILURE");
    }
    return result({
      outcome: "REUSED",
      materialId: material.id,
      statementPath: input.parsed.statementPath,
      event: existingEvent,
      state: existingState as CurrentState & { latestDisposition: AiFascicoloCompanyReviewDispositionV1 },
    });
  }

  let state = await input.tx.aiFascicoloHumanReviewState.findUnique({
    where: {
      materialId_statementPath: {
        materialId: material.id,
        statementPath: input.parsed.statementPath,
      },
    },
    select: STATE_SELECT,
  }) as CurrentState | null;
  if (!state) {
    state = await input.tx.aiFascicoloHumanReviewState.create({
      data: {
        materialId: material.id,
        enteId: canonicalEnteId,
        procedimentoId: material.procedimentoId,
        statementPath: input.parsed.statementPath,
        version: 0,
      },
      select: STATE_SELECT,
    }) as CurrentState;
  }
  if (
    state.materialId !== material.id
    || state.enteId !== canonicalEnteId
    || state.procedimentoId !== material.procedimentoId
    || state.statementPath !== input.parsed.statementPath
    || !Number.isSafeInteger(state.version)
    || state.version < 0
  ) {
    throw new AiFascicoloHumanReviewPersistenceError("PERSISTENCE_FAILURE");
  }

  const sequence = state.version + 1;
  const createdEvent = await input.tx.aiFascicoloHumanReviewEvent.create({
    data: {
      stateId: state.id,
      materialId: material.id,
      enteId: canonicalEnteId,
      procedimentoId: material.procedimentoId,
      statementPath: input.parsed.statementPath,
      sequence,
      disposition: domainEvent.disposition,
      humanUserId: input.actor.userId,
      actorIdSnapshot: input.actor.actorId,
      actorEmailSnapshot: input.actor.email,
      actorRoleSnapshot: input.actor.role,
      occurredAt: new Date(domainEvent.occurredAt),
      note: domainEvent.note ?? null,
      reason: domainEvent.reason ?? null,
      amendmentText: domainEvent.amendment?.text ?? null,
      idempotencyKey: input.parsed.idempotencyKey,
      commandFingerprint,
    },
    select: EVENT_SELECT,
  });
  const update = await input.tx.aiFascicoloHumanReviewState.updateMany({
    where: { id: state.id, version: state.version },
    data: {
      version: { increment: 1 },
      latestDisposition: domainEvent.disposition,
    },
  });
  if (update.count !== 1) {
    throw new RetryableReviewRaceError();
  }

  await createAuditLogInTransaction(input.tx, {
    azione: "AI_FASCICOLO_HUMAN_COMPANY_REVIEW_APPLY",
    entita: "AiFascicoloHumanReviewEvent",
    entitaId: createdEvent.id,
    enteId: canonicalEnteId,
    esito: "SUCCESS",
    actor: {
      userId: input.actor.userId,
      userEmail: input.actor.email,
      userRole: input.actor.role,
    },
    metadata: {
      materialId: material.id,
      procedimentoId: material.procedimentoId,
      statementPath: input.parsed.statementPath,
      eventId: createdEvent.id,
      sequence,
      stateId: state.id,
      stateVersion: sequence,
      disposition: domainEvent.disposition,
      provenance: "COMPANY_REVIEW",
    },
  });

  return result({
    outcome: "APPLIED",
    materialId: material.id,
    statementPath: input.parsed.statementPath,
    event: createdEvent,
    state: {
      id: state.id,
      version: sequence,
      latestDisposition: domainEvent.disposition,
    },
  });
}

export async function persistAiFascicoloHumanReview(
  input: unknown,
): Promise<AiFascicoloHumanReviewPersistenceResult> {
  const parsed = parseServiceInput(input);

  let currentUser;
  let tenantContext;
  try {
    [currentUser, tenantContext] = await Promise.all([
      getCurrentUser(),
      getCurrentTenantContext(),
    ]);
  } catch (error) {
    throw new AiFascicoloHumanReviewPersistenceError("PERSISTENCE_FAILURE", error);
  }
  if (
    !currentUser
    || !tenantContext
    || tenantContext.userId !== currentUser.id
    || !isBackofficeRole(currentUser.role)
  ) {
    throw new AiFascicoloHumanReviewPersistenceError("UNAUTHENTICATED_ACTOR");
  }

  const actor: AiFascicoloHumanReviewActorV1 = {
    actorType: "HUMAN_INTERNAL_COMPANY_OPERATOR",
    userId: currentUser.id,
    actorId: currentUser.id,
    email: currentUser.email,
    role: currentUser.role,
  };
  const occurredAt = new Date().toISOString();

  for (let attempt = 1; attempt <= MAX_RACE_RECONCILIATIONS; attempt += 1) {
    try {
      return await runSerializableTransactionWithRetry((tx) => applyInTransaction({
        tx,
        parsed,
        actor,
        tenantContext,
        occurredAt,
      }));
    } catch (error) {
      if (error instanceof AiFascicoloHumanReviewPersistenceError) {
        throw error;
      }
      const retryable = error instanceof RetryableReviewRaceError
        || classifyHumanReviewP2002(error) !== null;
      if (retryable && attempt < MAX_RACE_RECONCILIATIONS) {
        continue;
      }
      if (retryable || isSerializationFailure(error)) {
        throw new AiFascicoloHumanReviewPersistenceError("CONCURRENT_REVIEW_CONFLICT", error);
      }
      throw new AiFascicoloHumanReviewPersistenceError("PERSISTENCE_FAILURE", error);
    }
  }

  throw new AiFascicoloHumanReviewPersistenceError("CONCURRENT_REVIEW_CONFLICT");
}