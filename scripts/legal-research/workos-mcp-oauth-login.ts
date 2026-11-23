import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config as loadEnv } from "dotenv";

import {
  WORKOS_MCP_OAUTH_CALLBACK_URL,
  WorkosMcpOAuthProvider,
} from "../../src/server/legal-research/workos-mcp-oauth";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 8788;
export const WORKOS_MCP_CONNECTION_TIMEOUT_MS = 30_000;
export const WORKOS_MCP_AUTHORIZATION_TIMEOUT_MS = 120_000;

type OAuthConnectionLifecycle = Readonly<{
  connectInitial: () => Promise<void>;
  closeInitial: () => Promise<void>;
  finishAuth: (authorizationCode: string) => Promise<void>;
  connectAuthenticated: () => Promise<void>;
  closeAuthenticated: () => Promise<void>;
  authorizationCode: Promise<string>;
  onAuthorizationRequired: () => void;
}>;

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorCode: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function establishWorkosMcpOAuthConnection(
  lifecycle: OAuthConnectionLifecycle,
): Promise<void> {
  try {
    try {
      await withTimeout(
        lifecycle.connectInitial(),
        WORKOS_MCP_CONNECTION_TIMEOUT_MS,
        "WORKOS_MCP_OAUTH_CONNECTION_TIMEOUT",
      );
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      lifecycle.onAuthorizationRequired();
      const authorizationCode = await withTimeout(
        lifecycle.authorizationCode,
        WORKOS_MCP_AUTHORIZATION_TIMEOUT_MS,
        "WORKOS_MCP_OAUTH_CALLBACK_TIMEOUT",
      );
      await lifecycle.finishAuth(authorizationCode);
      try {
        await withTimeout(
          lifecycle.connectAuthenticated(),
          WORKOS_MCP_CONNECTION_TIMEOUT_MS,
          "WORKOS_MCP_OAUTH_AUTHENTICATED_CONNECTION_TIMEOUT",
        );
      } finally {
        await lifecycle.closeAuthenticated();
      }
    }
  } finally {
    await lifecycle.closeInitial();
  }
}

function configuredHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function runWorkosMcpOAuthLogin(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  loadEnv({ path: ".env.local", override: true, quiet: true, processEnv: env });
  const issuer = configuredHttpsUrl(env.WORKOS_AUTHKIT_ISSUER);
  const resource = configuredHttpsUrl(env.MCP_RESOURCE_URI);
  if (!issuer || !resource || new URL(resource).pathname !== "/api/mcp") {
    throw new Error("WORKOS_PRODUCTION_OAUTH_CONFIG_REQUIRED");
  }

  let resolveCallback: (code: string) => void;
  let rejectCallback: (error: Error) => void;
  const authorizationCode = new Promise<string>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  let provider: WorkosMcpOAuthProvider;
  const server = createServer(async (request, response) => {
    const callbackUrl = new URL(request.url ?? "/", WORKOS_MCP_OAUTH_CALLBACK_URL);
    if (callbackUrl.pathname !== "/callback") {
      response.writeHead(404).end();
      return;
    }

    const error = callbackUrl.searchParams.get("error");
    const code = callbackUrl.searchParams.get("code");
    const state = callbackUrl.searchParams.get("state");
    if (error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("WorkOS authorization failed. Return to the terminal.");
      rejectCallback(new Error(`WORKOS_MCP_OAUTH_${error.toUpperCase()}`));
      return;
    }
    if (!code || !state || state !== await provider.expectedState()) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Invalid OAuth callback. Return to the terminal.");
      rejectCallback(new Error("WORKOS_MCP_OAUTH_CALLBACK_INVALID"));
      return;
    }

    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("WorkOS authorization completed. You may close this page.");
    resolveCallback(code);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(CALLBACK_PORT, CALLBACK_HOST, resolve);
  });
  console.log(`WorkOS OAuth callback listening on ${CALLBACK_HOST}:${CALLBACK_PORT}.`);

  try {
    provider = new WorkosMcpOAuthProvider(
      WORKOS_MCP_OAUTH_CALLBACK_URL,
      resource,
      (authorizationUrl) => {
        if (authorizationUrl.origin !== new URL(issuer).origin) {
          throw new Error("WORKOS_MCP_OAUTH_ISSUER_MISMATCH");
        }
        console.log("Open this WorkOS authorization URL in your browser:");
        console.log(authorizationUrl.toString());
      },
    );

    const client = new Client({ name: "concessioni-portuali-local-executor", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(resource), {
      authProvider: provider,
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 0,
        maxReconnectionDelay: 0,
        reconnectionDelayGrowFactor: 1,
      },
    });
    let authenticatedClient: Client | undefined;

    await establishWorkosMcpOAuthConnection({
      connectInitial: () => client.connect(transport),
      closeInitial: () => client.close(),
      finishAuth: (code) => transport.finishAuth(code),
      authorizationCode,
      onAuthorizationRequired: () => {
        console.log(
          `WorkOS authorization required; callback timeout is ${WORKOS_MCP_AUTHORIZATION_TIMEOUT_MS} ms.`,
        );
      },
      connectAuthenticated: async () => {
        authenticatedClient = new Client({
          name: "concessioni-portuali-local-executor",
          version: "0.1.0",
        });
        const authenticatedTransport = new StreamableHTTPClientTransport(new URL(resource), {
          authProvider: provider,
          reconnectionOptions: {
            maxRetries: 0,
            initialReconnectionDelay: 0,
            maxReconnectionDelay: 0,
            reconnectionDelayGrowFactor: 1,
          },
        });
        await authenticatedClient.connect(authenticatedTransport);
      },
      closeAuthenticated: async () => {
        if (authenticatedClient) await authenticatedClient.close();
      },
    });

    console.log("WorkOS Production OAuth initialized successfully. No MCP tools were called.");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runWorkosMcpOAuthLogin().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "WORKOS_MCP_OAUTH_LOGIN_FAILED");
    process.exitCode = 1;
  });
}
