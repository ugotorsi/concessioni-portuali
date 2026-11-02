import {
  readProviderOAuthCredentialStatuses,
  type ProviderOAuthCredentialStatus,
} from "./provider-oauth-credential-store";

type OAuthReadiness =
  | "READY"
  | "NOT_CONFIGURED"
  | "REAUTHORIZATION_REQUIRED"
  | "REFRESH_FAILED";

export type AutomaticResearchConnectorReadiness = Readonly<{
  ready: boolean;
  legalDataHunter: "READY" | "CREDENTIAL_MISSING";
  moonlit: OAuthReadiness;
  simpliciter: OAuthReadiness;
}>;

function oauthCredentialState(status: ProviderOAuthCredentialStatus): OAuthReadiness {
  if (!status.stored) return "NOT_CONFIGURED";
  if (!status.hasRefreshToken
    || status.lastRefreshErrorCode === "REAUTHORIZATION_REQUIRED"
    || status.lastRefreshErrorCode === "REFRESH_TOKEN_MISSING") {
    return "REAUTHORIZATION_REQUIRED";
  }
  return status.lastRefreshErrorCode ? "REFRESH_FAILED" : "READY";
}

export async function verifyAutomaticResearchConnectorReadiness(
  env: Readonly<Record<string, string | undefined>> = process.env,
  readOAuthStatuses: typeof readProviderOAuthCredentialStatuses =
    readProviderOAuthCredentialStatuses,
): Promise<AutomaticResearchConnectorReadiness> {
  const legalDataHunter = env.LEGAL_DATA_HUNTER_API_KEY?.trim()
    ? "READY"
    : "CREDENTIAL_MISSING";
  const statuses = await readOAuthStatuses();
  const moonlit = oauthCredentialState(
    statuses.find(({ provider }) => provider === "MOONLIT")
      ?? {
        provider: "MOONLIT",
        stored: false,
        hasRefreshToken: false,
        accessTokenExpiresAt: null,
        lastRefreshedAt: null,
        lastRefreshErrorCode: null,
      },
  );
  const simpliciter = oauthCredentialState(
    statuses.find(({ provider }) => provider === "SIMPLICITER")
      ?? {
        provider: "SIMPLICITER",
        stored: false,
        hasRefreshToken: false,
        accessTokenExpiresAt: null,
        lastRefreshedAt: null,
        lastRefreshErrorCode: null,
      },
  );
  return {
    ready: legalDataHunter === "READY"
      && moonlit === "READY"
      && simpliciter === "READY",
    legalDataHunter,
    moonlit,
    simpliciter,
  };
}
