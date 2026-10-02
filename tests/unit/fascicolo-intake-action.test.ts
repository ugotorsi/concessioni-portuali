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
  data.set("oggettoFascicolo", "Concessione stabilimento balneare");
  data.set("denominazioneBreve", "Fascicolo Alfa");
  data.set("soggettoAssistito", "Società Alfa");
  data.set("noteIstruttorie", "Verificare gli atti disponibili.");
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
      "REDIRECT:/procedimenti/fascicolo-1#documenti",
    );

    expect(requireConcessioneTenantAccessMock).not.toHaveBeenCalled();
    expect(prismaMock.fascicoloIntake.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        enteId: "ente-a",
        concessioneId: null,
        oggettoFascicolo: "Concessione stabilimento balneare",
        soggettoAssistito: "Società Alfa",
      }),
    });
  });

  it("collega i documenti iniziali al fascicolo creato", async () => {
    const data = formData();
    data.append("documentiIniziali", new File(["atto"], "istanza.pdf", { type: "application/pdf" }));

    await expect(createFascicoloIntakeAction(data)).rejects.toThrow(
      "REDIRECT:/procedimenti/fascicolo-1#documenti",
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
      "REDIRECT:/procedimenti/fascicolo-1#documenti",
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
