import { beforeEach, describe, expect, it, vi } from "vitest";

function setBypassEnv(enabled: boolean, vercelEnv: string, stagingAdminEmail?: string) {
  if (enabled) {
    process.env.STAGING_ADMIN_BYPASS = "true";
  } else {
    delete process.env.STAGING_ADMIN_BYPASS;
  }

  process.env.VERCEL_ENV = vercelEnv;

  if (typeof stagingAdminEmail === "string") {
    process.env.STAGING_ADMIN_EMAIL = stagingAdminEmail;
  } else {
    delete process.env.STAGING_ADMIN_EMAIL;
  }
}

describe("next-auth staging admin bypass", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.STAGING_ADMIN_BYPASS;
    delete process.env.VERCEL_ENV;
    delete process.env.STAGING_ADMIN_EMAIL;
  });

  async function loadAuthModule() {
    const findFirstMock = vi.fn();
    const updateMock = vi.fn();
    const compareMock = vi.fn();

    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        user: {
          findFirst: findFirstMock,
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
      findFirstMock,
      updateMock,
      compareMock,
    };
  }

  it("denies bypass when STAGING_ADMIN_BYPASS is not true", async () => {
    setBypassEnv(false, "preview", "admin@example.it");

    const { tryStagingAdminBypass, findFirstMock, updateMock } = await loadAuthModule();

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("denies bypass when VERCEL_ENV is not preview", async () => {
    setBypassEnv(true, "production", "admin@example.it");

    const { tryStagingAdminBypass, findFirstMock, updateMock } = await loadAuthModule();

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("denies bypass when STAGING_ADMIN_EMAIL is missing", async () => {
    setBypassEnv(true, "preview");

    const { tryStagingAdminBypass, findFirstMock, updateMock } = await loadAuthModule();

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("allows bypass for configured active ADMIN and returns ADMIN session payload", async () => {
    setBypassEnv(true, "preview", "admin@example.it");

    const { tryStagingAdminBypass, findFirstMock, updateMock, compareMock } = await loadAuthModule();

    findFirstMock.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.it",
      nome: "Admin",
      ruolo: "ADMIN",
    });
    updateMock.mockResolvedValue({});

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(findFirstMock).toHaveBeenCalledTimes(1);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        email: {
          equals: "admin@example.it",
          mode: "insensitive",
        },
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

  it("denies bypass when configured user does not exist", async () => {
    setBypassEnv(true, "preview", "admin@example.it");

    const { tryStagingAdminBypass, findFirstMock, updateMock, compareMock } = await loadAuthModule();

    findFirstMock.mockResolvedValue(null);

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toBeNull();
    expect(findFirstMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("denies bypass when configured user is not ADMIN", async () => {
    setBypassEnv(true, "preview", "not-admin@example.it");

    const { tryStagingAdminBypass, findFirstMock, updateMock, compareMock } = await loadAuthModule();

    findFirstMock.mockResolvedValue(null);

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toBeNull();
    expect(findFirstMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("denies bypass when configured user is not active", async () => {
    setBypassEnv(true, "preview", "inactive-admin@example.it");

    const { tryStagingAdminBypass, findFirstMock, updateMock, compareMock } = await loadAuthModule();

    findFirstMock.mockResolvedValue(null);

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toBeNull();
    expect(findFirstMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("allows bypass even when other ADMIN users exist", async () => {
    setBypassEnv(true, "preview", "target-admin@example.it");

    const { tryStagingAdminBypass, findFirstMock, updateMock, compareMock } = await loadAuthModule();

    findFirstMock.mockResolvedValue({
      id: "admin-target",
      email: "target-admin@example.it",
      nome: "Target Admin",
      ruolo: "ADMIN",
    });
    updateMock.mockResolvedValue({});

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toEqual({
      id: "admin-target",
      email: "target-admin@example.it",
      name: "Target Admin",
      role: "ADMIN",
    });
    expect(findFirstMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(compareMock).not.toHaveBeenCalled();
  });
});
