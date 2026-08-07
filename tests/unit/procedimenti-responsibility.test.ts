import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireConcessioneTenantAccessMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
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
    txMock.procedimento.create.mockResolvedValue({ id: "proc-1", concessioneId: "con-1" });
    txMock.procedimento.findUnique.mockResolvedValue({ id: "proc-1", concessioneId: "con-1" });
    txMock.procedimento.update.mockResolvedValue({ id: "proc-1" });
    txMock.procedimentoResponsabileAssignment.create.mockResolvedValue({ id: "assignment-new" });
    txMock.procedimentoResponsabileAssignment.findFirst.mockResolvedValue(currentAssignment());
    txMock.procedimentoResponsabileAssignment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.procedimento.findUnique.mockResolvedValue({ id: "proc-1", concessioneId: "con-1" });
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
