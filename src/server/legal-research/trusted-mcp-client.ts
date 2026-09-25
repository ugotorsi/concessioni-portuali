import { getResearchMcpAuthConfig, type ResearchMcpPrincipal } from "./mcp-auth";
import {
  RESEARCH_FASCICOLO_ACCESS_GRANT_HEADER,
  mintResearchFascicoloAccessGrant,
} from "./fascicolo-access-grant";

export type TrustedResearchMcpClientErrorCode =
  | "MCP_ACCESS_TOKEN_REQUIRED"
  | "MCP_RESOURCE_URI_INVALID";

export class TrustedResearchMcpClientError extends Error {
  constructor(readonly code: TrustedResearchMcpClientErrorCode) {
    super(code);
    this.name = "TrustedResearchMcpClientError";
  }
}

type MintGrant = typeof mintResearchFascicoloAccessGrant;
type TrustedMcpTransport = (input: string, init: RequestInit) => Promise<Response>;

type TrustedResearchMcpClientOptions = Readonly<{
  env?: NodeJS.ProcessEnv;
  mintGrant?: MintGrant;
  transport?: TrustedMcpTransport;
}>;

export type TrustedResearchMcpCall = Readonly<{
  missionId: string;
  principal: ResearchMcpPrincipal;
  accessToken: string;
  payload: unknown;
}>;

function configuredResourceUri(env: NodeJS.ProcessEnv): string {
  const resource = getResearchMcpAuthConfig(env)?.resource;
  if (!resource || new URL(resource).pathname !== "/api/mcp") {
    throw new TrustedResearchMcpClientError("MCP_RESOURCE_URI_INVALID");
  }
  return resource;
}

export async function callTrustedResearchMcp(
  input: TrustedResearchMcpCall,
  options: TrustedResearchMcpClientOptions = {},
): Promise<Response> {
  const accessToken = input.accessToken.trim();
  if (!accessToken) throw new TrustedResearchMcpClientError("MCP_ACCESS_TOKEN_REQUIRED");
  const resourceUri = configuredResourceUri(options.env ?? process.env);
  const mintGrant = options.mintGrant ?? mintResearchFascicoloAccessGrant;
  const transport = options.transport ?? fetch;
  const { grant } = await mintGrant({ missionId: input.missionId, principal: input.principal });

  return transport(resourceUri, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      [RESEARCH_FASCICOLO_ACCESS_GRANT_HEADER]: grant,
    },
    body: JSON.stringify(input.payload),
    cache: "no-store",
    redirect: "error",
  });
}
