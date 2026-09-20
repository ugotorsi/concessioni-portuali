import { beforeEach, describe, expect, it, vi } from "vitest";

const { txMock, admitAsyncJobInTransactionMock, createAuditLogInTransactionMock } = vi.hoisted(() => ({
  txMock: {
    concessione: { findUnique: vi.fn(), updateMany: vi.fn() },
    concessioneExpiryChangeCommand: { findUnique: vi.fn(), create: vi.fn() },
    fascicoloSignal: { updateMany: vi.fn() },
    procedimento: { findMany: vi.fn() },
  },
  admitAsyncJobInTransactionMock: vi.fn(),
  createAuditLogInTransactionMock: vi.fn(),
}));

vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: vi.fn((callback: (tx: typeof txMock) => unknown) => callback(txMock)),
}));
vi.mock("@/server/async-jobs/persistence", () => ({
  admitAsyncJobInTransaction: admitAsyncJobInTransactionMock,
}));
vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: createAuditLogInTransactionMock,
}));

import {
  changeConcessioneExpiry,
  isConcessioneExpiryChangeEnabled,
} from "@/server/fascicolo-lifecycle/concessioneExpiryChange";
import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";

const actor = { id: "user-1", email: "user@example.test", role: "OPERATORE_SOCIETA" as const };
const tenantContext = {
  userId: actor.id,
  role: actor.role,
  isAdmin: false,
  tenantMemberships: [
    { id: "membership-a", userId: actor.id, enteId: "ente-a", role: "OPERATORE_SOCIETA" as const, isDefault: true },
    { id: "membership-b", userId: actor.id, enteId: "ente-b", role: "VIEWER_ADSP" as const, isDefault: false },
  ],
  defaultTenantId: "ente-a",
  accessibleTenantIds: ["ente-a", "ente-b"],
};

function command(overrides: Partial<Parameters<typeof changeConcessioneExpiry>[0]["command"]> = {}) {
  return {
    requestId: "request-1",
    concessioneId: "con-1",
    expectedGeneration: 0,
    expectedDataScadenza: "2026-10-01T15:30:00.000Z",
    newDate: "2027-01-15",
    motivation: "Proroga formalizzata",
    reference: "Atto 42/2026",
    ...overrides,
  };
}

function canonical(overrides: Record<string, unknown> = {}) {
  return {
    id: "con-1",
    enteId: "ente-a",
    dataScadenza: new Date("2026-10-01T15:30:00.000Z"),
    expiryGeneration: 0,
    stato: "ATTIVA",
    ...overrides,
  };
}

describe("controlled concessione expiry change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONCESSIONE_EXPIRY_CHANGE_ENABLED = "true";
    txMock.concessione.findUnique.mockResolvedValue(canonical());
    txMock.concessione.updateMany.mockResolvedValue({ count: 1 });
    txMock.concessioneExpiryChangeCommand.findUnique.mockResolvedValue(null);
    txMock.concessioneExpiryChangeCommand.create.mockResolvedValue({ id: "command-1" });
    txMock.fascicoloSignal.updateMany.mockResolvedValue({ count: 1 });
    txMock.procedimento.findMany.mockResolvedValue([]);
    admitAsyncJobInTransactionMock.mockResolvedValue({ outcome: "CREATED", job: { id: "job-1" } });
    createAuditLogInTransactionMock.mockResolvedValue({ id: "audit-1" });
  });

  it("mantiene il flag disabilitato per default e accetta solo true", () => {
    expect(isConcessioneExpiryChangeEnabled({})).toBe(false);
    expect(isConcessioneExpiryChangeEnabled({ CONCESSIONE_EXPIRY_CHANGE_ENABLED: "TRUE" })).toBe(false);
    expect(isConcessioneExpiryChangeEnabled({ CONCESSIONE_EXPIRY_CHANGE_ENABLED: "true" })).toBe(true);
  });

  it("usa il ruolo della membership esatta e rifiuta il viewer dell ente B", async () => {
    txMock.concessione.findUnique.mockResolvedValueOnce(canonical({ enteId: "ente-b" }));

    await expect(changeConcessioneExpiry({ command: command(), actor, tenantContext })).rejects.toThrow(
      "Tenant access denied.",
    );
    expect(txMock.concessioneExpiryChangeCommand.findUnique).not.toHaveBeenCalled();
  });

  it("riconosce il replay documentato prima del controllo CAS", async () => {
    await changeConcessioneExpiry({ command: command(), actor, tenantContext });
    const persisted = txMock.concessioneExpiryChangeCommand.create.mock.calls[0]?.[0]?.data;
    txMock.concessione.findUnique.mockResolvedValueOnce(canonical({
      dataScadenza: new Date("2027-01-15T00:00:00.000Z"),
      expiryGeneration: 1,
    }));
    txMock.concessioneExpiryChangeCommand.findUnique.mockResolvedValueOnce({
      actorId: actor.id,
      payloadFingerprint: persisted.payloadFingerprint,
      concessioneId: "con-1",
      resultingGeneration: 1,
    });

    await expect(changeConcessioneExpiry({ command: command(), actor, tenantContext })).resolves.toEqual({
      outcome: "REPLAYED",
      concessioneId: "con-1",
      expiryGeneration: 1,
    });
    expect(txMock.concessione.updateMany).toHaveBeenCalledOnce();
  });

  it("restituisce CONFLICT per requestId riusato da un altro attore", async () => {
    txMock.concessioneExpiryChangeCommand.findUnique.mockResolvedValueOnce({
      actorId: "user-2",
      payloadFingerprint: "different",
      concessioneId: "con-1",
      resultingGeneration: 1,
    });

    await expect(changeConcessioneExpiry({ command: command(), actor, tenantContext })).resolves.toEqual({
      outcome: "CONFLICT",
      concessioneId: "con-1",
    });
  });

  it("controlla il CAS prima di ALREADY_CURRENT anche dopo A-B-A", async () => {
    txMock.concessione.findUnique.mockResolvedValueOnce(canonical({ expiryGeneration: 2 }));

    await expect(changeConcessioneExpiry({
      command: command({ newDate: "2026-10-01" }),
      actor,
      tenantContext,
    })).resolves.toEqual({ outcome: "CONFLICT", concessioneId: "con-1" });
  });

  it("a giorno invariato conserva il timestamp storico non-midnight", async () => {
    await expect(changeConcessioneExpiry({
      command: command({ newDate: "2026-10-01" }),
      actor,
      tenantContext,
    })).resolves.toEqual({ outcome: "ALREADY_CURRENT", concessioneId: "con-1", expiryGeneration: 0 });
    expect(txMock.concessione.updateMany).not.toHaveBeenCalled();
    expect(txMock.concessioneExpiryChangeCommand.create).not.toHaveBeenCalled();
  });

  it("aggiorna a mezzanotte UTC, incrementa e supersede soltanto la famiglia esatta", async () => {
    const result = await changeConcessioneExpiry({
      command: command(),
      actor,
      tenantContext,
      now: new Date("2026-09-20T10:00:00.000Z"),
    });

    expect(result).toEqual({ outcome: "UPDATED", concessioneId: "con-1", expiryGeneration: 1 });
    expect(txMock.concessione.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ expiryGeneration: 0, dataScadenza: new Date("2026-10-01T15:30:00.000Z") }),
      data: { dataScadenza: new Date("2027-01-15T00:00:00.000Z"), expiryGeneration: 1 },
    }));
    expect(txMock.fascicoloSignal.updateMany).toHaveBeenCalledWith({
      where: {
        concessioneId: "con-1",
        enteId: "ente-a",
        status: "OPEN",
        kind: "CONCESSION_EXPIRY",
        subjectType: "CONCESSIONE",
        subjectId: "con-1",
        ruleCode: "CONCESSION_EXPIRY_WINDOW",
      },
      data: { status: "SUPERSEDED", supersededAt: new Date("2026-09-20T10:00:00.000Z") },
    });
    expect(txMock.concessioneExpiryChangeCommand.create).toHaveBeenCalledOnce();
    expect(createAuditLogInTransactionMock).toHaveBeenCalledOnce();
    expect(admitAsyncJobInTransactionMock).toHaveBeenCalledTimes(4);
  });

  it("propaga il fallimento di admission per consentire il rollback atomico", async () => {
    admitAsyncJobInTransactionMock.mockRejectedValueOnce(new Error("ADMISSION_FAILED"));

    await expect(changeConcessioneExpiry({ command: command(), actor, tenantContext })).rejects.toThrow(
      "ADMISSION_FAILED",
    );
  });

  it("ammette il catch-up maturato soltanto per i procedimenti attivi", async () => {
    txMock.concessione.findUnique.mockResolvedValueOnce(canonical({
      dataScadenza: new Date("2026-12-01T15:30:00.000Z"),
    }));
    txMock.procedimento.findMany.mockResolvedValueOnce([{ id: "proc-1" }, { id: "proc-2" }]);

    await changeConcessioneExpiry({
      command: command({
        expectedDataScadenza: "2026-12-01T15:30:00.000Z",
        newDate: "2026-10-01",
      }),
      actor,
      tenantContext,
      now: new Date("2026-09-20T10:00:00.000Z"),
    });

    expect(txMock.procedimento.findMany).toHaveBeenCalledWith({
      where: { concessioneId: "con-1", stato: { in: ["DA_AVVIARE", "IN_CORSO"] } },
      select: { id: true },
    });
    expect(admitAsyncJobInTransactionMock).toHaveBeenCalledTimes(4);
    const references = admitAsyncJobInTransactionMock.mock.calls.map((call) => call[1].inputReference.referenceId);
    expect(references.filter((referenceId) => referenceId === "proc-1")).toHaveLength(1);
    expect(references.filter((referenceId) => referenceId === "proc-2")).toHaveLength(1);
  });

  it("distingue A-B-A con generazioni e identita watch successive", async () => {
    txMock.concessione.findUnique
      .mockResolvedValueOnce(canonical())
      .mockResolvedValueOnce(canonical({
        dataScadenza: new Date("2027-01-15T00:00:00.000Z"),
        expiryGeneration: 1,
      }));

    await changeConcessioneExpiry({
      command: command(),
      actor,
      tenantContext,
      now: new Date("2026-09-20T10:00:00.000Z"),
    });
    await changeConcessioneExpiry({
      command: command({
        requestId: "request-2",
        expectedGeneration: 1,
        expectedDataScadenza: "2027-01-15T00:00:00.000Z",
        newDate: "2026-10-01",
      }),
      actor,
      tenantContext,
      now: new Date("2026-09-20T10:00:00.000Z"),
    });

    expect(txMock.concessioneExpiryChangeCommand.create.mock.calls.map((call) => (
      call[0].data.resultingGeneration
    ))).toEqual([1, 2]);
    const watchIdentities = admitAsyncJobInTransactionMock.mock.calls
      .map((call) => normalizeAsyncJobAdmission(call[1]))
      .filter((admission) => admission.operation === "FASCICOLO_TIME_WATCH_V2")
      .map((admission) => admission.idempotencyKey);
    expect(new Set(watchIdentities).size).toBe(watchIdentities.length);
  });
});