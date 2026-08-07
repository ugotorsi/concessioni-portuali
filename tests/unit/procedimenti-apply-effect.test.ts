import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  decisioneProcedimento: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  concessione: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  activityLog: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: getCurrentUserMock,
  };
});

vi.mock("@/server/audit/auditLog", () => ({
  auditFailure: auditFailureMock,
  auditSuccess: auditSuccessMock,
}));

import { applyRegisteredDecisionEffect } from "@/server/procedimenti/applyRegisteredDecisionEffect";

function decisionRow(overrides?: Partial<{
  statoEffetto: "NON_PREVISTO" | "PENDENTE" | "PRONTO" | "APPLICATO" | "BLOCCATO" | "ERRORE";
  effettoTitolo: string;
  statoConcessionePrecedente: string | null;
  statoConcessioneSuccessivo: string | null;
  dataEfficacia: Date;
  effectVersion: number;
  effettoApplicatoAt: Date | null;
}>) {
  return {
    id: "dec-1",
    enteId: "ente-a",
    procedimentoId: "proc-1",
    concessioneId: "con-1",
    tipoDecisione: "DECADENZA_DICHIARATA",
    effettoTitolo: overrides?.effettoTitolo ?? "CONCESSIONE_DECADUTA",
    statoConcessionePrecedente:
      overrides && "statoConcessionePrecedente" in overrides
        ? (overrides.statoConcessionePrecedente ?? null)
        : "ATTIVA",
    statoConcessioneSuccessivo: overrides?.statoConcessioneSuccessivo ?? "DECADUTA",
    statoEffetto: overrides?.statoEffetto ?? "PRONTO",
    dataEfficacia: overrides?.dataEfficacia ?? new Date("2026-07-02T00:00:00.000Z"),
    effectVersion: overrides?.effectVersion ?? 0,
    effettoApplicatoAt: overrides?.effettoApplicatoAt ?? null,
  };
}

describe("applyRegisteredDecisionEffect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    getCurrentUserMock.mockResolvedValue({
      id: "user-1",
      email: "giuridico@demo.local",
      role: "GIURIDICO",
    });

    txMock.$queryRaw.mockResolvedValue([decisionRow()]);
    txMock.$executeRaw.mockResolvedValue(1);
    txMock.decisioneProcedimento.updateMany.mockResolvedValue({ count: 1 });
    txMock.decisioneProcedimento.findUnique.mockResolvedValue({
      statoEffetto: "BLOCCATO",
      effectVersion: 0,
      effettoApplicatoAt: null,
    });
    txMock.concessione.updateMany.mockResolvedValue({ count: 1 });
    txMock.concessione.findUnique.mockResolvedValue({ stato: "ATTIVA" });
    txMock.activityLog.findFirst.mockResolvedValue({ currentHash: "prev-hash" });
    txMock.activityLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("applica separatamente un effetto pronto", async () => {
    const result = await applyRegisteredDecisionEffect({ decisioneId: "dec-1" });

    expect(result.status).toBe("APPLIED");
    expect(txMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(txMock.concessione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "con-1", stato: "ATTIVA" }),
        data: expect.objectContaining({ stato: "DECADUTA" }),
      }),
    );
    expect(txMock.activityLog.create).toHaveBeenCalledTimes(1);
    expect(txMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-1" }) }),
    );
  });

  it("persiste null negli audit effetto quando l action risolve un technical Preview actor", async () => {
    const result = await applyRegisteredDecisionEffect({
      decisioneId: "dec-1",
      actor: {
        userId: null,
        userEmail: "staging-admin@preview.invalid",
        userRole: "ADMIN",
      },
    });

    expect(result.status).toBe("APPLIED");
    expect(txMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: null }) }),
    );
  });

  it("restituisce NOT_READY prima della data di efficacia", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));

    txMock.$queryRaw.mockResolvedValueOnce([
      decisionRow({ dataEfficacia: new Date("2099-01-01T00:00:00.000Z"), statoEffetto: "PENDENTE" }),
    ]);

    const result = await applyRegisteredDecisionEffect({ decisioneId: "dec-1" });

    expect(result.status).toBe("NOT_READY");
    expect(txMock.$executeRaw).not.toHaveBeenCalled();
    expect(txMock.concessione.updateMany).not.toHaveBeenCalled();
  });

  it("applica quando dataEfficacia coincide con istante corrente", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T00:00:00.000Z"));

    txMock.$queryRaw.mockResolvedValueOnce([
      decisionRow({ dataEfficacia: new Date("2026-07-02T00:00:00.000Z"), statoEffetto: "PRONTO" }),
    ]);

    const result = await applyRegisteredDecisionEffect({ decisioneId: "dec-1" });

    expect(result.status).toBe("APPLIED");
    expect(txMock.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("mantiene NOT_READY con data immediatamente futura", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T00:00:00.000Z"));

    txMock.$queryRaw.mockResolvedValueOnce([
      decisionRow({ dataEfficacia: new Date("2026-07-02T00:00:00.001Z"), statoEffetto: "PENDENTE" }),
    ]);

    const result = await applyRegisteredDecisionEffect({ decisioneId: "dec-1" });

    expect(result.status).toBe("NOT_READY");
    expect(txMock.$executeRaw).not.toHaveBeenCalled();
  });

  it("restituisce no-op idempotente se gia applicato", async () => {
    txMock.$queryRaw.mockResolvedValueOnce([
      decisionRow({ statoEffetto: "APPLICATO", effettoApplicatoAt: new Date("2026-07-03T00:00:00.000Z") }),
    ]);

    const result = await applyRegisteredDecisionEffect({ decisioneId: "dec-1" });

    expect(result.status).toBe("ALREADY_APPLIED");
    expect(txMock.$executeRaw).not.toHaveBeenCalled();
    expect(txMock.concessione.updateMany).not.toHaveBeenCalled();
  });

  it("blocca applicazione quando effetto non previsto", async () => {
    txMock.$queryRaw.mockResolvedValueOnce([
      decisionRow({ effettoTitolo: "NESSUNO", statoConcessioneSuccessivo: null, statoEffetto: "NON_PREVISTO" }),
    ]);

    await expect(applyRegisteredDecisionEffect({ decisioneId: "dec-1" })).rejects.toThrow(/non previsto/i);
    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({ azione: "EFFETTO_APPLICAZIONE_FALLITA" }));
  });

  it("blocca applicazione se statoConcessionePrecedente e nullo", async () => {
    txMock.$queryRaw.mockResolvedValueOnce([
      decisionRow({ statoConcessionePrecedente: null, statoConcessioneSuccessivo: "DECADUTA" }),
    ]);

    await expect(applyRegisteredDecisionEffect({ decisioneId: "dec-1" })).rejects.toThrow(/incoerente/i);
    expect(txMock.$executeRaw).not.toHaveBeenCalled();
    expect(txMock.concessione.updateMany).not.toHaveBeenCalled();
  });

  it("gestisce concorrenza con no-op quando altro worker ha gia applicato", async () => {
    txMock.$executeRaw.mockResolvedValueOnce(0);
    txMock.$queryRaw
      .mockResolvedValueOnce([decisionRow({ statoEffetto: "PRONTO" })])
      .mockResolvedValueOnce([{ statoEffetto: "APPLICATO", effettoApplicatoAt: new Date("2026-07-04T00:00:00.000Z") }]);

    const result = await applyRegisteredDecisionEffect({ decisioneId: "dec-1" });

    expect(result.status).toBe("ALREADY_APPLIED");
  });

  it("se stato concessione diverge persiste BLOCCATO in seconda transazione e scrive un solo audit conflitto", async () => {
    txMock.$executeRaw.mockResolvedValueOnce(1);
    txMock.concessione.updateMany.mockResolvedValueOnce({ count: 0 });
    txMock.concessione.findUnique.mockResolvedValueOnce({ stato: "REVOCATA" });

    await expect(applyRegisteredDecisionEffect({ decisioneId: "dec-1" })).rejects.toMatchObject({
      code: "CONCESSIONE_STATE_CONFLICT",
      persistedStatoEffetto: "BLOCCATO",
      persistedEffettoApplicatoAt: null,
    });

    expect(txMock.decisioneProcedimento.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "dec-1", effectVersion: 0, statoEffetto: "PRONTO" }),
        data: expect.objectContaining({ statoEffetto: "BLOCCATO", effettoApplicatoAt: null }),
      }),
    );
    expect(txMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ azione: "EFFETTO_BLOCCATO_CONFLITTO_STATO" }),
      }),
    );
    expect(auditFailureMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ azione: "EFFETTO_APPLICAZIONE_FALLITA" }),
    );
  });

  it("se update BLOCCATO concorrente non riesce non sovrascrive e restituisce stato riletto", async () => {
    txMock.$executeRaw.mockResolvedValueOnce(1);
    txMock.concessione.updateMany.mockResolvedValueOnce({ count: 0 });
    txMock.concessione.findUnique.mockResolvedValueOnce({ stato: "REVOCATA" });
    txMock.decisioneProcedimento.updateMany.mockResolvedValueOnce({ count: 0 });
    txMock.decisioneProcedimento.findUnique.mockResolvedValueOnce({
      statoEffetto: "APPLICATO",
      effectVersion: 1,
      effettoApplicatoAt: new Date("2026-07-03T00:00:00.000Z"),
    });

    await expect(applyRegisteredDecisionEffect({ decisioneId: "dec-1" })).rejects.toMatchObject({
      code: "CONCESSIONE_STATE_CONFLICT",
      persistedStatoEffetto: "APPLICATO",
      persistedEffectVersion: 1,
    });

    expect(txMock.decisioneProcedimento.updateMany).toHaveBeenCalledTimes(1);
  });

  it("rollback applicazione se update concessione fallisce", async () => {
    txMock.concessione.updateMany.mockRejectedValueOnce(new Error("DB_UPDATE_FAILED"));

    await expect(applyRegisteredDecisionEffect({ decisioneId: "dec-1" })).rejects.toThrow(/DB_UPDATE_FAILED/);
    expect(txMock.activityLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ azione: "EFFETTO_APPLICATO" }) }),
    );
    expect(txMock.activityLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ azione: "EFFETTO_BLOCCATO_CONFLITTO_STATO" }) }),
    );
    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({ azione: "EFFETTO_APPLICAZIONE_FALLITA" }));
  });
});
