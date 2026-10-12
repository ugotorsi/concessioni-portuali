import * as OTPAuth from "otpauth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const compareMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
      update: updateMock,
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: compareMock },
  compare: compareMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 4,
    retryAfterSeconds: 0,
    resetAt: new Date(Date.now() + 60_000),
  }),
}));

vi.mock("@/server/audit/auditLog", () => ({
  auditFailure: vi.fn().mockResolvedValue(undefined),
  auditSuccess: vi.fn().mockResolvedValue(undefined),
}));

function userRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-admin",
    email: "admin@example.test",
    nome: "Admin",
    ruolo: "ADMIN",
    attivo: true,
    passwordHash: "bcrypt-hash",
    failedLoginAttempts: 0,
    lockedUntil: null,
    mfaEnabled: false,
    mfaSecret: null,
    mustChangePassword: false,
    ...overrides,
  };
}

async function loadAuth() {
  vi.resetModules();
  const { authOptions } = await import("@/lib/next-auth");
  const authorize = authOptions.providers[0]?.options?.authorize as (
    credentials: Record<string, string>,
  ) => Promise<Record<string, unknown> | null>;
  return { authOptions, authorize };
}

describe("NextAuth MFA enforcement", () => {
  beforeEach(() => {
    vi.stubEnv("NEXTAUTH_SECRET", "a-secure-nextauth-secret-with-32-characters");
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    findUniqueMock.mockReset();
    updateMock.mockReset().mockResolvedValue({});
    compareMock.mockReset().mockResolvedValue(true);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("issues only an enrollment-limited identity to an ADMIN without MFA", async () => {
    findUniqueMock.mockResolvedValue(userRecord());
    const { authorize } = await loadAuth();

    const user = await authorize({ email: "admin@example.test", password: "valid-password" });

    expect(user).toMatchObject({
      role: "ADMIN",
      mfaEnrollmentRequired: true,
      mfaVerified: true,
    });
  });

  it("requires a TOTP after a valid password when MFA is enabled", async () => {
    const { encryptMfaSecret, generateMfaSecret } = await import("@/lib/mfa");
    const secret = generateMfaSecret();
    findUniqueMock.mockResolvedValue(userRecord({
      mfaEnabled: true,
      mfaSecret: encryptMfaSecret(secret),
    }));
    const { authorize } = await loadAuth();

    await expect(authorize({
      email: "admin@example.test",
      password: "valid-password",
    })).rejects.toThrow("MFA_REQUIRED");
  });

  it("accepts a valid TOTP and rejects an invalid one", async () => {
    const { encryptMfaSecret, generateMfaSecret } = await import("@/lib/mfa");
    const secret = generateMfaSecret();
    const encryptedSecret = encryptMfaSecret(secret);
    const validCode = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
    findUniqueMock.mockResolvedValue(userRecord({ mfaEnabled: true, mfaSecret: encryptedSecret }));
    const { authorize } = await loadAuth();

    await expect(authorize({
      email: "admin@example.test",
      password: "valid-password",
      mfaCode: "000000",
    })).rejects.toThrow("MFA_INVALID");

    const user = await authorize({
      email: "admin@example.test",
      password: "valid-password",
      mfaCode: validCode,
    });
    expect(user).toMatchObject({ mfaEnrollmentRequired: false, mfaVerified: true });
  });

  it("invalidates an existing JWT session after account deactivation", async () => {
    findUniqueMock.mockResolvedValue({
      attivo: false,
      ruolo: "ADMIN",
      lockedUntil: null,
      mfaEnabled: true,
    });
    const { authOptions } = await loadAuth();
    const sessionCallback = authOptions.callbacks?.session;

    const session = await sessionCallback!({
      session: {
        user: { name: "Admin", email: "admin@example.test", image: null },
        expires: "2099-01-01T00:00:00.000Z",
      },
      token: { id: "user-admin", role: "ADMIN", mfaVerified: true },
    } as never);

    expect(session.user && "id" in session.user ? session.user.id : undefined).toBe("");
    expect(session.user && "role" in session.user ? session.user.role : undefined).toBe("");
  });
});