import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const txMock = vi.hoisted(() => ({
  fascicoloIntake: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  procedimento: {
    createMany: vi.fn(),
    findUnique: vi.fn(),
  },
  concessione: {
    findUnique: vi.fn(),
  },
  runtimeBudgetPolicy: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  $queryRawUnsafe: vi.fn(),
}));

vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: vi.fn(async (callback) => callback(txMock)),
}));

import {
  activateFascicoloIntake,
  FascicoloIntakeActivationError,
} from "@/server/fascicolo-intake/activation";

describe("activateFascicoloIntake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txMock.fascicoloIntake.findUnique
      .mockResolvedValueOnce({
        id: "intake-1",
        enteId: "ente-1",
        concessioneId: null,
        procedimentoId: null,
      })
      .mockResolvedValueOnce({
        procedimentoId: "procedimento-intake-6edc1d4728d330745a8b226b",
      });
    txMock.procedimento.createMany.mockResolvedValue({ count: 1 });
    txMock.procedimento.findUnique.mockResolvedValue({
      id: "procedimento-intake-6edc1d4728d330745a8b226b",
      enteId: "ente-1",
      concessioneId: null,
    });
    txMock.fascicoloIntake.updateMany.mockResolvedValue({ count: 1 });
    txMock.$queryRawUnsafe.mockResolvedValue([{
      id: "procedimento-intake-6edc1d4728d330745a8b226b",
      enteId: "ente-1",
    }]);
    txMock.runtimeBudgetPolicy.findFirst.mockResolvedValue(null);
    txMock.runtimeBudgetPolicy.create.mockResolvedValue({
      id: "policy-1",
      enabled: true,
      hardCapAmount: { toString: () => "1.000000" },
      windowSeconds: 86_400,
    });
  });

  it("attiva senza concessione preservando il fascicolo e senza avviare job o provider", async () => {
    const result = await activateFascicoloIntake({
      fascicoloIntakeId: "intake-1",
      tenantId: "ente-1",
    });

    expect(result).toEqual({
      outcome: "CREATED",
      procedimento: {
        id: "procedimento-intake-6edc1d4728d330745a8b226b",
        enteId: "ente-1",
        concessioneId: null,
      },
    });
    expect(txMock.procedimento.createMany).toHaveBeenCalledWith({
      data: [{
        id: "procedimento-intake-6edc1d4728d330745a8b226b",
        enteId: "ente-1",
        concessioneId: null,
        tipologia: "ALTRO",
        origineProcedimento: "ALTRO",
        procedimentoUfficio: false,
        stato: "DA_AVVIARE",
      }],
      skipDuplicates: true,
    });
    expect(txMock.fascicoloIntake.updateMany).toHaveBeenCalledWith({
      where: { id: "intake-1", procedimentoId: null },
      data: { procedimentoId: "procedimento-intake-6edc1d4728d330745a8b226b" },
    });

    const source = readFileSync("src/server/fascicolo-intake/activation.ts", "utf8");
    expect(source).not.toMatch(/createNeutralIntake|AsyncJob|provider/i);
  });

  it("crea la policy di procedimento quando il budget predefinito è autorizzato", async () => {
    await activateFascicoloIntake({
      fascicoloIntakeId: "intake-1",
      tenantId: "ente-1",
      budgetAuthorization: {
        authorized: true,
        currency: "EUR",
        hardCapAmount: "1.000000",
        windowSeconds: 86_400,
      },
    });

    expect(txMock.runtimeBudgetPolicy.create).toHaveBeenCalledWith({
      data: {
        scope: "PROCEDIMENTO",
        tenantId: "ente-1",
        procedimentoId: "procedimento-intake-6edc1d4728d330745a8b226b",
        currency: "EUR",
        hardCapAmount: "1.000000",
        windowSeconds: 86_400,
        enabled: true,
      },
      select: {
        id: true,
        enabled: true,
        hardCapAmount: true,
        windowSeconds: true,
      },
    });
  });

  it("riusa idempotentemente il collegamento esistente", async () => {
    txMock.fascicoloIntake.findUnique.mockReset().mockResolvedValue({
      id: "intake-1",
      enteId: "ente-1",
      concessioneId: null,
      procedimentoId: "procedimento-1",
    });
    txMock.procedimento.findUnique.mockResolvedValue({
      id: "procedimento-1",
      enteId: "ente-1",
      concessioneId: null,
    });

    await expect(activateFascicoloIntake({
      fascicoloIntakeId: "intake-1",
      tenantId: "ente-1",
    })).resolves.toEqual({
      outcome: "REUSED",
      procedimento: {
        id: "procedimento-1",
        enteId: "ente-1",
        concessioneId: null,
      },
    });
    expect(txMock.procedimento.createMany).not.toHaveBeenCalled();
    expect(txMock.fascicoloIntake.updateMany).not.toHaveBeenCalled();
  });

  it("nega l'attivazione da un tenant diverso", async () => {
    await expect(activateFascicoloIntake({
      fascicoloIntakeId: "intake-1",
      tenantId: "ente-2",
    })).rejects.toEqual(expect.objectContaining<FascicoloIntakeActivationError>({
      name: "FascicoloIntakeActivationError",
      message: "Tenant del fascicolo non coerente.",
    }));
    expect(txMock.procedimento.createMany).not.toHaveBeenCalled();
  });

  it("accetta soltanto una concessione reale dello stesso tenant", async () => {
    txMock.fascicoloIntake.findUnique.mockReset()
      .mockResolvedValueOnce({
        id: "intake-1",
        enteId: "ente-1",
        concessioneId: "concessione-1",
        procedimentoId: null,
      });
    txMock.concessione.findUnique.mockResolvedValue({ enteId: "ente-2" });

    await expect(activateFascicoloIntake({
      fascicoloIntakeId: "intake-1",
      tenantId: "ente-1",
    })).rejects.toThrow("Concessione del fascicolo non coerente con il tenant.");
    expect(txMock.procedimento.createMany).not.toHaveBeenCalled();
  });

  it("accetta il collegamento concorrente solo se coincide con quello deterministico", async () => {
    txMock.fascicoloIntake.updateMany.mockResolvedValue({ count: 0 });

    await expect(activateFascicoloIntake({
      fascicoloIntakeId: "intake-1",
      tenantId: "ente-1",
    })).resolves.toEqual(expect.objectContaining({ outcome: "CREATED" }));

    txMock.fascicoloIntake.findUnique.mockReset()
      .mockResolvedValueOnce({
        id: "intake-1",
        enteId: "ente-1",
        concessioneId: null,
        procedimentoId: null,
      })
      .mockResolvedValueOnce({ procedimentoId: "procedimento-diverso" });
    await expect(activateFascicoloIntake({
      fascicoloIntakeId: "intake-1",
      tenantId: "ente-1",
    })).rejects.toThrow("Attivazione concorrente del fascicolo non coerente.");
  });
});
