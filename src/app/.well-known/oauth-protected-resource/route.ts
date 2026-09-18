import {
  RESEARCH_MCP_READ_SCOPE,
  RESEARCH_MCP_WRITE_SCOPE,
  getResearchMcpAuthConfig,
  researchMcpAuthResponse,
} from "@/server/legal-research/mcp-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const config = getResearchMcpAuthConfig();
  if (!config) return researchMcpAuthResponse(null, { status: 503, error: "AUTH_UNAVAILABLE" });

  return Response.json({
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [RESEARCH_MCP_READ_SCOPE, RESEARCH_MCP_WRITE_SCOPE],
  }, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}