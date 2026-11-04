import "dotenv/config";

import { readFile, stat } from "node:fs/promises";

import { MOONLIT_OAUTH_STORAGE_PATH } from "../../src/server/legal-research/moonlit-oauth";
import {
  RESEARCH_OAUTH_PROVIDERS,
  readProviderCredentialKey,
  storeProviderOAuthCredential,
  type ResearchOAuthProvider,
  type StoredProviderOAuthState,
} from "../../src/server/legal-research/provider-oauth-credential-store";

// Imports an OAuth grant obtained interactively on this workstation into the encrypted DB store
// used by ephemeral workers. Never prints token material.
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const provider = (value("--provider") ?? "MOONLIT").toUpperCase() as ResearchOAuthProvider;
  if (!RESEARCH_OAUTH_PROVIDERS.includes(provider)) throw new Error("PROVIDER_INVALID");
  const sourcePath = value("--from")
    ?? (provider === "MOONLIT" ? process.env.MOONLIT_OAUTH_STORAGE_PATH?.trim() || MOONLIT_OAUTH_STORAGE_PATH : undefined);
  if (!sourcePath) throw new Error("SOURCE_PATH_REQUIRED");
  const key = readProviderCredentialKey();
  if (!key) throw new Error("RESEARCH_PROVIDER_CREDENTIAL_KEY_MISSING");
  const stored = JSON.parse(await readFile(sourcePath, "utf8")) as StoredProviderOAuthState;
  if (!stored.tokens?.access_token || !stored.tokens.refresh_token) {
    throw new Error("SOURCE_TOKENS_INCOMPLETE");
  }
  const obtainedAt = stored.tokensObtainedAt ?? (await stat(sourcePath)).mtime.toISOString();
  if (!argv.includes("--execute")) {
    console.log(JSON.stringify({ provider, dryRun: true, hasRefreshToken: true, tokensObtainedAt: obtainedAt }));
    return;
  }
  await storeProviderOAuthCredential({
    provider,
    key,
    state: {
      clientInformation: stored.clientInformation,
      tokens: stored.tokens,
      tokensObtainedAt: obtainedAt,
    },
  });
  console.log(JSON.stringify({ provider, imported: true, hasRefreshToken: true, tokensObtainedAt: obtainedAt }));
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : "IMPORT_FAILED" }));
    process.exit(1);
  },
);
