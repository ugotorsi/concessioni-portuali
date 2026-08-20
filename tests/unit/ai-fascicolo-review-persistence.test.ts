import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const auditMock = vi.hoisted(() => vi.fn());
const serializableMock = vi.hoisted(() => vi.fn());
const identityBuilderMock = vi.hoisted(() => vi.fn());

const tx = vi.hoisted(() => ({
  aiFascicoloTrustedReviewMaterial: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
const reconciliationTx = vi.hoisted(() => ({
  aiFascicoloTrustedReviewMaterial: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: auditMock }));
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: serializableMock,
}));
vi.mock("@/server/ai/fascicoloTrustedReviewIdentity", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/ai/fascicoloTrustedReviewIdentity")>(),
  buildAiFascicoloTrustedReviewMaterialIdentityV1: identityBuilderMock,
}));

import { Prisma } from "@/generated/prisma/client";
import {
  AiFascicoloReviewPersistenceError,
  persistAiFascicoloTrustedReviewMaterial,
} from "@/server/ai/fascicoloReviewPersistence";

const lineage = {
  analysisSchemaVersion: "ai-fascicolo-analysis/v1",
  snapshotSchemaVersion: "ai-fascicolo-snapshot/v1",
  outboundSchemaVersion: "ai-fascicolo-outbound/v1",
  sourceSnapshotContentHash: "source-hash",
  outboundProjectionHash: "outbound-hash",
  outboundProjectionHashAlgorithm: "sha256",
};
const trustedReview = {
  schemaVersion: "ai-fascicolo-trusted-review/v1",
  purpose: "INTERNAL_COMPANY_PROFESSIONAL_REVIEW",
  providerAnalysis: {
    provenance: "AI_ORIGINAL",
    content: {
      summary: { text: "Summary", basisRefs: ["DOC_1"] },
      timeline: [],
      recordedState: [],
      signals: [],
      investigativeQuestions: [],
      suggestedActivities: [],
      legalResearchQuestions: [],
    },
  },
  statements: [{
    statementPath: "summary",
    providerStatement: {
      provenance: "AI_ORIGINAL",
      content: { text: "Summary", basisRefs: ["DOC_1"] },
    },
    resolutionStatus: "MISSING_LOCAL_EVIDENCE",
    evidence: [{
      providerRef: "DOC_1",
      referenceType: "ENTITY",
      alias: "DOC_1",
      kind: "DOCUMENT",
      canonicalId: "document-1",
      validatedFieldPath: null,
      resolutionStatus: "MISSING_LOCAL_EVIDENCE",
      local: null,
    }],
  }],
};
const canonicalPayload = JSON.stringify({
  schemaVersion: "ai-fascicolo-trusted-review-material/v1",
  lineage,
  trustedReview,
});
const identity = {
  schemaVersion: "ai-fascicolo-trusted-review-material/v1",
  canonicalizationVersion: "ai-fascicolo-canonical-json/v1",
  fingerprintAlgorithm: "sha256",
  fingerprint: "fingerprint-1",
  canonicalPayload,
};

function input(extra?: Record<string, unknown>): unknown {
  return { procedimentoId: "procedure-1", trustedReview, lineage, ...extra };
}

function row(overrides?: Record<string, unknown>) {
  return {
    id: "material-1",
    enteId: "ente-1",
    procedimentoId: "procedure-1",
    identityContractVersion: identity.schemaVersion,
    canonicalizationVersion: identity.canonicalizationVersion,
    fingerprintAlgorithm: identity.fingerprintAlgorithm,
    fingerprint: identity.fingerprint,
    canonicalPayload,
    trustedReviewSchemaVersion: trustedReview.schemaVersion,
    analysisSchemaVersion: lineage.analysisSchemaVersion,
    snapshotSchemaVersion: lineage.snapshotSchemaVersion,
    outboundSchemaVersion: lineage.outboundSchemaVersion,
    sourceSnapshotContentHash: lineage.sourceSnapshotContentHash,
    outboundProjectionHash: lineage.outboundProjectionHash,
    outboundProjectionHashAlgorithm: lineage.outboundProjectionHashAlgorithm,
    ...overrides,
  };
}

function expectCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({ code });
}

function p2002(target: unknown) {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "7.8.0",
    meta: { target },
  });
}

function p2002PrismaPg(overrides: {
  modelName?: unknown;
  kind?: unknown;
  originalCode?: unknown;
  fields?: unknown;
} = {}) {
  const modelName = Object.prototype.hasOwnProperty.call(overrides, "modelName")
    ? overrides.modelName
    : "AiFascicoloTrustedReviewMaterial";
  const kind = Object.prototype.hasOwnProperty.call(overrides, "kind")
    ? overrides.kind
    : "UniqueConstraintViolation";
  const originalCode = Object.prototype.hasOwnProperty.call(overrides, "originalCode")
    ? overrides.originalCode
    : "23505";
  const fields = Object.prototype.hasOwnProperty.call(overrides, "fields")
    ? overrides.fields
    : identityFields;

  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "7.8.0",
    meta: {
      modelName,
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          kind,
          constraint: { fields },
          originalCode,
          originalMessage: "redacted",
        },
      },
    },
  });
}

class RuntimeDriverAdapterError {
  readonly name = "DriverAdapterError";

  constructor(readonly cause: Record<string, unknown>) {}
}

function p2002PrismaPgRuntimeShape() {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "7.8.0",
    meta: {
      modelName: "AiFascicoloTrustedReviewMaterial",
      driverAdapterError: new RuntimeDriverAdapterError({
        kind: "UniqueConstraintViolation",
        constraint: { fields: identityFields },
        originalCode: "23505",
        originalMessage: "redacted",
      }),
    },
  });
}
const identityFields = [
  "enteId",
  "procedimentoId",
  "identityContractVersion",
  "canonicalizationVersion",
  "fingerprintAlgorithm",
  "fingerprint",
];

describe("trusted review material persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.procedimento.findUnique.mockResolvedValue({
      id: "procedure-1",
      concessione: { enteId: "ente-1" },
    });
    getCurrentTenantContextMock.mockResolvedValue({
      role: "ADMIN",
      isAdmin: true,
      accessibleTenantIds: [],
    });
    requireTenantAccessMock.mockReturnValue(undefined);
    identityBuilderMock.mockReturnValue(identity);
    tx.aiFascicoloTrustedReviewMaterial.findUnique.mockResolvedValue(null);
    tx.aiFascicoloTrustedReviewMaterial.create.mockResolvedValue(row());
    reconciliationTx.aiFascicoloTrustedReviewMaterial.findUnique.mockResolvedValue(row());
    auditMock.mockResolvedValue({});
    serializableMock.mockImplementation(async (callback) => callback(tx));
  });

  it.each([
    ["invalid trusted review", { procedimentoId: "procedure-1", trustedReview: null, lineage }],
    ["invalid lineage", { procedimentoId: "procedure-1", trustedReview, lineage: null }],
    ["caller enteId", input({ enteId: "attacker-tenant" })],
    ["blank procedimento", { procedimentoId: " ", trustedReview, lineage }],
  ])("rejects invalid input before database access: %s", async (_name, value) => {
    await expectCode(persistAiFascicoloTrustedReviewMaterial(value), "INVALID_INPUT");
    expect(prismaMock.procedimento.findUnique).not.toHaveBeenCalled();
  });

  it("rejects non-enumerable extra service input fields", async () => {
    const value = input() as Record<string, unknown>;
    Object.defineProperty(value, "enteId", { value: "attacker-tenant", enumerable: false });

    await expectCode(persistAiFascicoloTrustedReviewMaterial(value), "INVALID_INPUT");
    expect(prismaMock.procedimento.findUnique).not.toHaveBeenCalled();
  });

  it("maps a missing procedimento and missing canonical ownership deterministically", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValueOnce(null);
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "PROCEDIMENTO_NOT_FOUND");

    prismaMock.procedimento.findUnique.mockResolvedValueOnce({
      id: "procedure-1",
      concessione: { enteId: null },
    });
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "TENANT_MISMATCH");
  });

  it("requires tenant context and exact canonical write authorization before persistence", async () => {
    getCurrentTenantContextMock.mockResolvedValueOnce(null);
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "TENANT_CONTEXT_REQUIRED");
    expect(serializableMock).not.toHaveBeenCalled();

    getCurrentTenantContextMock.mockResolvedValueOnce({ role: "OPERATORE_SOCIETA", isAdmin: false, accessibleTenantIds: [] });
    requireTenantAccessMock.mockImplementationOnce(() => { throw new Error("denied"); });
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "FORBIDDEN");
    expect(requireTenantAccessMock).toHaveBeenLastCalledWith(
      expect.anything(),
      "ente-1",
      { mode: "write", allowWhenEnteMissing: false },
    );
    expect(tx.aiFascicoloTrustedReviewMaterial.create).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("maps tenant-context and identity-construction failures deterministically", async () => {
    getCurrentTenantContextMock.mockRejectedValueOnce(new Error("context failed"));
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "PERSISTENCE_FAILURE");
    expect(serializableMock).not.toHaveBeenCalled();

    getCurrentTenantContextMock.mockResolvedValueOnce({ role: "ADMIN", isAdmin: true, accessibleTenantIds: [] });
    identityBuilderMock.mockImplementationOnce(() => { throw new Error("identity failed"); });
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "INVALID_INPUT");
    expect(serializableMock).not.toHaveBeenCalled();
  });

  it("creates exact identity-derived data and audits with the same transaction", async () => {
    const result = await persistAiFascicoloTrustedReviewMaterial(input());

    expect(identityBuilderMock).toHaveBeenCalledWith({ trustedReview, lineage });
    expect(serializableMock).toHaveBeenCalledTimes(1);
    expect(tx.aiFascicoloTrustedReviewMaterial.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        enteId: "ente-1",
        procedimentoId: "procedure-1",
        identityContractVersion: identity.schemaVersion,
        canonicalizationVersion: identity.canonicalizationVersion,
        fingerprintAlgorithm: identity.fingerprintAlgorithm,
        fingerprint: identity.fingerprint,
        canonicalPayload,
        analysisSchemaVersion: lineage.analysisSchemaVersion,
      }),
      select: expect.any(Object),
    });
    expect(auditMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      metadata: expect.objectContaining({
        persistenceOutcome: "CREATED",
        raceReconciliation: false,
      }),
    }));
    const auditInput = auditMock.mock.calls[0][1];
    expect(JSON.stringify(auditInput)).not.toContain("canonicalPayload");
    expect(JSON.stringify(auditInput)).not.toContain("Summary");
    expect(result).toEqual({
      materialId: "material-1",
      enteId: "ente-1",
      procedimentoId: "procedure-1",
      fingerprint: "fingerprint-1",
      outcome: "CREATED",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(tx.aiFascicoloTrustedReviewMaterial.update).not.toHaveBeenCalled();
    expect(tx.aiFascicoloTrustedReviewMaterial.delete).not.toHaveBeenCalled();
  });

  it("maps audit failure to persistence failure without a second transaction", async () => {
    auditMock.mockRejectedValueOnce(new Error("audit failed"));
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "PERSISTENCE_FAILURE");
    expect(serializableMock).toHaveBeenCalledTimes(1);
  });

  it("strictly reuses an exactly equivalent existing material", async () => {
    tx.aiFascicoloTrustedReviewMaterial.findUnique.mockResolvedValueOnce(row());
    const result = await persistAiFascicoloTrustedReviewMaterial(input());

    expect(result.outcome).toBe("REUSED");
    expect(tx.aiFascicoloTrustedReviewMaterial.create).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      metadata: expect.objectContaining({ persistenceOutcome: "REUSED" }),
    }));
  });

  it.each([
    "enteId",
    "procedimentoId",
    "identityContractVersion",
    "canonicalizationVersion",
    "fingerprintAlgorithm",
    "fingerprint",
    "trustedReviewSchemaVersion",
    "analysisSchemaVersion",
    "snapshotSchemaVersion",
    "outboundSchemaVersion",
    "sourceSnapshotContentHash",
    "outboundProjectionHash",
    "outboundProjectionHashAlgorithm",
  ])("fails closed when persisted semantic field differs: %s", async (field) => {
    tx.aiFascicoloTrustedReviewMaterial.findUnique.mockResolvedValueOnce(row({ [field]: "different" }));
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "MATERIAL_IDENTITY_CONFLICT");
  });

  it("rejects a valid but semantically different canonical payload as an identity conflict", async () => {
    const differentReview = structuredClone(trustedReview);
    differentReview.providerAnalysis.content.summary.text = "Different valid summary";
    differentReview.statements[0].providerStatement.content.text = "Different valid summary";
    const differentPayload = JSON.stringify({
      schemaVersion: identity.schemaVersion,
      lineage,
      trustedReview: differentReview,
    });
    tx.aiFascicoloTrustedReviewMaterial.findUnique.mockResolvedValueOnce(
      row({ canonicalPayload: differentPayload }),
    );

    await expectCode(
      persistAiFascicoloTrustedReviewMaterial(input()),
      "MATERIAL_IDENTITY_CONFLICT",
    );
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["malformed", "{"],
    ["null envelope", "null"],
    ["array envelope", "[]"],
    ["missing field", JSON.stringify({ schemaVersion: identity.schemaVersion, lineage })],
    ["unexpected field", JSON.stringify({ schemaVersion: identity.schemaVersion, lineage, trustedReview, extra: true })],
    ["invalid trusted review", JSON.stringify({ schemaVersion: identity.schemaVersion, lineage, trustedReview: null })],
    ["invalid lineage", JSON.stringify({ schemaVersion: identity.schemaVersion, lineage: null, trustedReview })],
    ["wrong runtime type", 42],
  ])("rejects invalid persisted canonical payload: %s", async (_name, payload) => {
    tx.aiFascicoloTrustedReviewMaterial.findUnique.mockResolvedValueOnce(row({ canonicalPayload: payload }));
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "INVALID_CANONICAL_PAYLOAD");
  });

  it("reconciles one exact material-identity P2002 in a fresh transaction", async () => {
    tx.aiFascicoloTrustedReviewMaterial.create.mockRejectedValueOnce(p2002(identityFields));
    serializableMock
      .mockImplementationOnce(async (callback) => callback(tx))
      .mockImplementationOnce(async (callback) => callback(reconciliationTx));

    const result = await persistAiFascicoloTrustedReviewMaterial(input());

    expect(result.outcome).toBe("REUSED_AFTER_RACE");
    expect(serializableMock).toHaveBeenCalledTimes(2);
    expect(tx.aiFascicoloTrustedReviewMaterial.findUnique).toHaveBeenCalledTimes(1);
    expect(reconciliationTx.aiFascicoloTrustedReviewMaterial.findUnique).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledWith(reconciliationTx, expect.objectContaining({
      metadata: expect.objectContaining({
        persistenceOutcome: "REUSED_AFTER_RACE",
        raceReconciliation: true,
      }),
    }));
  });

  it("fails reconciliation for mismatch or missing material", async () => {
    tx.aiFascicoloTrustedReviewMaterial.create.mockRejectedValue(p2002(identityFields));
    serializableMock
      .mockImplementationOnce(async (callback) => callback(tx))
      .mockImplementationOnce(async (callback) => callback(reconciliationTx));
    reconciliationTx.aiFascicoloTrustedReviewMaterial.findUnique.mockResolvedValueOnce(
      row({ analysisSchemaVersion: "different" }),
    );
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "MATERIAL_IDENTITY_CONFLICT");

    vi.clearAllMocks();
    prismaMock.procedimento.findUnique.mockResolvedValue({ id: "procedure-1", concessione: { enteId: "ente-1" } });
    getCurrentTenantContextMock.mockResolvedValue({ role: "ADMIN", isAdmin: true, accessibleTenantIds: [] });
    identityBuilderMock.mockReturnValue(identity);
    tx.aiFascicoloTrustedReviewMaterial.findUnique.mockResolvedValue(null);
    tx.aiFascicoloTrustedReviewMaterial.create.mockRejectedValue(p2002(identityFields));
    reconciliationTx.aiFascicoloTrustedReviewMaterial.findUnique.mockResolvedValue(null);
    serializableMock
      .mockImplementationOnce(async (callback) => callback(tx))
      .mockImplementationOnce(async (callback) => callback(reconciliationTx));
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "PERSISTENCE_FAILURE");
    expect(serializableMock).toHaveBeenCalledTimes(2);
  });

  it("never treats unrelated P2002 as reuse", async () => {
    tx.aiFascicoloTrustedReviewMaterial.create.mockRejectedValueOnce(p2002(["id"]));
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "PERSISTENCE_FAILURE");
    expect(serializableMock).toHaveBeenCalledTimes(1);
    expect(reconciliationTx.aiFascicoloTrustedReviewMaterial.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a duplicated structured P2002 target instead of reconciling", async () => {
    tx.aiFascicoloTrustedReviewMaterial.create.mockRejectedValueOnce(
      p2002([...identityFields, "fingerprint"]),
    );
    await expectCode(persistAiFascicoloTrustedReviewMaterial(input()), "PERSISTENCE_FAILURE");
    expect(serializableMock).toHaveBeenCalledTimes(1);
  });

  it("accepts the exact generated selector name as a structured P2002 target", async () => {
    tx.aiFascicoloTrustedReviewMaterial.create.mockRejectedValueOnce(p2002(
      "enteId_procedimentoId_identityContractVersion_canonicalizationVersion_fingerprintAlgorithm_fingerprint",
    ));
    serializableMock
      .mockImplementationOnce(async (callback) => callback(tx))
      .mockImplementationOnce(async (callback) => callback(reconciliationTx));

    await expect(persistAiFascicoloTrustedReviewMaterial(input()))
      .resolves.toMatchObject({ outcome: "REUSED_AFTER_RACE" });
  });

  it("reconciles PrismaPg material P2002 without meta.target from exact structured fields", async () => {
    tx.aiFascicoloTrustedReviewMaterial.create.mockRejectedValueOnce(
      p2002PrismaPg(),
    );
    serializableMock
      .mockImplementationOnce(async (callback) => callback(tx))
      .mockImplementationOnce(async (callback) => callback(reconciliationTx));

    const result = await persistAiFascicoloTrustedReviewMaterial(input());

    expect(result.outcome).toBe("REUSED_AFTER_RACE");
    expect(serializableMock).toHaveBeenCalledTimes(2);
    expect(reconciliationTx.aiFascicoloTrustedReviewMaterial.findUnique).toHaveBeenCalledTimes(1);
  });

  it("reconciles runtime-shaped PrismaPg P2002 with a DriverAdapterError instance", async () => {
    tx.aiFascicoloTrustedReviewMaterial.create.mockRejectedValueOnce(
      p2002PrismaPgRuntimeShape(),
    );
    serializableMock
      .mockImplementationOnce(async (callback) => callback(tx))
      .mockImplementationOnce(async (callback) => callback(reconciliationTx));

    await expect(persistAiFascicoloTrustedReviewMaterial(input()))
      .resolves.toMatchObject({ outcome: "REUSED_AFTER_RACE" });
  });

  it("reconciles PrismaPg material P2002 when structured field identifiers are quoted", async () => {
    tx.aiFascicoloTrustedReviewMaterial.create.mockRejectedValueOnce(
      p2002PrismaPg({
        fields: identityFields.map((field) => `"${field}"`),
      }),
    );
    serializableMock
      .mockImplementationOnce(async (callback) => callback(tx))
      .mockImplementationOnce(async (callback) => callback(reconciliationTx));

    const result = await persistAiFascicoloTrustedReviewMaterial(input());

    expect(result.outcome).toBe("REUSED_AFTER_RACE");
    expect(serializableMock).toHaveBeenCalledTimes(2);
    expect(reconciliationTx.aiFascicoloTrustedReviewMaterial.findUnique).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong model", { modelName: "OtherModel" }],
    ["wrong constraint kind", { kind: "ForeignKeyConstraintViolation" }],
    ["wrong SQLSTATE", { originalCode: "23503" }],
    ["missing identity field", { fields: identityFields.slice(0, -1) }],
    ["extra identity field", { fields: [...identityFields, "id"] }],
    ["duplicate identity field", { fields: [...identityFields.slice(0, -1), "fingerprintAlgorithm"] }],
    ["non-string identity field", { fields: [...identityFields.slice(0, -1), 42] }],
    ["missing structured fields", { fields: undefined }],
  ])("never reconciles PrismaPg material P2002 with %s", async (_name, overrides) => {
    tx.aiFascicoloTrustedReviewMaterial.create.mockRejectedValueOnce(
      p2002PrismaPg(overrides),
    );

    await expectCode(
      persistAiFascicoloTrustedReviewMaterial(input()),
      "PERSISTENCE_FAILURE",
    );

    expect(serializableMock).toHaveBeenCalledTimes(1);
    expect(reconciliationTx.aiFascicoloTrustedReviewMaterial.findUnique).not.toHaveBeenCalled();
  });
  it("exposes deterministic persistence errors without payload content", () => {
    const error = new AiFascicoloReviewPersistenceError("PERSISTENCE_FAILURE", new Error("internal"));
    expect(error.message).toBe("PERSISTENCE_FAILURE");
    expect(error.message).not.toContain("Summary");
  });
});