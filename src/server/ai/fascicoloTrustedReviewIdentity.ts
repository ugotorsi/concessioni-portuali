import { createHash } from "node:crypto";

import type { AiFascicoloOutboundAnalysisV1 } from "@/server/ai/fascicoloAnalysis";
import type { AiFascicoloTrustedReviewV1 } from "@/server/ai/fascicoloTrustedReview";

export const AI_FASCICOLO_TRUSTED_REVIEW_MATERIAL_V1_SCHEMA_VERSION =
  "ai-fascicolo-trusted-review-material/v1" as const;
export const AI_FASCICOLO_CANONICAL_JSON_V1_VERSION =
  "ai-fascicolo-canonical-json/v1" as const;
export const AI_FASCICOLO_TRUSTED_REVIEW_FINGERPRINT_ALGORITHM = "sha256" as const;

export type AiFascicoloTrustedReviewLineageV1 = Pick<
  AiFascicoloOutboundAnalysisV1,
  | "analysisSchemaVersion"
  | "snapshotSchemaVersion"
  | "outboundSchemaVersion"
  | "sourceSnapshotContentHash"
  | "outboundProjectionHash"
  | "outboundProjectionHashAlgorithm"
>;

export interface AiFascicoloTrustedReviewMaterialIdentityV1 {
  readonly schemaVersion: typeof AI_FASCICOLO_TRUSTED_REVIEW_MATERIAL_V1_SCHEMA_VERSION;
  readonly canonicalizationVersion: typeof AI_FASCICOLO_CANONICAL_JSON_V1_VERSION;
  readonly fingerprintAlgorithm: typeof AI_FASCICOLO_TRUSTED_REVIEW_FINGERPRINT_ALGORITHM;
  readonly fingerprint: string;
  readonly canonicalPayload: string;
}

export class AiFascicoloTrustedReviewIdentityError extends Error {
  readonly code = "INVALID_TRUSTED_REVIEW_MATERIAL" as const;

  constructor() {
    super("INVALID_TRUSTED_REVIEW_MATERIAL");
    this.name = "AiFascicoloTrustedReviewIdentityError";
  }
}

function fail(): never {
  throw new AiFascicoloTrustedReviewIdentityError();
}

const LINEAGE_KEYS = [
  "analysisSchemaVersion",
  "snapshotSchemaVersion",
  "outboundSchemaVersion",
  "sourceSnapshotContentHash",
  "outboundProjectionHash",
  "outboundProjectionHashAlgorithm",
] as const;

export function parseAiFascicoloTrustedReviewMaterialLineageV1(
  value: unknown,
): AiFascicoloTrustedReviewLineageV1 {
  try {
    if (value === null || typeof value !== "object") {
      return fail();
    }
    const prototype = Object.getPrototypeOf(value);
    if (
      (prototype !== Object.prototype && prototype !== null)
      || Object.getOwnPropertySymbols(value).length > 0
    ) {
      return fail();
    }

    const ownNames = Object.getOwnPropertyNames(value);
    if (
      ownNames.length !== LINEAGE_KEYS.length
      || LINEAGE_KEYS.some((key) => !ownNames.includes(key))
    ) {
      return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const values: Record<(typeof LINEAGE_KEYS)[number], string> = Object.create(null);
    for (const key of LINEAGE_KEYS) {
      const descriptor = descriptors[key];
      if (
        !descriptor?.enumerable
        || !("value" in descriptor)
        || typeof descriptor.value !== "string"
        || descriptor.value.trim().length === 0
      ) {
        return fail();
      }
      values[key] = descriptor.value;
    }

    return {
      analysisSchemaVersion: values.analysisSchemaVersion,
      snapshotSchemaVersion: values.snapshotSchemaVersion,
      outboundSchemaVersion: values.outboundSchemaVersion,
      sourceSnapshotContentHash: values.sourceSnapshotContentHash,
      outboundProjectionHash: values.outboundProjectionHash,
      outboundProjectionHashAlgorithm: values.outboundProjectionHashAlgorithm,
    } as AiFascicoloTrustedReviewLineageV1;
  } catch (error) {
    if (error instanceof AiFascicoloTrustedReviewIdentityError) {
      throw error;
    }
    return fail();
  }
}

function canonicalizeArray(value: readonly unknown[], active: WeakSet<object>): string {
  const symbolKeys = Object.getOwnPropertySymbols(value);
  if (symbolKeys.length > 0) {
    return fail();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownNames = Object.getOwnPropertyNames(value);
  for (const name of ownNames) {
    if (name === "length") {
      continue;
    }
    const index = Number(name);
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== name) {
      return fail();
    }
    const descriptor = descriptors[name];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      return fail();
    }
  }
  if (ownNames.length !== value.length + 1) {
    return fail();
  }

  const items: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.value === undefined) {
      return fail();
    }
    items.push(canonicalizeValue(descriptor.value, active));
  }
  return `[${items.join(",")}]`;
}

function canonicalizeObject(value: object, active: WeakSet<object>): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail();
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return fail();
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.getOwnPropertyNames(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      return fail();
    }
  }

  keys.sort();
  return `{${keys.map((key) => {
    const descriptor = descriptors[key];
    return `${JSON.stringify(key)}:${canonicalizeValue(descriptor.value, active)}`;
  }).join(",")}}`;
}

function canonicalizeValue(value: unknown, active: WeakSet<object>): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(Object.is(value, -0) ? 0 : value) : fail();
    case "undefined":
    case "bigint":
    case "symbol":
    case "function":
      return fail();
    case "object": {
      if (active.has(value)) {
        return fail();
      }
      active.add(value);
      try {
        return Array.isArray(value)
          ? canonicalizeArray(value, active)
          : canonicalizeObject(value, active);
      } finally {
        active.delete(value);
      }
    }
  }
  return fail();
}

export function canonicalizeAiFascicoloMaterialJson(value: unknown): string {
  return canonicalizeValue(value, new WeakSet<object>());
}

export function buildAiFascicoloTrustedReviewMaterialIdentityV1(input: {
  readonly trustedReview: AiFascicoloTrustedReviewV1;
  readonly lineage: AiFascicoloTrustedReviewLineageV1;
}): AiFascicoloTrustedReviewMaterialIdentityV1 {
  const exactLineage = parseAiFascicoloTrustedReviewMaterialLineageV1(input.lineage);
  const canonicalPayload = canonicalizeAiFascicoloMaterialJson({
    schemaVersion: AI_FASCICOLO_TRUSTED_REVIEW_MATERIAL_V1_SCHEMA_VERSION,
    lineage: exactLineage,
    trustedReview: input.trustedReview,
  });
  const fingerprint = createHash(AI_FASCICOLO_TRUSTED_REVIEW_FINGERPRINT_ALGORITHM)
    .update(`${AI_FASCICOLO_TRUSTED_REVIEW_MATERIAL_V1_SCHEMA_VERSION}\n${canonicalPayload}`, "utf8")
    .digest("hex");

  return Object.freeze({
    schemaVersion: AI_FASCICOLO_TRUSTED_REVIEW_MATERIAL_V1_SCHEMA_VERSION,
    canonicalizationVersion: AI_FASCICOLO_CANONICAL_JSON_V1_VERSION,
    fingerprintAlgorithm: AI_FASCICOLO_TRUSTED_REVIEW_FINGERPRINT_ALGORITHM,
    fingerprint,
    canonicalPayload,
  });
}