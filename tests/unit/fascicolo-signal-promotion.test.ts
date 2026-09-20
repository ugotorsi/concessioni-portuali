import { beforeEach, describe, expect, it, vi } from "vitest";

const auditMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const txMock = vi.hoisted(() => ({
  fascicoloSignal: { findUnique: vi.fn(), updateMany: vi.fn() },
  criticita: { create: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  canManageCriticita: (role: string) => role !== "VIEWER_ADSP",
  canManageProcedimenti: (role: string) => ["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO"].includes(role),
  getCurrentUser: getCurrentUserMock,
  requireRole: requireRoleMock,
}));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: auditMock }));
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: vi.fn(async (callback) => callback(txMock)),
}));
vi.mock("@/server/fascicolo-lifecycle/fascicoloSignal", () => ({
  fascicoloSignalTemporalFingerprint: vi.fn(() => "current-fingerprint"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { promoteFascicoloSignalAction } from "@/server/actions/fascicolo-signals";

function signal(overrides: Record<string, unknown> = {}) {
  return {
    id: "signal-1",
    enteId: "ente-1",
    concessioneId: "concessione-1",
    procedimentoId: "procedimento-1",
    subjectType: "CONCESSIONE",
    subjectId: "concessione-1",
    generationFingerprint: "current-fingerprint",
    currentThreshold: "CONCESSION_30_DAYS",
    status: "OPEN",
    humanDisposition: "UNREVIEWED",
    dispositionThreshold: null,
    reviewNote: null,
    criticitaId: null,
    procedimento: {
      id: "procedimento-1",
      concessioneId: "concessione-1",
      concessione: { id: "concessione-1", enteId: "ente-1", dataScadenza: new Date("2027-01-01") },
    },
    ...overrides,
  };
}

function promotionForm(overrides: Record<string, string> = {}) {
  const values = {
    signalId: "signal-1",
    expectedThreshold: "CONCESSION_30_DAYS",
    tipologia: "GIURIDICA",
    gravita: "MEDIA",
    descrizione: "Valutazione istruttoria esplicita del segnale.",
    rilevanzaArt47: "false",
    regolarizzata: "false",
    verificataRegolarizzazione: "false",
    ...overrides,
  };
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

function tenantContext(role = "GIURIDICO", membershipRole = role) {
  return {
    userId: "user-1",
    role,
    isAdmin: role === "ADMIN",
    accessibleTenantIds: role === "ADMIN" ? [] : ["ente-1"],
    defaultTenantId: role === "ADMIN" ? null : "ente-1",
    tenantMemberships: role === "ADMIN" ? [] : [{
      id: "membership-1",
      userId: "user-1",
      enteId: "ente-1",
      role: membershipRole,
      isDefault: true,
    }],
  };
}

describe("FascicoloSignal controlled promotion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("GIURIDICO");
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "user@example.test", role: "GIURIDICO" });
    getCurrentTenantContextMock.mockResolvedValue(tenantContext());
    requireTenantAccessMock.mockReturnValue(undefined);
    txMock.fascicoloSignal.findUnique.mockResolvedValue(signal());
    txMock.fascicoloSignal.updateMany.mockResolvedValue({ count: 1 });
    txMock.criticita.create.mockResolvedValue({ id: "criticita-1" });
    auditMock.mockResolvedValue({});
  });

  it.each(["UNREVIEWED", "ACKNOWLEDGED", "DISMISSED"])("promotes explicitly from %s", async (humanDisposition) => {
    txMock.fascicoloSignal.findUnique.mockResolvedValue(signal({ humanDisposition }));

    await expect(promoteFascicoloSignalAction(promotionForm())).resolves.toEqual({
      outcome: "PROMOTED",
      signalId: "signal-1",
      criticitaId: "criticita-1",
    });
    expect(txMock.fascicoloSignal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ humanDisposition, criticitaId: null }),
      data: expect.objectContaining({
        humanDisposition: "PROMOTED",
        dispositionThreshold: "CONCESSION_30_DAYS",
        criticitaId: "criticita-1",
      }),
    }));
  });

  it("forces canonical concession, ALERT_AUTOMATICO and APERTA without inferring Art. 47", async () => {
    await promoteFascicoloSignalAction(promotionForm());

    expect(txMock.criticita.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        concessioneId: "concessione-1",
        fonte: "ALERT_AUTOMATICO",
        stato: "APERTA",
        rilevanzaArt47: false,
        letteraArt47: null,
        rischioDecadenza: null,
        motivazioneArt47: null,
        azioneIstruttoriaArt47: null,
      }),
      select: { id: true },
    });
  });

  it("uses the normal Art. 47 validation and persistence rules", async () => {
    await expect(promoteFascicoloSignalAction(promotionForm({ rilevanzaArt47: "true" }))).rejects.toThrow(
      "lettera applicabile",
    );

    await promoteFascicoloSignalAction(promotionForm({
      rilevanzaArt47: "true",
      letteraArt47: "F_INADEMPIMENTO_OBBLIGHI",
      rischioDecadenza: "ALTO",
      motivazioneArt47: "Motivazione istruttoria completa.",
    }));
    expect(txMock.criticita.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rilevanzaArt47: true,
        letteraArt47: "F_INADEMPIMENTO_OBBLIGHI",
        rischioDecadenza: "ALTO",
      }),
    }));
  });

  it.each([
    ["TECNICO", "GIURIDICA"],
    ["ECONOMICO", "TECNICA"],
  ])("preserves %s tipologia restrictions", async (role, tipologia) => {
    requireRoleMock.mockResolvedValue(role);
    await expect(promoteFascicoloSignalAction(promotionForm({ tipologia }))).rejects.toThrow("può gestire solo");
    expect(txMock.criticita.create).not.toHaveBeenCalled();
  });

  it("writes CRITICITA_CREATE and promotion audit through the same transaction client", async () => {
    await promoteFascicoloSignalAction(promotionForm());

    expect(auditMock).toHaveBeenCalledTimes(2);
    expect(auditMock.mock.calls.map(([, input]) => input.azione)).toEqual([
      "CRITICITA_CREATE",
      "FASCICOLO_SIGNAL_PROMOTED",
    ]);
    expect(auditMock.mock.calls[1][1].metadata).toMatchObject({ criticitaId: "criticita-1" });
  });

  it("returns ALREADY_PROMOTED without creating another Criticita", async () => {
    txMock.fascicoloSignal.findUnique.mockResolvedValue(signal({
      humanDisposition: "PROMOTED",
      dispositionThreshold: "CONCESSION_30_DAYS",
      criticitaId: "criticita-existing",
    }));

    await expect(promoteFascicoloSignalAction(promotionForm())).resolves.toMatchObject({
      outcome: "ALREADY_PROMOTED",
      criticitaId: "criticita-existing",
    });
    expect(txMock.criticita.create).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("creates one Criticita across a successful promotion and a consolidated retry", async () => {
    txMock.fascicoloSignal.findUnique
      .mockResolvedValueOnce(signal())
      .mockResolvedValueOnce(signal({
        humanDisposition: "PROMOTED",
        dispositionThreshold: "CONCESSION_30_DAYS",
        criticitaId: "criticita-1",
      }));

    await promoteFascicoloSignalAction(promotionForm());
    await expect(promoteFascicoloSignalAction(promotionForm())).resolves.toMatchObject({ outcome: "ALREADY_PROMOTED" });
    expect(txMock.criticita.create).toHaveBeenCalledTimes(1);
  });

  it("allows a TECNICO tenant membership to promote a technical Criticita", async () => {
    requireRoleMock.mockResolvedValue("OPERATORE_SOCIETA");
    getCurrentTenantContextMock.mockResolvedValue(tenantContext("OPERATORE_SOCIETA", "TECNICO"));

    await promoteFascicoloSignalAction(promotionForm({ tipologia: "TECNICA" }));

    expect(txMock.fascicoloSignal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewedByRole: "TECNICO" }),
    }));
    expect(auditMock).toHaveBeenCalledWith(txMock, expect.objectContaining({
      actor: expect.objectContaining({ userRole: "TECNICO" }),
    }));
  });

  it("applies tipologia restrictions from the canonical tenant role", async () => {
    requireRoleMock.mockResolvedValue("OPERATORE_SOCIETA");
    getCurrentTenantContextMock.mockResolvedValue(tenantContext("OPERATORE_SOCIETA", "TECNICO"));
    await expect(promoteFascicoloSignalAction(promotionForm({ tipologia: "GIURIDICA" }))).rejects.toThrow(
      "solo criticità tecniche",
    );
    expect(txMock.criticita.create).not.toHaveBeenCalled();
  });

  it("allows an ECONOMICO tenant membership to promote MOROSITA", async () => {
    requireRoleMock.mockResolvedValue("OPERATORE_SOCIETA");
    getCurrentTenantContextMock.mockResolvedValue(tenantContext("OPERATORE_SOCIETA", "ECONOMICO"));

    await promoteFascicoloSignalAction(promotionForm({ tipologia: "MOROSITA" }));

    expect(txMock.criticita.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tipologia: "MOROSITA" }),
    }));
    expect(auditMock).toHaveBeenCalledWith(txMock, expect.objectContaining({
      actor: expect.objectContaining({ userRole: "ECONOMICO" }),
    }));
  });

  it("fails closed when the canonical tenant membership is absent", async () => {
    getCurrentTenantContextMock.mockResolvedValue({ ...tenantContext(), tenantMemberships: [] });

    await expect(promoteFascicoloSignalAction(promotionForm())).rejects.toThrow("Tenant access denied");
    expect(txMock.criticita.create).not.toHaveBeenCalled();
  });

  it.each([
    ["superseded", { status: "SUPERSEDED" }, "NOT_OPEN"],
    ["stale generation", { generationFingerprint: "stale" }, "STALE_GENERATION"],
    ["old threshold", { currentThreshold: "CONCESSION_60_DAYS" }, "THRESHOLD_CHANGED"],
    ["canonical mismatch", { subjectId: "other" }, "CANONICAL_SCOPE_MISMATCH"],
  ])("rejects %s before creating a Criticita", async (_label, override, error) => {
    txMock.fascicoloSignal.findUnique.mockResolvedValue(signal(override));
    await expect(promoteFascicoloSignalAction(promotionForm())).rejects.toThrow(error);
    expect(txMock.criticita.create).not.toHaveBeenCalled();
  });

  it("throws after a lost conditional update so the transaction can roll back the new Criticita", async () => {
    txMock.fascicoloSignal.updateMany.mockResolvedValue({ count: 0 });
    await expect(promoteFascicoloSignalAction(promotionForm())).rejects.toThrow("CONCURRENTLY_CHANGED");
    expect(txMock.criticita.create).toHaveBeenCalledTimes(1);
    expect(auditMock).not.toHaveBeenCalled();
  });
});