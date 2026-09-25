import { z } from "zod";

import {
  ResearchMcpAuthError,
  createWorkosResearchMcpPrincipalVerifier,
  getResearchMcpAuthConfig,
  researchMcpAuthResponse,
} from "@/server/legal-research/mcp-auth";
import { ResearchFascicoloAccessGrantError } from "@/server/legal-research/fascicolo-access-grant";
import {
  TrustedResearchMcpClientError,
  callTrustedResearchMcp,
} from "@/server/legal-research/trusted-mcp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  missionId: z.string().min(1).max(96),
}).strict();

function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1] ?? null;
}

export async function POST(request: Request): Promise<Response> {
  const config = getResearchMcpAuthConfig();
  let principal;
  try {
    principal = await createWorkosResearchMcpPrincipalVerifier({ config }).verify(request);
  } catch (error) {
    if (error instanceof ResearchMcpAuthError) {
      return researchMcpAuthResponse(config, { status: error.status, error: error.code });
    }
    return researchMcpAuthResponse(config, { status: 503, error: "AUTH_UNAVAILABLE" });
  }

  const accessToken = bearerToken(request);
  if (!principal || !accessToken) {
    return researchMcpAuthResponse(config, {
      invalidToken: request.headers.has("authorization"),
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "INVALID_REQUEST" }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const input = inputSchema.safeParse(body);
  if (!input.success) {
    return Response.json({ error: "INVALID_REQUEST" }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const response = await callTrustedResearchMcp({
      missionId: input.data.missionId,
      principal,
      accessToken,
      payload: {
        jsonrpc: "2.0",
        id: "trusted-research-get-mission",
        method: "tools/call",
        params: {
          name: "research_get_mission",
          arguments: { missionId: input.data.missionId },
        },
      },
    });
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    if (error instanceof ResearchFascicoloAccessGrantError) {
      return Response.json({ error: "FORBIDDEN" }, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (error instanceof TrustedResearchMcpClientError) {
      return Response.json({ error: "TRUSTED_MCP_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json({ error: "TRUSTED_MCP_REQUEST_FAILED" }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
