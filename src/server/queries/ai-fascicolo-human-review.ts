import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, isBackofficeRole } from "@/lib/auth";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import {
  AiFascicoloHumanReviewError,
  buildAiFascicoloHumanReviewEventV1,
  deriveAiFascicoloHumanReviewCurrentStateV1,
  type AiFascicoloCompanyReviewDispositionV1,
  type AiFascicoloHumanReviewCommandV1,
  type AiFascicoloHumanReviewEventV1,
} from "@/server/ai/fascicoloHumanReview";
import {
  AI_FASCICOLO_TRUSTED_REVIEW_V1_SCHEMA_VERSION,
  parseAiFascicoloTrustedReviewV1,
  type AiFascicoloTrustedReviewStatementV1,
  type AiFascicoloTrustedReviewV1,
} from "@/server/ai/fascicoloTrustedReview";
import {
  AI_FASCICOLO_TRUSTED_REVIEW_MATERIAL_V1_SCHEMA_VERSION,
  buildAiFascicoloTrustedReviewMaterialIdentityV1,
  parseAiFascicoloTrustedReviewMaterialLineageV1,
} from "@/server/ai/fascicoloTrustedReviewIdentity";

const INPUT_FIELDS = ["materialId", "statementPath"] as const;
const CANONICAL_ENVELOPE_FIELDS = ["schemaVersion", "lineage", "trustedReview"] as const;

type HumanReviewQueryErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED_ACTOR"
  | "MATERIAL_NOT_FOUND"
  | "TENANT_MISMATCH"
  | "INVALID_TRUSTED_MATERIAL"
  | "STATEMENT_NOT_FOUND"
  | "INCONSISTENT_REVIEW_HISTORY"
  | "READ_FAILURE";

export class AiFascicoloHumanReviewQueryError extends Error {
  constructor(readonly code: HumanReviewQueryErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = "AiFascicoloHumanReviewQueryError";
  }
}

export interface AiFascicoloHumanReviewQueryInput {
  readonly materialId: string;
  readonly statementPath: string;
}

export interface AiFascicoloHumanReviewProjection {
  readonly disposition: AiFascicoloCompanyReviewDispositionV1;
  readonly actor: {
    readonly id: string;
    readonly role: string;
  };
  readonly occurredAt: string;
  readonly note?: string;
  readonly reason?: string;
  readonly amendment?: {
    readonly text: string;
    readonly reason: string;
  };
}

export interface AiFascicoloHumanReviewHistoryItem extends AiFascicoloHumanReviewProjection {
  readonly id: string;
  readonly sequence: number;
}

export interface AiFascicoloHumanReviewReadModelV1 {
  readonly material: {
    readonly id: string;
    readonly procedimentoId: string;
    readonly statementPath: string;
    readonly target: AiFascicoloTrustedReviewStatementV1;
  };
  readonly reviewStatus: "UNREVIEWED" | "REVIEWED";
  readonly currentState: AiFascicoloHumanReviewProjection & {
    readonly version: number;
    readonly status: AiFascicoloCompanyReviewDispositionV1;
    readonly latestEventId: string;
  } | null;
  readonly history: readonly AiFascicoloHumanReviewHistoryItem[];
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

interface PersistedState {
  readonly id: string;
  readonly materialId: string;
  readonly enteId: string;
  readonly procedimentoId: string;
  readonly statementPath: string;
  readonly version: number;
  readonly latestDisposition: AiFascicoloCompanyReviewDispositionV1 | null;
}

interface PersistedEvent {
  readonly id: string;
  readonly stateId: string;
  readonly materialId: string;
  readonly enteId: string;
  readonly procedimentoId: string;
  readonly statementPath: string;
  readonly sequence: number;
  readonly disposition: AiFascicoloCompanyReviewDispositionV1;
  readonly humanUserId: string;
  readonly actorIdSnapshot: string;
  readonly actorEmailSnapshot: string;
  readonly actorRoleSnapshot: string;
  readonly occurredAt: Date;
  readonly note: string | null;
  readonly reason: string | null;
  readonly amendmentText: string | null;
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
  humanUserId: true,
  actorIdSnapshot: true,
  actorEmailSnapshot: true,
  actorRoleSnapshot: true,
  occurredAt: true,
  note: true,
  reason: true,
  amendmentText: true,
} as const;

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

function parseInput(input: unknown): AiFascicoloHumanReviewQueryInput {
  try {
    if (!isPlainRecord(input) || !hasExactDataFields(input, INPUT_FIELDS)) {
      throw new Error("Invalid input shape");
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const materialId = descriptors.materialId.value;
    const statementPath = descriptors.statementPath.value;
    if (!nonEmpty(materialId) || !nonEmpty(statementPath)) {
      throw new Error("Invalid input values");
    }
    return { materialId, statementPath };
  } catch (error) {
    throw new AiFascicoloHumanReviewQueryError("INVALID_INPUT", error);
  }
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
    throw new AiFascicoloHumanReviewQueryError("INVALID_TRUSTED_MATERIAL", error);
  }
}

function eventCommand(event: PersistedEvent): AiFascicoloHumanReviewCommandV1 {
  switch (event.disposition) {
    case "COMPANY_ACCEPTED":
      if (event.reason !== null || event.amendmentText !== null) {
        throw new AiFascicoloHumanReviewQueryError("INCONSISTENT_REVIEW_HISTORY");
      }
      return event.note === null
        ? { disposition: event.disposition }
        : { disposition: event.disposition, note: event.note };
    case "COMPANY_REJECTED":
    case "COMPANY_NEEDS_VERIFICATION":
      if (event.note !== null || event.reason === null || event.amendmentText !== null) {
        throw new AiFascicoloHumanReviewQueryError("INCONSISTENT_REVIEW_HISTORY");
      }
      return { disposition: event.disposition, reason: event.reason };
    case "COMPANY_AMENDED":
      if (event.note !== null || event.reason === null || event.amendmentText === null) {
        throw new AiFascicoloHumanReviewQueryError("INCONSISTENT_REVIEW_HISTORY");
      }
      return {
        disposition: event.disposition,
        amendment: { text: event.amendmentText, reason: event.reason },
      };
  }
}

function domainEvent(
  trustedReview: AiFascicoloTrustedReviewV1,
  statementPath: string,
  event: PersistedEvent,
): AiFascicoloHumanReviewEventV1 {
  try {
    const built = buildAiFascicoloHumanReviewEventV1({
      trustedReview,
      statementPath,
      actor: {
        actorType: "HUMAN_INTERNAL_COMPANY_OPERATOR",
        userId: event.humanUserId,
        actorId: event.actorIdSnapshot,
        email: event.actorEmailSnapshot,
        role: event.actorRoleSnapshot,
      },
      occurredAt: event.occurredAt.toISOString(),
      command: eventCommand(event),
    });
    if (built.disposition !== event.disposition) {
      throw new Error("Disposition mismatch");
    }
    return built;
  } catch (error) {
    if (error instanceof AiFascicoloHumanReviewQueryError) {
      throw error;
    }
    throw new AiFascicoloHumanReviewQueryError("INCONSISTENT_REVIEW_HISTORY", error);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}

function reviewProjection(domain: AiFascicoloHumanReviewEventV1): AiFascicoloHumanReviewProjection {
  return {
    disposition: domain.disposition,
    actor: {
      id: domain.actor.actorId,
      role: domain.actor.role,
    },
    occurredAt: domain.occurredAt,
    ...(domain.note === undefined ? {} : { note: domain.note }),
    ...(domain.reason === undefined ? {} : { reason: domain.reason }),
    ...(domain.amendment === undefined
      ? {}
      : { amendment: { text: domain.amendment.text, reason: domain.amendment.reason } }),
  };
}

function historyItem(event: PersistedEvent, domain: AiFascicoloHumanReviewEventV1): AiFascicoloHumanReviewHistoryItem {
  return {
    id: event.id,
    sequence: event.sequence,
    ...reviewProjection(domain),
  };
}

export async function getAiFascicoloHumanReviewReadModel(
  input: unknown,
): Promise<AiFascicoloHumanReviewReadModelV1> {
  const parsed = parseInput(input);
  try {
    const currentUser = await getCurrentUser();
    const tenantContext = await getCurrentTenantContext();
    if (
      !currentUser
      || !tenantContext
      || tenantContext.userId !== currentUser.id
      || !isBackofficeRole(currentUser.role)
    ) {
      throw new AiFascicoloHumanReviewQueryError("UNAUTHENTICATED_ACTOR");
    }

    return await prisma.$transaction(async (tx) => {
    const material = await tx.aiFascicoloTrustedReviewMaterial.findUnique({
      where: { id: parsed.materialId },
      select: MATERIAL_SELECT,
    }) as PersistedMaterial | null;
    if (!material) {
      throw new AiFascicoloHumanReviewQueryError("MATERIAL_NOT_FOUND");
    }
    const canonicalEnteId = material.procedimento.concessione?.enteId;
    if (
      !canonicalEnteId
      || material.enteId !== canonicalEnteId
      || material.procedimentoId !== material.procedimento.id
    ) {
      throw new AiFascicoloHumanReviewQueryError("TENANT_MISMATCH");
    }
    try {
      requireTenantAccess(tenantContext, canonicalEnteId, {
        mode: "read",
        allowWhenEnteMissing: false,
      });
    } catch (error) {
      throw new AiFascicoloHumanReviewQueryError("TENANT_MISMATCH", error);
    }

    const trustedReview = parseTrustedMaterial(material);
    let target: AiFascicoloTrustedReviewStatementV1;
    try {
      deriveAiFascicoloHumanReviewCurrentStateV1({
        trustedReview,
        statementPath: parsed.statementPath,
        orderedEvents: [],
      });
      target = trustedReview.statements.find(
        (statement) => statement.statementPath === parsed.statementPath,
      )!;
    } catch (error) {
      throw new AiFascicoloHumanReviewQueryError("STATEMENT_NOT_FOUND", error);
    }

    const state = await tx.aiFascicoloHumanReviewState.findUnique({
      where: {
        materialId_statementPath: {
          materialId: material.id,
          statementPath: parsed.statementPath,
        },
      },
      select: STATE_SELECT,
    }) as PersistedState | null;
    const events = await tx.aiFascicoloHumanReviewEvent.findMany({
      where: {
        materialId: material.id,
        statementPath: parsed.statementPath,
        enteId: canonicalEnteId,
        procedimentoId: material.procedimentoId,
      },
      orderBy: { sequence: "asc" },
      select: EVENT_SELECT,
    }) as PersistedEvent[];

    if ((state === null) !== (events.length === 0)) {
      throw new AiFascicoloHumanReviewQueryError("INCONSISTENT_REVIEW_HISTORY");
    }
    if (state === null) {
      return deepFreeze({
        material: {
          id: material.id,
          procedimentoId: material.procedimentoId,
          statementPath: parsed.statementPath,
          target: structuredClone(target),
        },
        reviewStatus: "UNREVIEWED",
        currentState: null,
        history: [],
      });
    }
    if (
      state.materialId !== material.id
      || state.enteId !== canonicalEnteId
      || state.procedimentoId !== material.procedimentoId
      || state.statementPath !== parsed.statementPath
      || state.latestDisposition === null
    ) {
      throw new AiFascicoloHumanReviewQueryError("INCONSISTENT_REVIEW_HISTORY");
    }

    const domainEvents = events.map((event, index) => {
      if (
        event.sequence !== index + 1
        || event.stateId !== state.id
        || event.materialId !== material.id
        || event.enteId !== canonicalEnteId
        || event.procedimentoId !== material.procedimentoId
        || event.statementPath !== parsed.statementPath
      ) {
        throw new AiFascicoloHumanReviewQueryError("INCONSISTENT_REVIEW_HISTORY");
      }
      return domainEvent(trustedReview, parsed.statementPath, event);
    });
    const derived = deriveAiFascicoloHumanReviewCurrentStateV1({
      trustedReview,
      statementPath: parsed.statementPath,
      orderedEvents: domainEvents,
    });
    const latestEvent = events.at(-1)!;
    if (
      state.version !== events.length
      || state.version !== latestEvent.sequence
      || state.latestDisposition !== latestEvent.disposition
      || derived.target.statementPath !== state.statementPath
      || derived.status !== state.latestDisposition
      || derived.latestEvent === null
      || derived.latestEvent?.disposition !== state.latestDisposition
    ) {
      throw new AiFascicoloHumanReviewQueryError("INCONSISTENT_REVIEW_HISTORY");
    }

    return deepFreeze({
      material: {
        id: material.id,
        procedimentoId: material.procedimentoId,
        statementPath: parsed.statementPath,
        target: structuredClone(target),
      },
      reviewStatus: "REVIEWED",
      currentState: {
        version: state.version,
        status: derived.status as AiFascicoloCompanyReviewDispositionV1,
        latestEventId: latestEvent.id,
        ...reviewProjection(derived.latestEvent),
      },
      history: events.map((event, index) => historyItem(event, domainEvents[index])),
    });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  } catch (error) {
    if (error instanceof AiFascicoloHumanReviewQueryError) {
      throw error;
    }
    throw new AiFascicoloHumanReviewQueryError("READ_FAILURE", error);
  }
}