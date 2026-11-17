CREATE TABLE "ResearchProviderOAuthCredential" (
    "provider" VARCHAR(32) NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "hasRefreshToken" BOOLEAN NOT NULL DEFAULT false,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "lastRefreshErrorCode" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchProviderOAuthCredential_pkey" PRIMARY KEY ("provider"),
    CONSTRAINT "ResearchProviderOAuthCredential_provider_check" CHECK ("provider" IN ('MOONLIT', 'SIMPLICITER'))
);
