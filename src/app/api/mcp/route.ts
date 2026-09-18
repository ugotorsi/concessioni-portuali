import {
  blockedResearchMcpPrincipalVerifier,
  researchMcpAuthRequiredResponse,
} from "@/server/legal-research/mcp-auth";
import { handleAuthenticatedResearchMcpRequest } from "@/server/legal-research/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const principal = await blockedResearchMcpPrincipalVerifier.verify(request);
  if (!principal) return researchMcpAuthRequiredResponse();
  return handleAuthenticatedResearchMcpRequest(request, principal);
}

export { handle as GET, handle as POST, handle as DELETE };