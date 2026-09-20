import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireConcessioneTenantAccessMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const admitAsyncJobInTransactionMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
  concessione: {
    findUnique: vi.fn(),
  },
  procedimento: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  procedimentoResponsabileAssignment: {
    create: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  procedimento: {
    findUnique: vi.fn(),
  },
  criticita: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, requireRole: requireRoleMock, getCurrentUser: getCurrentUserMock };
});
vi.mock("@/lib/tenant-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-auth")>("@/lib/tenant-auth");
  return {
    ...actual,
    getCurrentTenantContext: getCurrentTenantContextMock,
    requireConcessioneTenantAccess: requireConcessioneTenantAccessMock,
  };
});
vi.mock("@/server/audit/auditLog", () => ({ auditFailure: vi.fn(), auditSuccess: auditSuccessMock }));
vi.mock("@/server/audit/requestContext", () => ({ getAuditRequestContext: vi.fn(async () => ({ ipAddress: null, userAgent: null })) }));
vi.mock("@/server/async-jobs/persistence", () => ({
  admitAsyncJobInTransaction: admitAsyncJobInTransactionMock,
}));
vi.mock("@/server/procedimenti/applyRegisteredDecisionEffect", () => ({
  applyRegisteredDecisionEffect: vi.fn(),
  auditAlreadyAppliedDecisionEffect: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import {
  createProcedimentoAction,
  reassignProcedimentoResponsabileAction,
} from "@/server/actions/procedimenti";

function createFormData() {
  const formData = new FormData();
  formData.set("concessioneId", "con-1");
  formData.set("tipologia", "DIFFIDA");
  formData.set("stato", "DA_AVVIARE");
  formData.set("origineProcedimento", "UFFICIO");
  formData.set("procedimentoUfficio", "true");
  formData.set("responsabileProcedimentoNome", "Responsabile Amministrativo");
  formData.set("responsabileProcedimentoEmail", "responsabile@ente.test");
  formData.set("unitaOrganizzativaResponsabile", "Ufficio Demanio");
  formData.set("responsabileAssegnatoAt", "2026-08-01");
  return formData;
}

function reassignFormData() {
  const formData = new FormData();
  formData.set("procedimentoId", "proc-1");
  formData.set("responsabileNome", "Lucia Bianchi");
  formData.set("responsabileEmail", "lucia@ente.test");
  formData.set("unitaOrganizzativa", "Area Concessioni");
  formData.set("decorrenza", "2026-08-10");
  formData.set("motivoAssegnazione", "Riorganizzazione interna");
  return formData;
}

function currentAssignment() {
  return {
    id: "assignment-old",
    procedimentoId: "proc-1",
    responsabileNome: "Mario Rossi",
    responsabileEmail: "mario@ente.test",
    unitaOrganizzativa: "Ufficio Demanio",
    decorrenza: new Date("2026-08-01T00:00:00.000Z"),
    cessazione: null,
    motivoAssegnazione: null,
    comunicataAt: null,
    registeredByUserId: "user-old",
  };
}

describe("procedimento responsibility assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("GIURIDICO");
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "registrante@ente.test", role: "GIURIDICO" });
    getCurrentTenantContextMock.mockResolvedValue({
      userId: "user-1",
      role: "GIURIDICO",
      isAdmin: false,
      accessibleTenantIds: ["ente-a"],
    });
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    });
    txMock.concessione.findUnique.mockResolvedValue({
      id: "con-1",
      enteId: "ente-a",
      dataScadenza: new Date("2027-01-01T00:00:00.000Z"),
      expiryGeneration: 0,
      stato: "ATTIVA",
    });
    txMock.procedimento.create.mockResolvedValue({ id: "proc-1", concessioneId: "con-1", stato: "DA_AVVIARE" });
    txMock.procedimento.findUnique.mockResolvedValue({ id: "proc-1", concessioneId: "con-1" });
    txMock.procedimento.update.mockResolvedValue({ id: "proc-1" });
    txMock.procedimentoResponsabileAssignment.create.mockResolvedValue({ id: "assignment-new" });
    txMock.procedimentoResponsabileAssignment.findFirst.mockResolvedValue(currentAssignment());
    txMock.procedimentoResponsabileAssignment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.procedimento.findUnique.mockResolvedValue({ id: "proc-1", concessioneId: "con-1" });
    admitAsyncJobInTransactionMock.mockResolvedValue({ outcome: "CREATED", job: { id: "job-1" } });
  });

  it("create procedimento genera la prima assegnazione storica senza derivare il responsabile dal currentUser", async () => {
    await expect(createProcedimentoAction(createFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    const assignmentInput = txMock.procedimentoResponsabileAssignment.create.mock.calls[0]?.[0]?.data;
    expect(assignmentInput).toMatchObject({
      responsabileNome: "Responsabile Amministrativo",
      responsabileEmail: "responsabile@ente.test",
      unitaOrganizzativa: "Ufficio Demanio",
      decorrenza: new Date("2026-08-01T00:00:00.000Z"),
      registeredByUserId: "user-1",
    });
    expect(assignmentInput).not.toHaveProperty("comunicataAt");
  });

  it("create procedimento non collega il technical admin Preview a User", async () => {
    getCurrentUserMock.mockResolvedValueOnce({
      id: "staging-preview-admin",
      email: "staging-admin@preview.invalid",
      role: "ADMIN",
    });

    await expect(createProcedimentoAction(createFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    const assignmentInput = txMock.procedimentoResponsabileAssignment.create.mock.calls[0]?.[0]?.data;
    expect(assignmentInput).toMatchObject({ registeredByUserId: null });
  });

  it("non ammette catch-up quando nessuna soglia e maturata", async () => {
    txMock.concessione.findUnique.mockResolvedValueOnce({
      id: "con-1",
      enteId: "ente-a",
      dataScadenza: new Date(Date.now() + 100 * 24 * 60 * 60 * 1_000),
      expiryGeneration: 0,
      stato: "ATTIVA",
    });

    await expect(createProcedimentoAction(createFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(admitAsyncJobInTransactionMock).not.toHaveBeenCalled();
  });

  it.each([
    ["CONCESSION_90_DAYS", 75],
    ["CONCESSION_60_DAYS", 45],
    ["CONCESSION_30_DAYS", 15],
    ["DEADLINE_DUE", -1],
  ])("ammette soltanto l ultima soglia maturata %s", async (expectedThreshold, daysUntilExpiry) => {
    txMock.concessione.findUnique.mockResolvedValueOnce({
      id: "con-1",
      enteId: "ente-a",
      dataScadenza: new Date(Date.now() + daysUntilExpiry * 24 * 60 * 60 * 1_000),
      expiryGeneration: 0,
      stato: "ATTIVA",
    });

    await expect(createProcedimentoAction(createFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(admitAsyncJobInTransactionMock).toHaveBeenCalledTimes(1);
    const admission = admitAsyncJobInTransactionMock.mock.calls[0]?.[1];
    expect(admission.inputReference.metadata.changeChunk000Ref).toContain(`\"threshold\":\"${expectedThreshold}\"`);
  });

  it("usa il contratto V2 per il catch-up di una concessione a generazione positiva", async () => {
    txMock.concessione.findUnique.mockResolvedValueOnce({
      id: "con-1",
      enteId: "ente-a",
      dataScadenza: new Date(Date.now() + 15 * 24 * 60 * 60 * 1_000),
      expiryGeneration: 2,
      stato: "ATTIVA",
    });

    await expect(createProcedimentoAction(createFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    const admission = admitAsyncJobInTransactionMock.mock.calls[0]?.[1];
    expect(admission.inputReference.referenceVersion).toBe("V2");
    expect(admission.inputReference.metadata.changeChunk000Ref).toContain(`\"expiryGeneration\":2`);
  });

  it.each([
    ["procedimento non attivo", "CONCLUSO", "ATTIVA"],
    ["concessione non eleggibile", "DA_AVVIARE", "SCADUTA"],
  ])("non ammette catch-up per %s", async (_case, procedimentoStato, concessioneStato) => {
    txMock.procedimento.create.mockResolvedValueOnce({
      id: "proc-1",
      concessioneId: "con-1",
      stato: procedimentoStato,
    });
    txMock.concessione.findUnique.mockResolvedValueOnce({
      id: "con-1",
      enteId: "ente-a",
      dataScadenza: new Date(Date.now() - 24 * 60 * 60 * 1_000),
      expiryGeneration: 0,
      stato: concessioneStato,
    });

    await expect(createProcedimentoAction(createFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(admitAsyncJobInTransactionMock).not.toHaveBeenCalled();
  });

  it("annulla il percorso create per tenant canonico non coerente", async () => {
    txMock.concessione.findUnique.mockResolvedValueOnce({
      id: "con-1",
      enteId: "ente-b",
      dataScadenza: new Date(Date.now() - 24 * 60 * 60 * 1_000),
      expiryGeneration: 0,
      stato: "ATTIVA",
    });

    await expect(createProcedimentoAction(createFormData())).rejects.toThrow(
      "Tenant della concessione non coerente con il contesto autorizzato.",
    );

    expect(admitAsyncJobInTransactionMock).not.toHaveBeenCalled();
    expect(auditSuccessMock).not.toHaveBeenCalled();
  });

  it("annulla il percorso create per collegamento canonico non coerente", async () => {
    txMock.concessione.findUnique.mockResolvedValueOnce({
      id: "con-diversa",
      enteId: "ente-a",
      dataScadenza: new Date(Date.now() - 24 * 60 * 60 * 1_000),
      expiryGeneration: 0,
      stato: "ATTIVA",
    });

    await expect(createProcedimentoAction(createFormData())).rejects.toThrow(
      "Concessione canonica non coerente con il procedimento creato.",
    );

    expect(admitAsyncJobInTransactionMock).not.toHaveBeenCalled();
    expect(auditSuccessMock).not.toHaveBeenCalled();
  });

  it("propaga il fallimento admission per il rollback atomico di procedimento e assegnazione", async () => {
    txMock.concessione.findUnique.mockResolvedValueOnce({
      id: "con-1",
      enteId: "ente-a",
      dataScadenza: new Date(Date.now() - 24 * 60 * 60 * 1_000),
      expiryGeneration: 0,
      stato: "ATTIVA",
    });
    admitAsyncJobInTransactionMock.mockRejectedValueOnce(new Error("ADMISSION_FAILED"));

    await expect(createProcedimentoAction(createFormData())).rejects.toThrow("ADMISSION_FAILED");

    expect(txMock.procedimento.create).toHaveBeenCalledOnce();
    expect(txMock.procedimentoResponsabileAssignment.create).toHaveBeenCalledOnce();
    expect(auditSuccessMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("riassegnazione chiude solo la precedente, crea il nuovo snapshot e aggiorna Procedimento", async () => {
    await expect(reassignProcedimentoResponsabileAction(reassignFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(txMock.procedimentoResponsabileAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "assignment-old", cessazione: null },
        data: { cessazione: new Date("2026-08-10T00:00:00.000Z") },
      }),
    );
    const assignmentInput = txMock.procedimentoResponsabileAssignment.create.mock.calls[0]?.[0]?.data;
    expect(assignmentInput).toMatchObject({
      responsabileNome: "Lucia Bianchi",
      responsabileEmail: "lucia@ente.test",
      unitaOrganizzativa: "Area Concessioni",
      decorrenza: new Date("2026-08-10T00:00:00.000Z"),
      motivoAssegnazione: "Riorganizzazione interna",
      registeredByUserId: "user-1",
    });
    expect(assignmentInput).not.toHaveProperty("comunicataAt");
    expect(txMock.procedimento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          responsabileProcedimentoNome: "Lucia Bianchi",
          unitaOrganizzativaResponsabile: "Area Concessioni",
          responsabileAssegnatoAt: new Date("2026-08-10T00:00:00.000Z"),
        }),
      }),
    );
    expect(currentAssignment()).toMatchObject({
      responsabileNome: "Mario Rossi",
      responsabileEmail: "mario@ente.test",
      unitaOrganizzativa: "Ufficio Demanio",
      decorrenza: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(auditSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        azione: "PROCEDIMENTO_RESPONSABILE_RIASSEGNATO",
        actor: expect.objectContaining({ userId: "user-1" }),
      }),
    );
  });

  it("riassegnazione non collega il technical admin Preview a User", async () => {
    getCurrentUserMock.mockResolvedValueOnce({
      id: "staging-preview-admin",
      email: "staging-admin@preview.invalid",
      role: "ADMIN",
    });

    await expect(reassignProcedimentoResponsabileAction(reassignFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    const assignmentInput = txMock.procedimentoResponsabileAssignment.create.mock.calls[0]?.[0]?.data;
    expect(assignmentInput).toMatchObject({
      responsabileNome: "Lucia Bianchi",
      registeredByUserId: null,
    });
    expect(auditSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        azione: "PROCEDIMENTO_RESPONSABILE_RIASSEGNATO",
        actor: expect.objectContaining({ userId: null }),
      }),
    );
  });

  it("bootstrap legacy P0-A conserva il responsabile precedente e registra solo la nuova assegnazione", async () => {
    txMock.procedimentoResponsabileAssignment.findFirst.mockResolvedValueOnce(null);
    prismaMock.procedimento.findUnique.mockResolvedValueOnce({
      id: "proc-1",
      concessioneId: "con-1",
      responsabileProcedimentoNome: "Mario Rossi",
      responsabileProcedimentoEmail: "mario@ente.test",
      unitaOrganizzativaResponsabile: "Ufficio Demanio",
      responsabileAssegnatoAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    await expect(reassignProcedimentoResponsabileAction(reassignFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(txMock.procedimentoResponsabileAssignment.create).toHaveBeenNthCalledWith(1, {
      data: {
        procedimentoId: "proc-1",
        responsabileNome: "Mario Rossi",
        responsabileEmail: "mario@ente.test",
        unitaOrganizzativa: "Ufficio Demanio",
        decorrenza: new Date("2026-08-01T00:00:00.000Z"),
        cessazione: new Date("2026-08-10T00:00:00.000Z"),
        comunicataAt: null,
        registeredByUserId: null,
      },
    });
    const newAssignmentInput = txMock.procedimentoResponsabileAssignment.create.mock.calls[1]?.[0]?.data;
    expect(newAssignmentInput).toMatchObject({
      responsabileNome: "Lucia Bianchi",
      registeredByUserId: "user-1",
    });
    expect(newAssignmentInput).not.toHaveProperty("cessazione");
  });

  it("rifiuta una decorrenza legacy antecedente senza persistere history o snapshot", async () => {
    const formData = reassignFormData();
    formData.set("decorrenza", "2026-07-31");
    txMock.procedimentoResponsabileAssignment.findFirst.mockResolvedValueOnce(null);
    prismaMock.procedimento.findUnique.mockResolvedValueOnce({
      id: "proc-1",
      concessioneId: "con-1",
      responsabileProcedimentoNome: "Mario Rossi",
      responsabileProcedimentoEmail: "mario@ente.test",
      unitaOrganizzativaResponsabile: "Ufficio Demanio",
      responsabileAssegnatoAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    await expect(reassignProcedimentoResponsabileAction(formData)).rejects.toThrow("DATA_RIASSEGNAZIONE_ANTECEDENTE");
    expect(txMock.procedimentoResponsabileAssignment.create).not.toHaveBeenCalled();
    expect(txMock.procedimentoResponsabileAssignment.updateMany).not.toHaveBeenCalled();
    expect(txMock.procedimento.update).not.toHaveBeenCalled();
  });

  it("non inventa lo storico legacy incompleto e registra l audit esplicito", async () => {
    txMock.procedimentoResponsabileAssignment.findFirst.mockResolvedValueOnce(null);
    prismaMock.procedimento.findUnique.mockResolvedValueOnce({
      id: "proc-1",
      concessioneId: "con-1",
      responsabileProcedimentoNome: "Mario Rossi",
      responsabileProcedimentoEmail: "mario@ente.test",
      unitaOrganizzativaResponsabile: null,
      responsabileAssegnatoAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    await expect(reassignProcedimentoResponsabileAction(reassignFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(txMock.procedimentoResponsabileAssignment.create).toHaveBeenCalledTimes(1);
    expect(txMock.procedimentoResponsabileAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          responsabileNome: "Lucia Bianchi",
          registeredByUserId: "user-1",
        }),
      }),
    );
    expect(auditSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ azione: "STORICO_RESPONSABILE_PRECEDENTE_NON_RICOSTRUIBILE" }),
    );
  });

  it("rifiuta decorrenza antecedente alla responsabilita attiva", async () => {
    const formData = reassignFormData();
    formData.set("decorrenza", "2026-07-31");

    await expect(reassignProcedimentoResponsabileAction(formData)).rejects.toThrow("DATA_RIASSEGNAZIONE_ANTECEDENTE");
    expect(txMock.procedimentoResponsabileAssignment.updateMany).not.toHaveBeenCalled();
  });

  it("rifiuta responsabile o unita organizzativa blank", async () => {
    const missingResponsabile = reassignFormData();
    missingResponsabile.set("responsabileNome", "   ");
    await expect(reassignProcedimentoResponsabileAction(missingResponsabile)).rejects.toThrow("RESPONSABILE_PROCEDIMENTO_MANCANTE");

    const missingUnita = reassignFormData();
    missingUnita.set("unitaOrganizzativa", "   ");
    await expect(reassignProcedimentoResponsabileAction(missingUnita)).rejects.toThrow("UNITA_ORGANIZZATIVA_MANCANTE");
  });

  it("traduce la violazione del vincolo di assegnazione attiva in conflitto concorrente", async () => {
    const error = Object.create(Prisma.PrismaClientKnownRequestError.prototype) as Prisma.PrismaClientKnownRequestError;
    Object.assign(error, { code: "P2002" });
    prismaMock.$transaction.mockRejectedValueOnce(error);

    await expect(reassignProcedimentoResponsabileAction(reassignFormData())).rejects.toThrow("RIASSEGNAZIONE_CONCORRENTE");
  });
});
