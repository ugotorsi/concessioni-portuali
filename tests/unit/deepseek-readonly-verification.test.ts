import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminWithMfa: vi.fn(),
  verifyAiProviderConnection: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAdminWithMfa: mocks.requireAdminWithMfa,
}));
vi.mock("@/server/ai/providerConnection", () => ({
  verifyAiProviderConnection: mocks.verifyAiProviderConnection,
}));

import { POST } from
  "@/app/api/admin/deepseek-readonly-verification/route";
import {
  assertDeepSeekReadOnlyVerificationRequest,
  deepSeekReadOnlyVerificationOrigin,
  isDeepSeekReadOnlyVerificationDeployment,
  isDeepSeekReadOnlyVerificationRequestAllowed,
  isTrustedDeepSeekReadOnlyVerificationMutation,
} from "@/server/ai/deepSeekReadOnlyVerificationDeployment";

const environment = {
  NOETRA_DEEPSEEK_READONLY_VERIFICATION_ENABLED: "true",
  NOETRA_DEEPSEEK_READONLY_VERIFICATION_AUTHORIZATION_ID:
    "GH_ISSUE_70_2026_11_07_DEEPSEEK_READONLY",
  VERCEL_ENV: "production",
  VERCEL_URL: "isolated-check.example.vercel.app",
  VERCEL_PROJECT_ID: "prj_Dg5N94gGCa5DmJbI44bS0TOwcJiu",
  VERCEL_DEPLOYMENT_ID: "dpl_IsolatedReadOnly123",
};

describe("isolated DeepSeek read-only verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "NOETRA_DEEPSEEK_READONLY_VERIFICATION_ENABLED",
      environment.NOETRA_DEEPSEEK_READONLY_VERIFICATION_ENABLED,
    );
    vi.stubEnv(
      "NOETRA_DEEPSEEK_READONLY_VERIFICATION_AUTHORIZATION_ID",
      environment.NOETRA_DEEPSEEK_READONLY_VERIFICATION_AUTHORIZATION_ID,
    );
    vi.stubEnv("VERCEL_ENV", environment.VERCEL_ENV);
    vi.stubEnv("VERCEL_URL", environment.VERCEL_URL);
    vi.stubEnv("VERCEL_PROJECT_ID", environment.VERCEL_PROJECT_ID);
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", environment.VERCEL_DEPLOYMENT_ID);
    mocks.requireAdminWithMfa.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.test",
    });
    mocks.verifyAiProviderConnection.mockResolvedValue({
      provider: "DEEPSEEK",
      verified: true,
    });
  });

  it("binds the deployment to its generated protected URL", () => {
    expect(isDeepSeekReadOnlyVerificationDeployment(environment)).toBe(true);
    expect(deepSeekReadOnlyVerificationOrigin(environment))
      .toBe("https://isolated-check.example.vercel.app");
    expect(() => assertDeepSeekReadOnlyVerificationRequest({
      env: environment,
      requestHost: "isolated-check.example.vercel.app",
    })).not.toThrow();
    expect(() => assertDeepSeekReadOnlyVerificationRequest({
      env: environment,
      requestHost: "app.noetra.it",
    })).toThrow("DEEPSEEK_READONLY_VERIFICATION_DEPLOYMENT_REJECTED");
  });

  it("allows only auth, the dedicated page, assets and its server action", () => {
    expect(isDeepSeekReadOnlyVerificationRequestAllowed({
      pathname: "/admin/deepseek-readonly-verification",
      hasNextActionHeader: false,
    })).toBe(true);
    expect(isDeepSeekReadOnlyVerificationRequestAllowed({
      pathname: "/admin/deepseek-readonly-verification",
      hasNextActionHeader: true,
    })).toBe(false);
    expect(isDeepSeekReadOnlyVerificationRequestAllowed({
      pathname: "/admin/runtime",
      hasNextActionHeader: false,
    })).toBe(false);
    expect(isDeepSeekReadOnlyVerificationRequestAllowed({
      pathname: "/api/admin/ai-live-qualification",
      hasNextActionHeader: false,
    })).toBe(false);
  });

  it("accepts only a same-origin form mutation", () => {
    expect(isTrustedDeepSeekReadOnlyVerificationMutation({
      env: environment,
      request: request(),
    })).toBe(true);
    expect(isTrustedDeepSeekReadOnlyVerificationMutation({
      env: environment,
      request: request({ origin: "https://app.noetra.it" }),
    })).toBe(false);
    expect(isTrustedDeepSeekReadOnlyVerificationMutation({
      env: environment,
      request: request({ contentType: "application/json" }),
    })).toBe(false);
  });

  it("requires ADMIN+MFA before two-GET verification", async () => {
    const result = await POST(request());

    expect(mocks.requireAdminWithMfa).toHaveBeenCalledOnce();
    expect(mocks.verifyAiProviderConnection).toHaveBeenCalledWith({
      provider: "DEEPSEEK",
      actor: {
        userId: "admin-1",
        userEmail: "admin@example.test",
        userRole: "ADMIN",
      },
    });
    expect(result.status).toBe(303);
    expect(result.headers.get("location"))
      .toBe("https://isolated-check.example.vercel.app/admin/deepseek-readonly-verification");
  });

  it("rejects unauthenticated access without provider calls", async () => {
    mocks.requireAdminWithMfa.mockRejectedValue(
      new Error("AUTHENTICATION_REQUIRED"),
    );

    const result = await POST(request());

    expect(result.status).toBe(401);
    expect(mocks.verifyAiProviderConnection).not.toHaveBeenCalled();
  });

  it("rejects a wrong host before authentication or provider access", async () => {
    const result = await POST(request({ host: "app.noetra.it" }));

    expect(result.status).toBe(404);
    expect(mocks.requireAdminWithMfa).not.toHaveBeenCalled();
    expect(mocks.verifyAiProviderConnection).not.toHaveBeenCalled();
  });

  it("rejects arbitrary Server Actions and unrelated POST routes fail closed", () => {
    expect(isDeepSeekReadOnlyVerificationRequestAllowed({
      pathname: "/admin/deepseek-readonly-verification",
      hasNextActionHeader: true,
    })).toBe(false);
    expect(isDeepSeekReadOnlyVerificationRequestAllowed({
      pathname: "/api/admin/runtime-health",
      hasNextActionHeader: false,
    })).toBe(false);
  });
});

function request(input: {
  readonly host?: string;
  readonly origin?: string;
  readonly contentType?: string;
} = {}): Request {
  const body = new URLSearchParams({
    confirmation: "VERIFY_DEEPSEEK_READONLY",
  });
  return new Request(
    `https://${input.host ?? environment.VERCEL_URL}/api/admin/deepseek-readonly-verification`,
    {
      method: "POST",
      headers: {
        host: input.host ?? environment.VERCEL_URL,
        origin: input.origin ?? `https://${environment.VERCEL_URL}`,
        "content-type": input.contentType
          ?? "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
      redirect: "manual",
    },
  );
}
