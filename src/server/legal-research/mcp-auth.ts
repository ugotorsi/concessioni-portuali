export const MCP_AUTH_BLOCKED = true as const;

export const MCP_AUTH_BLOCK_REASON =
  "No OAuth 2.1/OIDC authorization server and bearer-token verifier are configured for the MCP resource.";

export const RESEARCH_MCP_READ_SCOPE = "research:read" as const;
export const RESEARCH_MCP_WRITE_SCOPE = "research:write" as const;

export type ResearchMcpScope =
  | typeof RESEARCH_MCP_READ_SCOPE
  | typeof RESEARCH_MCP_WRITE_SCOPE;

export type ResearchMcpPrincipal = Readonly<{
  actorId: string;
  tenantId: string;
  claimantId: string;
  scopes: readonly ResearchMcpScope[];
}>;

export interface ResearchMcpPrincipalVerifier {
  verify(request: Request): Promise<ResearchMcpPrincipal | null>;
}

export const blockedResearchMcpPrincipalVerifier: ResearchMcpPrincipalVerifier = {
  async verify() {
    return null;
  },
};

export function researchMcpAuthRequiredResponse(): Response {
  return Response.json(
    { error: "AUTH_REQUIRED", message: MCP_AUTH_BLOCK_REASON },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}