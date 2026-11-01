import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { prisma } from "@/lib/prisma";

export const RESEARCH_PROVIDER_CREDENTIAL_KEY_ENV = "RESEARCH_PROVIDER_CREDENTIAL_KEY" as const;
export const RESEARCH_OAUTH_PROVIDERS = ["MOONLIT", "SIMPLICITER"] as const;
export type ResearchOAuthProvider = (typeof RESEARCH_OAUTH_PROVIDERS)[number];

const ENVELOPE_VERSION = "RESEARCH_PROVIDER_OAUTH_V1";
const DEFAULT_REFRESH_MARGIN_MS = 5 * 60 * 1_000;

export type StoredProviderOAuthState = Readonly<{
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  tokensObtainedAt?: string;
}>;

type Envelope = Readonly<{ version: string; iv: string; authTag: string; ciphertext: string }>;

type CredentialRow = Readonly<{
  provider: string;
  encryptedPayload: string;
  stateVersion: number;
}>;

export interface ProviderOAuthCredentialRepository {
  find(provider: ResearchOAuthProvider): Promise<CredentialRow | null>;
  upsert(input: Readonly<{
    provider: ResearchOAuthProvider;
    encryptedPayload: string;
    hasRefreshToken: boolean;
    accessTokenExpiresAt: Date | null;
  }>): Promise<void>;
  compareAndSwap(input: Readonly<{
    provider: ResearchOAuthProvider;
    expectedStateVersion: number;
    encryptedPayload: string;
    hasRefreshToken: boolean;
    accessTokenExpiresAt: Date | null;
    refreshedAt: Date;
  }>): Promise<boolean>;
  recordRefreshError(provider: ResearchOAuthProvider, code: string): Promise<void>;
}

export class ProviderOAuthCredentialError extends Error {
  constructor(readonly code:
    | "CREDENTIAL_KEY_MISSING"
    | "CREDENTIAL_KEY_INVALID"
    | "CREDENTIAL_PAYLOAD_INVALID"
    | "PROVIDER_OAUTH_LOGIN_FORBIDDEN") {
    super(code);
    this.name = "ProviderOAuthCredentialError";
  }
}

export function readProviderCredentialKey(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Buffer | null {
  const encoded = environment[RESEARCH_PROVIDER_CREDENTIAL_KEY_ENV]?.trim();
  if (!encoded) return null;
  const key = Buffer.from(encoded, /^[A-Za-z0-9_-]+$/.test(encoded) ? "base64url" : "base64");
  if (key.length !== 32) throw new ProviderOAuthCredentialError("CREDENTIAL_KEY_INVALID");
  return key;
}

function aad(provider: ResearchOAuthProvider): Buffer {
  return Buffer.from(`${ENVELOPE_VERSION}\n${provider}`, "utf8");
}

export function encryptProviderOAuthState(
  provider: ResearchOAuthProvider,
  state: StoredProviderOAuthState,
  key: Buffer,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(provider));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  const envelope: Envelope = {
    version: ENVELOPE_VERSION,
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
  return JSON.stringify(envelope);
}

export function decryptProviderOAuthState(
  provider: ResearchOAuthProvider,
  encryptedPayload: string,
  key: Buffer,
): StoredProviderOAuthState {
  try {
    const envelope = JSON.parse(encryptedPayload) as Envelope;
    if (envelope.version !== ENVELOPE_VERSION) throw new Error("VERSION");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
    decipher.setAAD(aad(provider));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as StoredProviderOAuthState;
  } catch {
    throw new ProviderOAuthCredentialError("CREDENTIAL_PAYLOAD_INVALID");
  }
}

function accessTokenExpiry(state: StoredProviderOAuthState): Date | null {
  const expiresIn = state.tokens?.expires_in;
  if (!state.tokensObtainedAt || typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) return null;
  const obtainedAt = Date.parse(state.tokensObtainedAt);
  return Number.isFinite(obtainedAt) ? new Date(obtainedAt + expiresIn * 1_000) : null;
}

const prismaRepository: ProviderOAuthCredentialRepository = {
  find: (provider) => prisma.researchProviderOAuthCredential.findUnique({
    where: { provider },
    select: { provider: true, encryptedPayload: true, stateVersion: true },
  }),
  async upsert(input) {
    await prisma.researchProviderOAuthCredential.upsert({
      where: { provider: input.provider },
      create: {
        provider: input.provider,
        encryptedPayload: input.encryptedPayload,
        hasRefreshToken: input.hasRefreshToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
      },
      update: {
        encryptedPayload: input.encryptedPayload,
        hasRefreshToken: input.hasRefreshToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        lastRefreshErrorCode: null,
        stateVersion: { increment: 1 },
      },
    });
  },
  async compareAndSwap(input) {
    const updated = await prisma.researchProviderOAuthCredential.updateMany({
      where: { provider: input.provider, stateVersion: input.expectedStateVersion },
      data: {
        encryptedPayload: input.encryptedPayload,
        hasRefreshToken: input.hasRefreshToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        lastRefreshedAt: input.refreshedAt,
        lastRefreshErrorCode: null,
        stateVersion: { increment: 1 },
      },
    });
    return updated.count === 1;
  },
  async recordRefreshError(provider, code) {
    await prisma.researchProviderOAuthCredential.updateMany({
      where: { provider },
      data: { lastRefreshErrorCode: code.slice(0, 128) },
    });
  },
};

/** Persists an OAuth state obtained interactively on an operator workstation. */
export async function storeProviderOAuthCredential(input: Readonly<{
  provider: ResearchOAuthProvider;
  state: StoredProviderOAuthState;
  key: Buffer;
  repository?: ProviderOAuthCredentialRepository;
}>): Promise<void> {
  const state: StoredProviderOAuthState = {
    clientInformation: input.state.clientInformation,
    tokens: input.state.tokens,
    tokensObtainedAt: input.state.tokensObtainedAt ?? new Date().toISOString(),
  };
  await (input.repository ?? prismaRepository).upsert({
    provider: input.provider,
    encryptedPayload: encryptProviderOAuthState(input.provider, state, input.key),
    hasRefreshToken: Boolean(state.tokens?.refresh_token),
    accessTokenExpiresAt: accessTokenExpiry(state),
  });
}

/** Non-interactive OAuth client: it may refresh tokens but never starts a browser login. */
class StoredOAuthClientProvider implements OAuthClientProvider {
  readonly redirectUrl = "http://127.0.0.1/unused";
  readonly clientMetadata: OAuthClientMetadata = {
    client_name: "Concessioni Portuali Automatic Research",
    redirect_uris: ["http://127.0.0.1/unused"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  refreshedState: StoredProviderOAuthState | null = null;

  constructor(private oauthState: StoredProviderOAuthState, private readonly now: () => Date) {}

  clientInformation() {
    return this.oauthState.clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    this.oauthState = { ...this.oauthState, clientInformation };
  }

  tokens() {
    return this.oauthState.tokens;
  }

  saveTokens(tokens: OAuthTokens) {
    this.oauthState = { ...this.oauthState, tokens, tokensObtainedAt: this.now().toISOString() };
    this.refreshedState = this.oauthState;
  }

  redirectToAuthorization(): void {
    throw new ProviderOAuthCredentialError("PROVIDER_OAUTH_LOGIN_FORBIDDEN");
  }

  saveCodeVerifier(): void {
    throw new ProviderOAuthCredentialError("PROVIDER_OAUTH_LOGIN_FORBIDDEN");
  }

  codeVerifier(): string {
    throw new ProviderOAuthCredentialError("PROVIDER_OAUTH_LOGIN_FORBIDDEN");
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "tokens") this.oauthState = { ...this.oauthState, tokens: undefined };
  }
}

export type ProviderAccessTokenResult =
  | Readonly<{ status: "READY"; accessToken: string; refreshed: boolean }>
  | Readonly<{ status: "NOT_CONFIGURED" | "REAUTHORIZATION_REQUIRED" | "REFRESH_FAILED"; errorCode: string }>;

export async function resolveProviderAccessToken(input: Readonly<{
  provider: ResearchOAuthProvider;
  serverUrl: string;
  key: Buffer;
  now?: () => Date;
  refreshMarginMs?: number;
  repository?: ProviderOAuthCredentialRepository;
  authorize?: typeof auth;
}>): Promise<ProviderAccessTokenResult> {
  const repository = input.repository ?? prismaRepository;
  const now = input.now ?? (() => new Date());
  const row = await repository.find(input.provider);
  if (!row) return { status: "NOT_CONFIGURED", errorCode: "PROVIDER_CREDENTIAL_NOT_STORED" };
  const state = decryptProviderOAuthState(input.provider, row.encryptedPayload, input.key);
  const currentToken = state.tokens?.access_token?.trim();
  const expiry = accessTokenExpiry(state);
  const marginMs = input.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;
  if (currentToken && expiry && expiry.getTime() - marginMs > now().getTime()) {
    return { status: "READY", accessToken: currentToken, refreshed: false };
  }
  if (!state.tokens?.refresh_token) {
    await repository.recordRefreshError(input.provider, "REFRESH_TOKEN_MISSING");
    return { status: "REAUTHORIZATION_REQUIRED", errorCode: "REFRESH_TOKEN_MISSING" };
  }
  const client = new StoredOAuthClientProvider(state, now);
  try {
    const result = await (input.authorize ?? auth)(client, { serverUrl: input.serverUrl });
    if (result !== "AUTHORIZED" || !client.refreshedState?.tokens?.access_token) {
      throw new ProviderOAuthCredentialError("PROVIDER_OAUTH_LOGIN_FORBIDDEN");
    }
  } catch (error) {
    const code = error instanceof ProviderOAuthCredentialError
      ? "REAUTHORIZATION_REQUIRED"
      : "REFRESH_FAILED";
    await repository.recordRefreshError(input.provider, code);
    return { status: code, errorCode: code };
  }
  const refreshed = client.refreshedState;
  const swapped = await repository.compareAndSwap({
    provider: input.provider,
    expectedStateVersion: row.stateVersion,
    encryptedPayload: encryptProviderOAuthState(input.provider, refreshed, input.key),
    hasRefreshToken: Boolean(refreshed.tokens?.refresh_token),
    accessTokenExpiresAt: accessTokenExpiry(refreshed),
    refreshedAt: now(),
  });
  if (!swapped) {
    // Another execution refreshed concurrently; its persisted state is authoritative.
    const winner = await repository.find(input.provider);
    const winnerToken = winner
      ? decryptProviderOAuthState(input.provider, winner.encryptedPayload, input.key).tokens?.access_token?.trim()
      : null;
    return winnerToken
      ? { status: "READY", accessToken: winnerToken, refreshed: false }
      : { status: "REFRESH_FAILED", errorCode: "CONCURRENT_REFRESH_CONFLICT" };
  }
  return { status: "READY", accessToken: refreshed.tokens!.access_token, refreshed: true };
}

export type ProviderOAuthCredentialStatus = Readonly<{
  provider: ResearchOAuthProvider;
  stored: boolean;
  hasRefreshToken: boolean;
  accessTokenExpiresAt: Date | null;
  lastRefreshedAt: Date | null;
  lastRefreshErrorCode: string | null;
}>;

export async function readProviderOAuthCredentialStatuses(): Promise<readonly ProviderOAuthCredentialStatus[]> {
  const rows = await prisma.researchProviderOAuthCredential.findMany({
    select: {
      provider: true,
      hasRefreshToken: true,
      accessTokenExpiresAt: true,
      lastRefreshedAt: true,
      lastRefreshErrorCode: true,
    },
  });
  return RESEARCH_OAUTH_PROVIDERS.map((provider) => {
    const row = rows.find((candidate) => candidate.provider === provider);
    return {
      provider,
      stored: Boolean(row),
      hasRefreshToken: row?.hasRefreshToken ?? false,
      accessTokenExpiresAt: row?.accessTokenExpiresAt ?? null,
      lastRefreshedAt: row?.lastRefreshedAt ?? null,
      lastRefreshErrorCode: row?.lastRefreshErrorCode ?? null,
    };
  });
}
