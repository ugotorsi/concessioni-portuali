import { beforeEach, describe, expect, it, vi } from "vitest";

function setBypassEnv(enabled: boolean, vercelEnv: string) {
  if (enabled) {
    process.env.STAGING_ADMIN_BYPASS = "true";
  } else {
    delete process.env.STAGING_ADMIN_BYPASS;
  }

  process.env.VERCEL_ENV = vercelEnv;
}

describe("next-auth staging admin bypass", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.STAGING_ADMIN_BYPASS;
    delete process.env.VERCEL_ENV;
  });

  async function loadAuthModule() {
    const findManyMock = vi.fn();
    const updateMock = vi.fn();
    const compareMock = vi.fn();

    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        user: {
          findMany: findManyMock,
          findUnique: vi.fn(),
          update: updateMock,
        },
      },
    }));

    vi.doMock("bcryptjs", () => ({
      default: { compare: compareMock },
      compare: compareMock,
    }));

    const nextAuthModule = await import("@/lib/next-auth");

    return {
      tryStagingAdminBypass: nextAuthModule.tryStagingAdminBypass,
      findManyMock,
      updateMock,
      compareMock,
    };
  }

  it("allows bypass only in preview with STAGING_ADMIN_BYPASS=true and returns ADMIN session payload", async () => {
    setBypassEnv(true, "preview");

    const { tryStagingAdminBypass, findManyMock, updateMock, compareMock } = await loadAuthModule();

    findManyMock.mockResolvedValue([
      {
        id: "admin-1",
        email: "admin@example.it",
        nome: "Admin",
        ruolo: "ADMIN",
      },
    ]);
    updateMock.mockResolvedValue({});

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        ruolo: "ADMIN",
        attivo: true,
      },
      select: {
        id: true,
        email: true,
        nome: true,
        ruolo: true,
      },
    });
    expect(compareMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: "admin-1",
      email: "admin@example.it",
      name: "Admin",
      role: "ADMIN",
    });
  });

  it("denies bypass in production even if STAGING_ADMIN_BYPASS=true", async () => {
    setBypassEnv(true, "production");

    const { tryStagingAdminBypass, findManyMock, updateMock, compareMock } = await loadAuthModule();

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toBeNull();
    expect(findManyMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("denies bypass when no active ADMIN exists", async () => {
    setBypassEnv(true, "preview");

    const { tryStagingAdminBypass, findManyMock, updateMock, compareMock } = await loadAuthModule();

    findManyMock.mockResolvedValue([]);

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toBeNull();
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("denies bypass when multiple active ADMIN users exist", async () => {
    setBypassEnv(true, "preview");

    const { tryStagingAdminBypass, findManyMock, updateMock, compareMock } = await loadAuthModule();

    findManyMock.mockResolvedValue([
      { id: "admin-1", email: "admin-1@example.it", nome: "Admin One", ruolo: "ADMIN" },
      { id: "admin-2", email: "admin-2@example.it", nome: "Admin Two", ruolo: "ADMIN" },
    ]);

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toBeNull();
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
  });
});
