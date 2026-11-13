import { describe, expect, it, vi } from "vitest";

import { createAutomaticResearchProviderAdapters } from "@/server/legal-research/automatic-research-providers";

describe("automatic research provider selection", () => {
  it("does not read credentials or create adapters for unselected providers", async () => {
    const moonlitTokens = vi.fn().mockResolvedValue({ access_token: "moonlit-token" });
    const simpliciterTokens = vi.fn().mockResolvedValue({ access_token: "simpliciter-token" });

    const adapters = await createAutomaticResearchProviderAdapters({
      requestTimeoutMs: 5_000,
      enabledProviders: ["MOONLIT"],
      moonlitTokenReader: { tokens: moonlitTokens },
      simpliciterTokenReader: { tokens: simpliciterTokens },
    });

    expect(moonlitTokens).toHaveBeenCalledOnce();
    expect(simpliciterTokens).not.toHaveBeenCalled();
    expect(adapters).toHaveLength(3);
  });

  it("creates no provider adapters when no server-side connector is selected", async () => {
    const moonlitTokens = vi.fn();
    const simpliciterTokens = vi.fn();

    await expect(createAutomaticResearchProviderAdapters({
      requestTimeoutMs: 5_000,
      enabledProviders: [],
      moonlitTokenReader: { tokens: moonlitTokens },
      simpliciterTokenReader: { tokens: simpliciterTokens },
    })).resolves.toEqual([]);
    expect(moonlitTokens).not.toHaveBeenCalled();
    expect(simpliciterTokens).not.toHaveBeenCalled();
  });
});
