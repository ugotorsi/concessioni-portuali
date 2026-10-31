import { describe, expect, it, vi } from "vitest";

import {
  callTechnicalSourcesTool,
  TechnicalSourcesMcpError,
  TECHNICAL_SOURCES_MCP_ENDPOINT,
} from "@/server/technical-sources/technical-sources-mcp";

function rpcResponse(id: number, result: Record<string, unknown>): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

describe("technical sources MCP client", () => {
  it("uses the fixed staging endpoint and stores only structured MCP output", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      requests.push({ url: String(input), init });
      const body = JSON.parse(String(init.body)) as { id: number; method: string };
      return body.method === "initialize"
        ? rpcResponse(body.id, {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "noetra-fonti-tecniche", version: "0.5.0" },
          })
        : rpcResponse(body.id, {
            structuredContent: { count: 1, results: [{ id: "source-1" }] },
          });
    };
    const getAccessToken = vi.fn(async () => "mock-only-token");

    const result = await callTechnicalSourcesTool({
      tool: "search",
      arguments: { query: "urbanistica Amalfi" },
    }, { getAccessToken, fetchImpl });

    expect(result).toEqual({
      data: { count: 1, results: [{ id: "source-1" }] },
      serviceVersion: "0.5.0",
    });
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.url)).toEqual([
      TECHNICAL_SOURCES_MCP_ENDPOINT,
      TECHNICAL_SOURCES_MCP_ENDPOINT,
    ]);
    expect(requests.every((request) => request.init.redirect === "error")).toBe(true);
    expect(requests.every((request) => (
      new Headers(request.init.headers).get("authorization") === "Bearer mock-only-token"
    ))).toBe(true);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a machine token is unavailable without making a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(callTechnicalSourcesTool({
      tool: "search",
      arguments: { query: "urbanistica" },
    }, {
      getAccessToken: async () => {
        throw new TechnicalSourcesMcpError("M2M_AUTH_NOT_CONFIGURED");
      },
      fetchImpl,
    })).rejects.toMatchObject({ code: "M2M_AUTH_NOT_CONFIGURED" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects malformed tool inputs before acquiring a token", async () => {
    const getAccessToken = vi.fn(async () => "mock-only-token");
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(callTechnicalSourcesTool({
      tool: "interroga_punto_wms",
      arguments: {
        source_id: "campania-tematica",
        layer: "LAYER",
        latitudine: 91,
        longitudine: 14,
      },
    }, { getAccessToken, fetchImpl })).rejects.toThrow("request is invalid");

    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects upstream MCP tool errors without returning error-shaped success", async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async (_input, init = {}) => {
      callCount += 1;
      const body = JSON.parse(String(init.body)) as { id: number; method: string };
      return body.method === "initialize"
        ? rpcResponse(body.id, {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "noetra-fonti-tecniche", version: "0.5.0" },
          })
        : rpcResponse(body.id, { isError: true });
    };

    await expect(callTechnicalSourcesTool({
      tool: "fetch",
      arguments: { id: "unknown" },
    }, {
      getAccessToken: async () => "mock-only-token",
      fetchImpl,
    })).rejects.toMatchObject({ code: "MCP_TOOL_ERROR" });
    expect(callCount).toBe(2);
  });
});
