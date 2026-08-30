import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import {
  AiFascicoloHumanReviewQueryError,
  getAiFascicoloHumanReviewReadModel,
} from "@/server/queries/ai-fascicolo-human-review";
import { buildAiFascicoloTrustedReviewMaterialIdentityV1 } from "@/server/ai/fascicoloTrustedReviewIdentity";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCurrentTenantContext: vi.fn(),
  requireTenantAccess: vi.fn(),
  transaction: vi.fn(),
  materialFindUnique: vi.fn(),
  stateFindUnique: vi.fn(),
  eventFindMany: vi.fn(),
  globalMaterialFindUnique: vi.fn(),
  globalStateFindUnique: vi.fn(),
  globalEventFindMany: vi.fn(),
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
    aiFascicoloTrustedReviewMaterial: { findUnique: mocks.globalMaterialFindUnique },
    aiFascicoloHumanReviewState: { findUnique: mocks.globalStateFindUnique },
    aiFascicoloHumanReviewEvent: { findMany: mocks.globalEventFindMany },
  },
}));

const trustedReview = {
  schemaVersion: "ai-fascicolo-trusted-review/v1" as const,
  purpose: "INTERNAL_COMPANY_PROFESSIONAL_REVIEW" as const,
  providerAnalysis: {
    provenance: "AI_ORIGINAL" as const,
    content: {
      summary: { text: "Provider statement DOC_1", basisRefs: ["DOC_1"] },
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
      provenance: "AI_ORIGINAL" as const,
      content: { text: "Provider statement DOC_1", basisRefs: ["DOC_1"] },
    },
    resolutionStatus: "RESOLVED" as const,
    evidence: [{
      providerRef: "DOC_1",
      referenceType: "ENTITY" as const,
      alias: "DOC_1",
      kind: "DOCUMENT" as const,
      canonicalId: "document-1",
      validatedFieldPath: null,
      resolutionStatus: "RESOLVED" as const,
      local: {
        provenance: "LOCAL_AUTHORITATIVE_DATA" as const,
        displayLabel: "Document 1",
        value: "authoritative value",
      },
    }],
  }],
};

const lineage = {
  analysisSchemaVersion: "analysis/v1",
  snapshotSchemaVersion: "snapshot/v1",
  outboundSchemaVersion: "outbound/v1",
  sourceSnapshotContentHash: "source-hash",
  outboundProjectionHash: "outbound-hash",
  outboundProjectionHashAlgorithm: "sha256",
};

function materialFixture() {
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
    procedimento: { id: "procedimento-1", concessione: { enteId: "ente-1" } },
  };
}

function stateFixture(version = 1, latestDisposition = "COMPANY_ACCEPTED") {
  return {
    id: "state-1",
    materialId: "material-1",
    enteId: "ente-1",
    procedimentoId: "procedimento-1",
    statementPath: "summary",
    version,
    latestDisposition,
    internalOnly: "excluded",
  };
}

function eventFixture(sequence = 1, disposition = "COMPANY_ACCEPTED") {
  const accepted = disposition === "COMPANY_ACCEPTED";
  const amended = disposition === "COMPANY_AMENDED";
  return {
    id: `event-${sequence}`,
    stateId: "state-1",
    materialId: "material-1",
    enteId: "ente-1",
    procedimentoId: "procedimento-1",
    statementPath: "summary",
    sequence,
    disposition,
    humanUserId: "user-1",
    actorIdSnapshot: "user-1",
    actorEmailSnapshot: "operator@example.test",
    actorRoleSnapshot: "GIURIDICO",
    occurredAt: new Date(`2026-08-30T10:00:0${sequence}.000Z`),
    note: accepted ? "Reviewed" : null,
    reason: accepted ? null : amended ? "Amend reason" : "Needs evidence",
    amendmentText: amended ? "Amended text" : null,
    idempotencyKey: `secret-key-${sequence}`,
    commandFingerprint: `fingerprint-${sequence}`,
    createdAt: new Date(),
  };
}

function input() {
  return { materialId: "material-1", statementPath: "summary" };
}

async function expectCode(operation: Promise<unknown>, code: string): Promise<void> {
  await operation.then(
    () => { throw new Error("Expected query error"); },
    (error: unknown) => {
      expect(error).toBeInstanceOf(AiFascicoloHumanReviewQueryError);
      expect((error as AiFascicoloHumanReviewQueryError).code).toBe(code);
    },
  );
}

describe("B2C3 Human Review Read Model V1", () => {
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
    mocks.transaction.mockImplementation(async (
      callback: (tx: unknown) => Promise<unknown>,
    ) => callback({
      aiFascicoloTrustedReviewMaterial: { findUnique: mocks.materialFindUnique },
      aiFascicoloHumanReviewState: { findUnique: mocks.stateFindUnique },
      aiFascicoloHumanReviewEvent: { findMany: mocks.eventFindMany },
    }));
    mocks.materialFindUnique.mockResolvedValue(materialFixture());
    mocks.stateFindUnique.mockResolvedValue(null);
    mocks.eventFindMany.mockResolvedValue([]);
  });

  it.each([
    null,
    [],
    {},
    { materialId: "", statementPath: "summary" },
    { materialId: "material-1", statementPath: "" },
    { materialId: "material-1", statementPath: "summary", enteId: "ente-1" },
    { materialId: "material-1", statementPath: "summary", actor: "user-1" },
  ])("rejects invalid or caller-authoritative input", async (value) => {
    await expectCode(getAiFascicoloHumanReviewReadModel(value), "INVALID_INPUT");
  });

  it("rejects prototype, accessor, and symbol input tricks", async () => {
    await expectCode(getAiFascicoloHumanReviewReadModel(Object.create({
      materialId: "material-1",
      statementPath: "summary",
    })), "INVALID_INPUT");
    const accessor = { statementPath: "summary" } as Record<string, unknown>;
    Object.defineProperty(accessor, "materialId", { enumerable: true, get: () => "material-1" });
    await expectCode(getAiFascicoloHumanReviewReadModel(accessor), "INVALID_INPUT");
    const symbolInput = input() as Record<PropertyKey, unknown>;
    symbolInput[Symbol("authority")] = "ente-1";
    await expectCode(getAiFascicoloHumanReviewReadModel(symbolInput), "INVALID_INPUT");
  });

  it("fails closed without an authenticated company actor", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expectCode(getAiFascicoloHumanReviewReadModel(input()), "UNAUTHENTICATED_ACTOR");
  });

  it.each(["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO", "TECNICO", "ECONOMICO"] as const)(
    "allows internal company role %s",
    async (role) => {
      mocks.getCurrentUser.mockResolvedValue({ id: "user-1", email: "operator@example.test", role });
      const result = await getAiFascicoloHumanReviewReadModel(input());
      expect(result.reviewStatus).toBe("UNREVIEWED");
    },
  );

  it("rejects VIEWER_ADSP and mismatched tenant identity", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1", email: "viewer@example.test", role: "VIEWER_ADSP" });
    await expectCode(getAiFascicoloHumanReviewReadModel(input()), "UNAUTHENTICATED_ACTOR");
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1", email: "operator@example.test", role: "GIURIDICO" });
    mocks.getCurrentTenantContext.mockResolvedValue({
      userId: "user-2", role: "GIURIDICO", isAdmin: false, accessibleTenantIds: ["ente-1"],
    });
    await expectCode(getAiFascicoloHumanReviewReadModel(input()), "UNAUTHENTICATED_ACTOR");
  });

  it("fails closed for a missing material or inconsistent canonical tenant", async () => {
    mocks.materialFindUnique.mockResolvedValueOnce(null);
    await expectCode(getAiFascicoloHumanReviewReadModel(input()), "MATERIAL_NOT_FOUND");
    mocks.materialFindUnique.mockResolvedValueOnce({ ...materialFixture(), enteId: "ente-other" });
    await expectCode(getAiFascicoloHumanReviewReadModel(input()), "TENANT_MISMATCH");
  });

  it("authorizes the DB-derived canonical tenant in read mode", async () => {
    await getAiFascicoloHumanReviewReadModel(input());
    expect(mocks.requireTenantAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "ente-1",
      { mode: "read", allowWhenEnteMissing: false },
    );
    expect(mocks.materialFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "material-1" },
    }));
  });

  it("uses one RepeatableRead transaction snapshot for all DB reads", async () => {
    mocks.globalMaterialFindUnique.mockResolvedValue({ ...materialFixture(), enteId: "changed-ente" });
    mocks.globalStateFindUnique.mockResolvedValue(stateFixture(2, "COMPANY_REJECTED"));
    mocks.globalEventFindMany.mockResolvedValue([eventFixture(), eventFixture(2, "COMPANY_REJECTED")]);

    const result = await getAiFascicoloHumanReviewReadModel(input());

    expect(result.reviewStatus).toBe("UNREVIEWED");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    expect(mocks.materialFindUnique).toHaveBeenCalledTimes(1);
    expect(mocks.stateFindUnique).toHaveBeenCalledTimes(1);
    expect(mocks.eventFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.globalMaterialFindUnique).not.toHaveBeenCalled();
    expect(mocks.globalStateFindUnique).not.toHaveBeenCalled();
    expect(mocks.globalEventFindMany).not.toHaveBeenCalled();
  });

  it("fails closed when tenant access is denied", async () => {
    mocks.requireTenantAccess.mockImplementation(() => { throw new Error("denied"); });
    await expectCode(getAiFascicoloHumanReviewReadModel(input()), "TENANT_MISMATCH");
  });

  it("rejects invalid trusted material and an unknown statement target", async () => {
    mocks.materialFindUnique.mockResolvedValueOnce({ ...materialFixture(), fingerprint: "tampered" });
    await expectCode(getAiFascicoloHumanReviewReadModel(input()), "INVALID_TRUSTED_MATERIAL");
    await expectCode(getAiFascicoloHumanReviewReadModel({
      materialId: "material-1", statementPath: "timeline[0]",
    }), "STATEMENT_NOT_FOUND");
  });

  it("returns an immutable minimized UNREVIEWED projection without writes", async () => {
    const result = await getAiFascicoloHumanReviewReadModel(input());
    expect(result).toMatchObject({
      material: { id: "material-1", procedimentoId: "procedimento-1", statementPath: "summary" },
      reviewStatus: "UNREVIEWED",
      currentState: null,
      history: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.material.target)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/fingerprint|canonicalPayload|idempotency|state-1/);
    expect(mocks.stateFindUnique).toHaveBeenCalledTimes(1);
    expect(mocks.eventFindMany).toHaveBeenCalledTimes(1);
  });

  it("returns one coherent event and current state", async () => {
    mocks.stateFindUnique.mockResolvedValue(stateFixture());
    mocks.eventFindMany.mockResolvedValue([eventFixture()]);
    const result = await getAiFascicoloHumanReviewReadModel(input());
    expect(result).toMatchObject({
      reviewStatus: "REVIEWED",
      currentState: { version: 1, status: "COMPANY_ACCEPTED", latestEventId: "event-1" },
      history: [{
        id: "event-1",
        sequence: 1,
        disposition: "COMPANY_ACCEPTED",
        actor: { id: "user-1", role: "GIURIDICO" },
        note: "Reviewed",
      }],
    });
    expect(result.currentState).toMatchObject({
      disposition: "COMPANY_ACCEPTED",
      note: "Reviewed",
      actor: { id: "user-1", role: "GIURIDICO" },
    });
  });

  it.each([
    ["COMPANY_ACCEPTED", { note: "Reviewed" }],
    ["COMPANY_REJECTED", { reason: "Needs evidence" }],
    ["COMPANY_NEEDS_VERIFICATION", { reason: "Needs evidence" }],
    ["COMPANY_AMENDED", { amendment: { text: "Amended text", reason: "Amend reason" } }],
  ])("projects the complete current review payload for %s", async (disposition, payload) => {
    mocks.stateFindUnique.mockResolvedValue(stateFixture(1, disposition));
    mocks.eventFindMany.mockResolvedValue([eventFixture(1, disposition)]);

    const result = await getAiFascicoloHumanReviewReadModel(input());

    expect(result.currentState).toMatchObject({
      version: 1,
      status: disposition,
      latestEventId: "event-1",
      disposition,
      actor: { id: "user-1", role: "GIURIDICO" },
      occurredAt: "2026-08-30T10:00:01.000Z",
      ...payload,
    });
  });

  it("returns the full ordered history and requests sequence ASC", async () => {
    mocks.stateFindUnique.mockResolvedValue(stateFixture(2, "COMPANY_NEEDS_VERIFICATION"));
    mocks.eventFindMany.mockResolvedValue([
      eventFixture(1),
      eventFixture(2, "COMPANY_NEEDS_VERIFICATION"),
    ]);
    const result = await getAiFascicoloHumanReviewReadModel(input());
    expect(result.history.map((event) => event.sequence)).toEqual([1, 2]);
    expect(result.currentState).toEqual({
      version: 2,
      status: "COMPANY_NEEDS_VERIFICATION",
      latestEventId: "event-2",
      disposition: "COMPANY_NEEDS_VERIFICATION",
      actor: { id: "user-1", role: "GIURIDICO" },
      occurredAt: "2026-08-30T10:00:02.000Z",
      reason: "Needs evidence",
    });
    expect(mocks.eventFindMany).toHaveBeenCalledWith({
      where: {
        materialId: "material-1",
        statementPath: "summary",
        enteId: "ente-1",
        procedimentoId: "procedimento-1",
      },
      orderBy: { sequence: "asc" },
      select: expect.any(Object),
    });
  });

  it.each([
    ["gap", stateFixture(2, "COMPANY_NEEDS_VERIFICATION"), [eventFixture(1), eventFixture(3, "COMPANY_NEEDS_VERIFICATION")]],
    ["duplicate", stateFixture(2), [eventFixture(1), eventFixture(1)]],
    ["not starting at one", stateFixture(), [eventFixture(2)]],
    ["events without state", null, [eventFixture()]],
    ["state without events", stateFixture(), []],
    ["version mismatch", stateFixture(2), [eventFixture()]],
    ["latest disposition mismatch", stateFixture(1, "COMPANY_REJECTED"), [eventFixture()]],
  ])("fails closed for inconsistent history: %s", async (_name, state, events) => {
    mocks.stateFindUnique.mockResolvedValue(state);
    mocks.eventFindMany.mockResolvedValue(events);
    await expectCode(getAiFascicoloHumanReviewReadModel(input()), "INCONSISTENT_REVIEW_HISTORY");
  });

  it.each([
    ["accepted with reason", { ...eventFixture(), reason: "incompatible" }],
    ["accepted with amendment", { ...eventFixture(), amendmentText: "incompatible" }],
    ["rejected without reason", { ...eventFixture(1, "COMPANY_REJECTED"), reason: null }],
    ["rejected with amendment", { ...eventFixture(1, "COMPANY_REJECTED"), amendmentText: "incompatible" }],
    ["needs verification without reason", { ...eventFixture(1, "COMPANY_NEEDS_VERIFICATION"), reason: null }],
    ["amended without amendment", { ...eventFixture(1, "COMPANY_AMENDED"), amendmentText: null }],
    ["amended with incompatible note", { ...eventFixture(1, "COMPANY_AMENDED"), note: "incompatible" }],
  ])("fails closed for invalid event fields: %s", async (_name, event) => {
    mocks.stateFindUnique.mockResolvedValue(stateFixture(1, event.disposition));
    mocks.eventFindMany.mockResolvedValue([event]);
    await expectCode(getAiFascicoloHumanReviewReadModel(input()), "INCONSISTENT_REVIEW_HISTORY");
  });

  it("deep-freezes reviewed state, history, actor, and amendment projections", async () => {
    mocks.stateFindUnique.mockResolvedValue(stateFixture(1, "COMPANY_AMENDED"));
    mocks.eventFindMany.mockResolvedValue([eventFixture(1, "COMPANY_AMENDED")]);
    const result = await getAiFascicoloHumanReviewReadModel(input());
    const currentState = result.currentState!;
    const historyItem = result.history[0];

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.material)).toBe(true);
    expect(Object.isFrozen(result.material.target)).toBe(true);
    expect(Object.isFrozen(currentState)).toBe(true);
    expect(Object.isFrozen(currentState.actor)).toBe(true);
    expect(Object.isFrozen(currentState.amendment)).toBe(true);
    expect(Object.isFrozen(result.history)).toBe(true);
    expect(Object.isFrozen(historyItem)).toBe(true);
    expect(Object.isFrozen(historyItem.actor)).toBe(true);
    expect(Object.isFrozen(historyItem.amendment)).toBe(true);

    try {
      (historyItem.actor as { role: string }).role = "ADMIN";
      (historyItem.amendment as { text: string }).text = "mutated";
    } catch {
      // Frozen assignments throw in strict mode.
    }
    expect(historyItem.actor.role).toBe("GIURIDICO");
    expect(historyItem.amendment?.text).toBe("Amended text");
  });

  it("does not expose actor email in history or current state", async () => {
    mocks.stateFindUnique.mockResolvedValue(stateFixture());
    mocks.eventFindMany.mockResolvedValue([eventFixture()]);
    const result = await getAiFascicoloHumanReviewReadModel(input());

    expect(result.history[0].actor).toEqual({ id: "user-1", role: "GIURIDICO" });
    expect(result.currentState?.actor).toEqual({ id: "user-1", role: "GIURIDICO" });
    expect(JSON.stringify(result)).not.toContain("operator@example.test");
  });

  it("fails closed for cross-tenant state or event records", async () => {
    mocks.stateFindUnique.mockResolvedValue({ ...stateFixture(), enteId: "ente-other" });
    mocks.eventFindMany.mockResolvedValue([eventFixture()]);
    await expectCode(getAiFascicoloHumanReviewReadModel(input()), "INCONSISTENT_REVIEW_HISTORY");
    mocks.stateFindUnique.mockResolvedValue(stateFixture());
    mocks.eventFindMany.mockResolvedValue([{ ...eventFixture(), procedimentoId: "procedimento-other" }]);
    await expectCode(getAiFascicoloHumanReviewReadModel(input()), "INCONSISTENT_REVIEW_HISTORY");
  });

  it("maps read failures without exposing raw Prisma errors", async () => {
    mocks.materialFindUnique.mockRejectedValue(new Error("database secret"));
    await expectCode(getAiFascicoloHumanReviewReadModel(input()), "READ_FAILURE");
  });

  it("exposes no administrative outcome and has no write or audit dependency", async () => {
    mocks.stateFindUnique.mockResolvedValue(stateFixture());
    mocks.eventFindMany.mockResolvedValue([eventFixture()]);
    const serialized = JSON.stringify(await getAiFascicoloHumanReviewReadModel(input()));
    for (const forbidden of [
      "APPROVED", "DENIED", "VALID", "INVALID", "COMPLIANT", "NON_COMPLIANT",
      "REVOKED", "RENEWED", "DECIDED", "SANCTIONED",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(mocks)).toEqual(expect.arrayContaining([
      "materialFindUnique", "stateFindUnique", "eventFindMany",
    ]));
    expect(Object.keys(mocks)).not.toEqual(expect.arrayContaining([
      "create", "update", "upsert", "delete", "audit",
    ]));
  });
});