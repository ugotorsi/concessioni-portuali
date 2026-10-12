import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildNeutralIntakeIdempotencyKeyV1,
  canonicalizeNeutralIntakeManifestV1,
  NEUTRAL_INTAKE_IDEMPOTENCY_PREFIX,
  NEUTRAL_INTAKE_MANIFEST_PREFIX,
  neutralIntakeManifestsEqual,
} from "@/server/intake/neutralIntakeIdentity";

const event = {
  ingressChannel: "LOCAL_PACK_ENTRY",
  anchor: { type: "ORIGIN_REFERENCE" as const, value: "adsp-mtc/ARPAC-ACT" },
};

const manifest = {
  storageProvider: "local" as const,
  storageBucket: null,
  storageKey: `intake/sha256/${"a".repeat(64)}`,
  sha256: "a".repeat(64),
  mimeType: "application/pdf",
  sizeBytes: 42,
  originalName: "ARPAC.pdf",
  ingressChannel: event.ingressChannel,
  originReference: event.anchor.value,
  enteId: null,
  receivedByUserId: null,
  receivedByActorId: "actor-1",
  receivedByRole: "ADMIN",
};

type EventInput = {
  ingressChannel: string;
  anchor: { type: "ORIGIN_REFERENCE" | "OPERATION_ID"; value: string };
};

function expectedEventCanonical(input: EventInput): string {
  return [
    NEUTRAL_INTAKE_IDEMPOTENCY_PREFIX,
    input.ingressChannel,
    input.anchor.type,
    input.anchor.value,
  ].map((field) => `${Buffer.byteLength(field, "utf8")}:${field}`).join("\n");
}

function expectedEventKey(input: EventInput): string {
  return createHash("sha256").update(expectedEventCanonical(input), "utf8").digest("hex");
}

describe("B2C9 Block 3B.1 intake identity", () => {
  it("uses the frozen V1 prefix and returns lowercase SHA-256", () => {
    expect(NEUTRAL_INTAKE_IDEMPOTENCY_PREFIX).toBe("B2C9_BLOCK_3B1_NEUTRAL_INTAKE_IDEMPOTENCY_V1");
    expect(buildNeutralIntakeIdempotencyKeyV1(event)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same event", () => {
    expect(buildNeutralIntakeIdempotencyKeyV1(event)).toBe(buildNeutralIntakeIdempotencyKeyV1(event));
  });

  it("changes with ingress channel", () => {
    expect(buildNeutralIntakeIdempotencyKeyV1(event)).not.toBe(buildNeutralIntakeIdempotencyKeyV1({
      ...event,
      ingressChannel: "OFFICIAL_WEB",
    }));
  });

  it("changes with stable origin reference", () => {
    expect(buildNeutralIntakeIdempotencyKeyV1(event)).not.toBe(buildNeutralIntakeIdempotencyKeyV1({
      ...event,
      anchor: { ...event.anchor, value: "adsp-mtc/OTHER" },
    }));
  });

  it("supports a stable operation ID when no semantic origin reference exists", () => {
    const key = buildNeutralIntakeIdempotencyKeyV1({
      ingressChannel: "MANUAL_UPLOAD",
      anchor: { type: "OPERATION_ID", value: "operation-42" },
    });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses unambiguous length-prefixed canonical serialization", () => {
    const canonical = canonicalizeNeutralIntakeManifestV1(manifest);
    expect(canonical).toContain(`${Buffer.byteLength(NEUTRAL_INTAKE_MANIFEST_PREFIX, "utf8")}:${NEUTRAL_INTAKE_MANIFEST_PREFIX}`);
    expect(canonical).toContain("0:");
  });

  it("separates event tuples that collide under naive concatenation", () => {
    const collisionPairs = [
      [
        { ingressChannel: "xORIGIN_REFERENCE", anchor: { type: "ORIGIN_REFERENCE" as const, value: "y" } },
        { ingressChannel: "x", anchor: { type: "ORIGIN_REFERENCE" as const, value: "ORIGIN_REFERENCEy" } },
      ],
      [
        { ingressChannel: "x", anchor: { type: "ORIGIN_REFERENCE" as const, value: "OPERATION_IDz" } },
        { ingressChannel: "xORIGIN_REFERENCE", anchor: { type: "OPERATION_ID" as const, value: "z" } },
      ],
    ] as const;

    for (const [left, right] of collisionPairs) {
      const naive = (input: EventInput) =>
        `${input.ingressChannel}${input.anchor.type}${input.anchor.value}`;
      expect(naive(left)).toBe(naive(right));
      expect(expectedEventCanonical(left)).not.toBe(expectedEventCanonical(right));
      expect(buildNeutralIntakeIdempotencyKeyV1(left)).toBe(expectedEventKey(left));
      expect(buildNeutralIntakeIdempotencyKeyV1(right)).toBe(expectedEventKey(right));
      expect(buildNeutralIntakeIdempotencyKeyV1(left)).not.toBe(buildNeutralIntakeIdempotencyKeyV1(right));
    }
  });

  it("separates null from delimiter-like optional manifest content", () => {
    const absent = canonicalizeNeutralIntakeManifestV1(manifest);
    const present = canonicalizeNeutralIntakeManifestV1({ ...manifest, storageBucket: "0:" });

    expect(absent).not.toBe(present);
    expect(neutralIntakeManifestsEqual(manifest, { ...manifest, storageBucket: "0:" })).toBe(false);
  });

  it("normalizes equivalent manifests", () => {
    expect(neutralIntakeManifestsEqual(manifest, {
      ...manifest,
      sha256: manifest.sha256.toUpperCase(),
      mimeType: " APPLICATION/PDF ",
    })).toBe(true);
  });

  it("detects every immutable manifest difference", () => {
    for (const override of [
      { storageProvider: "s3" as const }, { storageBucket: "bucket" }, { storageKey: "other" },
      { sha256: "b".repeat(64) }, { mimeType: "image/jpeg" }, { sizeBytes: 43 },
      { originalName: "other.pdf" }, { ingressChannel: "OTHER" }, { originReference: "other" },
      { enteId: "ente-1" }, { receivedByUserId: "user-1" }, { receivedByActorId: "actor-2" },
      { receivedByRole: "GIURIDICO" },
    ]) {
      expect(neutralIntakeManifestsEqual(manifest, { ...manifest, ...override })).toBe(false);
    }
  });
});
