import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentRoleMock = vi.hoisted(() => vi.fn());
const runDbReconPreviewTempMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentRole: getCurrentRoleMock,
}));

vi.mock("@/server/db-recon-preview-temp", async () => {
  const actual = await vi.importActual<typeof import("@/server/db-recon-preview-temp")>(
    "@/server/db-recon-preview-temp",
  );

  return {
    ...actual,
    runDbReconPreviewTemp: runDbReconPreviewTempMock,
  };
});

import { GET } from "@/app/api/admin/db-recon-preview-temp/route";

const ORIGINAL_ENV = { ...process.env };

describe("GET /api/admin/db-recon-preview-temp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "staging-operativo";
    process.env.VERCEL_GIT_COMMIT_SHA = "abc1234567890";

    getCurrentRoleMock.mockResolvedValue("ADMIN");
    runDbReconPreviewTempMock.mockResolvedValue({
      connected: true,
      currentDatabase: "concessioni_staging",
      currentSchema: "public",
      postgresVersion: "PostgreSQL 16.4",
      prismaMigrationsPresent: true,
      prismaMigrationsCount: 2,
      publicTablesCount: 10,
      tablesPresence: {
        Ente: true,
        User: true,
        Concessione: true,
        Procedimento: true,
        DecisioneProcedimento: true,
      },
      enumsPresence: {
        TipoDecisioneProcedimento: true,
        EffettoTitoloProcedimento: true,
        StatoEffettoProcedimento: true,
      },
      columnsPresence: {
        statoEffetto: true,
        effettoApplicatoAt: true,
        effectVersion: true,
      },
      decisioneProcedimentoIndexesCount: 8,
      decisioneProcedimentoConstraintsCount: 6,
      recordCounts: {
        Ente: 1,
        User: 5,
        Concessione: 3,
        Procedimento: 2,
        DecisioneProcedimento: 1,
      },
    });
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentRoleMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 403 when role is not ADMIN", async () => {
    getCurrentRoleMock.mockResolvedValue("GIURIDICO");

    const response = await GET();

    expect(response.status).toBe(403);
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 403 when runtime is not preview", async () => {
    process.env.VERCEL_ENV = "production";

    const response = await GET();

    expect(response.status).toBe(403);
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 403 when branch is not staging-operativo", async () => {
    process.env.VERCEL_GIT_COMMIT_REF = "main";

    const response = await GET();

    expect(response.status).toBe(403);
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns no-store and does not leak secret-like fields", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload.environment).toBe("preview");
    expect(payload.branch).toBe("staging-operativo");
    expect(payload.commit).toBe("abc123456789");

    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toContain("database_url");
    expect(serialized).not.toContain("direct_url");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("postgresql://");
  });
});