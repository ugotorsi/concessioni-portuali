import path from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  MOONLIT_MCP_URL,
  MoonlitOAuthProvider,
} from "../../src/server/legal-research/moonlit-oauth";
import {
  SIMPLICITER_MCP_URL,
  SimpliciterOAuthProvider,
} from "../../src/server/legal-research/simpliciter-oauth";

export type ProviderCatalogName = "MOONLIT" | "SIMPLICITER";

type ProviderCatalogTool = Readonly<{
  name: string;
  inputSchema: unknown;
  outputSchema?: unknown;
}>;

export type ProviderCatalogClient = Readonly<{
  listTools(): Promise<Readonly<{ tools: readonly ProviderCatalogTool[] }>>;
  close(): Promise<void>;
}>;

export type ProviderCatalogConnectOptions = Readonly<{
  tokenProvider?: Pick<MoonlitOAuthProvider, "tokens">;
  fetch?: typeof fetch;
  url?: string;
}>;

type ProviderCatalogDependencies = Readonly<{
  connect(provider: ProviderCatalogName): Promise<ProviderCatalogClient>;
  output(message: string): void;
}>;

export class ProviderCatalogError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProviderCatalogError";
  }
}

function phaseError(
  phase: "TOKEN_READ" | "MCP_CONNECT" | "LIST_TOOLS",
  error: unknown,
): ProviderCatalogError {
  const status = error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403)
    ? `_${error.code}`
    : "_FAILED";
  return new ProviderCatalogError(`PROVIDER_${phase}${status}`);
}

export function parseProviderCatalogArgs(argv: readonly string[]): ProviderCatalogName {
  let listTools = false;
  let provider: ProviderCatalogName | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--list-tools") {
      if (listTools) throw new ProviderCatalogError("DUPLICATE_LIST_TOOLS_FLAG");
      listTools = true;
      continue;
    }
    if (argument === "--provider") {
      if (provider) throw new ProviderCatalogError("DUPLICATE_PROVIDER");
      const value = argv[index + 1]?.toUpperCase();
      if (value !== "MOONLIT" && value !== "SIMPLICITER") {
        throw new ProviderCatalogError("PROVIDER_INVALID");
      }
      provider = value;
      index += 1;
      continue;
    }
    throw new ProviderCatalogError("UNKNOWN_CATALOG_ARGUMENT");
  }
  if (!listTools) throw new ProviderCatalogError("EXPLICIT_LIST_TOOLS_FLAG_REQUIRED");
  if (!provider) throw new ProviderCatalogError("PROVIDER_REQUIRED");
  return provider;
}

function providerConnection(provider: ProviderCatalogName): Readonly<{
  url: string;
  authProvider: MoonlitOAuthProvider;
}> {
  const redirectUrl = "http://127.0.0.1:8789/callback";
  const rejectInteractiveLogin = () => {
    throw new ProviderCatalogError("PROVIDER_OAUTH_LOGIN_REQUIRED");
  };
  return provider === "MOONLIT"
    ? {
        url: MOONLIT_MCP_URL,
        authProvider: new MoonlitOAuthProvider(redirectUrl, rejectInteractiveLogin),
      }
    : {
        url: SIMPLICITER_MCP_URL,
        authProvider: new SimpliciterOAuthProvider(redirectUrl, rejectInteractiveLogin),
      };
}

export async function connectProvider(
  provider: ProviderCatalogName,
  options: ProviderCatalogConnectOptions = {},
): Promise<ProviderCatalogClient> {
  const connection = providerConnection(provider);
  let accessToken: string | undefined;
  try {
    accessToken = (await (options.tokenProvider ?? connection.authProvider).tokens())
      ?.access_token
      .trim();
  } catch (error) {
    throw phaseError("TOKEN_READ", error);
  }
  if (!accessToken) throw new ProviderCatalogError("PROVIDER_ACCESS_TOKEN_REQUIRED");

  const client = new Client({ name: "concessioni-portuali-catalog-reader", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(options.url ?? connection.url), {
    fetch: options.fetch,
    requestInit: {
      headers: { Authorization: `Bearer ${accessToken}` },
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
  } catch (error) {
    await client.close().catch(() => undefined);
    throw phaseError("MCP_CONNECT", error);
  }
  return client;
}

function safeCatalog(provider: ProviderCatalogName, tools: readonly ProviderCatalogTool[]) {
  if (tools.some((tool) => !tool.name || !tool.inputSchema)) {
    throw new ProviderCatalogError("PROVIDER_CATALOG_RESPONSE_INVALID");
  }
  return {
    provider,
    tools: tools.map((tool) => ({
      name: tool.name,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema ?? null,
    })),
  };
}

export async function runProviderCatalogCli(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: ProviderCatalogDependencies = { connect: connectProvider, output: console.log },
): Promise<void> {
  const provider = parseProviderCatalogArgs(argv);
  let client: ProviderCatalogClient | undefined;
  try {
    try {
      client = await dependencies.connect(provider);
    } catch (error) {
      if (error instanceof ProviderCatalogError) throw error;
      throw phaseError("MCP_CONNECT", error);
    }
    let response: Readonly<{ tools: readonly ProviderCatalogTool[] }>;
    try {
      response = await client.listTools();
    } catch (error) {
      throw phaseError("LIST_TOOLS", error);
    }
    dependencies.output(JSON.stringify(safeCatalog(provider, response.tools), null, 2));
  } finally {
    await client?.close().catch(() => undefined);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runProviderCatalogCli().catch((error: unknown) => {
    const code = error instanceof ProviderCatalogError ? error.code : "PROVIDER_CATALOG_READ_FAILED";
    console.error(JSON.stringify({ error: code }));
    process.exitCode = 1;
  });
}
