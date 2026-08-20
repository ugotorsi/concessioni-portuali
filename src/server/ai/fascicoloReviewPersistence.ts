import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import {
  AI_FASCICOLO_TRUSTED_REVIEW_V1_SCHEMA_VERSION,
  parseAiFascicoloTrustedReviewV1,
} from "@/server/ai/fascicoloTrustedReview";
import {
  AI_FASCICOLO_TRUSTED_REVIEW_MATERIAL_V1_SCHEMA_VERSION,
  buildAiFascicoloTrustedReviewMaterialIdentityV1,
  parseAiFascicoloTrustedReviewMaterialLineageV1,
} from "@/server/ai/fascicoloTrustedReviewIdentity";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

const MATERIAL_IDENTITY_FIELDS = [
  "enteId",
  "procedimentoId",
  "identityContractVersion",
  "canonicalizationVersion",
  "fingerprintAlgorithm",
  "fingerprint",
] as const;
const MATERIAL_IDENTITY_SELECTOR =
  "enteId_procedimentoId_identityContractVersion_canonicalizationVersion_fingerprintAlgorithm_fingerprint";
const CANONICAL_ENVELOPE_FIELDS = ["schemaVersion", "lineage", "trustedReview"] as const;

type PersistenceErrorCode =
  | "INVALID_INPUT"
  | "PROCEDIMENTO_NOT_FOUND"
  | "TENANT_MISMATCH"
  | "TENANT_CONTEXT_REQUIRED"
  | "FORBIDDEN"
  | "INVALID_CANONICAL_PAYLOAD"
  | "MATERIAL_IDENTITY_CONFLICT"
  | "PERSISTENCE_FAILURE";

export class AiFascicoloReviewPersistenceError extends Error {
  constructor(readonly code: PersistenceErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = "AiFascicoloReviewPersistenceError";
  }
}

export interface AiFascicoloTrustedReviewMaterialPersistenceResult {
  readonly materialId: string;
  readonly enteId: string;
  readonly procedimentoId: string;
  readonly fingerprint: string;
  readonly outcome: "CREATED" | "REUSED" | "REUSED_AFTER_RACE";
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
} as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.getOwnPropertyNames(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function parseServiceInput(input: unknown) {
  if (!isPlainRecord(input) || !hasExactFields(input, ["procedimentoId", "trustedReview", "lineage"])) {
    throw new AiFascicoloReviewPersistenceError("INVALID_INPUT");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.getOwnPropertySymbols(input).length > 0) {
    throw new AiFascicoloReviewPersistenceError("INVALID_INPUT");
  }
  for (const field of ["procedimentoId", "trustedReview", "lineage"] as const) {
    const descriptor = descriptors[field];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new AiFascicoloReviewPersistenceError("INVALID_INPUT");
    }
  }
  const procedimentoId = descriptors.procedimentoId.value;
  if (typeof procedimentoId !== "string" || procedimentoId.trim().length === 0) {
    throw new AiFascicoloReviewPersistenceError("INVALID_INPUT");
  }
  try {
    return {
      procedimentoId,
      trustedReview: parseAiFascicoloTrustedReviewV1(descriptors.trustedReview.value),
      lineage: parseAiFascicoloTrustedReviewMaterialLineageV1(descriptors.lineage.value),
    };
  } catch (error) {
    if (error instanceof AiFascicoloReviewPersistenceError) {
      throw error;
    }
    throw new AiFascicoloReviewPersistenceError("INVALID_INPUT", error);
  }
}

function parsePersistedCanonicalPayload(canonicalPayload: unknown): void {
  if (typeof canonicalPayload !== "string" || canonicalPayload.trim().length === 0) {
    throw new AiFascicoloReviewPersistenceError("INVALID_CANONICAL_PAYLOAD");
  }
  try {
    const envelope: unknown = JSON.parse(canonicalPayload);
    if (!isPlainRecord(envelope) || !hasExactFields(envelope, CANONICAL_ENVELOPE_FIELDS)) {
      throw new AiFascicoloReviewPersistenceError("INVALID_CANONICAL_PAYLOAD");
    }
    if (envelope.schemaVersion !== AI_FASCICOLO_TRUSTED_REVIEW_MATERIAL_V1_SCHEMA_VERSION) {
      throw new AiFascicoloReviewPersistenceError("INVALID_CANONICAL_PAYLOAD");
    }
    parseAiFascicoloTrustedReviewMaterialLineageV1(envelope.lineage);
    parseAiFascicoloTrustedReviewV1(envelope.trustedReview);
  } catch (error) {
    if (
      error instanceof AiFascicoloReviewPersistenceError
      && error.code === "INVALID_CANONICAL_PAYLOAD"
    ) {
      throw error;
    }
    throw new AiFascicoloReviewPersistenceError("INVALID_CANONICAL_PAYLOAD", error);
  }
}

function isExactMaterialIdentityP2002(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const meta = error.meta;
  const target = meta?.target;

  // Preserve the Prisma shapes already supported by the original implementation.
  if (target === MATERIAL_IDENTITY_SELECTOR) {
    return true;
  }

  if (
    Array.isArray(target)
    && target.every((field) => typeof field === "string")
  ) {
    const targetFields = new Set(target);
    if (
      target.length === MATERIAL_IDENTITY_FIELDS.length
      && targetFields.size === MATERIAL_IDENTITY_FIELDS.length
      && MATERIAL_IDENTITY_FIELDS.every((field) => targetFields.has(field))
    ) {
      return true;
    }
  }

  // PrismaPg runtime shape observed against real PostgreSQL:
  // meta.target is absent, while the structured adapter cause exposes
  // the model, SQLSTATE and exact unique-constraint field list.
  if (
    !isPlainRecord(meta)
    || meta.modelName !== "AiFascicoloTrustedReviewMaterial"
  ) {
    return false;
  }

  const driverAdapterError = meta.driverAdapterError;
  if (!isRecordLike(driverAdapterError)) {
    return false;
  }

  const cause = driverAdapterError.cause;
  if (
    !isPlainRecord(cause)
    || cause.kind !== "UniqueConstraintViolation"
    || cause.originalCode !== "23505"
  ) {
    return false;
  }

  const constraint = cause.constraint;
  if (!isPlainRecord(constraint) || !Array.isArray(constraint.fields)) {
    return false;
  }

  const normalizedFields = constraint.fields.map((field) => {
    if (typeof field !== "string") {
      return null;
    }

    return field.startsWith('"') && field.endsWith('"')
      ? field.slice(1, -1)
      : field;
  });

  if (normalizedFields.some((field) => field === null)) {
    return false;
  }

  const constraintFields = new Set(normalizedFields);

  return normalizedFields.length === MATERIAL_IDENTITY_FIELDS.length
    && constraintFields.size === MATERIAL_IDENTITY_FIELDS.length
    && MATERIAL_IDENTITY_FIELDS.every((field) => constraintFields.has(field));
}
function materialWhere(expected: PersistedMaterial) {
  return {
    [MATERIAL_IDENTITY_SELECTOR]: {
      enteId: expected.enteId,
      procedimentoId: expected.procedimentoId,
      identityContractVersion: expected.identityContractVersion,
      canonicalizationVersion: expected.canonicalizationVersion,
      fingerprintAlgorithm: expected.fingerprintAlgorithm,
      fingerprint: expected.fingerprint,
    },
  };
}

function assertEquivalent(existing: PersistedMaterial, expected: PersistedMaterial): void {
  parsePersistedCanonicalPayload(existing.canonicalPayload);
  for (const field of [
    "enteId",
    "procedimentoId",
    "identityContractVersion",
    "canonicalizationVersion",
    "fingerprintAlgorithm",
    "fingerprint",
    "canonicalPayload",
    "trustedReviewSchemaVersion",
    "analysisSchemaVersion",
    "snapshotSchemaVersion",
    "outboundSchemaVersion",
    "sourceSnapshotContentHash",
    "outboundProjectionHash",
    "outboundProjectionHashAlgorithm",
  ] as const) {
    if (existing[field] !== expected[field]) {
      throw new AiFascicoloReviewPersistenceError("MATERIAL_IDENTITY_CONFLICT");
    }
  }
}

function result(
  material: PersistedMaterial,
  outcome: AiFascicoloTrustedReviewMaterialPersistenceResult["outcome"],
): AiFascicoloTrustedReviewMaterialPersistenceResult {
  return Object.freeze({
    materialId: material.id,
    enteId: material.enteId,
    procedimentoId: material.procedimentoId,
    fingerprint: material.fingerprint,
    outcome,
  });
}

async function auditMaterial(
  tx: Prisma.TransactionClient,
  material: PersistedMaterial,
  outcome: AiFascicoloTrustedReviewMaterialPersistenceResult["outcome"],
): Promise<void> {
  await createAuditLogInTransaction(tx, {
    azione: "AI_FASCICOLO_TRUSTED_REVIEW_MATERIAL_PERSIST",
    entita: "AiFascicoloTrustedReviewMaterial",
    entitaId: material.id,
    enteId: material.enteId,
    esito: "SUCCESS",
    metadata: {
      materialId: material.id,
      procedimentoId: material.procedimentoId,
      enteId: material.enteId,
      identityContractVersion: material.identityContractVersion,
      canonicalizationVersion: material.canonicalizationVersion,
      fingerprintAlgorithm: material.fingerprintAlgorithm,
      fingerprint: material.fingerprint,
      persistenceOutcome: outcome,
      raceReconciliation: outcome === "REUSED_AFTER_RACE",
    },
  });
}

export async function persistAiFascicoloTrustedReviewMaterial(
  input: unknown,
): Promise<AiFascicoloTrustedReviewMaterialPersistenceResult> {
  const parsed = parseServiceInput(input);

  let procedimento;
  try {
    procedimento = await prisma.procedimento.findUnique({
      where: { id: parsed.procedimentoId },
      select: { id: true, concessione: { select: { enteId: true } } },
    });
  } catch (error) {
    throw new AiFascicoloReviewPersistenceError("PERSISTENCE_FAILURE", error);
  }
  if (!procedimento) {
    throw new AiFascicoloReviewPersistenceError("PROCEDIMENTO_NOT_FOUND");
  }
  const enteId = procedimento.concessione?.enteId;
  if (!enteId) {
    throw new AiFascicoloReviewPersistenceError("TENANT_MISMATCH");
  }

  let tenantContext;
  try {
    tenantContext = await getCurrentTenantContext();
  } catch (error) {
    throw new AiFascicoloReviewPersistenceError("PERSISTENCE_FAILURE", error);
  }
  if (!tenantContext) {
    throw new AiFascicoloReviewPersistenceError("TENANT_CONTEXT_REQUIRED");
  }
  try {
    requireTenantAccess(tenantContext, enteId, {
      mode: "write",
      allowWhenEnteMissing: false,
    });
  } catch (error) {
    throw new AiFascicoloReviewPersistenceError("FORBIDDEN", error);
  }

  let identity;
  try {
    identity = buildAiFascicoloTrustedReviewMaterialIdentityV1({
      trustedReview: parsed.trustedReview,
      lineage: parsed.lineage,
    });
  } catch (error) {
    throw new AiFascicoloReviewPersistenceError("INVALID_INPUT", error);
  }
  const expected: PersistedMaterial = {
    id: "",
    enteId,
    procedimentoId: procedimento.id,
    identityContractVersion: identity.schemaVersion,
    canonicalizationVersion: identity.canonicalizationVersion,
    fingerprintAlgorithm: identity.fingerprintAlgorithm,
    fingerprint: identity.fingerprint,
    canonicalPayload: identity.canonicalPayload,
    trustedReviewSchemaVersion: AI_FASCICOLO_TRUSTED_REVIEW_V1_SCHEMA_VERSION,
    analysisSchemaVersion: parsed.lineage.analysisSchemaVersion,
    snapshotSchemaVersion: parsed.lineage.snapshotSchemaVersion,
    outboundSchemaVersion: parsed.lineage.outboundSchemaVersion,
    sourceSnapshotContentHash: parsed.lineage.sourceSnapshotContentHash,
    outboundProjectionHash: parsed.lineage.outboundProjectionHash,
    outboundProjectionHashAlgorithm: parsed.lineage.outboundProjectionHashAlgorithm,
  };

  try {
    return await runSerializableTransactionWithRetry(async (tx) => {
      const existing = await tx.aiFascicoloTrustedReviewMaterial.findUnique({
        where: materialWhere(expected),
        select: MATERIAL_SELECT,
      });
      if (existing) {
        assertEquivalent(existing, expected);
        await auditMaterial(tx, existing, "REUSED");
        return result(existing, "REUSED");
      }

      const created = await tx.aiFascicoloTrustedReviewMaterial.create({
        data: {
          enteId: expected.enteId,
          procedimentoId: expected.procedimentoId,
          identityContractVersion: expected.identityContractVersion,
          canonicalizationVersion: expected.canonicalizationVersion,
          fingerprintAlgorithm: expected.fingerprintAlgorithm,
          fingerprint: expected.fingerprint,
          canonicalPayload: expected.canonicalPayload,
          trustedReviewSchemaVersion: expected.trustedReviewSchemaVersion,
          analysisSchemaVersion: expected.analysisSchemaVersion,
          snapshotSchemaVersion: expected.snapshotSchemaVersion,
          outboundSchemaVersion: expected.outboundSchemaVersion,
          sourceSnapshotContentHash: expected.sourceSnapshotContentHash,
          outboundProjectionHash: expected.outboundProjectionHash,
          outboundProjectionHashAlgorithm: expected.outboundProjectionHashAlgorithm,
        },
        select: MATERIAL_SELECT,
      });
      await auditMaterial(tx, created, "CREATED");
      return result(created, "CREATED");
    });
  } catch (error) {
    if (error instanceof AiFascicoloReviewPersistenceError) {
      throw error;
    }
    if (!isExactMaterialIdentityP2002(error)) {
      throw new AiFascicoloReviewPersistenceError("PERSISTENCE_FAILURE", error);
    }

    try {
      return await runSerializableTransactionWithRetry(async (tx) => {
        const existing = await tx.aiFascicoloTrustedReviewMaterial.findUnique({
          where: materialWhere(expected),
          select: MATERIAL_SELECT,
        });
        if (!existing) {
          throw new AiFascicoloReviewPersistenceError("PERSISTENCE_FAILURE");
        }
        assertEquivalent(existing, expected);
        await auditMaterial(tx, existing, "REUSED_AFTER_RACE");
        return result(existing, "REUSED_AFTER_RACE");
      });
    } catch (reconciliationError) {
      if (reconciliationError instanceof AiFascicoloReviewPersistenceError) {
        throw reconciliationError;
      }
      throw new AiFascicoloReviewPersistenceError("PERSISTENCE_FAILURE", reconciliationError);
    }
  }
}