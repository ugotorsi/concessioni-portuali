import "dotenv/config";

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

import { MOONLIT_MCP_URL, MoonlitOAuthProvider } from "../../src/server/legal-research/moonlit-oauth";
import {
  readProviderCredentialKey,
  storeProviderOAuthCredential,
  type StoredProviderOAuthState,
} from "../../src/server/legal-research/provider-oauth-credential-store";

// Obtains a NEW Moonlit grant dedicated to the worker (separate dynamic client registration) and
// stores it only encrypted in the database. The workstation grant is never read or modified, so
// refresh-token rotation on either side cannot invalidate the other. Never prints token material.
const CALLBACK_PORT = 8790;
const REDIRECT_URL = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
const LOGIN_TIMEOUT_MS = 10 * 60_000;

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function assertDatabaseHost(expectedPrefix: string | undefined): void {
  if (!expectedPrefix) throw new Error("EXPECTED_DB_HOST_REQUIRED");
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!host.startsWith(expectedPrefix)) throw new Error("DATABASE_HOST_MISMATCH");
}

function waitForAuthorizationCode(expectedState: () => Promise<string | undefined>): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", REDIRECT_URL);
      if (url.pathname !== "/callback") {
        response.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const expected = await expectedState();
      if (!code || !state || !expected || state !== expected) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" })
          .end("Autorizzazione non valida. Chiudere la finestra.");
        server.close();
        reject(new Error(url.searchParams.get("error") ? "AUTHORIZATION_DENIED" : "AUTHORIZATION_STATE_INVALID"));
        return;
      }
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
        .end("Autorizzazione Moonlit per il worker NOETRA ricevuta. Si puo chiudere la finestra.");
      server.close();
      resolve(code);
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("AUTHORIZATION_TIMEOUT"));
    }, LOGIN_TIMEOUT_MS);
    server.on("close", () => clearTimeout(timer));
    server.on("error", reject);
    server.listen(CALLBACK_PORT, "127.0.0.1");
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  assertDatabaseHost(argument(argv, "--expected-db-host"));
  const key = readProviderCredentialKey();
  if (!key) throw new Error("RESEARCH_PROVIDER_CREDENTIAL_KEY_MISSING");

  const storagePath = path.join(os.tmpdir(), `noetra-worker-moonlit-${randomBytes(8).toString("hex")}.json`);
  try {
    let authorizationUrl: URL | null = null;
    const provider = new MoonlitOAuthProvider(
      REDIRECT_URL,
      (url) => {
        authorizationUrl = url;
      },
      storagePath,
    );
    const codePromise = waitForAuthorizationCode(() => provider.expectedState());
    if (await auth(provider, { serverUrl: MOONLIT_MCP_URL }) !== "REDIRECT" || !authorizationUrl) {
      throw new Error("AUTHORIZATION_REDIRECT_EXPECTED");
    }
    console.log(JSON.stringify({ step: "OPEN_IN_BROWSER", url: String(authorizationUrl) }));
    const code = await codePromise;
    if (await auth(provider, { serverUrl: MOONLIT_MCP_URL, authorizationCode: code }) !== "AUTHORIZED") {
      throw new Error("TOKEN_EXCHANGE_FAILED");
    }
    const stored = JSON.parse(await readFile(storagePath, "utf8")) as StoredProviderOAuthState;
    if (!stored.tokens?.access_token || !stored.tokens.refresh_token) throw new Error("TOKENS_INCOMPLETE");
    const tokensObtainedAt = new Date().toISOString();
    await storeProviderOAuthCredential({
      provider: "MOONLIT",
      key,
      state: { clientInformation: stored.clientInformation, tokens: stored.tokens, tokensObtainedAt },
    });
    console.log(JSON.stringify({ provider: "MOONLIT", stored: true, hasRefreshToken: true, tokensObtainedAt }));
  } finally {
    await rm(storagePath, { force: true });
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : "GRANT_FAILED" }));
    process.exit(1);
  },
);
