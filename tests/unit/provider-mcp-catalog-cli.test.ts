import { describe, expect, it, vi } from "vitest";

import {
  connectProvider,
  ProviderCatalogError,
  runProviderCatalogCli,
  type ProviderCatalogClient,
  type ProviderCatalogName,
} from "../../scripts/legal-research/list-provider-tools";

function bearerOnlyOAuthProvider() {
  return {
    tokens: vi.fn(async () => ({ access_token: "existing-access-token", token_type: "Bearer" })),
    saveTokens: vi.fn(),
    saveClientInformation: vi.fn(),
    state: vi.fn(),
    saveCodeVerifier: vi.fn(),
    redirectToAuthorization: vi.fn(),
    invalidateCredentials: vi.fn(),
  };
}

function rejectingMcpFetch(phase: "initialize" | "tools/list", status: 401 | 403) {
  const methods: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      id?: number;
      method: string;
      params?: { protocolVersion?: string };
    };
    methods.push(request.method);

    if (request.method === phase) return new Response(null, { status });
    if (request.method === "initialize") {
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: request.params?.protocolVersion,
          capabilities: {},
          serverInfo: { name: "mock-provider", version: "1.0.0" },
        },
      });
    }
    return new Response(null, { status: 200 });
  });
  return { fetch, methods };
}

function fakeDependencies(options: Readonly<{
  connectError?: Error;
  listError?: Error;
}> = {}) {
  const listTools = options.listError
    ? vi.fn(async () => { throw options.listError; })
    : vi.fn(async () => ({
        tools: [{
          name: "observed_tool",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
          outputSchema: { type: "object", properties: { results: { type: "array" } } },
          description: "must not be copied",
        }],
      }));
  const callTool = vi.fn();
  const close = vi.fn(async () => undefined);
  const client = { listTools, callTool, close } as unknown as ProviderCatalogClient;
  const connect = options.connectError
    ? vi.fn(async () => { throw options.connectError; })
    : vi.fn(async (_provider: ProviderCatalogName) => client);
  const output = vi.fn();
  return { callTool, client, close, connect, listTools, output };
}

describe("provider MCP catalog CLI", () => {
  it("does not connect or list tools without explicit opt-in", async () => {
    const dependencies = fakeDependencies();

    await expect(runProviderCatalogCli([
      "--provider", "moonlit",
    ], dependencies)).rejects.toMatchObject({ code: "EXPLICIT_LIST_TOOLS_FLAG_REQUIRED" });

    expect(dependencies.connect).not.toHaveBeenCalled();
    expect(dependencies.listTools).not.toHaveBeenCalled();
    expect(dependencies.callTool).not.toHaveBeenCalled();
  });

  it.each(["MOONLIT", "SIMPLICITER"] as const)(
    "lists %s tools exactly once and emits only names and returned schemas",
    async (provider) => {
      const dependencies = fakeDependencies();

      await runProviderCatalogCli([
        "--list-tools", "--provider", provider.toLowerCase(),
      ], dependencies);

      expect(dependencies.connect).toHaveBeenCalledWith(provider);
      expect(dependencies.listTools).toHaveBeenCalledOnce();
      expect(dependencies.callTool).not.toHaveBeenCalled();
      expect(dependencies.close).toHaveBeenCalledOnce();
      expect(JSON.parse(dependencies.output.mock.calls[0][0])).toEqual({
        provider,
        tools: [{
          name: "observed_tool",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
          outputSchema: { type: "object", properties: { results: { type: "array" } } },
        }],
      });
    },
  );

  it.each(["connect", "list"] as const)("sanitizes %s failures", async (phase) => {
    const sensitiveError = new Error("sensitive provider detail");
    const dependencies = fakeDependencies(
      phase === "connect" ? { connectError: sensitiveError } : { listError: sensitiveError },
    );

    await expect(runProviderCatalogCli([
      "--list-tools", "--provider", "moonlit",
    ], dependencies)).rejects.toEqual(
      expect.objectContaining<Partial<ProviderCatalogError>>({
        code: phase === "connect" ? "PROVIDER_MCP_CONNECT_FAILED" : "PROVIDER_LIST_TOOLS_FAILED",
        message: phase === "connect" ? "PROVIDER_MCP_CONNECT_FAILED" : "PROVIDER_LIST_TOOLS_FAILED",
      }),
    );
    expect(dependencies.callTool).not.toHaveBeenCalled();
    expect(dependencies.output).not.toHaveBeenCalled();
  });

  it("sanitizes token read failures before connecting", async () => {
    const tokens = vi.fn(async () => { throw new Error("sensitive storage detail"); });
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(connectProvider("MOONLIT", {
      tokenProvider: { tokens },
      fetch,
      url: "https://provider.invalid/mcp",
    })).rejects.toEqual(expect.objectContaining<Partial<ProviderCatalogError>>({
      code: "PROVIDER_TOKEN_READ_FAILED",
      message: "PROVIDER_TOKEN_READ_FAILED",
    }));

    expect(tokens).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["initialize", 401],
    ["initialize", 403],
    ["tools/list", 401],
    ["tools/list", 403],
  ] as const)("does not start OAuth when %s returns %s", async (phase, status) => {
    const oauthProvider = bearerOnlyOAuthProvider();
    const transport = rejectingMcpFetch(phase, status);
    const output = vi.fn();

    await expect(runProviderCatalogCli(
      ["--list-tools", "--provider", "moonlit"],
      {
        connect: (provider) => connectProvider(provider, {
          tokenProvider: oauthProvider,
          fetch: transport.fetch,
          url: "https://provider.invalid/mcp",
        }),
        output,
      },
    )).rejects.toMatchObject({
      code: phase === "initialize"
        ? `PROVIDER_MCP_CONNECT_${status}`
        : `PROVIDER_LIST_TOOLS_${status}`,
    });

    expect(oauthProvider.tokens).toHaveBeenCalledOnce();
    expect(oauthProvider.saveTokens).not.toHaveBeenCalled();
    expect(oauthProvider.saveClientInformation).not.toHaveBeenCalled();
    expect(oauthProvider.state).not.toHaveBeenCalled();
    expect(oauthProvider.saveCodeVerifier).not.toHaveBeenCalled();
    expect(oauthProvider.redirectToAuthorization).not.toHaveBeenCalled();
    expect(oauthProvider.invalidateCredentials).not.toHaveBeenCalled();
    const expectedMethods = phase === "initialize"
      ? ["initialize"]
      : ["initialize", "notifications/initialized", "tools/list"];
    expect(transport.methods).toEqual(expectedMethods);
    expect(transport.fetch).toHaveBeenCalledTimes(expectedMethods.length);
    expect(output).not.toHaveBeenCalled();
  });
});
