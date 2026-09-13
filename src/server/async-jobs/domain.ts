import { createHash } from "node:crypto";

import { z } from "zod";

export const ASYNC_JOB_IDEMPOTENCY_VERSION = "B2C9_ASYNC_JOB_IDEMPOTENCY_V1" as const;
export const ASYNC_JOB_ADMISSION_VERSION = "B2C9_ASYNC_JOB_ADMISSION_V1" as const;
export const ASYNC_JOB_MAX_REFERENCE_BYTES = 12 * 1024;
export const ASYNC_JOB_MAX_ATTEMPTS = 100;

const nonBlank = z.string().trim().min(1);
const boundedIdentifier = nonBlank.max(256);
const operation = z.string().trim().min(3).max(128).regex(/^[A-Z][A-Z0-9_.:-]*$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const forbiddenReferenceKey = /text|content|body|bytes|prompt|response|payload|message|output|data|credential|password|secret|token|authorization|api.?key|bearer|jwt|cookie|private.?key/i;
const allowedReferenceMetadataKey = /^[a-z][A-Za-z0-9]*(?:Id|Ref|Version|Kind|Type|Code|Count|Hash|At|Enabled)$/;

const referenceMetadataValue = z.union([
  z.string().max(512),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const referenceEnvelopeSchema = z.object({
  referenceType: z.string().trim().min(1).max(128).regex(/^[A-Z][A-Z0-9_.:-]*$/),
  referenceId: boundedIdentifier,
  referenceVersion: boundedIdentifier.nullable().optional().transform((value) => value ?? null),
  metadata: z.record(z.string().min(1).max(64), referenceMetadataValue).optional().default({}),
}).strict();

export interface AsyncJobReferenceEnvelope {
  readonly referenceType: string;
  readonly referenceId: string;
  readonly referenceVersion: string | null;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

function boundedReference(value: unknown): AsyncJobReferenceEnvelope {
  const parsed = referenceEnvelopeSchema.safeParse(value);
  if (!parsed.success) throw new AsyncJobInputError("INVALID_REFERENCE");
  for (const key of Object.keys(parsed.data.metadata)) {
    if (forbiddenReferenceKey.test(key)) throw new AsyncJobInputError("SENSITIVE_REFERENCE_FIELD");
    if (!allowedReferenceMetadataKey.test(key)) throw new AsyncJobInputError("INVALID_REFERENCE");
  }
  const metadata = Object.fromEntries(
    Object.entries(parsed.data.metadata).sort(([left], [right]) => left.localeCompare(right)),
  );
  const normalized: AsyncJobReferenceEnvelope = { ...parsed.data, metadata };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > ASYNC_JOB_MAX_REFERENCE_BYTES) {
    throw new AsyncJobInputError("REFERENCE_TOO_LARGE");
  }
  return normalized;
}

function lengthPrefixed(fields: readonly string[]): string {
  return fields.map((field) => `${Buffer.byteLength(field, "utf8")}:${field}`).join("\n");
}

function nullable(value: string | null): string {
  return value === null ? "0:" : `1:${value}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export type AsyncJobInputErrorCode =
  | "INVALID_ADMISSION"
  | "INVALID_REFERENCE"
  | "REFERENCE_TOO_LARGE"
  | "SENSITIVE_REFERENCE_FIELD";

export class AsyncJobInputError extends Error {
  constructor(readonly code: AsyncJobInputErrorCode) {
    super(code);
    this.name = "AsyncJobInputError";
  }
}

const actorSchema = z.object({
  actorId: boundedIdentifier,
  actorEmail: z.string().trim().email().max(320).nullable(),
  actorRole: boundedIdentifier,
}).strict();

const admissionSchema = z.discriminatedUnion("admissionType", [
  z.object({
    admissionType: z.literal("AUTHENTICATED_USER"),
    tenantId: boundedIdentifier.nullable(),
    initiatingUserId: boundedIdentifier,
    actor: actorSchema,
  }).strict().superRefine((input, context) => {
    if (input.actor.actorId !== input.initiatingUserId) {
      context.addIssue({ code: "custom", path: ["actor", "actorId"], message: "Actor must match initiating user." });
    }
  }),
  z.object({
    admissionType: z.literal("AUTHORIZED_SYSTEM"),
    tenantId: boundedIdentifier.nullable(),
    initiatingUserId: z.null(),
    actor: actorSchema,
  }).strict(),
]);

export const asyncJobAdmissionSchema = z.object({
  operation,
  logicalOperationId: boundedIdentifier,
  purpose: boundedIdentifier,
  correlationId: boundedIdentifier,
  policyDecisionRef: boundedIdentifier.nullable().optional().transform((value) => value ?? null),
  inputReference: z.unknown(),
  maxAttempts: z.number().int().min(1).max(ASYNC_JOB_MAX_ATTEMPTS),
  availableAt: z.date(),
  admission: admissionSchema,
}).strict().superRefine((input, context) => {
  if (input.admission.admissionType === "AUTHORIZED_SYSTEM" && input.policyDecisionRef === null) {
    context.addIssue({ code: "custom", path: ["policyDecisionRef"], message: "System admission requires an authorization decision reference." });
  }
});

export type AsyncJobAdmissionInput = z.input<typeof asyncJobAdmissionSchema>;

export interface NormalizedAsyncJobAdmission {
  readonly operation: string;
  readonly logicalOperationId: string;
  readonly purpose: string;
  readonly correlationId: string;
  readonly policyDecisionRef: string | null;
  readonly inputReference: AsyncJobReferenceEnvelope;
  readonly maxAttempts: number;
  readonly availableAt: Date;
  readonly admission: z.output<typeof admissionSchema>;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
}

export function normalizeAsyncJobAdmission(input: unknown): NormalizedAsyncJobAdmission {
  const parsed = asyncJobAdmissionSchema.safeParse(input);
  if (!parsed.success) throw new AsyncJobInputError("INVALID_ADMISSION");
  const inputReference = boundedReference(parsed.data.inputReference);
  const scope = parsed.data.admission.tenantId === null
    ? "GLOBAL"
    : `TENANT:${parsed.data.admission.tenantId}`;
  const idempotencyKey = createHash("sha256").update(lengthPrefixed([
    ASYNC_JOB_IDEMPOTENCY_VERSION,
    scope,
    parsed.data.operation,
    parsed.data.logicalOperationId,
  ]), "utf8").digest("hex");
  const requestFingerprint = createHash("sha256").update(lengthPrefixed([
    ASYNC_JOB_ADMISSION_VERSION,
    idempotencyKey,
    parsed.data.purpose,
    parsed.data.correlationId,
    nullable(parsed.data.policyDecisionRef),
    parsed.data.admission.admissionType,
    nullable(parsed.data.admission.tenantId),
    nullable(parsed.data.admission.initiatingUserId),
    parsed.data.admission.actor.actorId,
    nullable(parsed.data.admission.actor.actorEmail),
    parsed.data.admission.actor.actorRole,
    String(parsed.data.maxAttempts),
    parsed.data.availableAt.toISOString(),
    stableJson(inputReference),
  ]), "utf8").digest("hex");
  return Object.freeze({ ...parsed.data, inputReference, idempotencyKey, requestFingerprint });
}

export interface AsyncJobFailure {
  readonly retryable: boolean;
  readonly category: string;
  readonly code: string;
}

const failureSchema = z.object({
  retryable: z.boolean(),
  category: z.string().trim().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/),
  code: z.string().trim().min(1).max(128).regex(/^[A-Z][A-Z0-9_.:-]*$/),
}).strict();

export function normalizeAsyncJobFailure(input: unknown): AsyncJobFailure {
  return Object.freeze(failureSchema.parse(input));
}

export function normalizeAsyncJobResultMetadata(input: unknown): AsyncJobReferenceEnvelope {
  return boundedReference(input);
}

export function assertSha256(value: unknown): string {
  return sha256.parse(value);
}