import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import {
  AiFascicoloHumanReviewPersistenceError,
  persistAiFascicoloHumanReview,
} from "@/server/ai/fascicoloHumanReviewPersistence";
import { buildAiFascicoloTrustedReviewMaterialIdentityV1 } from "@/server/ai/fascicoloTrustedReviewIdentity";
import type { AiFascicoloHumanReviewCommandV1 } from "@/server/ai/fascicoloHumanReview";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCurrentTenantContext: vi.fn(),
  requireTenantAccess: vi.fn(),
  createAuditLogInTransaction: vi.fn(),
  runSerializableTransactionWithRetry: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentUser: mocks.getCurrentUser };
});
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: mocks.getCurrentTenantContext,
  requireTenantAccess: mocks.requireTenantAccess,
}));
vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: mocks.createAuditLogInTransaction,
}));
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: mocks.runSerializableTransactionWithRetry,
}));

interface FakeState {
  id: string;
  materialId: string;
  enteId: string;
  procedimentoId: string;
  statementPath: string;
  version: number;
  latestDisposition: string | null;
}

interface FakeEvent {
  id: string;
  stateId: string;
  materialId: string;
  enteId: string;
  procedimentoId: string;
  statementPath: string;
  sequence: number;
  disposition: string;
  humanUserId: string;
  actorIdSnapshot: string;
  actorEmailSnapshot: string;
  actorRoleSnapshot: string;
  occurredAt: Date;
  note: string | null;
  reason: string | null;
  amendmentText: string | null;
  idempotencyKey: string;
  commandFingerprint: string;
}

interface FakeDatabase {
  material: ReturnType<typeof materialFixture> | null;
  states: FakeState[];
  events: FakeEvent[];
  audits: unknown[];
  nextStateId: number;
  nextEventId: number;
}

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
      investigativeQuestions: [{ text: "Question", basisRefs: [] }],
      suggestedActivities: [],
      legalResearchQuestions: [],
    },
  },
  statements: [
    {
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
    },
    {
      statementPath: "investigativeQuestions[0]",
      providerStatement: {
        provenance: "AI_ORIGINAL" as const,
        content: { text: "Question", basisRefs: [] },
      },
      resolutionStatus: "NO_BASIS_REFS" as const,
      evidence: [],
    },
  ],
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
    procedimento: {
      id: "procedimento-1",
      concessione: { enteId: "ente-1" },
    },
  };
}

function cloneDatabase(database: FakeDatabase): FakeDatabase {
  return structuredClone(database);
}

function replaceDatabase(target: FakeDatabase, source: FakeDatabase): void {
  target.material = source.material;
  target.states = source.states;
  target.events = source.events;
  target.audits = source.audits;
  target.nextStateId = source.nextStateId;
  target.nextEventId = source.nextEventId;
}

function transactionClient(database: FakeDatabase, options?: { conflictUpdateOnce?: { value: boolean } }) {
  return {
    __database: database,
    aiFascicoloTrustedReviewMaterial: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        database.material?.id === where.id ? database.material : null),
    },
    aiFascicoloHumanReviewState: {
      findUnique: vi.fn(async ({ where }: { where: { materialId_statementPath: { materialId: string; statementPath: string } } }) =>
        database.states.find((state) =>
          state.materialId === where.materialId_statementPath.materialId
          && state.statementPath === where.materialId_statementPath.statementPath) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<FakeState, "id" | "latestDisposition"> }) => {
        const state: FakeState = {
          ...data,
          id: `state-${database.nextStateId++}`,
          latestDisposition: null,
        };
        database.states.push(state);
        return state;
      }),
      updateMany: vi.fn(async ({ where, data }: {
        where: { id: string; version: number };
        data: { version: { increment: number }; latestDisposition: string };
      }) => {
        if (options?.conflictUpdateOnce?.value) {
          options.conflictUpdateOnce.value = false;
          return { count: 0 };
        }
        const state = database.states.find((item) => item.id === where.id && item.version === where.version);
        if (!state) {
          return { count: 0 };
        }
        state.version += data.version.increment;
        state.latestDisposition = data.latestDisposition;
        return { count: 1 };
      }),
    },
    aiFascicoloHumanReviewEvent: {
      findUnique: vi.fn(async ({ where }: { where: { enteId_idempotencyKey: { enteId: string; idempotencyKey: string } } }) =>
        database.events.find((event) =>
          event.enteId === where.enteId_idempotencyKey.enteId
          && event.idempotencyKey === where.enteId_idempotencyKey.idempotencyKey) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<FakeEvent, "id"> }) => {
        const event: FakeEvent = { ...data, id: `event-${database.nextEventId++}` };
        database.events.push(event);
        return event;
      }),
    },
  };
}

function input(command: AiFascicoloHumanReviewCommandV1 = { disposition: "COMPANY_ACCEPTED" }, idempotencyKey = "review-key-1") {
  return {
    materialId: "material-1",
    statementPath: "summary",
    idempotencyKey,
    command,
  };
}

function expectCode(operation: Promise<unknown>, code: string): Promise<void> {
  return operation.then(
    () => { throw new Error("Expected persistence error"); },
    (error: unknown) => {
      expect(error).toBeInstanceOf(AiFascicoloHumanReviewPersistenceError);
      expect((error as AiFascicoloHumanReviewPersistenceError).code).toBe(code);
    },
  );
}

function p2002(meta: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique constraint", {
    code: "P2002",
    clientVersion: "test",
    meta,
  });
}

class DriverAdapterErrorFixture {
  constructor(readonly cause: unknown) {}
}

function prismaPgP2002(input: {
  modelName: string;
  fields?: unknown;
  kind?: string;
  originalCode?: string;
}): Prisma.PrismaClientKnownRequestError {
  return p2002({
    modelName: input.modelName,
    driverAdapterError: new DriverAdapterErrorFixture({
      kind: input.kind ?? "UniqueConstraintViolation",
      originalCode: input.originalCode ?? "23505",
      constraint: { fields: input.fields ?? [] },
    }),
  });
}

describe("B2C2 Human Review Persistence V1", () => {
  let database: FakeDatabase;
  let conflictUpdateOnce: { value: boolean };

  beforeEach(() => {
    vi.clearAllMocks();
    database = {
      material: materialFixture(),
      states: [],
      events: [],
      audits: [],
      nextStateId: 1,
      nextEventId: 1,
    };
    conflictUpdateOnce = { value: false };
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "operator@example.test",
      role: "GIURIDICO",
    });
    mocks.getCurrentTenantContext.mockResolvedValue({
      userId: "user-1",
      role: "GIURIDICO",
      isAdmin: false,
      tenantMemberships: [],
      defaultTenantId: "ente-1",
      accessibleTenantIds: ["ente-1"],
    });
    mocks.requireTenantAccess.mockImplementation(() => undefined);
    mocks.createAuditLogInTransaction.mockImplementation(async (tx, auditInput) => {
      tx.__database.audits.push(auditInput);
    });
    mocks.runSerializableTransactionWithRetry.mockImplementation(async (callback) => {
      const draft = cloneDatabase(database);
      const result = await callback(transactionClient(draft, { conflictUpdateOnce }));
      replaceDatabase(database, draft);
      return result;
    });
  });

  it.each([
    null,
    {},
    { materialId: "", statementPath: "summary", idempotencyKey: "key", command: { disposition: "COMPANY_ACCEPTED" } },
  ])("rejects invalid input", async (value) => {
    await expectCode(persistAiFascicoloHumanReview(value), "INVALID_INPUT");
  });

  it("rejects caller-supplied actor authority", async () => {
    await expectCode(persistAiFascicoloHumanReview({
      ...input(),
      actor: { userId: "attacker", actorId: "attacker", email: "attacker@example.test", role: "ADMIN" },
    }), "INVALID_INPUT");
  });

  it("fails closed without an authenticated internal company actor", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expectCode(persistAiFascicoloHumanReview(input()), "UNAUTHENTICATED_ACTOR");

    mocks.getCurrentUser.mockResolvedValue({ id: "viewer", email: "viewer@example.test", role: "VIEWER_ADSP" });
    mocks.getCurrentTenantContext.mockResolvedValue({
      userId: "viewer", role: "VIEWER_ADSP", isAdmin: false, tenantMemberships: [], defaultTenantId: "ente-1", accessibleTenantIds: ["ente-1"],
    });
    await expectCode(persistAiFascicoloHumanReview(input()), "UNAUTHENTICATED_ACTOR");
  });

  it.each(["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO", "TECNICO", "ECONOMICO"] as const)(
    "allows approved application role %s",
    async (role) => {
      mocks.getCurrentUser.mockResolvedValue({ id: "user-1", email: "operator@example.test", role });
      mocks.getCurrentTenantContext.mockResolvedValue({
        userId: "user-1", role, isAdmin: role === "ADMIN", tenantMemberships: [], defaultTenantId: "ente-1", accessibleTenantIds: ["ente-1"],
      });

      await expect(persistAiFascicoloHumanReview(input())).resolves.toMatchObject({ outcome: "APPLIED" });
    },
  );

  it("fails closed when current user and tenant context identify different users", async () => {
    mocks.getCurrentTenantContext.mockResolvedValue({
      userId: "user-other", role: "GIURIDICO", isAdmin: false, tenantMemberships: [], defaultTenantId: "ente-1", accessibleTenantIds: ["ente-1"],
    });
    await expectCode(persistAiFascicoloHumanReview(input()), "UNAUTHENTICATED_ACTOR");
  });

  it.each([
    { disposition: "COMPANY_ACCEPTED", extra: true },
    { disposition: "COMPANY_REJECTED", reason: "R", extra: true },
    { disposition: "COMPANY_NEEDS_VERIFICATION", reason: "R", extra: true },
    { disposition: "COMPANY_AMENDED", amendment: { text: "A", reason: "R" }, extra: true },
    { disposition: "COMPANY_AMENDED", amendment: { text: "A", reason: "R", extra: true } },
  ])("rejects command fields outside the domain shape: $disposition", async (command) => {
    await expectCode(persistAiFascicoloHumanReview(input(
      command as unknown as AiFascicoloHumanReviewCommandV1,
    )), "INVALID_INPUT");
  });

  it("rejects a missing material", async () => {
    database.material = null;
    await expectCode(persistAiFascicoloHumanReview(input()), "MATERIAL_NOT_FOUND");
  });

  it("derives canonical ownership and rejects tenant mismatch", async () => {
    mocks.requireTenantAccess.mockImplementation(() => { throw new Error("denied"); });
    await expectCode(persistAiFascicoloHumanReview(input()), "TENANT_MISMATCH");
    expect(mocks.requireTenantAccess).toHaveBeenCalledWith(expect.anything(), "ente-1", {
      mode: "write",
      allowWhenEnteMissing: false,
    });
  });

  it("rejects an inconsistent persisted tenant", async () => {
    database.material = { ...materialFixture(), enteId: "ente-other" };
    await expectCode(persistAiFascicoloHumanReview(input()), "TENANT_MISMATCH");
  });

  it("rejects invalid trusted material and unknown statement paths", async () => {
    database.material = { ...materialFixture(), canonicalPayload: "{}" };
    await expectCode(persistAiFascicoloHumanReview(input()), "INVALID_TRUSTED_MATERIAL");

    database.material = materialFixture();
    await expectCode(persistAiFascicoloHumanReview({ ...input(), statementPath: "timeline[99]" }), "STATEMENT_NOT_FOUND");
  });

  it.each([
    { disposition: "COMPANY_ACCEPTED" as const, note: "Usabile internamente" },
    { disposition: "COMPANY_REJECTED" as const, reason: "Non supportato" },
    { disposition: "COMPANY_NEEDS_VERIFICATION" as const, reason: "Verifica necessaria" },
    { disposition: "COMPANY_AMENDED" as const, amendment: { text: "Testo aziendale", reason: "Correzione" } },
  ])("applies the domain disposition $disposition with authenticated actor snapshots", async (command) => {
    const applied = await persistAiFascicoloHumanReview(input(command));

    expect(applied.outcome).toBe("APPLIED");
    expect(applied.event).toMatchObject({ sequence: 1, disposition: command.disposition });
    expect(applied.state).toMatchObject({ version: 1, latestDisposition: command.disposition });
    expect(database.events[0]).toMatchObject({
      humanUserId: "user-1",
      actorIdSnapshot: "user-1",
      actorEmailSnapshot: "operator@example.test",
      actorRoleSnapshot: "GIURIDICO",
    });
    expect(database.audits).toHaveLength(1);
  });

  it("appends events and advances only the current-state projection", async () => {
    await persistAiFascicoloHumanReview(input({ disposition: "COMPANY_ACCEPTED" }, "key-1"));
    const firstEvent = structuredClone(database.events[0]);
    const second = await persistAiFascicoloHumanReview(input({
      disposition: "COMPANY_AMENDED",
      amendment: { text: "Integrazione", reason: "Precisazione" },
    }, "key-2"));

    expect(second.event.sequence).toBe(2);
    expect(second.state).toMatchObject({ version: 2, latestDisposition: "COMPANY_AMENDED" });
    expect(database.states).toHaveLength(1);
    expect(database.events).toHaveLength(2);
    expect(database.events[0]).toEqual(firstEvent);
  });

  it("reuses the same idempotency key and fingerprint without event, state, or audit duplication", async () => {
    const applied = await persistAiFascicoloHumanReview(input());
    const reused = await persistAiFascicoloHumanReview(input());

    expect(applied.outcome).toBe("APPLIED");
    expect(reused).toMatchObject({
      outcome: "REUSED",
      event: { id: applied.event.id, sequence: 1 },
      state: { id: applied.state.id, version: 1 },
    });
    expect(database.events).toHaveLength(1);
    expect(database.states[0].version).toBe(1);
    expect(database.audits).toHaveLength(1);
  });

  it("reuses semantically equal commands regardless of caller property order", async () => {
    const first = { disposition: "COMPANY_ACCEPTED", note: "Nota" } as const;
    const reordered = { note: "Nota", disposition: "COMPANY_ACCEPTED" } as const;

    const applied = await persistAiFascicoloHumanReview(input(first));
    const reused = await persistAiFascicoloHumanReview(input(reordered));

    expect(applied.outcome).toBe("APPLIED");
    expect(reused.outcome).toBe("REUSED");
    expect(database.events).toHaveLength(1);
  });

  it("fails closed when an idempotency key is reused for a different command", async () => {
    await persistAiFascicoloHumanReview(input());
    await expectCode(persistAiFascicoloHumanReview(input({
      disposition: "COMPANY_REJECTED",
      reason: "Different command",
    })), "IDEMPOTENCY_CONFLICT");
    expect(database.events).toHaveLength(1);
    expect(database.audits).toHaveLength(1);
  });

  it("rolls back event and state when atomic audit fails", async () => {
    mocks.createAuditLogInTransaction.mockRejectedValue(new Error("audit failed"));
    await expectCode(persistAiFascicoloHumanReview(input()), "PERSISTENCE_FAILURE");
    expect(database.events).toHaveLength(0);
    expect(database.states).toHaveLength(0);
    expect(database.audits).toHaveLength(0);
  });

  it("fails closed on persistence errors", async () => {
    mocks.runSerializableTransactionWithRetry.mockRejectedValue(new Error("database unavailable"));
    await expectCode(persistAiFascicoloHumanReview(input()), "PERSISTENCE_FAILURE");
  });

  it("retries a projection race in a new transaction without losing an update", async () => {
    conflictUpdateOnce.value = true;
    const applied = await persistAiFascicoloHumanReview(input());

    expect(applied).toMatchObject({ outcome: "APPLIED", event: { sequence: 1 }, state: { version: 1 } });
    expect(mocks.runSerializableTransactionWithRetry).toHaveBeenCalledTimes(2);
    expect(database.events).toHaveLength(1);
    expect(database.states).toHaveLength(1);
  });

  it("serializes two calls and reuses one idempotency event deterministically", async () => {
    let queue = Promise.resolve();
    mocks.runSerializableTransactionWithRetry.mockImplementation((callback) => {
      const operation = queue.then(async () => {
        const draft = cloneDatabase(database);
        const result = await callback(transactionClient(draft));
        replaceDatabase(database, draft);
        return result;
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    });

    const results = await Promise.all([
      persistAiFascicoloHumanReview(input()),
      persistAiFascicoloHumanReview(input()),
    ]);
    expect(results.map((item) => item.outcome).sort()).toEqual(["APPLIED", "REUSED"]);
    expect(database.events).toHaveLength(1);
    expect(database.states).toHaveLength(1);
    expect(database.states[0].version).toBe(1);
  });

  it.each([
    ["state selector", p2002({ modelName: "AiFascicoloHumanReviewState", target: "materialId_statementPath" })],
    ["state field array", p2002({ modelName: "AiFascicoloHumanReviewState", target: ["statementPath", "materialId"] })],
    ["event idempotency field array", p2002({ modelName: "AiFascicoloHumanReviewEvent", target: ["idempotencyKey", "enteId"] })],
    ["event sequence field array", p2002({ modelName: "AiFascicoloHumanReviewEvent", target: ["sequence", "materialId", "statementPath"] })],
    ["PrismaPg state", prismaPgP2002({ modelName: "AiFascicoloHumanReviewState", fields: ['"materialId"', '"statementPath"'] })],
    ["PrismaPg event idempotency", prismaPgP2002({ modelName: "AiFascicoloHumanReviewEvent", fields: ['"enteId"', '"idempotencyKey"'] })],
    ["PrismaPg event sequence", prismaPgP2002({ modelName: "AiFascicoloHumanReviewEvent", fields: ['"materialId"', '"statementPath"', '"sequence"'] })],
  ])("reconciles recognized %s P2002 in a fresh transaction", async (_name, error) => {
    mocks.runSerializableTransactionWithRetry.mockRejectedValueOnce(error);

    await expect(persistAiFascicoloHumanReview(input())).resolves.toMatchObject({ outcome: "APPLIED" });

    expect(mocks.runSerializableTransactionWithRetry).toHaveBeenCalledTimes(2);
    expect(mocks.runSerializableTransactionWithRetry.mock.calls[0][0])
      .not.toBe(mocks.runSerializableTransactionWithRetry.mock.calls[1][0]);
  });

  it.each([
    ["wrong model for state fields", p2002({ modelName: "AiFascicoloHumanReviewEvent", target: ["materialId", "statementPath"] })],
    ["wrong model for idempotency fields", p2002({ modelName: "AiFascicoloHumanReviewState", target: ["enteId", "idempotencyKey"] })],
    ["wrong model for sequence fields", p2002({ modelName: "AiFascicoloHumanReviewState", target: ["materialId", "statementPath", "sequence"] })],
    ["wrong kind", prismaPgP2002({ modelName: "AiFascicoloHumanReviewEvent", fields: ["enteId", "idempotencyKey"], kind: "ForeignKeyConstraintViolation" })],
    ["wrong SQLSTATE", prismaPgP2002({ modelName: "AiFascicoloHumanReviewEvent", fields: ["enteId", "idempotencyKey"], originalCode: "23503" })],
    ["missing field", prismaPgP2002({ modelName: "AiFascicoloHumanReviewEvent", fields: ["enteId"] })],
    ["extra field", prismaPgP2002({ modelName: "AiFascicoloHumanReviewEvent", fields: ["enteId", "idempotencyKey", "extra"] })],
    ["duplicate field", prismaPgP2002({ modelName: "AiFascicoloHumanReviewEvent", fields: ["enteId", "enteId"] })],
    ["non-string field", prismaPgP2002({ modelName: "AiFascicoloHumanReviewEvent", fields: ["enteId", 42] })],
    ["missing model", p2002({ target: ["enteId", "idempotencyKey"] })],
    ["unrelated constraint", p2002({ modelName: "AiFascicoloHumanReviewEvent", target: ["id"] })],
    ["malformed adapter", p2002({ modelName: "AiFascicoloHumanReviewEvent", driverAdapterError: { cause: null } })],
  ])("rejects unrelated or malformed P2002: %s", async (_name, error) => {
    mocks.runSerializableTransactionWithRetry.mockRejectedValueOnce(error);

    await expectCode(persistAiFascicoloHumanReview(input()), "PERSISTENCE_FAILURE");
    expect(mocks.runSerializableTransactionWithRetry).toHaveBeenCalledTimes(1);
  });

  it("represents no administrative or concession outcome", async () => {
    const result = await persistAiFascicoloHumanReview(input());
    const serialized = JSON.stringify({ result, events: database.events, audits: database.audits });
    for (const forbidden of [
      "APPROVED", "DENIED", "VALID", "INVALID", "COMPLIANT", "NON_COMPLIANT",
      "REVOKED", "RENEWED", "DECAYED", "SANCTIONED",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});