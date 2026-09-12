import { createHash } from "node:crypto";

import { z } from "zod";

export const NEUTRAL_INTAKE_IDEMPOTENCY_PREFIX =
  "B2C9_BLOCK_3B1_NEUTRAL_INTAKE_IDEMPOTENCY_V1" as const;
export const NEUTRAL_INTAKE_MANIFEST_PREFIX =
  "B2C9_BLOCK_3B1_NEUTRAL_INTAKE_MANIFEST_V1" as const;

const nonBlank = z.string().trim().min(1);
const optionalNonBlank = nonBlank.nullable().optional().transform((value) => value ?? null);
const sha256 = z.string().trim().regex(/^[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase());

export const neutralIntakeIdempotencyAnchorSchema = z.object({
  type: z.enum(["ORIGIN_REFERENCE", "OPERATION_ID"]),
  value: nonBlank,
}).strict();

export const neutralIntakeImmutableManifestSchema = z.object({
  storageProvider: z.enum(["local", "s3"]),
  storageBucket: optionalNonBlank,
  storageKey: nonBlank,
  sha256,
  mimeType: nonBlank.transform((value) => value.toLowerCase()),
  sizeBytes: z.number().int().positive(),
  originalName: optionalNonBlank,
  ingressChannel: nonBlank,
  originReference: optionalNonBlank,
  enteId: optionalNonBlank,
  receivedByUserId: optionalNonBlank,
  receivedByActorId: nonBlank,
  receivedByRole: nonBlank,
}).strict();

export type NeutralIntakeIdempotencyAnchor = z.input<typeof neutralIntakeIdempotencyAnchorSchema>;
export type NeutralIntakeImmutableManifest = z.output<typeof neutralIntakeImmutableManifestSchema>;

function lengthPrefixed(fields: readonly string[]): string {
  return fields
    .map((field) => `${Buffer.byteLength(field, "utf8")}:${field}`)
    .join("\n");
}

function nullableField(value: string | null): string {
  return value === null ? "0:" : `1:${value}`;
}

export function buildNeutralIntakeIdempotencyKeyV1(input: {
  ingressChannel: string;
  anchor: NeutralIntakeIdempotencyAnchor;
}): string {
  const ingressChannel = nonBlank.parse(input.ingressChannel);
  const anchor = neutralIntakeIdempotencyAnchorSchema.parse(input.anchor);
  const canonical = lengthPrefixed([
    NEUTRAL_INTAKE_IDEMPOTENCY_PREFIX,
    ingressChannel,
    anchor.type,
    anchor.value,
  ]);

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function normalizeNeutralIntakeManifest(
  input: unknown,
): NeutralIntakeImmutableManifest {
  return neutralIntakeImmutableManifestSchema.parse(input);
}

export function canonicalizeNeutralIntakeManifestV1(
  rawInput: unknown,
): string {
  const input = normalizeNeutralIntakeManifest(rawInput);
  return lengthPrefixed([
    NEUTRAL_INTAKE_MANIFEST_PREFIX,
    input.storageProvider,
    nullableField(input.storageBucket),
    input.storageKey,
    input.sha256,
    input.mimeType,
    String(input.sizeBytes),
    nullableField(input.originalName),
    input.ingressChannel,
    nullableField(input.originReference),
    nullableField(input.enteId),
    nullableField(input.receivedByUserId),
    input.receivedByActorId,
    input.receivedByRole,
  ]);
}

export function fingerprintNeutralIntakeManifestV1(
  input: unknown,
): string {
  return createHash("sha256")
    .update(canonicalizeNeutralIntakeManifestV1(input), "utf8")
    .digest("hex");
}

export function neutralIntakeManifestsEqual(
  left: unknown,
  right: unknown,
): boolean {
  return fingerprintNeutralIntakeManifestV1(left) === fingerprintNeutralIntakeManifestV1(right);
}
