import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireConcessioneTenantAccessMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const applyRegisteredDecisionEffectMock = vi.hoisted(() => vi.fn());
const auditAlreadyAppliedDecisionEffectMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
  procedimento: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  decisioneProcedimento: {
    create: vi.fn(),
  },
  concessione: {
    update: vi.fn(),
  },
  activityLog: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  $executeRaw: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  procedimento: {
    findUnique: vi.fn(),
  },
  decisioneProcedimento: {
    findUnique: vi.fn(),
  },
  documento: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    requireRole: requireRoleMock,
    getCurrentUser: getCurrentUserMock,
  };
});

vi.mock("@/lib/tenant-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-auth")>("@/lib/tenant-auth");
  return {
    ...actual,
    getCurrentTenantContext: getCurrentTenantContextMock,
    requireConcessioneTenantAccess: requireConcessioneTenantAccessMock,
  };
});

vi.mock("@/server/audit/auditLog", () => ({
  auditFailure: auditFailureMock,
  auditSuccess: auditSuccessMock,
}));

vi.mock("@/server/procedimenti/applyRegisteredDecisionEffect", () => ({
  applyRegisteredDecisionEffect: applyRegisteredDecisionEffectMock,
  auditAlreadyAppliedDecisionEffect: auditAlreadyAppliedDecisionEffectMock,
}));

vi.mock("@/server/audit/requestContext", () => ({
  getAuditRequestContext: vi.fn(async () => ({ ipAddress: null, userAgent: null })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { finalizeProcedimentoDecisionAction } from "@/server/actions/procedimenti";

function buildProcedimento(input?: Partial<{
  tipologia: string;
  stato: string;
  checklistContraddittorioCompleta: boolean;
  concessioneStato: string;
  hasDecision: boolean;
  responsabileProcedimentoNome: string | null;
  unitaOrganizzativaResponsabile: string | null;
  responsabileAssegnatoAt: Date | null;
}>) {
  return {
    id: "proc-1",
    concessioneId: "con-1",
    responsabileProcedimentoNome:
      input && "responsabileProcedimentoNome" in input
        ? (input.responsabileProcedimentoNome ?? null)
        : "Responsabile Demo",
    unitaOrganizzativaResponsabile:
      input && "unitaOrganizzativaResponsabile" in input
        ? (input.unitaOrganizzativaResponsabile ?? null)
        : "Ufficio Demanio",
    responsabileAssegnatoAt:
      input && "responsabileAssegnatoAt" in input
        ? (input.responsabileAssegnatoAt ?? null)
        : new Date("2026-06-01T00:00:00.000Z"),
    tipologia: input?.tipologia ?? "AVVIO_DECADENZA",
    stato: input?.stato ?? "IN_CORSO",
    checklistContraddittorioCompleta: input?.checklistContraddittorioCompleta ?? true,
    propostaEsitoIstruttorio: "DECADENZA_DA_VALUTARE",
    decisioneProcedimento: input?.hasDecision ? { id: "dec-1" } : null,
    concessione: {
      id: "con-1",
      enteId: "ente-a",
      stato: input?.concessioneStato ?? "ATTIVA",
    },
  };
}

function baseFormData() {
  const fd = new FormData();
  fd.set("procedimentoId", "proc-1");
  fd.set("decisionType", "DECADENZA_DICHIARATA");
  fd.set("numeroAtto", "DEC-2026-001");
  fd.set("protocolloAtto", "PROT-2026-001");
  fd.set("dataAtto", "2026-07-01");
  fd.set("dataEfficacia", "2026-07-02");
  fd.set("organoCompetente", "Comitato di Gestione");
  fd.set("adottanteNome", "Presidente Comitato");
  fd.set("adottanteQualifica", "Presidente");
  fd.set("scostamentoDaIstruttoria", "false");
  fd.set("motivazioneSintetica", "Grave inadempimento accertato.");
  fd.set("documentoId", "doc-1");
  fd.set("confermaFinalizzazione", "CONFIRMO_REGISTRAZIONE_ATTO");
  return fd;
}

function buildP2002(target: unknown): Prisma.PrismaClientKnownRequestError {
  const p2002 = Object.create(Prisma.PrismaClientKnownRequestError.prototype) as Prisma.PrismaClientKnownRequestError;
  Object.assign(p2002, { code: "P2002", meta: { target } });
  return p2002;
}

function expectedIdempotencyKey() {
  const keyPayload = "proc-1|DECADENZA_DICHIARATA|DEC-2026-001|2026-07-01T00:00:00.000Z|2026-07-02T00:00:00.000Z";
  return createHash("sha256").update(keyPayload).digest("hex");
}

function existingEquivalentDecision(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "dec-existing",
    enteId: "ente-a",
    procedimentoId: "proc-1",
    concessioneId: "con-1",
    tipoDecisione: "DECADENZA_DICHIARATA",
    numeroAtto: "DEC-2026-001",
    protocolloAtto: "PROT-2026-001",
    dataAtto: new Date("2026-07-01T00:00:00.000Z"),
    dataEfficacia: new Date("2026-07-02T00:00:00.000Z"),
    documentoId: "doc-1",
    organoCompetente: "Comitato di Gestione",
    adottanteNome: "Presidente Comitato",
    adottanteQualifica: "Presidente",
    scostamentoDaIstruttoria: false,
    motivazioneScostamentoIstruttoria: null,
    effettoTitolo: "CONCESSIONE_DECADUTA",
    statoConcessionePrecedente: "ATTIVA",
    statoConcessioneSuccessivo: "DECADUTA",
    idempotencyKey: expectedIdempotencyKey(),
    ...overrides,
  };
}

describe("finalizeProcedimentoDecisionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireRoleMock.mockResolvedValue("GIURIDICO");
    getCurrentUserMock.mockResolvedValue({
      id: "user-1",
      email: "giuridico@demo.local",
      role: "GIURIDICO",
    });
    getCurrentTenantContextMock.mockResolvedValue({
      userId: "user-1",
      role: "GIURIDICO",
      isAdmin: false,
      tenantMemberships: [],
      defaultTenantId: "ente-a",
      accessibleTenantIds: ["ente-a"],
    });

    prismaMock.procedimento.findUnique.mockResolvedValue(buildProcedimento());
    prismaMock.documento.findUnique.mockResolvedValue({
      id: "doc-1",
      concessioneId: "con-1",
      procedimentoId: "proc-1",
    });

    txMock.procedimento.findUnique.mockResolvedValue(buildProcedimento());
    txMock.procedimento.update.mockResolvedValue({ id: "proc-1" });
    txMock.decisioneProcedimento.create.mockResolvedValue({ id: "dec-1", enteId: "ente-a", concessioneId: "con-1" });
    txMock.concessione.update.mockResolvedValue({ id: "con-1" });
    txMock.activityLog.findFirst.mockResolvedValue({ currentHash: "prev-hash" });
    txMock.activityLog.create.mockResolvedValue({ id: "log-1" });
    txMock.$executeRaw.mockResolvedValue(1);

    applyRegisteredDecisionEffectMock.mockResolvedValue({
      status: "APPLIED",
      decisioneId: "dec-1",
      concessioneId: "con-1",
      statoEffetto: "APPLICATO",
      appliedAt: new Date("2026-07-02T00:00:00.000Z"),
    });

    redirectMock.mockImplementation((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    });
  });

  it("non consente ruoli non autorizzati", async () => {
    requireRoleMock.mockResolvedValue("ECONOMICO");

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow(/non autorizzato/i);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalled();
  });

  it("blocca checklist incompleta su decadenza", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue(
      buildProcedimento({ checklistContraddittorioCompleta: false }),
    );

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow(/checklist/i);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("richiede documento per decisione con effetto titolo", async () => {
    const fd = baseFormData();
    fd.delete("documentoId");

    await expect(finalizeProcedimentoDecisionAction(fd)).rejects.toThrow("DOCUMENTO_ATTO_MANCANTE");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rifiuta registrazione se manca responsabile procedimento", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue(
      buildProcedimento({ responsabileProcedimentoNome: null }),
    );

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow("RESPONSABILE_PROCEDIMENTO_MANCANTE");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rifiuta registrazione se manca unita organizzativa responsabile", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue(
      buildProcedimento({ unitaOrganizzativaResponsabile: null }),
    );

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow("RESPONSABILE_PROCEDIMENTO_MANCANTE");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rifiuta registrazione se manca protocollo atto", async () => {
    const fd = baseFormData();
    fd.delete("protocolloAtto");

    await expect(finalizeProcedimentoDecisionAction(fd)).rejects.toThrow("PROTOCOLLO_ATTO_MANCANTE");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rifiuta se scostamento dichiarato senza motivazione", async () => {
    const fd = baseFormData();
    fd.set("scostamentoDaIstruttoria", "true");
    fd.set("motivazioneScostamentoIstruttoria", "   ");

    await expect(finalizeProcedimentoDecisionAction(fd)).rejects.toThrow("MOTIVAZIONE_SCOSTAMENTO_ISTRUTTORIA_MANCANTE");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("blocca procedimento gia concluso", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue(buildProcedimento({ stato: "CONCLUSO" }));

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow(/gia concluso/i);
  });

  it("blocca doppio invio se decisione gia presente", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue(buildProcedimento({ hasDecision: true }));

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow(/gia registrata/i);
  });

  it("applica decadenza valida in transazione atomica", async () => {
    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.decisioneProcedimento.create).toHaveBeenCalledTimes(1);
    expect(txMock.procedimento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stato: "CONCLUSO" }),
      }),
    );
    expect(txMock.concessione.update).not.toHaveBeenCalled();
    expect(applyRegisteredDecisionEffectMock).toHaveBeenCalledTimes(1);
    expect(txMock.activityLog.create).toHaveBeenCalledTimes(1);
    expect(txMock.decisioneProcedimento.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ registeredByUserId: "user-1" }) }),
    );
    expect(txMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-1" }) }),
    );
    expect(auditSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ azione: "EFFETTO_PRONTO", actor: expect.objectContaining({ userId: "user-1" }) }),
    );
    expect(applyRegisteredDecisionEffectMock).toHaveBeenCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ userId: "user-1" }) }),
    );
  });

  it("technical Preview registra decisione e audit senza FK User", async () => {
    requireRoleMock.mockResolvedValue("ADMIN");
    getCurrentUserMock.mockResolvedValue({
      id: "staging-preview-admin",
      email: "staging-admin@preview.invalid",
      role: "ADMIN",
    });

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(txMock.decisioneProcedimento.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ registeredByUserId: null }) }),
    );
    expect(txMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: null }) }),
    );
    expect(auditSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ azione: "EFFETTO_PRONTO", actor: expect.objectContaining({ userId: null }) }),
    );
    expect(applyRegisteredDecisionEffectMock).toHaveBeenCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ userId: null }) }),
    );
  });

  it("archiviazione non aggiorna concessione", async () => {
    const fd = baseFormData();
    fd.set("decisionType", "ARCHIVIAZIONE");

    await expect(finalizeProcedimentoDecisionAction(fd)).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(txMock.procedimento.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stato: "ARCHIVIATO" }) }),
    );
    expect(txMock.concessione.update).not.toHaveBeenCalled();
    expect(applyRegisteredDecisionEffectMock).not.toHaveBeenCalled();
  });

  it("chiusura senza effetto non aggiorna concessione", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue(buildProcedimento({ tipologia: "DIFFIDA" }));
    txMock.procedimento.findUnique.mockResolvedValue(buildProcedimento({ tipologia: "DIFFIDA" }));

    const fd = baseFormData();
    fd.set("decisionType", "CHIUSURA_SENZA_EFFETTO");

    await expect(finalizeProcedimentoDecisionAction(fd)).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(txMock.procedimento.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stato: "CONCLUSO" }) }),
    );
    expect(txMock.concessione.update).not.toHaveBeenCalled();
    expect(applyRegisteredDecisionEffectMock).not.toHaveBeenCalled();
  });

  it("decisione con efficacia futura resta pendente e non applica subito l'effetto", async () => {
    const fd = baseFormData();
    fd.set("dataEfficacia", "2028-07-11");

    await expect(finalizeProcedimentoDecisionAction(fd)).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(txMock.$executeRaw).toHaveBeenCalled();
    expect(applyRegisteredDecisionEffectMock).not.toHaveBeenCalled();
    expect(txMock.concessione.update).not.toHaveBeenCalled();
  });

  it("gestisce P2002 come replay idempotente equivalente", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(buildP2002(["procedimentoId"]));
    prismaMock.decisioneProcedimento.findUnique.mockResolvedValueOnce(existingEquivalentDecision());

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");
    expect(auditFailureMock).not.toHaveBeenCalledWith(expect.objectContaining({ azione: "PROCEDIMENTO_DECISION_FINALIZE" }));
  });

  it("gestisce P2002 su idempotencyKey come replay equivalente", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(buildP2002(["idempotencyKey"]));
    prismaMock.decisioneProcedimento.findUnique.mockResolvedValueOnce(existingEquivalentDecision());

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");
    expect(prismaMock.decisioneProcedimento.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { idempotencyKey: expectedIdempotencyKey() } }),
    );
  });

  it("P2002 con documento differente produce IDEMPOTENCY_CONFLICT", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(buildP2002(["procedimentoId"]));
    prismaMock.decisioneProcedimento.findUnique.mockResolvedValueOnce(
      existingEquivalentDecision({ documentoId: "doc-differente" }),
    );

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("P2002 con organo differente produce IDEMPOTENCY_CONFLICT", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(buildP2002(["idempotencyKey"]));
    prismaMock.decisioneProcedimento.findUnique.mockResolvedValueOnce(
      existingEquivalentDecision({ organoCompetente: "Altro Organo" }),
    );

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("P2002 con effetto o stato successivo differente produce IDEMPOTENCY_CONFLICT", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(buildP2002(["procedimentoId"]));
    prismaMock.decisioneProcedimento.findUnique.mockResolvedValueOnce(
      existingEquivalentDecision({
        tipoDecisione: "ARCHIVIAZIONE",
        effettoTitolo: "NESSUNO",
        statoConcessioneSuccessivo: null,
      }),
    );

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("P2002 con target sconosciuto non viene trattato come replay", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(buildP2002(["unknownUniqueIndex"]));

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow("P2002_TARGET_UNRECOGNIZED");
  });

  it("blocca tenant errato", async () => {
    requireConcessioneTenantAccessMock.mockRejectedValueOnce(new Error("TENANT_WRITE_DENIED"));

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow(/tenant corrente/i);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("blocca stato concessione incompatibile", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue(
      buildProcedimento({ concessioneStato: "REVOCATA" }),
    );

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow(/incompatibile/i);
  });

  it("propaga errore se applicazione effetto separata fallisce", async () => {
    applyRegisteredDecisionEffectMock.mockRejectedValueOnce(new Error("DB_UPDATE_FAILED"));

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toMatchObject({
      decisioneRegistrata: true,
      effettoApplicato: false,
      statoEffetto: "ERRORE",
      codiceErrore: "DB_UPDATE_FAILED",
    });

    expect(txMock.activityLog.create).toHaveBeenCalled();
  });

  it("quando conflitto concessione in apply propaga stato effettivamente persistito", async () => {
    applyRegisteredDecisionEffectMock.mockRejectedValueOnce({
      code: "CONCESSIONE_STATE_CONFLICT",
      persistedStatoEffetto: "BLOCCATO",
    });

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toMatchObject({
      decisioneRegistrata: true,
      effettoApplicato: false,
      statoEffetto: "BLOCCATO",
      codiceErrore: "CONCESSIONE_STATE_CONFLICT",
    });

    expect(txMock.decisioneProcedimento.create).toHaveBeenCalledTimes(1);
  });

  it("se apply non fornisce stato persistito nel conflitto non dichiara BLOCCATO automaticamente", async () => {
    applyRegisteredDecisionEffectMock.mockRejectedValueOnce({
      code: "CONCESSIONE_STATE_CONFLICT",
    });

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toMatchObject({
      decisioneRegistrata: true,
      effettoApplicato: false,
      statoEffetto: "PRONTO",
      codiceErrore: "CONCESSIONE_STATE_CONFLICT",
    });
  });

  it("registeredByUserId deriva da currentUser e non da adottanteNome", async () => {
    const fd = baseFormData();
    fd.set("adottanteNome", "Soggetto Esterno");
    fd.set("adottanteQualifica", "Autorita Competente");

    await expect(finalizeProcedimentoDecisionAction(fd)).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(txMock.decisioneProcedimento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          registeredByUserId: "user-1",
          adottanteNome: "Soggetto Esterno",
          adottanteQualifica: "Autorita Competente",
        }),
      }),
    );
  });

  it("ADMIN puo registrare il provvedimento", async () => {
    requireRoleMock.mockResolvedValue("ADMIN");
    getCurrentUserMock.mockResolvedValue({
      id: "admin-1",
      email: "admin@demo.local",
      role: "ADMIN",
    });

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");
    expect(txMock.decisioneProcedimento.create).toHaveBeenCalled();
  });

  it("GIURIDICO puo registrare il provvedimento", async () => {
    requireRoleMock.mockResolvedValue("GIURIDICO");

    await expect(finalizeProcedimentoDecisionAction(baseFormData())).rejects.toThrow("REDIRECT:/procedimenti/proc-1");
    expect(txMock.decisioneProcedimento.create).toHaveBeenCalled();
  });

  it("organo competente resta dato dichiarato e non deriva dal ruolo", async () => {
    requireRoleMock.mockResolvedValue("ADMIN");
    const fd = baseFormData();
    fd.set("organoCompetente", "Comitato Portuale Straordinario");

    await expect(finalizeProcedimentoDecisionAction(fd)).rejects.toThrow("REDIRECT:/procedimenti/proc-1");

    expect(txMock.decisioneProcedimento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organoCompetente: "Comitato Portuale Straordinario",
        }),
      }),
    );
  });
});
