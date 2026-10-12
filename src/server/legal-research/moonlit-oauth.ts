import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

type StoredMoonlitOAuth = {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
};

export const MOONLIT_MCP_URL = "https://mcp.moonlit.ai/mcp" as const;
export const MOONLIT_OAUTH_STORAGE_PATH = path.join(
  process.cwd(),
  ".local-storage",
  "moonlit",
  "oauth.json",
);

function configuredMoonlitStoragePath(): string {
  return process.env.MOONLIT_OAUTH_STORAGE_PATH?.trim() || MOONLIT_OAUTH_STORAGE_PATH;
}

async function readStoredOAuth(storagePath: string): Promise<StoredMoonlitOAuth> {
  try {
    return JSON.parse(await readFile(storagePath, "utf8")) as StoredMoonlitOAuth;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeStoredOAuth(storagePath: string, value: StoredMoonlitOAuth): Promise<void> {
  await mkdir(path.dirname(storagePath), { recursive: true });
  const temporaryPath = `${storagePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, storagePath);
  await chmod(storagePath, 0o600);
}

export class MoonlitOAuthProvider implements OAuthClientProvider {
  readonly clientMetadata: OAuthClientMetadata;

  constructor(
    readonly redirectUrl: string,
    private readonly onRedirect: (authorizationUrl: URL) => void | Promise<void>,
    private readonly storagePath = configuredMoonlitStoragePath(),
  ) {
    this.clientMetadata = {
      client_name: "Concessioni Portuali Local Executor",
      redirect_uris: [redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
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
    if (!codeVerifier) throw new Error("MOONLIT_OAUTH_CODE_VERIFIER_MISSING");
    return codeVerifier;
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