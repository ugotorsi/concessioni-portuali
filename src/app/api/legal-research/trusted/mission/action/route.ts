import { z } from "zod";

import { ResearchFascicoloAccessGrantError } from "@/server/legal-research/fascicolo-access-grant";
import {
  ResearchMcpAuthError,
  createWorkosResearchMcpPrincipalVerifier,
  getResearchMcpAuthConfig,
  researchMcpAuthResponse,
} from "@/server/legal-research/mcp-auth";
import {
  RESEARCH_MCP_WRITE_ARGUMENT_SCHEMAS,
  researchMissionIdSchema,
} from "@/server/legal-research/mcp-write-contracts";
import {
  TrustedResearchMcpClientError,
  TrustedResearchMcpRequestError,
  callTrustedResearchMcp,
  trustedResearchMcpTechnicalCode,
} from "@/server/legal-research/trusted-mcp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM_FORBIDDEN_DIAGNOSTIC = "TRUSTED_ACTION_UPSTREAM_FORBIDDEN";
const REQUEST_FAILED_DIAGNOSTIC = "TRUSTED_ACTION_REQUEST_FAILED";

const claimActionSchema = RESEARCH_MCP_WRITE_ARGUMENT_SCHEMAS.research_claim_mission.extend({
  action: z.literal("research_claim_mission"),
}).strict();

const submitActionSchema = RESEARCH_MCP_WRITE_ARGUMENT_SCHEMAS.research_submit_evidence_bundle.extend({
  action: z.literal("research_submit_evidence_bundle"),
  missionId: researchMissionIdSchema,
}).strict().refine(
  ({ missionId, bundle }) => missionId === bundle.missionId,
  { path: ["missionId"], message: "Mission must match the evidence bundle" },
);

const completeActionSchema = RESEARCH_MCP_WRITE_ARGUMENT_SCHEMAS.research_complete_mission.extend({
  action: z.literal("research_complete_mission"),
}).strict();

const deferActionSchema = RESEARCH_MCP_WRITE_ARGUMENT_SCHEMAS.research_defer_mission.extend({
  action: z.literal("research_defer_mission"),
}).strict();

const inputSchema = z.discriminatedUnion("action", [
  claimActionSchema,
  submitActionSchema,
  completeActionSchema,
  deferActionSchema,
]);

type ActionInput = z.infer<typeof inputSchema>;

function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1] ?? null;
}

function mcpArguments(input: ActionInput): Record<string, unknown> {
  switch (input.action) {
    case "research_claim_mission": {
      const { action: _action, ...arguments_ } = input;
      return arguments_;
    }
    case "research_submit_evidence_bundle": {
      const { action: _action, missionId: _missionId, ...arguments_ } = input;
      return arguments_;
    }
    case "research_complete_mission":
    case "research_defer_mission": {
      const { action: _action, ...arguments_ } = input;
      return arguments_;
    }
  }
}

export async function POST(request: Request): Promise<Response> {
  const config = getResearchMcpAuthConfig();
  let principal;
  try {
    principal = await createWorkosResearchMcpPrincipalVerifier({ config }).verify(request);
  } catch (error) {
    if (error instanceof ResearchMcpAuthError) {
      if (error.diagnosticCode) console.warn(error.diagnosticCode);
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

  let requestPhase: "CALL_SETUP" | "BUILD_RESPONSE" = "CALL_SETUP";
  try {
    const response = await callTrustedResearchMcp({
      missionId: input.data.missionId,
      principal,
      accessToken,
      payload: {
        jsonrpc: "2.0",
        id: `trusted-${input.data.action}`,
        method: "tools/call",
        params: {
          name: input.data.action,
          arguments: mcpArguments(input.data),
        },
      },
    });
    if (response.status === 403) console.warn(UPSTREAM_FORBIDDEN_DIAGNOSTIC);
    requestPhase = "BUILD_RESPONSE";
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
      if (error.diagnosticCode) console.warn(error.diagnosticCode);
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
    if (error instanceof TrustedResearchMcpRequestError) {
      console.warn(REQUEST_FAILED_DIAGNOSTIC, error.phase, error.technicalCode);
    } else {
      console.warn(REQUEST_FAILED_DIAGNOSTIC, requestPhase, trustedResearchMcpTechnicalCode(error));
    }
    return Response.json({ error: "TRUSTED_MCP_REQUEST_FAILED" }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
