import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireConcessioneTenantAccessMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const uploadDocumentMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  concessione: { findUnique: vi.fn() },
  fascicoloIntake: { create: vi.fn(), findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, requireRole: requireRoleMock, getCurrentUser: getCurrentUserMock };
});
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireConcessioneTenantAccess: requireConcessioneTenantAccessMock,
  requireTenantAccess: vi.fn(),
}));
vi.mock("@/server/audit/auditLog", () => ({ auditSuccess: auditSuccessMock }));
vi.mock("@/server/documents/uploadService", () => ({ uploadDocument: uploadDocumentMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { createFascicoloIntakeAction } from "@/server/actions/fascicolo-intake";

function formData(concessioneId?: string) {
  const data = new FormData();
  data.set("tipologiaConcessioneIniziale", "MARITTIMA_TURISTICO_RICREATIVA");
  data.set("titoloFascicolo", "Fascicolo Alfa");
  data.set("descrizioneIniziale", "Concessione stabilimento balneare");
  data.set("soggettoAssistito", "Società Alfa");
  if (concessioneId) {
    data.set("concessioneId", concessioneId);
  }
  return data;
}

describe("createFascicoloIntakeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("GIURIDICO");
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "utente@ente.test" });
    getCurrentTenantContextMock.mockResolvedValue({
      userId: "user-1",
      role: "GIURIDICO",
      isAdmin: false,
      defaultTenantId: "ente-a",
      accessibleTenantIds: ["ente-a"],
    });
    prismaMock.fascicoloIntake.create.mockResolvedValue({
      id: "fascicolo-1",
      tipologiaConcessione: "MARITTIMA_TURISTICO_RICREATIVA",
    });
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    });
  });

  it("crea il fascicolo senza concessione usando il tenant predefinito", async () => {
    await expect(createFascicoloIntakeAction(formData())).rejects.toThrow(
      "REDIRECT:/procedimenti/fascicolo-1",
    );

    expect(requireConcessioneTenantAccessMock).not.toHaveBeenCalled();
    expect(prismaMock.fascicoloIntake.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        enteId: "ente-a",
        concessioneId: null,
        oggettoFascicolo: "Fascicolo Alfa",
        denominazioneBreve: "Fascicolo Alfa",
        contestoIniziale: "Concessione stabilimento balneare",
        soggettoAssistito: "Società Alfa",
      }),
    });
  });

  it("collega i documenti iniziali al fascicolo creato", async () => {
    const data = formData();
    data.append("documentiIniziali", new File(["atto"], "istanza.pdf", { type: "application/pdf" }));

    await expect(createFascicoloIntakeAction(data)).rejects.toThrow(
      "REDIRECT:/procedimenti/fascicolo-1",
    );

    expect(uploadDocumentMock).toHaveBeenCalledWith(expect.objectContaining({
      fascicoloIntakeId: "fascicolo-1",
      enteId: "ente-a",
      nome: "istanza.pdf",
      tipologia: "NOTA",
    }));
  });

  it("collega facoltativamente una concessione reale e ne usa il tenant", async () => {
    prismaMock.concessione.findUnique.mockResolvedValue({ enteId: "ente-b" });

    await expect(createFascicoloIntakeAction(formData("con-1"))).rejects.toThrow(
      "REDIRECT:/procedimenti/fascicolo-1",
    );

    expect(requireConcessioneTenantAccessMock).toHaveBeenCalledWith(
      expect.anything(),
      "con-1",
      { mode: "write", allowWhenEnteMissing: false },
    );
    expect(prismaMock.fascicoloIntake.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ enteId: "ente-b", concessioneId: "con-1" }),
    });
  });

  it("richiede un titolo comprensibile", async () => {
    const data = formData();
    data.delete("titoloFascicolo");

    await expect(createFascicoloIntakeAction(data)).rejects.toThrow(
      "Inserisci il titolo del fascicolo.",
    );
    expect(prismaMock.fascicoloIntake.create).not.toHaveBeenCalled();
  });

  it("richiede la selezione del tipo", async () => {
    const data = formData();
    data.delete("tipologiaConcessioneIniziale");

    await expect(createFascicoloIntakeAction(data)).rejects.toThrow(
      "Seleziona il tipo del fascicolo.",
    );
    expect(prismaMock.fascicoloIntake.create).not.toHaveBeenCalled();
  });

  it("mantiene facoltativi i dati della concessione", async () => {
    await expect(createFascicoloIntakeAction(formData())).rejects.toThrow(
      "REDIRECT:/procedimenti/fascicolo-1",
    );

    expect(prismaMock.fascicoloIntake.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        concessioneId: null,
        enteConcedente: null,
        numeroConcessione: null,
        decorrenza: null,
        scadenza: null,
        oggettoConcessione: null,
        localita: null,
      }),
    });
  });

  it("rifiuta un fascicolo scollegato se manca il tenant predefinito", async () => {
    getCurrentTenantContextMock.mockResolvedValue({
      userId: "user-1",
      role: "GIURIDICO",
      isAdmin: true,
      defaultTenantId: null,
      accessibleTenantIds: [],
    });

    await expect(createFascicoloIntakeAction(formData())).rejects.toThrow(
      "Seleziona un tenant predefinito",
    );
    expect(prismaMock.fascicoloIntake.create).not.toHaveBeenCalled();
  });
});
