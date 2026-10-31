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
      });
    }
    const grant = request.headers.get(RESEARCH_FASCICOLO_ACCESS_GRANT_HEADER);
    const trustedWorkerMissionId = grant
      ? verifyResearchFascicoloAccessGrant(grant, principal).originMissionId
      : undefined;
    return handleAuthenticatedResearchMcpRequest(request, principal, {
      ...(trustedWorkerMissionId ? { trustedWorkerMissionId } : {}),
    });
  } catch (error) {
    if (error instanceof ResearchFascicoloAccessGrantError) {
      return Response.json({ error: "FORBIDDEN" }, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (error instanceof ResearchMcpAuthError) {
      return researchMcpAuthResponse(config, {
        status: error.status,
        error: error.code,
      });
    }
    return researchMcpAuthResponse(config, { status: 503, error: "AUTH_UNAVAILABLE" });
  }
}

export { handle as GET, handle as POST, handle as DELETE };