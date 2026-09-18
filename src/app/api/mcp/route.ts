import {
  ResearchMcpAuthError,
  createWorkosResearchMcpPrincipalVerifier,
  getResearchMcpAuthConfig,
  researchMcpAuthResponse,
} from "@/server/legal-research/mcp-auth";
import { handleAuthenticatedResearchMcpRequest } from "@/server/legal-research/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const config = getResearchMcpAuthConfig();
  try {
    const principal = await createWorkosResearchMcpPrincipalVerifier({ config }).verify(request);
    if (!principal) {
      return researchMcpAuthResponse(config, {
        invalidToken: request.headers.has("authorization"),
        scopes: ["research:read"],
      });
    }
    return handleAuthenticatedResearchMcpRequest(request, principal);
  } catch (error) {
    if (error instanceof ResearchMcpAuthError) {
      return researchMcpAuthResponse(config, {
        status: error.status,
        error: error.code,
        scopes: error.requiredScopes,
      });
    }
    return researchMcpAuthResponse(config, { status: 503, error: "AUTH_UNAVAILABLE" });
  }
}

export { handle as GET, handle as POST, handle as DELETE };