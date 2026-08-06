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
    const findFirstMock = vi.fn();
    const updateMock = vi.fn();
    const compareMock = vi.fn();

    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        user: {
          findMany: findManyMock,
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
      authOptions: nextAuthModule.authOptions,
      tryStagingAdminBypass: nextAuthModule.tryStagingAdminBypass,
      findManyMock,
      findFirstMock,
      updateMock,
      compareMock,
    };
  }

  it("denies bypass when STAGING_ADMIN_BYPASS is not true", async () => {
    setBypassEnv(false, "preview");

    const { tryStagingAdminBypass, findManyMock, findFirstMock, updateMock } = await loadAuthModule();

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toBeNull();
    expect(findManyMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("denies bypass when VERCEL_ENV is not preview", async () => {
    setBypassEnv(true, "production");

    const { tryStagingAdminBypass, findManyMock, findFirstMock, updateMock } = await loadAuthModule();

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toBeNull();
    expect(findManyMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("denies bypass when STAGING_ADMIN_BYPASS is absent in preview", async () => {
    setBypassEnv(true, "preview");
    delete process.env.STAGING_ADMIN_BYPASS;

    const { tryStagingAdminBypass, findManyMock, findFirstMock, updateMock } = await loadAuthModule();

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result).toBeNull();
    expect(findManyMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns technical ADMIN identity in preview when bypass is enabled", async () => {
    setBypassEnv(true, "preview");

    const { tryStagingAdminBypass, findManyMock, findFirstMock, updateMock, compareMock } =
      await loadAuthModule();

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(findManyMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: "staging-preview-admin",
      email: "staging-admin@preview.invalid",
      name: "Amministratore staging",
      role: "ADMIN",
    });
  });

  it("does not run bypass for non-bypass credentials payload", async () => {
    setBypassEnv(true, "preview");

    const { tryStagingAdminBypass, findManyMock, findFirstMock, updateMock } = await loadAuthModule();

    const result = await tryStagingAdminBypass({});

    expect(result).toBeNull();
    expect(findManyMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("session callbacks preserve technical ADMIN role and id", async () => {
    setBypassEnv(true, "preview");

    const { authOptions, tryStagingAdminBypass } = await loadAuthModule();

    const bypassUser = await tryStagingAdminBypass({ stagingBypass: "true" });
    expect(bypassUser).not.toBeNull();

    const jwtCallback = authOptions.callbacks?.jwt;
    const sessionCallback = authOptions.callbacks?.session;

    expect(jwtCallback).toBeDefined();
    expect(sessionCallback).toBeDefined();

    const token = await jwtCallback!({ token: {}, user: bypassUser! } as never);
    expect(token.id).toBe("staging-preview-admin");
    expect(token.role).toBe("ADMIN");

    const session = await sessionCallback!(
      {
        session: {
          user: {
            name: bypassUser!.name,
            email: bypassUser!.email,
            image: null,
          },
          expires: "2099-01-01T00:00:00.000Z",
        },
        token,
      } as never,
    );

    expect(session.user?.role).toBe("ADMIN");
    expect(session.user?.id).toBe("staging-preview-admin");
    expect(session.user?.name).toBe("Amministratore staging");
    expect(session.user?.email).toBe("staging-admin@preview.invalid");
  });

  it("allows bypass regardless of other ADMIN records because bypass is database-free", async () => {
    setBypassEnv(true, "preview");

    const { tryStagingAdminBypass, findManyMock, findFirstMock, updateMock, compareMock } =
      await loadAuthModule();

    const result = await tryStagingAdminBypass({ stagingBypass: "true" });

    expect(result?.role).toBe("ADMIN");
    expect(findManyMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
  });
});
