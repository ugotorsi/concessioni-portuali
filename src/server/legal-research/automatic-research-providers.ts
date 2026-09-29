import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  createMoonlitExactRetrievalAdapter,
  createMoonlitKeywordResearchAdapter,
  createMoonlitResearchAdapter,
  createSimpliciterCrossJurisdictionResearchAdapter,
  createSimpliciterExactRetrievalAdapter,
  createSimpliciterResearchAdapter,
  type ProviderToolCaller,
  type ResearchProviderAdapter,
} from "./provider-research-adapters";
import { MOONLIT_MCP_URL, MoonlitOAuthProvider } from "./moonlit-oauth";
import { SIMPLICITER_MCP_URL, SimpliciterOAuthProvider } from "./simpliciter-oauth";
import { TrustedMissionExecutorError } from "./trusted-mission-executor";

type TokenReader = Readonly<{ tokens(): Promise<{ access_token: string } | null | undefined> }>;

function bearerOnlyToolCaller(options: Readonly<{
  url: string;
  accessToken: string;
  requestTimeoutMs: number;
  fetch?: typeof fetch;
}>): ProviderToolCaller {
  return async (request) => {
    const baseFetch = options.fetch ?? fetch;
    const client = new Client({ name: "concessioni-portuali-automatic-research", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(options.url), {
      fetch: (input, init) => baseFetch(input, {
        ...init,
        redirect: "error",
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(options.requestTimeoutMs)])
          : AbortSignal.timeout(options.requestTimeoutMs),
      }),
      requestInit: {
        headers: { Authorization: `Bearer ${options.accessToken}` },
        redirect: "error",
      },
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 0,
        maxReconnectionDelay: 0,
        reconnectionDelayGrowFactor: 1,
      },
    });
    try {
      await client.connect(transport);
      return await client.callTool(request);
    } finally {
      await client.close().catch(() => undefined);
    }
  };
}

async function bearer(reader: TokenReader): Promise<string | null> {
  const accessToken = (await reader.tokens())?.access_token.trim();
  return accessToken || null;
}

export async function createAutomaticResearchProviderAdapters(options: Readonly<{
  requestTimeoutMs: number;
  moonlitTokenReader?: TokenReader;
  simpliciterTokenReader?: TokenReader;
  fetch?: typeof fetch;
}>): Promise<readonly ResearchProviderAdapter[]> {
  if (!Number.isInteger(options.requestTimeoutMs)
    || options.requestTimeoutMs < 1_000 || options.requestTimeoutMs > 300_000) {
    throw new TrustedMissionExecutorError("PROVIDER_REQUEST_TIMEOUT_INVALID");
  }
  const rejectLogin = () => {
    throw new TrustedMissionExecutorError("PROVIDER_OAUTH_LOGIN_FORBIDDEN");
  };
  const moonlitReader = options.moonlitTokenReader
    ?? new MoonlitOAuthProvider("http://127.0.0.1/unused", rejectLogin);
  const simpliciterReader = options.simpliciterTokenReader
    ?? new SimpliciterOAuthProvider("http://127.0.0.1/unused", rejectLogin);
  const adapters: ResearchProviderAdapter[] = [];
  const moonlitToken = await bearer(moonlitReader);
  if (moonlitToken) {
    const callTool = bearerOnlyToolCaller({
      url: MOONLIT_MCP_URL,
      accessToken: moonlitToken,
      requestTimeoutMs: options.requestTimeoutMs,
      fetch: options.fetch,
    });
    adapters.push(
      createMoonlitResearchAdapter(callTool),
      createMoonlitKeywordResearchAdapter(callTool),
      createMoonlitExactRetrievalAdapter(callTool),
    );
  }
  const simpliciterToken = await bearer(simpliciterReader);
  if (simpliciterToken) {
    const callTool = bearerOnlyToolCaller({
      url: SIMPLICITER_MCP_URL,
      accessToken: simpliciterToken,
      requestTimeoutMs: options.requestTimeoutMs,
      fetch: options.fetch,
    });
    adapters.push(
      createSimpliciterResearchAdapter(callTool),
      createSimpliciterExactRetrievalAdapter(callTool),
      createSimpliciterCrossJurisdictionResearchAdapter(callTool),
    );
  }
  return adapters;
}
