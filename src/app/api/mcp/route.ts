import {
  ResearchMcpAuthError,
  createWorkosResearchMcpPrincipalVerifier,
  getResearchMcpAuthConfig,
  researchMcpAuthResponse,
} from "@/server/legal-research/mcp-auth";
import { handleAuthenticatedResearchMcpRequest } from "@/server/legal-research/mcp";
import {
  RESEARCH_FASCICOLO_ACCESS_GRANT_HEADER,
  ResearchFascicoloAccessGrantError,
  verifyResearchFascicoloAccessGrant,
} from "@/server/legal-research/fascicolo-access-grant";

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
    try {
      const fascicoloGrant = verifyResearchFascicoloAccessGrant(
        request.headers.get(RESEARCH_FASCICOLO_ACCESS_GRANT_HEADER),
        principal,
      );
      return handleAuthenticatedResearchMcpRequest(request, principal, { fascicoloGrant });
    } catch (error) {
      if (error instanceof ResearchFascicoloAccessGrantError) {
        return handleAuthenticatedResearchMcpRequest(request, principal, {
          fascicoloGrantError: error.code,
        });
      }
      throw error;
    }
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