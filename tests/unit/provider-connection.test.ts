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

  it("uses only the provider model-list endpoint with GET and records zero generation cost", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const result = await verifyAiProviderConnection({
      provider: "DEEPSEEK",
      actor,
      environment: { AI_DEEPSEEK_API_KEY: "secret-value" },
      fetch,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.deepseek.com/models",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty("body");
    expect(result).toMatchObject({
      verified: true,
      generationRequested: false,
      expectedGenerationCostEur: 0,
    });
    const auditInput = mocks.auditSuccess.mock.calls[0]?.[0];
    expect(JSON.stringify(auditInput)).not.toContain("secret-value");
    expect(auditInput.metadata).toMatchObject({
      credentialValueLogged: false,
      expectedGenerationCostEur: 0,
    });
  });

  it("classifies rejected credentials without reading or persisting a response body", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("sensitive provider body", { status: 401 }));
    const result = await verifyAiProviderConnection({
      provider: "OPENAI",
      actor,
      environment: { AI_OPENAI_API_KEY: "secret-value" },
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
      environment: { AI_ANTHROPIC_API_KEY: "secret-value" },
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
        environment: { AI_OPENAI_API_KEY: "secret-value" },
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
