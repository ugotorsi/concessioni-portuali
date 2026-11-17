import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  discoverAuthorizationServerMetadata,
  refreshAuthorization,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

type StoredWorkosMcpOAuth = {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
  tokensSavedAt?: number;
};

export const WORKOS_MCP_OAUTH_CALLBACK_URL = "http://127.0.0.1:8788/callback" as const;
export const WORKOS_MCP_OAUTH_STORAGE_PATH = path.join(
  process.cwd(),
  ".local-storage",
  "workos-staging",
  "oauth.json",
);

async function readStoredOAuth(storagePath: string): Promise<StoredWorkosMcpOAuth> {
  try {
    return JSON.parse(await readFile(storagePath, "utf8")) as StoredWorkosMcpOAuth;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeStoredOAuth(storagePath: string, value: StoredWorkosMcpOAuth): Promise<void> {
  await mkdir(path.dirname(storagePath), { recursive: true });
  const temporaryPath = `${storagePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, storagePath);
  await chmod(storagePath, 0o600);
}

export async function storedWorkosMcpAccessToken(config: Readonly<{
  issuer: string;
  resource: string;
}>): Promise<string> {
  const stored = await readStoredOAuth(WORKOS_MCP_OAUTH_STORAGE_PATH);
  const accessToken = stored.tokens?.access_token?.trim();
  const expiresIn = stored.tokens?.expires_in;
  const expiresAt = stored.tokensSavedAt && expiresIn
    ? stored.tokensSavedAt + expiresIn * 1000
    : 0;
  if (accessToken && expiresAt > Date.now() + 60_000) return accessToken;

  if (!stored.clientInformation || !stored.tokens?.refresh_token) {
    throw new Error("WORKOS_MCP_OAUTH_LOGIN_REQUIRED");
  }

  const issuer = new URL(config.issuer);
  const resource = new URL(config.resource);
  if (issuer.protocol !== "https:" || resource.protocol !== "https:" || resource.pathname !== "/api/mcp") {
    throw new Error("WORKOS_MCP_OAUTH_CONFIG_INVALID");
  }
  const metadata = await discoverAuthorizationServerMetadata(issuer);
  if (!metadata || metadata.issuer !== issuer.toString().replace(/\/$/, "")) {
    throw new Error("WORKOS_MCP_OAUTH_ISSUER_MISMATCH");
  }
  const tokens = await refreshAuthorization(issuer, {
    metadata,
    clientInformation: stored.clientInformation,
    refreshToken: stored.tokens.refresh_token,
    resource,
  });
  await writeStoredOAuth(WORKOS_MCP_OAUTH_STORAGE_PATH, {
    clientInformation: stored.clientInformation,
    tokens,
    tokensSavedAt: Date.now(),
  });
  return tokens.access_token;
}

export class WorkosMcpOAuthProvider implements OAuthClientProvider {
  readonly clientMetadata: OAuthClientMetadata;

  constructor(
    readonly redirectUrl: string,
    private readonly resourceUrl: string,
    private readonly onRedirect: (authorizationUrl: URL) => void | Promise<void>,
    private readonly storagePath = WORKOS_MCP_OAUTH_STORAGE_PATH,
  ) {
    this.clientMetadata = {
      client_name: "Concessioni Portuali Local Executor",
      redirect_uris: [redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid profile email offline_access",
    };
  }

  async state(): Promise<string> {
    const stored = await readStoredOAuth(this.storagePath);
    const state = randomBytes(32).toString("base64url");
    await writeStoredOAuth(this.storagePath, { ...stored, state });
    return state;
  }

  async expectedState(): Promise<string | undefined> {
    return (await readStoredOAuth(this.storagePath)).state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await readStoredOAuth(this.storagePath)).clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    const stored = await readStoredOAuth(this.storagePath);
    await writeStoredOAuth(this.storagePath, { ...stored, clientInformation });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await readStoredOAuth(this.storagePath)).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const stored = await readStoredOAuth(this.storagePath);
    await writeStoredOAuth(this.storagePath, {
      clientInformation: stored.clientInformation,
      tokens,
      tokensSavedAt: Date.now(),
    });
  }

  redirectToAuthorization(authorizationUrl: URL): void | Promise<void> {
    return this.onRedirect(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const stored = await readStoredOAuth(this.storagePath);
    await writeStoredOAuth(this.storagePath, { ...stored, codeVerifier });
  }

  async codeVerifier(): Promise<string> {
    const codeVerifier = (await readStoredOAuth(this.storagePath)).codeVerifier;
    if (!codeVerifier) throw new Error("WORKOS_MCP_OAUTH_CODE_VERIFIER_MISSING");
    return codeVerifier;
  }

  async validateResourceURL(serverUrl: string | URL, resource?: string): Promise<URL> {
    const expected = new URL(this.resourceUrl);
    const requested = new URL(resource ?? serverUrl);
    if (requested.toString() !== expected.toString()) {
      throw new Error("WORKOS_MCP_RESOURCE_MISMATCH");
    }
    return expected;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    const stored = await readStoredOAuth(this.storagePath);
    if (scope === "all") return writeStoredOAuth(this.storagePath, {});
    if (scope === "client") delete stored.clientInformation;
    if (scope === "tokens") delete stored.tokens;
    if (scope === "verifier") delete stored.codeVerifier;
    await writeStoredOAuth(this.storagePath, stored);
  }
}