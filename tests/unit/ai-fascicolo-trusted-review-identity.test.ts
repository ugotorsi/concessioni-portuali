import { describe, expect, it } from "vitest";

import type { AiFascicoloTrustedReviewV1 } from "@/server/ai/fascicoloTrustedReview";
import {
  AiFascicoloTrustedReviewIdentityError,
  buildAiFascicoloTrustedReviewMaterialIdentityV1,
  canonicalizeAiFascicoloMaterialJson,
  type AiFascicoloTrustedReviewLineageV1,
} from "@/server/ai/fascicoloTrustedReviewIdentity";

function lineageFixture(): AiFascicoloTrustedReviewLineageV1 {
  return {
    analysisSchemaVersion: "ai-fascicolo-analysis/v1",
    snapshotSchemaVersion: "ai-fascicolo-snapshot/v1",
    outboundSchemaVersion: "ai-fascicolo-outbound/v1",
    sourceSnapshotContentHash: "a".repeat(64),
    outboundProjectionHash: "b".repeat(64),
    outboundProjectionHashAlgorithm: "sha256",
  };
}

function trustedReviewFixture(): AiFascicoloTrustedReviewV1 {
  return {
    schemaVersion: "ai-fascicolo-trusted-review/v1",
    purpose: "INTERNAL_COMPANY_PROFESSIONAL_REVIEW",
    providerAnalysis: {
      provenance: "AI_ORIGINAL",
      content: {
        summary: { text: "Provider DOC_1", basisRefs: ["DOC_1", "DOC_2"] },
        timeline: [],
        recordedState: [],
        signals: [],
        investigativeQuestions: [{ text: "Question", basisRefs: [] }],
        suggestedActivities: [],
        legalResearchQuestions: [],
      },
    },
    statements: [
      {
        statementPath: "summary",
        providerStatement: {
          provenance: "AI_ORIGINAL",
          content: { text: "Provider DOC_1", basisRefs: ["DOC_1", "DOC_2"] },
        },
        resolutionStatus: "RESOLVED",
        evidence: [{
          providerRef: "DOC_1",
          referenceType: "ENTITY",
          alias: "DOC_1",
          kind: "DOCUMENT",
          canonicalId: "document-1",
          validatedFieldPath: null,
          resolutionStatus: "RESOLVED",
          local: {
            provenance: "LOCAL_AUTHORITATIVE_DATA",
            displayLabel: "Documento 1",
            fieldLabel: "Documento",
            value: { recorded: true, amount: 1 },
          },
        }],
      },
      {
        statementPath: "investigativeQuestions[0]",
        providerStatement: {
          provenance: "AI_ORIGINAL",
          content: { text: "Question", basisRefs: [] },
        },
        resolutionStatus: "NO_BASIS_REFS",
        evidence: [],
      },
    ],
  };
}

function identity(input?: {
  trustedReview?: AiFascicoloTrustedReviewV1;
  lineage?: AiFascicoloTrustedReviewLineageV1;
}) {
  return buildAiFascicoloTrustedReviewMaterialIdentityV1({
    trustedReview: input?.trustedReview ?? trustedReviewFixture(),
    lineage: input?.lineage ?? lineageFixture(),
  });
}

function identityWithRuntimeLineage(lineage: unknown) {
  return buildAiFascicoloTrustedReviewMaterialIdentityV1({
    trustedReview: trustedReviewFixture(),
    lineage: lineage as AiFascicoloTrustedReviewLineageV1,
  });
}

function cloneReview(): AiFascicoloTrustedReviewV1 {
  return structuredClone(trustedReviewFixture());
}

function expectRejected(value: unknown): void {
  expect(() => canonicalizeAiFascicoloMaterialJson(value))
    .toThrow(AiFascicoloTrustedReviewIdentityError);
}

describe("AI-01C2B4B2A trusted review material identity", () => {
  it("matches a hard-coded canonical JSON and SHA-256 golden vector", () => {
    const trustedReview: AiFascicoloTrustedReviewV1 = {
      schemaVersion: "ai-fascicolo-trusted-review/v1",
      purpose: "INTERNAL_COMPANY_PROFESSIONAL_REVIEW",
      providerAnalysis: {
        provenance: "AI_ORIGINAL",
        content: {
          summary: { text: "A", basisRefs: ["DOC_1"] },
          timeline: [], recordedState: [], signals: [], investigativeQuestions: [],
          suggestedActivities: [], legalResearchQuestions: [],
        },
      },
      statements: [{
        statementPath: "summary",
        providerStatement: {
          provenance: "AI_ORIGINAL",
          content: { text: "A", basisRefs: ["DOC_1"] },
        },
        resolutionStatus: "MISSING_LOCAL_EVIDENCE",
        evidence: [{
          providerRef: "DOC_1", referenceType: "ENTITY", alias: "DOC_1",
          kind: "DOCUMENT", canonicalId: "d1", validatedFieldPath: null,
          resolutionStatus: "MISSING_LOCAL_EVIDENCE", local: null,
        }],
      }],
    };
    const lineage: AiFascicoloTrustedReviewLineageV1 = {
      analysisSchemaVersion: "ai-fascicolo-analysis/v1",
      snapshotSchemaVersion: "ai-fascicolo-snapshot/v1",
      outboundSchemaVersion: "ai-fascicolo-outbound/v1",
      sourceSnapshotContentHash: "source",
      outboundProjectionHash: "outbound",
      outboundProjectionHashAlgorithm: "sha256",
    };
    const expectedCanonicalPayload = "{\"lineage\":{\"analysisSchemaVersion\":\"ai-fascicolo-analysis/v1\",\"outboundProjectionHash\":\"outbound\",\"outboundProjectionHashAlgorithm\":\"sha256\",\"outboundSchemaVersion\":\"ai-fascicolo-outbound/v1\",\"snapshotSchemaVersion\":\"ai-fascicolo-snapshot/v1\",\"sourceSnapshotContentHash\":\"source\"},\"schemaVersion\":\"ai-fascicolo-trusted-review-material/v1\",\"trustedReview\":{\"providerAnalysis\":{\"content\":{\"investigativeQuestions\":[],\"legalResearchQuestions\":[],\"recordedState\":[],\"signals\":[],\"suggestedActivities\":[],\"summary\":{\"basisRefs\":[\"DOC_1\"],\"text\":\"A\"},\"timeline\":[]},\"provenance\":\"AI_ORIGINAL\"},\"purpose\":\"INTERNAL_COMPANY_PROFESSIONAL_REVIEW\",\"schemaVersion\":\"ai-fascicolo-trusted-review/v1\",\"statements\":[{\"evidence\":[{\"alias\":\"DOC_1\",\"canonicalId\":\"d1\",\"kind\":\"DOCUMENT\",\"local\":null,\"providerRef\":\"DOC_1\",\"referenceType\":\"ENTITY\",\"resolutionStatus\":\"MISSING_LOCAL_EVIDENCE\",\"validatedFieldPath\":null}],\"providerStatement\":{\"content\":{\"basisRefs\":[\"DOC_1\"],\"text\":\"A\"},\"provenance\":\"AI_ORIGINAL\"},\"resolutionStatus\":\"MISSING_LOCAL_EVIDENCE\",\"statementPath\":\"summary\"}]}}";
    const expectedFingerprint = "527d69f51a715ff51e7d49795d541c9bfc37c6c24c31543b0edb7a196acecef3";

    const result = identity({ trustedReview, lineage });

    expect(result.canonicalPayload).toBe(expectedCanonicalPayload);
    expect(result.fingerprint).toBe(expectedFingerprint);
  });

  it("is deterministic and independent of object insertion order", () => {
    const first = identity();
    const lineage = lineageFixture();
    const reorderedLineage = {
      outboundProjectionHashAlgorithm: lineage.outboundProjectionHashAlgorithm,
      outboundProjectionHash: lineage.outboundProjectionHash,
      sourceSnapshotContentHash: lineage.sourceSnapshotContentHash,
      outboundSchemaVersion: lineage.outboundSchemaVersion,
      snapshotSchemaVersion: lineage.snapshotSchemaVersion,
      analysisSchemaVersion: lineage.analysisSchemaVersion,
    };

    expect(identity()).toEqual(first);
    expect(identity({ lineage: reorderedLineage }).fingerprint).toBe(first.fingerprint);
    expect(canonicalizeAiFascicoloMaterialJson({ z: 1, a: 2 }))
      .toBe(canonicalizeAiFascicoloMaterialJson({ a: 2, z: 1 }));
  });

  it("preserves array order and binds provider text, basisRefs, and statement order", () => {
    const baseline = identity().fingerprint;
    const basisRefs = cloneReview();
    basisRefs.providerAnalysis.content.summary.basisRefs.reverse();
    const providerText = cloneReview();
    providerText.providerAnalysis.content.summary.text = "provider DOC_1";
    const statementOrder = cloneReview();
    statementOrder.statements.reverse();

    expect(identity({ trustedReview: basisRefs }).fingerprint).not.toBe(baseline);
    expect(identity({ trustedReview: providerText }).fingerprint).not.toBe(baseline);
    expect(identity({ trustedReview: statementOrder }).fingerprint).not.toBe(baseline);
    expect(canonicalizeAiFascicoloMaterialJson([1, 2]))
      .not.toBe(canonicalizeAiFascicoloMaterialJson([2, 1]));
  });

  it("binds statementPath, canonical ID, local values, provenance, and status", () => {
    const baseline = identity().fingerprint;
    const statementPath = cloneReview();
    statementPath.statements[0].statementPath = "recordedState[0]";
    const canonicalId = cloneReview();
    canonicalId.statements[0].evidence[0].canonicalId = "document-2";
    const localValue = cloneReview();
    localValue.statements[0].evidence[0].local!.value = { recorded: false, amount: 1 };
    const provenance = cloneReview();
    (provenance.statements[0].evidence[0].local as { provenance: string }).provenance = "OTHER";
    const status = cloneReview();
    status.statements[0].resolutionStatus = "REQUIRES_HUMAN_REVIEW";

    for (const changed of [statementPath, canonicalId, localValue, provenance, status]) {
      expect(identity({ trustedReview: changed }).fingerprint).not.toBe(baseline);
    }
  });

  it("binds source and outbound lineage independently", () => {
    const baseline = identity().fingerprint;
    const source = { ...lineageFixture(), sourceSnapshotContentHash: "changed-source" };
    const outbound = { ...lineageFixture(), outboundProjectionHash: "changed-outbound" };

    expect(identity({ lineage: source }).fingerprint).not.toBe(baseline);
    expect(identity({ lineage: outbound }).fingerprint).not.toBe(baseline);
  });

  it("accepts exactly the six required lineage fields deterministically", () => {
    const lineage = lineageFixture();

    expect(identity({ lineage })).toEqual(identity({ lineage: { ...lineage } }));
    expect(identity({ lineage }).canonicalPayload).not.toContain("generatedAt");
  });

  it.each(["generatedAt", "arbitraryExtraField"])(
    "rejects an extra lineage field: %s",
    (extraField) => {
      expect(() => identityWithRuntimeLineage({
        ...lineageFixture(),
        [extraField]: "extra",
      })).toThrow(AiFascicoloTrustedReviewIdentityError);
    },
  );

  it("rejects a complete outbound-analysis-shaped object as lineage", () => {
    expect(() => identityWithRuntimeLineage({
      ...lineageFixture(),
      generatedAt: "2026-08-18T00:00:00.000Z",
      analysis: {},
      resolvedBasisRefs: [],
      limitations: [],
    })).toThrow(AiFascicoloTrustedReviewIdentityError);
  });

  it.each([
    "analysisSchemaVersion",
    "snapshotSchemaVersion",
    "outboundSchemaVersion",
    "sourceSnapshotContentHash",
    "outboundProjectionHash",
    "outboundProjectionHashAlgorithm",
  ] as const)("rejects missing required lineage field: %s", (missingField) => {
    const lineage = { ...lineageFixture() } as Record<string, unknown>;
    delete lineage[missingField];

    expect(() => identityWithRuntimeLineage(lineage))
      .toThrow(AiFascicoloTrustedReviewIdentityError);
  });

  it.each([
    ["null lineage", null],
    ["undefined field", { ...lineageFixture(), sourceSnapshotContentHash: undefined }],
    ["null field", { ...lineageFixture(), sourceSnapshotContentHash: null }],
    ["numeric field", { ...lineageFixture(), sourceSnapshotContentHash: 1 }],
    ["boolean field", { ...lineageFixture(), sourceSnapshotContentHash: true }],
    ["empty field", { ...lineageFixture(), sourceSnapshotContentHash: "" }],
    ["whitespace field", { ...lineageFixture(), sourceSnapshotContentHash: "   " }],
  ])("rejects malformed lineage: %s", (_name, lineage) => {
    expect(() => identityWithRuntimeLineage(lineage))
      .toThrow(AiFascicoloTrustedReviewIdentityError);
  });

  it("rejects a lineage accessor without invoking its getter", () => {
    let getterCalls = 0;
    const lineage = { ...lineageFixture() } as Record<string, unknown>;
    Object.defineProperty(lineage, "sourceSnapshotContentHash", {
      enumerable: true,
      get() { getterCalls += 1; return "source"; },
    });

    expect(() => identityWithRuntimeLineage(lineage))
      .toThrow(AiFascicoloTrustedReviewIdentityError);
    expect(getterCalls).toBe(0);
  });

  it("rejects symbol, non-enumerable, and prototype-bearing lineage objects", () => {
    const withSymbol = { ...lineageFixture(), [Symbol("extra")]: "value" };
    const nonEnumerable = { ...lineageFixture() };
    Object.defineProperty(nonEnumerable, "extra", { value: "value", enumerable: false });
    class LineageClass {
      analysisSchemaVersion = "ai-fascicolo-analysis/v1";
      snapshotSchemaVersion = "ai-fascicolo-snapshot/v1";
      outboundSchemaVersion = "ai-fascicolo-outbound/v1";
      sourceSnapshotContentHash = "source";
      outboundProjectionHash = "outbound";
      outboundProjectionHashAlgorithm = "sha256";
    }

    for (const lineage of [withSymbol, nonEnumerable, new LineageClass()]) {
      expect(() => identityWithRuntimeLineage(lineage))
        .toThrow(AiFascicoloTrustedReviewIdentityError);
    }
  });

  it("distinguishes null from absent", () => {
    expect(canonicalizeAiFascicoloMaterialJson({ value: null }))
      .not.toBe(canonicalizeAiFascicoloMaterialJson({}));
  });

  it("rejects undefined, non-finite numbers, bigint, functions, and symbols", () => {
    for (const value of [undefined, NaN, Infinity, -Infinity, 1n, () => undefined, Symbol("x")]) {
      expectRejected(value);
    }
    expectRejected({ value: undefined });
    expectRejected([undefined]);
  });

  it("rejects Date, Map, Set, RegExp, and class instances", () => {
    class CustomValue { value = 1; }
    for (const value of [new Date(), new Map(), new Set(), /x/, new CustomValue()]) {
      expectRejected(value);
    }
  });

  it("rejects holes, symbol keys, non-enumerable properties, and accessors without invocation", () => {
    const sparse = Array(1);
    const withSymbol = { value: 1, [Symbol("hidden")]: 2 };
    const nonEnumerable = { value: 1 };
    Object.defineProperty(nonEnumerable, "hidden", { value: 2, enumerable: false });
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get() { getterCalls += 1; return 1; },
    });

    for (const value of [sparse, withSymbol, nonEnumerable, accessor]) {
      expectRejected(value);
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects custom and symbol array properties and array accessors without invocation", () => {
    const custom = [1] as number[] & { extra?: string };
    custom.extra = "value";
    const withSymbol = [1] as unknown[] & { [key: symbol]: unknown };
    withSymbol[Symbol("extra")] = "value";
    let getterCalls = 0;
    const accessor = [1];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() { getterCalls += 1; return 1; },
    });

    for (const value of [custom, withSymbol, accessor]) {
      expectRejected(value);
    }
    expect(getterCalls).toBe(0);
  });

  it("accepts shared noncyclic references deterministically", () => {
    const shared = { x: 1 };
    const value = { a: shared, b: shared };

    expect(canonicalizeAiFascicoloMaterialJson(value))
      .toBe("{\"a\":{\"x\":1},\"b\":{\"x\":1}}");
    expect(canonicalizeAiFascicoloMaterialJson(value))
      .toBe(canonicalizeAiFascicoloMaterialJson(value));
  });

  it("rejects cycles with a controlled domain error", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expectRejected(cyclic);
    try {
      canonicalizeAiFascicoloMaterialJson(cyclic);
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_TRUSTED_REVIEW_MATERIAL" });
      expect((error as Error).message).not.toContain("call stack");
    }
  });

  it("does not normalize Unicode and canonicalizes negative zero as JSON zero", () => {
    const composed = "é";
    const decomposed = "e\u0301";

    expect(canonicalizeAiFascicoloMaterialJson(composed))
      .not.toBe(canonicalizeAiFascicoloMaterialJson(decomposed));
    expect(canonicalizeAiFascicoloMaterialJson(-0)).toBe("0");
    expect(canonicalizeAiFascicoloMaterialJson(-0))
      .toBe(canonicalizeAiFascicoloMaterialJson(0));
  });

  it("returns a frozen minimal result with a lowercase SHA-256 fingerprint", () => {
    const result = identity();

    expect(Object.keys(result).sort()).toEqual([
      "canonicalPayload", "canonicalizationVersion", "fingerprint",
      "fingerprintAlgorithm", "schemaVersion",
    ]);
    expect(result).toMatchObject({
      schemaVersion: "ai-fascicolo-trusted-review-material/v1",
      canonicalizationVersion: "ai-fascicolo-canonical-json/v1",
      fingerprintAlgorithm: "sha256",
    });
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("does not retain aliases, mutate inputs, or change after caller mutation", () => {
    const trustedReview = cloneReview();
    const lineage = lineageFixture();
    const reviewBefore = structuredClone(trustedReview);
    const lineageBefore = structuredClone(lineage);
    const result = identity({ trustedReview, lineage });

    expect(trustedReview).toEqual(reviewBefore);
    expect(lineage).toEqual(lineageBefore);
    trustedReview.providerAnalysis.content.summary.text = "changed later";
    lineage.sourceSnapshotContentHash = "changed later";

    expect(result).toEqual(identity({ trustedReview: reviewBefore, lineage: lineageBefore }));
  });

  it("adds no tenant, procedimento, actor, review event, clock, or persistence identity", () => {
    const serialized = identity().canonicalPayload;

    for (const forbidden of [
      "tenantId", "enteId", "procedimentoId", "actorId", "userId",
      "COMPANY_ACCEPTED", "occurredAt", "generatedAt", "materialId",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});