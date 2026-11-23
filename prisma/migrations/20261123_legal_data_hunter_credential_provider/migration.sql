ALTER TABLE "ResearchProviderOAuthCredential"
DROP CONSTRAINT "ResearchProviderOAuthCredential_provider_check";

ALTER TABLE "ResearchProviderOAuthCredential"
ADD CONSTRAINT "ResearchProviderOAuthCredential_provider_check"
CHECK ("provider" IN ('MOONLIT', 'SIMPLICITER', 'LEGAL_DATA_HUNTER'));
