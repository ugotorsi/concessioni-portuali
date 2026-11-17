import { createHash } from "node:crypto";

import { z } from "zod";

import {
  normalizeAsyncJobAdmission,
  type AsyncJobAdmissionInput,
} from "@/server/async-jobs/domain";
import type { AsyncJobHandler } from "@/server/async-jobs/registry";
import { stableStringify } from "@/server/audit/hash";

import {
  FASCICOLO_CHANGE_CONTRACT_VERSION,
  FASCICOLO_CHANGE_V2_CONTRACT_VERSION,
  fingerprintFascicoloChange,
  fingerprintFascicoloTimeThresholdChangeV2,
  parseFascicoloChange,
  parseFascicoloTimeThresholdChangeV2,
  type AnyFascicoloChange,
  type FascicoloChange,
  type FascicoloTimeThresholdChangeV2,
} from "./change";
import { projectFascicoloSignal } from "./fascicoloSignal";
import { planFascicoloReevaluation, planFascicoloReevaluationV2 } from "./planner";

export const FASCICOLO_REEVALUATE_OPERATION = "FASCICOLO_REEVALUATE_V1" as const;
export const FASCICOLO_REEVALUATE_PURPOSE = "FASCICOLO_REEVALUATION_PLANNING" as const;

const CANONICAL_TRIGGERED_AT = new Date(0).toISOString();
const CHANGE_CHUNK_LENGTH = 480;
const CHANGE_CHUNK_KEY = /^changeChunk(\d{3})Ref$/;

type FascicoloReevaluationProvenance = {
  tenantId: string | null;
  admissionType: "AUTHENTICATED_USER" | "AUTHORIZED_SYSTEM";
  initiatingUserId: string | null;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
  policyDecisionRef: string | null;
  correlationId: string;
};

type FascicoloReevaluationInput = {
  procedimentoId: string;
  change: AnyFascicoloChange;
};

const referenceSchema = z.object({
  referenceType: z.literal("FASCICOLO_REEVALUATION"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V1"),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict();

const referenceSchemaV2 = z.object({
  referenceType: z.literal("FASCICOLO_REEVALUATION"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V2"),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict();

export class FascicoloReevaluationJobInputError extends Error {
  constructor(readonly code: "INVALID_CHANGE_REFERENCE" | "CHANGE_FINGERPRINT_MISMATCH" | "PROCEDIMENTO_TARGET_MISMATCH") {
    super(code);
    this.name = "FascicoloReevaluationJobInputError";
  }
}

function procedimentoIds(change: FascicoloChange): readonly string[] {
  switch (change.kind) {
    case "DOCUMENT_CHANGED":
    case "FASCICOLO_DATA_CHANGED":
    case "REQUIREMENT_EVIDENCE_CHANGED":
      return [change.procedimentoId];
    case "CONCESSIONE_CHANGED":
    case "LEGAL_SOURCE_CHANGED":
    case "CASE_LAW_CHANGED":
      return change.linkedProcedimentoIds;
    case "CRITICITA_CHANGED":
    case "TIME_THRESHOLD_REACHED":
      return change.procedimentoId === null ? [] : [change.procedimentoId];
  }
}

function assertTarget(change: FascicoloChange, procedimentoId: string): void {
  const linkedIds = procedimentoIds(change);
  if (linkedIds.length > 0 && !linkedIds.includes(procedimentoId)) {
    throw new FascicoloReevaluationJobInputError("PROCEDIMENTO_TARGET_MISMATCH");
  }
}

function logicalOperationId(procedimentoId: string, changeFingerprint: string): string {
  return createHash("sha256").update([
    FASCICOLO_REEVALUATE_OPERATION,
    FASCICOLO_CHANGE_CONTRACT_VERSION,
    procedimentoId,
    changeFingerprint,
  ].join("\n"), "utf8").digest("hex");
}

function logicalOperationIdV2(procedimentoId: string, changeFingerprint: string): string {
  return createHash("sha256").update([
    FASCICOLO_REEVALUATE_OPERATION,
    FASCICOLO_CHANGE_V2_CONTRACT_VERSION,
    procedimentoId,
    changeFingerprint,
  ].join("\n"), "utf8").digest("hex");
}

function encodedCausalState(change: FascicoloChange): string {
  const { triggeredAt: _triggeredAt, ...causalState } = change;
  return stableStringify(causalState);
}

function buildReference(procedimentoId: string, change: FascicoloChange) {
  const encodedChange = encodedCausalState(change);
  const chunks = Array.from(
    { length: Math.ceil(encodedChange.length / CHANGE_CHUNK_LENGTH) },
    (_, index) => encodedChange.slice(index * CHANGE_CHUNK_LENGTH, (index + 1) * CHANGE_CHUNK_LENGTH),
  );
  const metadata: Record<string, string | number> = {
    changeContractVersion: FASCICOLO_CHANGE_CONTRACT_VERSION,
    changeFingerprintHash: fingerprintFascicoloChange(change),
    changeChunkCount: chunks.length,
  };
  chunks.forEach((chunk, index) => {
    metadata[`changeChunk${String(index).padStart(3, "0")}Ref`] = chunk;
  });
  return {
    referenceType: "FASCICOLO_REEVALUATION",
    referenceId: procedimentoId,
    referenceVersion: "V1",
    metadata,
  } as const;
}

function buildReferenceV2(procedimentoId: string, change: FascicoloTimeThresholdChangeV2) {
  const encodedChange = encodedCausalState(change);
  const chunks = Array.from(
    { length: Math.ceil(encodedChange.length / CHANGE_CHUNK_LENGTH) },
    (_, index) => encodedChange.slice(index * CHANGE_CHUNK_LENGTH, (index + 1) * CHANGE_CHUNK_LENGTH),
  );
  const metadata: Record<string, string | number> = {
    changeContractVersion: FASCICOLO_CHANGE_V2_CONTRACT_VERSION,
    changeFingerprintHash: fingerprintFascicoloTimeThresholdChangeV2(change),
    changeChunkCount: chunks.length,
  };
  chunks.forEach((chunk, index) => {
    metadata[`changeChunk${String(index).padStart(3, "0")}Ref`] = chunk;
  });
  return {
    referenceType: "FASCICOLO_REEVALUATION",
    referenceId: procedimentoId,
    referenceVersion: "V2",
    metadata,
  } as const;
}

export function buildFascicoloReevaluationAdmission(
  input: { procedimentoId: string; change: unknown },
  provenance: FascicoloReevaluationProvenance,
): AsyncJobAdmissionInput {
  const change = parseFascicoloChange(input.change);
  assertTarget(change, input.procedimentoId);
  const changeFingerprint = fingerprintFascicoloChange(change);
  const admission: AsyncJobAdmissionInput = {
    operation: FASCICOLO_REEVALUATE_OPERATION,
    logicalOperationId: logicalOperationId(input.procedimentoId, changeFingerprint),
    purpose: FASCICOLO_REEVALUATE_PURPOSE,
    correlationId: provenance.correlationId,
    policyDecisionRef: provenance.policyDecisionRef,
    inputReference: buildReference(input.procedimentoId, change),
    maxAttempts: 2,
    availableAt: new Date(0),
    admission: provenance.admissionType === "AUTHENTICATED_USER"
      ? {
          admissionType: "AUTHENTICATED_USER",
          tenantId: provenance.tenantId,
          initiatingUserId: provenance.initiatingUserId!,
          actor: {
            actorId: provenance.actorId,
            actorEmail: provenance.actorEmail,
            actorRole: provenance.actorRole,
          },
        }
      : {
          admissionType: "AUTHORIZED_SYSTEM",
          tenantId: provenance.tenantId,
          initiatingUserId: null,
          actor: {
            actorId: provenance.actorId,
            actorEmail: provenance.actorEmail,
            actorRole: provenance.actorRole,
          },
        },
  };
  normalizeAsyncJobAdmission(admission);
  return admission;
}

export function buildFascicoloReevaluationAdmissionV2(
  input: { procedimentoId: string; change: unknown },
  provenance: FascicoloReevaluationProvenance,
): AsyncJobAdmissionInput {
  const change = parseFascicoloTimeThresholdChangeV2(input.change);
  assertTarget(change, input.procedimentoId);
  const changeFingerprint = fingerprintFascicoloTimeThresholdChangeV2(change);
  const admission: AsyncJobAdmissionInput = {
    operation: FASCICOLO_REEVALUATE_OPERATION,
    logicalOperationId: logicalOperationIdV2(input.procedimentoId, changeFingerprint),
    purpose: FASCICOLO_REEVALUATE_PURPOSE,
    correlationId: provenance.correlationId,
    policyDecisionRef: provenance.policyDecisionRef,
    inputReference: buildReferenceV2(input.procedimentoId, change),
    maxAttempts: 2,
    availableAt: new Date(0),
    admission: provenance.admissionType === "AUTHENTICATED_USER"
      ? {
          admissionType: "AUTHENTICATED_USER",
          tenantId: provenance.tenantId,
          initiatingUserId: provenance.initiatingUserId!,
          actor: {
            actorId: provenance.actorId,
            actorEmail: provenance.actorEmail,
            actorRole: provenance.actorRole,
          },
        }
      : {
          admissionType: "AUTHORIZED_SYSTEM",
          tenantId: provenance.tenantId,
          initiatingUserId: null,
          actor: {
            actorId: provenance.actorId,
            actorEmail: provenance.actorEmail,
            actorRole: provenance.actorRole,
          },
        },
  };
  normalizeAsyncJobAdmission(admission);
  return admission;
}

export function parseFascicoloReevaluationReference(input: unknown): FascicoloReevaluationInput {
  if ((input as { referenceVersion?: unknown } | null)?.referenceVersion === "V2") {
    return parseFascicoloReevaluationReferenceV2(input);
  }
  const parsed = referenceSchema.safeParse(input);
  if (!parsed.success) throw new FascicoloReevaluationJobInputError("INVALID_CHANGE_REFERENCE");
  const { metadata } = parsed.data;
  const chunkCount = metadata.changeChunkCount;
  if (
    metadata.changeContractVersion !== FASCICOLO_CHANGE_CONTRACT_VERSION
    || typeof metadata.changeFingerprintHash !== "string"
    || typeof chunkCount !== "number"
    || !Number.isInteger(chunkCount)
    || chunkCount < 1
  ) {
    throw new FascicoloReevaluationJobInputError("INVALID_CHANGE_REFERENCE");
  }
  const chunkEntries = Object.entries(metadata)
    .filter(([key]) => CHANGE_CHUNK_KEY.test(key))
    .sort(([left], [right]) => left.localeCompare(right));
  const expectedKeys = Array.from(
    { length: chunkCount },
    (_, index) => `changeChunk${String(index).padStart(3, "0")}Ref`,
  );
  if (
    chunkEntries.length !== chunkCount
    || chunkEntries.some(([key, value], index) => key !== expectedKeys[index] || typeof value !== "string")
    || Object.keys(metadata).length !== chunkCount + 3
  ) {
    throw new FascicoloReevaluationJobInputError("INVALID_CHANGE_REFERENCE");
  }
  let causalState: unknown;
  try {
    causalState = JSON.parse(chunkEntries.map(([, value]) => value).join(""));
  } catch {
    throw new FascicoloReevaluationJobInputError("INVALID_CHANGE_REFERENCE");
  }
  const change = parseFascicoloChange({
    ...(causalState as Record<string, unknown>),
    triggeredAt: CANONICAL_TRIGGERED_AT,
  });
  const actualFingerprint = fingerprintFascicoloChange(change);
  if (actualFingerprint !== metadata.changeFingerprintHash) {
    throw new FascicoloReevaluationJobInputError("CHANGE_FINGERPRINT_MISMATCH");
  }
  assertTarget(change, parsed.data.referenceId);
  return Object.freeze({ procedimentoId: parsed.data.referenceId, change });
}

function parseFascicoloReevaluationReferenceV2(input: unknown): FascicoloReevaluationInput {
  const parsed = referenceSchemaV2.safeParse(input);
  if (!parsed.success) throw new FascicoloReevaluationJobInputError("INVALID_CHANGE_REFERENCE");
  const { metadata } = parsed.data;
  const chunkCount = metadata.changeChunkCount;
  if (
    metadata.changeContractVersion !== FASCICOLO_CHANGE_V2_CONTRACT_VERSION
    || typeof metadata.changeFingerprintHash !== "string"
    || typeof chunkCount !== "number"
    || !Number.isInteger(chunkCount)
    || chunkCount < 1
  ) {
    throw new FascicoloReevaluationJobInputError("INVALID_CHANGE_REFERENCE");
  }
  const chunkEntries = Object.entries(metadata)
    .filter(([key]) => CHANGE_CHUNK_KEY.test(key))
    .sort(([left], [right]) => left.localeCompare(right));
  const expectedKeys = Array.from(
    { length: chunkCount },
    (_, index) => `changeChunk${String(index).padStart(3, "0")}Ref`,
  );
  if (
    chunkEntries.length !== chunkCount
    || chunkEntries.some(([key, value], index) => key !== expectedKeys[index] || typeof value !== "string")
    || Object.keys(metadata).length !== chunkCount + 3
  ) {
    throw new FascicoloReevaluationJobInputError("INVALID_CHANGE_REFERENCE");
  }
  let causalState: unknown;
  try {
    causalState = JSON.parse(chunkEntries.map(([, value]) => value).join(""));
  } catch {
    throw new FascicoloReevaluationJobInputError("INVALID_CHANGE_REFERENCE");
  }
  const change = parseFascicoloTimeThresholdChangeV2({
    ...(causalState as Record<string, unknown>),
    triggeredAt: CANONICAL_TRIGGERED_AT,
  });
  const actualFingerprint = fingerprintFascicoloTimeThresholdChangeV2(change);
  if (actualFingerprint !== metadata.changeFingerprintHash) {
    throw new FascicoloReevaluationJobInputError("CHANGE_FINGERPRINT_MISMATCH");
  }
  assertTarget(change, parsed.data.referenceId);
  return Object.freeze({ procedimentoId: parsed.data.referenceId, change });
}

export function createFascicoloReevaluationHandler(
  dependencies: {
    projectSignal?: typeof projectFascicoloSignal;
    now?: () => Date;
  } = {},
): AsyncJobHandler<FascicoloReevaluationInput> {
  return {
    operation: FASCICOLO_REEVALUATE_OPERATION,
    parseInput: parseFascicoloReevaluationReference,
    async execute(input) {
      await (dependencies.projectSignal ?? projectFascicoloSignal)(
        input.change,
        (dependencies.now ?? (() => new Date()))(),
      );
      const plan = "expiryGeneration" in input.change
        ? planFascicoloReevaluationV2(input.change)
        : planFascicoloReevaluation(input.change);
      const familyCodes = plan.items.map((item) => item.family).join(",");
      const planHash = createHash("sha256").update(stableStringify(plan), "utf8").digest("hex");
      return {
        referenceType: "FASCICOLO_REEVALUATION_PLAN",
        referenceId: input.procedimentoId,
        referenceVersion: "V1",
        metadata: {
          changeFingerprintHash: plan.changeFingerprint,
          planHash,
          planItemCount: plan.items.length,
          planFamilyCodesRef: familyCodes,
          requiresTargetResolutionEnabled: plan.legalAssessment.requiresTargetResolution,
        },
      };
    },
  };
}