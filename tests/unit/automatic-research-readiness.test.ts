import { describe, expect, it } from "vitest";

import { verifyAutomaticResearchConnectorReadiness } from "@/server/legal-research/automatic-research-readiness";
import type { ProviderOAuthCredentialStatus } from "@/server/legal-research/provider-oauth-credential-store";

function statuses(
  moonlit: Partial<ProviderOAuthCredentialStatus> = {},
  simpliciter: Partial<ProviderOAuthCredentialStatus> = {},
) {
  const status = (
    provider: ProviderOAuthCredentialStatus["provider"],
    overrides: Partial<ProviderOAuthCredentialStatus>,
  ): ProviderOAuthCredentialStatus => ({
    provider,
    stored: false,
    hasRefreshToken: false,
    accessTokenExpiresAt: null,
    lastRefreshedAt: null,
    lastRefreshErrorCode: null,
    ...overrides,
  });
  return async () => [
    status("MOONLIT", moonlit),
    status("SIMPLICITER", simpliciter),
  ];
}

describe("automatic research connector readiness", () => {
  it("fails closed without stored OAuth credentials or the LDH credential", async () => {
    await expect(verifyAutomaticResearchConnectorReadiness({}, statuses())).resolves.toEqual({
      ready: false,
      legalDataHunter: "CREDENTIAL_MISSING",
      moonlit: "NOT_CONFIGURED",
      simpliciter: "NOT_CONFIGURED",
    });
  });

  it("reports reauthorization and refresh failures without exposing values", async () => {
    await expect(verifyAutomaticResearchConnectorReadiness({
      LEGAL_DATA_HUNTER_API_KEY: "configured",
    }, statuses(
      { stored: true, lastRefreshErrorCode: "REFRESH_TOKEN_MISSING" },
      { stored: true, hasRefreshToken: true, lastRefreshErrorCode: "REFRESH_FAILED" },
    ))).resolves.toEqual({
      ready: false,
      legalDataHunter: "READY",
      moonlit: "REAUTHORIZATION_REQUIRED",
      simpliciter: "REFRESH_FAILED",
    });
  });

  it("reports ready only when both stored credentials can refresh and LDH is configured", async () => {
    await expect(verifyAutomaticResearchConnectorReadiness({
      LEGAL_DATA_HUNTER_API_KEY: "configured",
    }, statuses(
      { stored: true, hasRefreshToken: true },
      { stored: true, hasRefreshToken: true },
    ))).resolves.toEqual({
      ready: true,
      legalDataHunter: "READY",
      moonlit: "READY",
      simpliciter: "READY",
    });
  });
});
