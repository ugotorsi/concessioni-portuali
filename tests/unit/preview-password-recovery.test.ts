import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPreviewPasswordRecoveryConfig,
  isPreviewPasswordRecoveryEnabled,
  PreviewPasswordRecoveryError,
  requireVerifiedWorkosIdentity,
  sendWorkosMagicAuthCode,
  verifyWorkosMagicAuthCode,
} from "@/server/auth/preview-password-recovery";

const config = {
  apiKey: "sk_test_value",
  clientId: "client_test_value",
};

describe("Preview password recovery WorkOS binding", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is fail-closed outside an explicitly enabled Preview", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PREVIEW_PASSWORD_RECOVERY_ENABLED", "true");
    vi.stubEnv("WORKOS_API_KEY", config.apiKey);
    vi.stubEnv("WORKOS_CLIENT_ID", config.clientId);

    expect(isPreviewPasswordRecoveryEnabled()).toBe(false);
    expect(getPreviewPasswordRecoveryConfig()).toBeNull();
  });

  it("requires both WorkOS credentials when Preview recovery is enabled", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PREVIEW_PASSWORD_RECOVERY_ENABLED", "true");
    vi.stubEnv("WORKOS_API_KEY", config.apiKey);

    expect(getPreviewPasswordRecoveryConfig()).toBeNull();

    vi.stubEnv("WORKOS_CLIENT_ID", config.clientId);
    expect(getPreviewPasswordRecoveryConfig()).toEqual(config);
  });

  it("accepts only a verified WorkOS user bound to the immutable local ID", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      id: "workos-user",
      email: "owner@example.com",
      email_verified: true,
      external_id: "local-user",
    }));

    await expect(requireVerifiedWorkosIdentity({
      localUserId: "local-user",
      email: "owner@example.com",
      config,
      fetcher,
    })).resolves.toMatchObject({ external_id: "local-user" });

    fetcher.mockResolvedValueOnce(Response.json({
      id: "workos-user",
      email: "owner@example.com",
      email_verified: true,
      external_id: "different-user",
    }));
    await expect(requireVerifiedWorkosIdentity({
      localUserId: "local-user",
      email: "owner@example.com",
      config,
      fetcher,
    })).rejects.toMatchObject({
      code: "WORKOS_IDENTITY_MISMATCH",
    } satisfies Partial<PreviewPasswordRecoveryError>);
  });

  it("requests email delivery without exposing the returned Magic Auth code", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      id: "magic-auth",
      code: "123456",
    }));

    await sendWorkosMagicAuthCode({
      email: "owner@example.com",
      config,
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.workos.com/user_management/magic_auth",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("owner@example.com"),
      }),
    );
  });

  it("distinguishes identity lookup failures from Magic Auth delivery failures", async () => {
    const identityFetcher = vi.fn().mockResolvedValue(Response.json(
      { message: "User not found", code: "not_found" },
      { status: 404, headers: { "x-request-id": "request_identity" } },
    ));
    await expect(requireVerifiedWorkosIdentity({
      localUserId: "local-user",
      email: "owner@example.com",
      config,
      fetcher: identityFetcher,
    })).rejects.toMatchObject({
      code: "WORKOS_IDENTITY_UNAVAILABLE",
      diagnostic: {
        stage: "IDENTITY_LOOKUP",
        httpStatus: 404,
        providerCode: "not_found",
        providerRequestId: "request_identity",
      },
    } satisfies Partial<PreviewPasswordRecoveryError>);

    const magicFetcher = vi.fn().mockResolvedValue(Response.json(
      { message: "Magic Auth email is disabled", code: "email_disabled" },
      { status: 403 },
    ));
    await expect(sendWorkosMagicAuthCode({
      email: "owner@example.com",
      config,
      fetcher: magicFetcher,
    })).rejects.toMatchObject({
      code: "WORKOS_MAGIC_AUTH_UNAVAILABLE",
      diagnostic: {
        stage: "MAGIC_AUTH_CREATE",
        httpStatus: 403,
        providerCode: "email_disabled",
      },
    } satisfies Partial<PreviewPasswordRecoveryError>);
  });

  it("verifies the one-time code and rechecks email plus external ID", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      user: {
        id: "workos-user",
        email: "owner@example.com",
        email_verified: true,
        external_id: "local-user",
      },
      access_token: "must-not-be-used",
      refresh_token: "must-not-be-used",
    }));

    await expect(verifyWorkosMagicAuthCode({
      email: "owner@example.com",
      code: "123456",
      localUserId: "local-user",
      config,
      fetcher,
    })).resolves.toMatchObject({
      email: "owner@example.com",
      external_id: "local-user",
    });
  });
});
