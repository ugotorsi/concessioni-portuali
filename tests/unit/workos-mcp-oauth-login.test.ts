import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { describe, expect, it, vi } from "vitest";

import {
  establishWorkosMcpOAuthConnection,
  withTimeout,
} from "../../scripts/legal-research/workos-mcp-oauth-login";

function lifecycle(overrides: Partial<Parameters<typeof establishWorkosMcpOAuthConnection>[0]> = {}) {
  return {
    connectInitial: vi.fn(async () => undefined),
    closeInitial: vi.fn(async () => undefined),
    finishAuth: vi.fn(async () => undefined),
    connectAuthenticated: vi.fn(async () => undefined),
    closeAuthenticated: vi.fn(async () => undefined),
    authorizationCode: Promise.resolve("authorization-code"),
    onAuthorizationRequired: vi.fn(),
    ...overrides,
  };
}

describe("WorkOS MCP OAuth login", () => {
  it("closes the initial client after an already-authorized connection", async () => {
    const connection = lifecycle();

    await establishWorkosMcpOAuthConnection(connection);

    expect(connection.closeInitial).toHaveBeenCalledOnce();
    expect(connection.onAuthorizationRequired).not.toHaveBeenCalled();
    expect(connection.finishAuth).not.toHaveBeenCalled();
    expect(connection.connectAuthenticated).not.toHaveBeenCalled();
  });

  it("closes both clients after completing an interactive authorization", async () => {
    const connection = lifecycle({
      connectInitial: vi.fn(async () => {
        throw new UnauthorizedError();
      }),
    });

    await establishWorkosMcpOAuthConnection(connection);

    expect(connection.onAuthorizationRequired).toHaveBeenCalledOnce();
    expect(connection.finishAuth).toHaveBeenCalledWith("authorization-code");
    expect(connection.connectAuthenticated).toHaveBeenCalledOnce();
    expect(connection.closeAuthenticated).toHaveBeenCalledOnce();
    expect(connection.closeInitial).toHaveBeenCalledOnce();
  });

  it("closes the initial client when connection fails", async () => {
    const connection = lifecycle({
      connectInitial: vi.fn(async () => {
        throw new Error("UPSTREAM_FAILURE");
      }),
    });

    await expect(establishWorkosMcpOAuthConnection(connection)).rejects.toThrow("UPSTREAM_FAILURE");
    expect(connection.closeInitial).toHaveBeenCalledOnce();
  });

  it("rejects bounded waits with the provided diagnostic code", async () => {
    await expect(withTimeout(
      new Promise<never>(() => undefined),
      1,
      "EXPECTED_TIMEOUT",
    )).rejects.toThrow("EXPECTED_TIMEOUT");
  });
});
