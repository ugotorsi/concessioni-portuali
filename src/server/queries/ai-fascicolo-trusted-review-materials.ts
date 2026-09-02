import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, isBackofficeRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
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

const INPUT_FIELDS = ["procedimentoId"] as const;
const CANONICAL_ENVELOPE_FIELDS = ["schemaVersion", "lineage", "trustedReview"] as const;

type TrustedReviewMaterialsQueryErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED_ACTOR"
  | "PROCEDIMENTO_NOT_FOUND"
  | "TENANT_MISMATCH"
  | "INVALID_TRUSTED_MATERIAL"
  | "READ_FAILURE";

export class AiFascicoloTrustedReviewMaterialsQueryError extends Error {
  constructor(readonly code: TrustedReviewMaterialsQueryErrorCode) {
    super(code);
    this.name = "AiFascicoloTrustedReviewMaterialsQueryError";
  }
}

export interface AiFascicoloTrustedReviewMaterialsQueryInput {
  readonly procedimentoId: string;
}

export interface AiFascicoloTrustedReviewMaterialDiscoveryItemV1 {
  readonly materialId: string;
  readonly createdAt: string;
  readonly statementPaths: readonly string[];
}

export interface AiFascicoloTrustedReviewMaterialsReadModelV1 {
  readonly procedimentoId: string;
  readonly materials: readonly AiFascicoloTrustedReviewMaterialDiscoveryItemV1[];
}

interface PersistedProcedimento {
  readonly id: string;
  readonly concessione: { readonly enteId: string | null } | null;
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
  readonly createdAt: Date;
}

const PROCEDIMENTO_SELECT = {
  id: true,
  concessione: { select: { enteId: true } },
} as const;

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
  createdAt: true,
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

function parseInput(input: unknown): AiFascicoloTrustedReviewMaterialsQueryInput {
  if (!isPlainRecord(input) || !hasExactDataFields(input, INPUT_FIELDS)) {
    throw new AiFascicoloTrustedReviewMaterialsQueryError("INVALID_INPUT");
  }
  const procedimentoId = Object.getOwnPropertyDescriptor(input, "procedimentoId")?.value;
  if (!nonEmpty(procedimentoId)) {
    throw new AiFascicoloTrustedReviewMaterialsQueryError("INVALID_INPUT");
  }
  return { procedimentoId };
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
  } catch {
    throw new AiFascicoloTrustedReviewMaterialsQueryError("INVALID_TRUSTED_MATERIAL");
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

function projectMaterial(
  material: PersistedMaterial,
  canonicalProcedimentoId: string,
  canonicalEnteId: string,
): AiFascicoloTrustedReviewMaterialDiscoveryItemV1 {
  if (
    !nonEmpty(material.id)
    || material.procedimentoId !== canonicalProcedimentoId
    || material.enteId !== canonicalEnteId
    || !(material.createdAt instanceof Date)
    || Number.isNaN(material.createdAt.getTime())
  ) {
    throw new AiFascicoloTrustedReviewMaterialsQueryError("INVALID_TRUSTED_MATERIAL");
  }
  const trustedReview = parseTrustedMaterial(material);
  return {
    materialId: material.id,
    createdAt: material.createdAt.toISOString(),
    statementPaths: trustedReview.statements.map((statement) => statement.statementPath),
  };
}

export async function getAiFascicoloTrustedReviewMaterialsReadModel(
  input: unknown,
): Promise<AiFascicoloTrustedReviewMaterialsReadModelV1> {
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
      throw new AiFascicoloTrustedReviewMaterialsQueryError("UNAUTHENTICATED_ACTOR");
    }

    return await prisma.$transaction(async (tx) => {
      const procedimento = await tx.procedimento.findUnique({
        where: { id: parsed.procedimentoId },
        select: PROCEDIMENTO_SELECT,
      }) as PersistedProcedimento | null;
      if (!procedimento) {
        throw new AiFascicoloTrustedReviewMaterialsQueryError("PROCEDIMENTO_NOT_FOUND");
      }
      const canonicalEnteId = procedimento.concessione?.enteId;
      if (procedimento.id !== parsed.procedimentoId || !nonEmpty(canonicalEnteId)) {
        throw new AiFascicoloTrustedReviewMaterialsQueryError("TENANT_MISMATCH");
      }
      try {
        requireTenantAccess(tenantContext, canonicalEnteId, {
          mode: "read",
          allowWhenEnteMissing: false,
        });
      } catch {
        throw new AiFascicoloTrustedReviewMaterialsQueryError("PROCEDIMENTO_NOT_FOUND");
      }

      const materials = await tx.aiFascicoloTrustedReviewMaterial.findMany({
        where: {
          procedimentoId: procedimento.id,
          enteId: canonicalEnteId,
        },
        orderBy: [
          { createdAt: "desc" },
          { id: "desc" },
        ],
        select: MATERIAL_SELECT,
      }) as PersistedMaterial[];

      return deepFreeze({
        procedimentoId: procedimento.id,
        materials: materials.map((material) => projectMaterial(
          material,
          procedimento.id,
          canonicalEnteId,
        )),
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  } catch (error) {
    if (error instanceof AiFascicoloTrustedReviewMaterialsQueryError) {
      throw error;
    }
    throw new AiFascicoloTrustedReviewMaterialsQueryError("READ_FAILURE");
  }
}