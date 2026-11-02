import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  decryptProviderOAuthState,
  decryptLegalDataHunterApiKey,
  encryptLegalDataHunterApiKey,
  encryptProviderOAuthState,
  ProviderOAuthCredentialError,
  readProviderCredentialKey,
  resolveProviderAccessToken,
  storeProviderOAuthCredential,
  type ProviderOAuthCredentialRepository,
  type ResearchOAuthProvider,
  type StoredProviderOAuthState,
} from "@/server/legal-research/provider-oauth-credential-store";

const key = randomBytes(32);
const now = new Date("2026-11-01T12:00:00Z");

function memoryRepository() {
  const rows = new Map<ResearchOAuthProvider, { provider: string; encryptedPayload: string; stateVersion: number }>();
  const errors: string[] = [];
  const repository: ProviderOAuthCredentialRepository = {
    async find(provider) {
      return rows.get(provider) ?? null;
    },
    async upsert(input) {
      const current = rows.get(input.provider);
      rows.set(input.provider, {
        provider: input.provider,
        encryptedPayload: input.encryptedPayload,
        stateVersion: (current?.stateVersion ?? 0) + 1,
      });
    },
    async compareAndSwap(input) {
      const current = rows.get(input.provider);
      if (!current || current.stateVersion !== input.expectedStateVersion) return false;
      rows.set(input.provider, {
        provider: input.provider,
        encryptedPayload: input.encryptedPayload,
        stateVersion: current.stateVersion + 1,
      });
      return true;
    },
    async recordRefreshError(_provider, code) {
      errors.push(code);
    },
  };
  return { rows, errors, repository };
}

function state(accessToken: string, obtainedAt: Date, refreshToken: string | undefined = "refresh-1"): StoredProviderOAuthState {
  return {
    clientInformation: { client_id: "client-1" },
    tokens: { access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshToken },
    tokensObtainedAt: obtainedAt.toISOString(),
  };
}

describe("encrypted research provider OAuth credential store", () => {
  it("binds ciphertext to the provider and never stores plaintext tokens", () => {
    const envelope = encryptProviderOAuthState("MOONLIT", state("secret-access", now), key);
    expect(envelope).not.toContain("secret-access");
    expect(envelope).not.toContain("refresh-1");
    expect(decryptProviderOAuthState("MOONLIT", envelope, key).tokens?.access_token).toBe("secret-access");
    expect(() => decryptProviderOAuthState("SIMPLICITER", envelope, key)).toThrow(ProviderOAuthCredentialError);
    expect(() => decryptProviderOAuthState("MOONLIT", envelope, randomBytes(32))).toThrow(ProviderOAuthCredentialError);
  });

  it("requires a 32-byte key", () => {
    expect(readProviderCredentialKey({})).toBeNull();
    expect(readProviderCredentialKey({ RESEARCH_PROVIDER_CREDENTIAL_KEY: key.toString("base64url") })?.equals(key)).toBe(true);
    expect(() => readProviderCredentialKey({ RESEARCH_PROVIDER_CREDENTIAL_KEY: "c2hvcnQ" }))
      .toThrow(ProviderOAuthCredentialError);
  });

  it("encrypts the Legal Data Hunter API key with provider-bound authenticated encryption", () => {
    const envelope = encryptLegalDataHunterApiKey("ldh-secret-key", key);
    expect(envelope).not.toContain("ldh-secret-key");
    expect(decryptLegalDataHunterApiKey(envelope, key)).toBe("ldh-secret-key");
    expect(() => decryptLegalDataHunterApiKey(envelope, randomBytes(32)))
      .toThrow(ProviderOAuthCredentialError);
  });

  it("returns a fresh stored token without contacting the provider", async () => {
    const { repository } = memoryRepository();
    await storeProviderOAuthCredential({ provider: "MOONLIT", key, repository, state: state("fresh", now) });
    const authorize = vi.fn();
    await expect(resolveProviderAccessToken({
      provider: "MOONLIT", serverUrl: "https://provider.example/mcp", key, repository, authorize, now: () => now,
    })).resolves.toEqual({ status: "READY", accessToken: "fresh", refreshed: false });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("refreshes an expiring token and persists the rotated grant", async () => {
    const { repository, rows } = memoryRepository();
    await storeProviderOAuthCredential({
      provider: "MOONLIT", key, repository, state: state("old", new Date(now.getTime() - 3_590_000)),
    });
    const authorize = vi.fn(async (client: { saveTokens(tokens: object): void }) => {
      client.saveTokens({ access_token: "new", token_type: "Bearer", expires_in: 3600, refresh_token: "refresh-2" });
      return "AUTHORIZED" as const;
    });
    await expect(resolveProviderAccessToken({
      provider: "MOONLIT", serverUrl: "https://provider.example/mcp", key, repository,
      authorize: authorize as never, now: () => now,
    })).resolves.toEqual({ status: "READY", accessToken: "new", refreshed: true });
    const persisted = decryptProviderOAuthState("MOONLIT", rows.get("MOONLIT")!.encryptedPayload, key);
    expect(persisted.tokens).toMatchObject({ access_token: "new", refresh_token: "refresh-2" });
    expect(rows.get("MOONLIT")!.stateVersion).toBe(2);
  });

  it("never starts an interactive login when refresh is rejected", async () => {
    const { repository, errors } = memoryRepository();
    await storeProviderOAuthCredential({
      provider: "MOONLIT", key, repository, state: state("old", new Date(now.getTime() - 7_200_000)),
    });
    const authorize = vi.fn(async (client: { redirectToAuthorization(url: URL): void }) => {
      client.redirectToAuthorization(new URL("https://provider.example/authorize"));
      return "REDIRECT" as const;
    });
    await expect(resolveProviderAccessToken({
      provider: "MOONLIT", serverUrl: "https://provider.example/mcp", key, repository,
      authorize: authorize as never, now: () => now,
    })).resolves.toEqual({ status: "REAUTHORIZATION_REQUIRED", errorCode: "REAUTHORIZATION_REQUIRED" });
    expect(errors).toEqual(["REAUTHORIZATION_REQUIRED"]);
  });

  it("adopts the concurrently persisted grant when compare-and-swap loses", async () => {
    const { repository, rows } = memoryRepository();
    await storeProviderOAuthCredential({
      provider: "MOONLIT", key, repository, state: state("old", new Date(now.getTime() - 7_200_000)),
    });
    const authorize = vi.fn(async (client: { saveTokens(tokens: object): void }) => {
      rows.set("MOONLIT", {
        provider: "MOONLIT",
        encryptedPayload: encryptProviderOAuthState("MOONLIT", state("winner", now), key),
        stateVersion: 2,
      });
      client.saveTokens({ access_token: "loser", token_type: "Bearer", expires_in: 3600, refresh_token: "refresh-x" });
      return "AUTHORIZED" as const;
    });
    await expect(resolveProviderAccessToken({
      provider: "MOONLIT", serverUrl: "https://provider.example/mcp", key, repository,
      authorize: authorize as never, now: () => now,
    })).resolves.toEqual({ status: "READY", accessToken: "winner", refreshed: false });
  });

  it("reports a missing credential without failing", async () => {
    const { repository } = memoryRepository();
    await expect(resolveProviderAccessToken({
      provider: "SIMPLICITER", serverUrl: "https://provider.example/mcp", key, repository, now: () => now,
    })).resolves.toEqual({ status: "NOT_CONFIGURED", errorCode: "PROVIDER_CREDENTIAL_NOT_STORED" });
  });
});
