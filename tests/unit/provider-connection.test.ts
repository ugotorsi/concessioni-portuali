import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditSuccess: vi.fn(),
  auditFailure: vi.fn(),
}));

vi.mock("@/server/audit/auditLog", () => ({
  auditSuccess: mocks.auditSuccess,
  auditFailure: mocks.auditFailure,
}));

import { verifyAiProviderConnection } from "@/server/ai/providerConnection";

const actor = {
  userId: "admin-1",
  userEmail: "admin@example.test",
  userRole: "ADMIN" as const,
};
const fingerprintEnvironment = {
  NEXTAUTH_SECRET: "test-fingerprint-secret-at-least-32-characters",
};

describe("AI provider connection verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditSuccess.mockResolvedValue(undefined);
    mocks.auditFailure.mockResolvedValue(undefined);
  });

  it("does not issue a request when the credential is absent", async () => {
    const fetch = vi.fn();
    const result = await verifyAiProviderConnection({
      provider: "ANTHROPIC",
      actor,
      environment: {},
      fetch,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      verified: false,
      code: "AI_PROVIDER_CREDENTIAL_MISSING",
      generationRequested: false,
      expectedGenerationCostEur: 0,
    });
  });

  it("verifies the DeepSeek model and sufficient balance with read-only GETs", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "deepseek-v4-pro" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        is_available: true,
        balance_infos: [{
          currency: "USD",
          total_balance: "5.00",
          granted_balance: "0.00",
          topped_up_balance: "5.00",
        }],
      }), { status: 200 }));
    const result = await verifyAiProviderConnection({
      provider: "DEEPSEEK",
      actor,
      environment: {
        ...fingerprintEnvironment,
        AI_DEEPSEEK_API_KEY: "secret-value",
      },
      fetch,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.deepseek.com/models",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://api.deepseek.com/user/balance",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty("body");
    expect(fetch.mock.calls[1]?.[1]).not.toHaveProperty("body");
    expect(result).toMatchObject({
      verified: true,
      credentialValid: true,
      modelAvailable: true,
      balanceSufficient: true,
      modelTechnicallyQualified: false,
      generationRequested: false,
      expectedGenerationCostEur: 0,
    });
    const auditInput = mocks.auditSuccess.mock.calls[0]?.[0];
    expect(JSON.stringify(auditInput)).not.toContain("secret-value");
    expect(JSON.stringify(auditInput)).not.toContain(fingerprintEnvironment.NEXTAUTH_SECRET);
    expect(auditInput.metadata).toMatchObject({
      credentialValueLogged: false,
      expectedGenerationCostEur: 0,
      modelAvailable: true,
      balanceSufficient: true,
    });
  });

  it.each([
    {
      name: "available balance response",
      response: new Response(JSON.stringify({
        is_available: false,
        balance_infos: [],
      }), { status: 200 }),
      expectedHttpStatus: 200,
    },
    {
      name: "HTTP 402",
      response: new Response(JSON.stringify({
        error: { type: "invalid_request_error" },
      }), { status: 402 }),
      expectedHttpStatus: 402,
    },
  ])("rejects DeepSeek verification for insufficient balance via $name", async ({
    response,
    expectedHttpStatus,
  }) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "deepseek-v4-pro" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(response);

    const result = await verifyAiProviderConnection({
      provider: "DEEPSEEK",
      actor,
      environment: {
        ...fingerprintEnvironment,
        AI_DEEPSEEK_API_KEY: "secret-value",
      },
      fetch,
    });

    expect(result).toMatchObject({
      verified: false,
      credentialValid: true,
      modelAvailable: true,
      balanceSufficient: false,
      httpStatus: expectedHttpStatus,
      code: "AI_PROVIDER_BALANCE_INSUFFICIENT",
      generationRequested: false,
      expectedGenerationCostEur: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.auditFailure).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.auditFailure.mock.calls)).not.toContain("secret-value");
  });

  it("classifies a model-list HTTP 402 as insufficient balance", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { type: "invalid_request_error" },
    }), { status: 402 }));

    const result = await verifyAiProviderConnection({
      provider: "DEEPSEEK",
      actor,
      environment: {
        ...fingerprintEnvironment,
        AI_DEEPSEEK_API_KEY: "secret-value",
      },
      fetch,
    });

    expect(result).toMatchObject({
      verified: false,
      balanceSufficient: false,
      httpStatus: 402,
      code: "AI_PROVIDER_BALANCE_INSUFFICIENT",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a valid credential when the configured model is not listed", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "different-model" }],
    }), { status: 200 }));
    const result = await verifyAiProviderConnection({
      provider: "ANTHROPIC",
      actor,
      environment: {
        ...fingerprintEnvironment,
        AI_ANTHROPIC_API_KEY: "secret-value",
      },
      fetch,
    });

    expect(result).toMatchObject({
      verified: false,
      credentialValid: true,
      modelAvailable: false,
      code: "AI_PROVIDER_MODEL_UNAVAILABLE",
    });
    expect(mocks.auditFailure).toHaveBeenCalledOnce();
  });

  it("classifies rejected credentials without reading or persisting a response body", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("sensitive provider body", { status: 401 }));
    const result = await verifyAiProviderConnection({
      provider: "OPENAI",
      actor,
      environment: {
        ...fingerprintEnvironment,
        AI_OPENAI_API_KEY: "secret-value",
      },
      fetch,
    });

    expect(result.code).toBe("AI_PROVIDER_CREDENTIAL_REJECTED");
    expect(JSON.stringify(mocks.auditFailure.mock.calls)).not.toContain("secret-value");
    expect(JSON.stringify(mocks.auditFailure.mock.calls)).not.toContain("sensitive provider body");
  });

  it("classifies network failures without retrying", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
    const result = await verifyAiProviderConnection({
      provider: "ANTHROPIC",
      actor,
      environment: {
        ...fingerprintEnvironment,
        AI_ANTHROPIC_API_KEY: "secret-value",
      },
      fetch,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.code).toBe("AI_PROVIDER_CONNECTION_UNREACHABLE");
    expect(result.expectedGenerationCostEur).toBe(0);
  });

  it("aborts a connection check at the fixed timeout without retrying", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => (
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        })
      ));
      const verification = verifyAiProviderConnection({
        provider: "OPENAI",
        actor,
        environment: {
          ...fingerprintEnvironment,
          AI_OPENAI_API_KEY: "secret-value",
        },
        fetch: fetch as typeof globalThis.fetch,
      });

      await vi.advanceTimersByTimeAsync(8_000);
      await expect(verification).resolves.toMatchObject({
        verified: false,
        code: "AI_PROVIDER_CONNECTION_TIMEOUT",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
