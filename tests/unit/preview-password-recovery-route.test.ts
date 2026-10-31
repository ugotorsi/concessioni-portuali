import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const verifyCodeMock = vi.hoisted(() => vi.fn());
const requireIdentityMock = vi.hoisted(() => vi.fn());
const sendCodeMock = vi.hoisted(() => vi.fn());
const auditInTransactionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: findUniqueMock },
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  buildRateLimitKey: vi.fn(() => "request-key"),
  getClientIp: vi.fn(() => "192.0.2.1"),
  createRateLimitResponse: vi.fn(() => Response.json({ error: "RATE_LIMITED" }, { status: 429 })),
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 4,
    retryAfterSeconds: 0,
    resetAt: new Date(Date.now() + 60_000),
  }),
}));

vi.mock("@/server/audit/auditLog", () => ({
  auditFailure: vi.fn().mockResolvedValue(undefined),
  createAuditLogInTransaction: auditInTransactionMock,
}));

vi.mock("@/server/auth/preview-password-recovery", () => ({
  PreviewPasswordRecoveryError: class PreviewPasswordRecoveryError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  getPreviewPasswordRecoveryConfig: vi.fn(() => ({
    apiKey: "sk_test",
    clientId: "client_test",
  })),
  requireVerifiedWorkosIdentity: requireIdentityMock,
  sendWorkosMagicAuthCode: sendCodeMock,
  verifyWorkosMagicAuthCode: verifyCodeMock,
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn().mockResolvedValue(false),
    hash: vi.fn().mockResolvedValue("new-password-hash"),
  },
}));

function recoverableUser() {
  return {
    id: "existing-user",
    email: "owner@example.com",
    ruolo: "ADMIN",
    attivo: true,
    mfaEnabled: true,
    mfaSecret: "encrypted-secret",
    mfaVerifiedAt: new Date("2026-10-01T00:00:00.000Z"),
  };
}

describe("Preview password recovery route", () => {
  beforeEach(() => {
    findUniqueMock.mockReset().mockResolvedValue(recoverableUser());
    updateMock.mockReset().mockResolvedValue({});
    auditInTransactionMock.mockReset().mockResolvedValue({});
    verifyCodeMock.mockReset().mockResolvedValue({
      id: "workos-user",
      email: "owner@example.com",
      email_verified: true,
      external_id: "existing-user",
    });
    requireIdentityMock.mockReset().mockResolvedValue({});
    sendCodeMock.mockReset().mockResolvedValue(undefined);
    transactionMock.mockReset().mockImplementation(async (callback) => callback({
      user: {
        findUnique: findUniqueMock,
        update: updateMock,
      },
    }));
  });

  it("sends recovery only after checking the immutable WorkOS binding", async () => {
    const { POST } = await import("@/app/api/auth/password-recovery/route");
    const response = await POST(new Request("https://preview.example/api/auth/password-recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", email: "owner@example.com" }),
    }));

    expect(response.status).toBe(202);
    expect(requireIdentityMock).toHaveBeenCalledWith(expect.objectContaining({
      localUserId: "existing-user",
      email: "owner@example.com",
    }));
    expect(sendCodeMock).toHaveBeenCalledOnce();
  });

  it("updates only password security state while preserving MFA and assignments", async () => {
    const { POST } = await import("@/app/api/auth/password-recovery/route");
    const response = await POST(new Request("https://preview.example/api/auth/password-recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        email: "owner@example.com",
        code: "123456",
        password: "Strong!Credential42",
      }),
    }));

    expect(response.status).toBe(200);
    expect(verifyCodeMock).toHaveBeenCalledWith(expect.objectContaining({
      localUserId: "existing-user",
      email: "owner@example.com",
    }));
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "existing-user" },
      data: {
        passwordHash: "new-password-hash",
        passwordChangedAt: expect.any(Date),
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
        mustChangePassword: false,
      },
    });
    expect(updateMock.mock.calls[0]?.[0]?.data).not.toHaveProperty("mfaEnabled");
    expect(updateMock.mock.calls[0]?.[0]?.data).not.toHaveProperty("mfaSecret");
    expect(updateMock.mock.calls[0]?.[0]?.data).not.toHaveProperty("email");
    expect(updateMock.mock.calls[0]?.[0]?.data).not.toHaveProperty("tenantMemberships");
    expect(auditInTransactionMock).toHaveBeenCalledOnce();
  });
});
