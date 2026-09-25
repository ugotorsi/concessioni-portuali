import { getResearchMcpAuthConfig, type ResearchMcpPrincipal } from "./mcp-auth";
import {
  RESEARCH_FASCICOLO_ACCESS_GRANT_HEADER,
  ResearchFascicoloAccessGrantError,
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

export type TrustedResearchMcpFailurePhase =
  | "MINT_GRANT"
  | "SERIALIZE_REQUEST"
  | "INTERNAL_FETCH";

export type TrustedResearchMcpTechnicalCode =
  | "ABORTED"
  | "TIMEOUT"
  | "CONNECT_TIMEOUT"
  | "HEADERS_TIMEOUT"
  | "BODY_TIMEOUT"
  | "CONNECTION_REFUSED"
  | "CONNECTION_RESET"
  | "DNS_NOT_FOUND"
  | "DNS_RETRY"
  | "REDIRECT_REJECTED"
  | "TYPE_ERROR"
  | "UNKNOWN";

export class TrustedResearchMcpRequestError extends Error {
  constructor(
    readonly phase: TrustedResearchMcpFailurePhase,
    readonly technicalCode: TrustedResearchMcpTechnicalCode,
  ) {
    super(`${phase}:${technicalCode}`);
    this.name = "TrustedResearchMcpRequestError";
  }
}

const TECHNICAL_CODE_MAP: Readonly<Record<string, TrustedResearchMcpTechnicalCode>> = {
  ABORT_ERR: "ABORTED",
  UND_ERR_CONNECT_TIMEOUT: "CONNECT_TIMEOUT",
  UND_ERR_HEADERS_TIMEOUT: "HEADERS_TIMEOUT",
  UND_ERR_BODY_TIMEOUT: "BODY_TIMEOUT",
  ECONNREFUSED: "CONNECTION_REFUSED",
  ECONNRESET: "CONNECTION_RESET",
  ENOTFOUND: "DNS_NOT_FOUND",
  EAI_AGAIN: "DNS_RETRY",
  ERR_INVALID_REDIRECT: "REDIRECT_REJECTED",
};

function mappedTechnicalCode(code: unknown): TrustedResearchMcpTechnicalCode | null {
  return typeof code === "string" && Object.hasOwn(TECHNICAL_CODE_MAP, code)
    ? TECHNICAL_CODE_MAP[code]
    : null;
}

export function trustedResearchMcpTechnicalCode(error: unknown): TrustedResearchMcpTechnicalCode {
  if (!(error instanceof Error)) return "UNKNOWN";
  if (error.name === "AbortError") return "ABORTED";
  if (error.name === "TimeoutError") return "TIMEOUT";
  const directCode = "code" in error ? mappedTechnicalCode(error.code) : null;
  if (directCode) return directCode;
  const cause = error.cause;
  const causeCode = cause && typeof cause === "object" && "code" in cause
    ? mappedTechnicalCode(cause.code)
    : null;
  if (causeCode) return causeCode;
  if (error instanceof TypeError && cause instanceof Error && cause.message === "unexpected redirect") {
    return "REDIRECT_REJECTED";
  }
  return error instanceof TypeError ? "TYPE_ERROR" : "UNKNOWN";
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
  let grant: string;
  try {
    ({ grant } = await mintGrant({ missionId: input.missionId, principal: input.principal }));
  } catch (error) {
    if (error instanceof ResearchFascicoloAccessGrantError) throw error;
    throw new TrustedResearchMcpRequestError("MINT_GRANT", trustedResearchMcpTechnicalCode(error));
  }

  let body: string;
  try {
    body = JSON.stringify(input.payload);
  } catch (error) {
    throw new TrustedResearchMcpRequestError("SERIALIZE_REQUEST", trustedResearchMcpTechnicalCode(error));
  }

  try {
    return await transport(resourceUri, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        [RESEARCH_FASCICOLO_ACCESS_GRANT_HEADER]: grant,
      },
      body,
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    throw new TrustedResearchMcpRequestError("INTERNAL_FETCH", trustedResearchMcpTechnicalCode(error));
  }
}
