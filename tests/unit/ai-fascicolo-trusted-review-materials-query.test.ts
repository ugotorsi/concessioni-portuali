import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import type { AiFascicoloTrustedReviewV1 } from "@/server/ai/fascicoloTrustedReview";
import {
  buildAiFascicoloTrustedReviewMaterialIdentityV1,
  type AiFascicoloTrustedReviewLineageV1,
} from "@/server/ai/fascicoloTrustedReviewIdentity";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCurrentTenantContext: vi.fn(),
  requireTenantAccess: vi.fn(),
  transaction: vi.fn(),
  procedimentoFindUnique: vi.fn(),
  materialFindMany: vi.fn(),
  globalProcedimentoFindUnique: vi.fn(),
  globalMaterialFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentUser: mocks.getCurrentUser };
});
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: mocks.getCurrentTenantContext,
  requireTenantAccess: mocks.requireTenantAccess,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    procedimento: { findUnique: mocks.globalProcedimentoFindUnique },
    aiFascicoloTrustedReviewMaterial: { findMany: mocks.globalMaterialFindMany },
  },
}));

import {
  AiFascicoloTrustedReviewMaterialsQueryError,
  getAiFascicoloTrustedReviewMaterialsReadModel,
} from "@/server/queries/ai-fascicolo-trusted-review-materials";

const source = readFileSync(
  resolve(process.cwd(), "src/server/queries/ai-fascicolo-trusted-review-materials.ts"),
  "utf8",
);

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

function materialFixture(overrides: Record<string, unknown> = {}) {
  const trustedReview = trustedReviewFixture();
  const lineage = lineageFixture();
  const identity = buildAiFascicoloTrustedReviewMaterialIdentityV1({ trustedReview, lineage });
  return {
    id: "material-1",
    enteId: "ente-1",
    procedimentoId: "procedimento-1",
    identityContractVersion: identity.schemaVersion,
    canonicalizationVersion: identity.canonicalizationVersion,
    fingerprintAlgorithm: identity.fingerprintAlgorithm,
    fingerprint: identity.fingerprint,
    canonicalPayload: identity.canonicalPayload,
    trustedReviewSchemaVersion: trustedReview.schemaVersion,
    ...lineage,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    ...overrides,
  };
}

function input() {
  return { procedimentoId: "procedimento-1" };
}

async function expectCode(operation: Promise<unknown>, code: string): Promise<void> {
  await operation.then(
    () => { throw new Error("Expected query error"); },
    (error: unknown) => {
      expect(error).toBeInstanceOf(AiFascicoloTrustedReviewMaterialsQueryError);
      expect((error as AiFascicoloTrustedReviewMaterialsQueryError).code).toBe(code);
      expect(error).not.toHaveProperty("cause");
    },
  );
}

describe("B2C8 Trusted Review Material Discovery Read Model V1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "operator@example.test",
      role: "GIURIDICO",
    });
    mocks.getCurrentTenantContext.mockResolvedValue({
      userId: "user-1",
      role: "GIURIDICO",
      isAdmin: false,
      accessibleTenantIds: ["ente-1"],
    });
    mocks.requireTenantAccess.mockImplementation(() => undefined);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      procedimento: { findUnique: mocks.procedimentoFindUnique },
      aiFascicoloTrustedReviewMaterial: { findMany: mocks.materialFindMany },
    }));
    mocks.procedimentoFindUnique.mockResolvedValue({
      id: "procedimento-1",
      concessione: { enteId: "ente-1" },
    });
    mocks.materialFindMany.mockResolvedValue([]);
  });

  it.each([
    null,
    [],
    {},
    { procedimentoId: "" },
    { procedimentoId: " " },
    { procedimentoId: "procedimento-1", enteId: "ente-1" },
    { procedimentoId: "procedimento-1", latest: true },
    { procedimentoId: "procedimento-1", limit: 10 },
  ])("rejects invalid or caller-authoritative input", async (value) => {
    await expectCode(getAiFascicoloTrustedReviewMaterialsReadModel(value), "INVALID_INPUT");
  });

  it("rejects prototype, accessor, and symbol input attacks", async () => {
    await expectCode(getAiFascicoloTrustedReviewMaterialsReadModel(Object.create({
      procedimentoId: "procedimento-1",
    })), "INVALID_INPUT");
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "procedimentoId", {
      enumerable: true,
      get: () => "procedimento-1",
    });
    await expectCode(getAiFascicoloTrustedReviewMaterialsReadModel(accessor), "INVALID_INPUT");
    const symbolInput = input() as Record<PropertyKey, unknown>;
    symbolInput[Symbol("authority")] = "ente-1";
    await expectCode(getAiFascicoloTrustedReviewMaterialsReadModel(symbolInput), "INVALID_INPUT");
  });

  it.each([
    [null, { userId: "user-1", role: "GIURIDICO", isAdmin: false, accessibleTenantIds: ["ente-1"] }],
    [{ id: "user-1", email: "operator@example.test", role: "GIURIDICO" }, null],
    [
      { id: "user-1", email: "operator@example.test", role: "GIURIDICO" },
      { userId: "user-2", role: "GIURIDICO", isAdmin: false, accessibleTenantIds: ["ente-1"] },
    ],
    [
      { id: "user-1", email: "viewer@example.test", role: "VIEWER_ADSP" },
      { userId: "user-1", role: "VIEWER_ADSP", isAdmin: false, accessibleTenantIds: ["ente-1"] },
    ],
  ])("fails closed for unauthenticated or unauthorized actor context", async (user, context) => {
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.getCurrentTenantContext.mockResolvedValue(context);
    await expectCode(getAiFascicoloTrustedReviewMaterialsReadModel(input()), "UNAUTHENTICATED_ACTOR");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("allows a representative backoffice role and uses canonical read authority", async () => {
    await getAiFascicoloTrustedReviewMaterialsReadModel(input());
    expect(mocks.requireTenantAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "ente-1",
      { mode: "read", allowWhenEnteMissing: false },
    );
    expect(mocks.procedimentoFindUnique).toHaveBeenCalledWith({
      where: { id: "procedimento-1" },
      select: {
        id: true,
        concessione: { select: { enteId: true } },
      },
    });
  });

  it("uses the same public result for missing and tenant-denied procedimento", async () => {
    mocks.procedimentoFindUnique.mockResolvedValueOnce(null);
    await expectCode(
      getAiFascicoloTrustedReviewMaterialsReadModel(input()),
      "PROCEDIMENTO_NOT_FOUND",
    );
    mocks.requireTenantAccess.mockImplementationOnce(() => { throw new Error("private tenant"); });
    await expectCode(
      getAiFascicoloTrustedReviewMaterialsReadModel(input()),
      "PROCEDIMENTO_NOT_FOUND",
    );
    expect(mocks.materialFindMany).not.toHaveBeenCalled();
  });

  it("fails closed for an invalid canonical tenant linkage", async () => {
    mocks.procedimentoFindUnique.mockResolvedValue({
      id: "procedimento-1",
      concessione: { enteId: null },
    });
    await expectCode(getAiFascicoloTrustedReviewMaterialsReadModel(input()), "TENANT_MISMATCH");
    expect(mocks.materialFindMany).not.toHaveBeenCalled();
  });

  it("returns an exact deeply frozen empty history", async () => {
    const result = await getAiFascicoloTrustedReviewMaterialsReadModel(input());
    expect(result).toEqual({ procedimentoId: "procedimento-1", materials: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.materials)).toBe(true);
  });

  it("projects one material minimally with ISO time and canonical statement order", async () => {
    mocks.materialFindMany.mockResolvedValue([materialFixture()]);
    const result = await getAiFascicoloTrustedReviewMaterialsReadModel(input());
    expect(result).toEqual({
      procedimentoId: "procedimento-1",
      materials: [{
        materialId: "material-1",
        createdAt: "2026-09-01T10:00:00.000Z",
        statementPaths: ["summary", "investigativeQuestions[0]"],
      }],
    });
    expect(Object.isFrozen(result.materials[0])).toBe(true);
    expect(Object.isFrozen(result.materials[0].statementPaths)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /enteId|tenantId|canonicalPayload|fingerprint|Hash|schemaVersion|actor|provider|model|outcome|reviewStatus/,
    );
  });

  it("requests history ordering by chronology then deterministic id tie-breaker", async () => {
    const sameTime = new Date("2026-09-01T10:00:00.000Z");
    mocks.materialFindMany.mockResolvedValue([
      materialFixture({ id: "material-z", createdAt: sameTime }),
      materialFixture({ id: "material-a", createdAt: sameTime }),
    ]);
    const result = await getAiFascicoloTrustedReviewMaterialsReadModel(input());
    expect(result.materials.map((material) => material.materialId)).toEqual([
      "material-z",
      "material-a",
    ]);
    expect(mocks.materialFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { procedimentoId: "procedimento-1", enteId: "ente-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }));
  });

  it.each([
    ["malformed envelope", { canonicalPayload: "{}" }],
    ["malformed trusted review", {
      canonicalPayload: JSON.stringify({ schemaVersion: "ai-fascicolo-trusted-review-material/v1", lineage: lineageFixture(), trustedReview: null }),
    }],
    ["identity mismatch", { fingerprint: "tampered" }],
    ["invalid timestamp", { createdAt: new Date("invalid") }],
  ])("rejects %s", async (_name, override) => {
    mocks.materialFindMany.mockResolvedValue([materialFixture(override)]);
    await expectCode(
      getAiFascicoloTrustedReviewMaterialsReadModel(input()),
      "INVALID_TRUSTED_MATERIAL",
    );
  });

  it("fails the whole query when any material is invalid", async () => {
    mocks.materialFindMany.mockResolvedValue([
      materialFixture(),
      materialFixture({ id: "material-2", fingerprint: "tampered" }),
    ]);
    await expectCode(
      getAiFascicoloTrustedReviewMaterialsReadModel(input()),
      "INVALID_TRUSTED_MATERIAL",
    );
  });

  it("maps unexpected reads to READ_FAILURE without leaking raw errors", async () => {
    mocks.materialFindMany.mockRejectedValue(new Error("SECRET_DATABASE_DETAIL"));
    try {
      await getAiFascicoloTrustedReviewMaterialsReadModel(input());
      throw new Error("Expected query error");
    } catch (error) {
      expect(error).toBeInstanceOf(AiFascicoloTrustedReviewMaterialsQueryError);
      expect((error as AiFascicoloTrustedReviewMaterialsQueryError).code).toBe("READ_FAILURE");
      expect((error as Error).message).toBe("READ_FAILURE");
      expect(error).not.toHaveProperty("cause");
      expect(JSON.stringify(error)).not.toContain("SECRET_DATABASE_DETAIL");
    }
  });

  it("uses one RepeatableRead snapshot and no global model reads", async () => {
    await getAiFascicoloTrustedReviewMaterialsReadModel(input());
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    expect(mocks.procedimentoFindUnique).toHaveBeenCalledTimes(1);
    expect(mocks.materialFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.globalProcedimentoFindUnique).not.toHaveBeenCalled();
    expect(mocks.globalMaterialFindMany).not.toHaveBeenCalled();
  });

  it("contains no Human Review, write, provider, UI, pagination, or administrative concern", () => {
    expect(source).not.toMatch(/aiFascicoloHumanReview|getAiFascicoloHumanReviewReadModel/);
    expect(source).not.toMatch(/\.(?:create|update|upsert|delete)\s*\(/);
    expect(source).not.toMatch(/OpenAI|openaiRuntime|process\.env|next\/cache|revalidatePath|revalidateTag/);
    expect(source).not.toMatch(/\b(?:take|cursor|limit|latestMaterial|currentMaterial)\b/);
    expect(source).not.toMatch(
      /\b(?:APPROVED|REJECTED|COMPLIANT|NON_COMPLIANT|REVOKED|RENEWED|SANCTIONED|ADMINISTRATIVE_DECISION)\b/,
    );
  });
});