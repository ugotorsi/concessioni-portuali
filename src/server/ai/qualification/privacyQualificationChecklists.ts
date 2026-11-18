export const MULTI_AI_PRIVACY_QUALIFICATION_VERSION =
  "MULTI_AI_PRIVACY_QUALIFICATION_2026_11_05" as const;

export interface PrivacyQualificationItem {
  readonly id: string;
  readonly result: "PASS" | "FAIL" | "NOT_TESTED";
  readonly blocking: boolean;
  readonly finding: string;
  readonly requiredAction: string | null;
  readonly sourceUrls: readonly string[];
}

export interface ProviderPrivacyQualificationChecklist {
  readonly version: typeof MULTI_AI_PRIVACY_QUALIFICATION_VERSION;
  readonly assessedOn: "2026-11-05";
  readonly serviceScope: string;
  readonly realDataDecision: "BLOCKED";
  readonly overallResult: "FAIL" | "NOT_TESTED";
  readonly items: readonly PrivacyQualificationItem[];
}

const anthropicSources = {
  dpaArticle:
    "https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa",
  dpa: "https://www.anthropic.com/legal/data-processing-addendum",
  retention:
    "https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data",
  zeroDataRetention:
    "https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to",
  training:
    "https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training",
  serverLocation:
    "https://privacy.claude.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers",
  dataResidency:
    "https://platform.claude.com/docs/en/manage-claude/data-residency",
  subprocessors: "https://trust.anthropic.com/subprocessors",
} as const;

const deepSeekSources = {
  openPlatformTerms:
    "https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html",
  privacyPolicy:
    "https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html",
  garanteDecision:
    "https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/10098477",
} as const;

export const ANTHROPIC_API_PRIVACY_QUALIFICATION = {
  version: MULTI_AI_PRIVACY_QUALIFICATION_VERSION,
  assessedOn: "2026-11-05",
  serviceScope: "Direct Anthropic commercial API",
  realDataDecision: "BLOCKED",
  overallResult: "NOT_TESTED",
  items: [
    {
      id: "ANTHROPIC_DPA_SCC",
      result: "PASS",
      blocking: false,
      finding: "Commercial terms incorporate a DPA and EU SCC Module Two or Three.",
      requiredAction: "Review and archive the complete applicable DPA annexes before approval.",
      sourceUrls: [anthropicSources.dpaArticle, anthropicSources.dpa],
    },
    {
      id: "ANTHROPIC_STANDARD_RETENTION",
      result: "PASS",
      blocking: false,
      finding: "Standard API inputs and outputs are deleted within 30 days, subject to documented safety and feedback exceptions.",
      requiredAction: "Confirm whether Claude Sonnet 5 is subject to any covered-model retention exception.",
      sourceUrls: [anthropicSources.retention],
    },
    {
      id: "ANTHROPIC_TRAINING_DEFAULT",
      result: "PASS",
      blocking: false,
      finding: "Commercial API inputs and outputs are not used for training by default, absent feedback or opt-in.",
      requiredAction: "Confirm the organization has not opted in and prohibit feedback submission for qualification payloads.",
      sourceUrls: [anthropicSources.training],
    },
    {
      id: "ANTHROPIC_ZDR_ACCOUNT_STATUS",
      result: "NOT_TESTED",
      blocking: true,
      finding: "Zero Data Retention is optional, organization-specific, and not the default.",
      requiredAction: "Verify the executed agreement and organization setting; do not infer ZDR from API access.",
      sourceUrls: [anthropicSources.zeroDataRetention],
    },
    {
      id: "ANTHROPIC_TRANSFER_TIA",
      result: "NOT_TESTED",
      blocking: true,
      finding: "Direct API data is stored in the United States by default; inference routing does not change storage location.",
      requiredAction: "Complete and approve an EU-US transfer impact assessment and verify applicable SCC safeguards.",
      sourceUrls: [anthropicSources.serverLocation, anthropicSources.dataResidency],
    },
    {
      id: "ANTHROPIC_SUBPROCESSORS",
      result: "NOT_TESTED",
      blocking: true,
      finding: "The official subprocessor list is published through a JavaScript-rendered trust center and was not enumerated in this assessment.",
      requiredAction: "Retrieve, review, and archive the current subprocessor list and processing locations.",
      sourceUrls: [anthropicSources.subprocessors],
    },
    {
      id: "ANTHROPIC_NOETRA_GOVERNANCE",
      result: "NOT_TESTED",
      blocking: true,
      finding: "NOETRA legal basis, customer information, professional secrecy, tenant authorization, and incident procedures are not approved.",
      requiredAction: "Obtain privacy, legal, security, and administrative approval before any real-data authorization.",
      sourceUrls: [anthropicSources.dpa],
    },
  ],
} as const satisfies ProviderPrivacyQualificationChecklist;

export const DEEPSEEK_OPEN_PLATFORM_PRIVACY_QUALIFICATION = {
  version: MULTI_AI_PRIVACY_QUALIFICATION_VERSION,
  assessedOn: "2026-11-05",
  serviceScope: "DeepSeek Open Platform API",
  realDataDecision: "BLOCKED",
  overallResult: "FAIL",
  items: [
    {
      id: "DEEPSEEK_OPEN_PLATFORM_SCOPE",
      result: "PASS",
      blocking: true,
      finding: "The Open Platform terms govern API services but expressly exclude downstream end-user personal data from the published privacy policy.",
      requiredAction: "Obtain a written enterprise agreement covering API input/output data and controller/processor roles.",
      sourceUrls: [deepSeekSources.openPlatformTerms, deepSeekSources.privacyPolicy],
    },
    {
      id: "DEEPSEEK_DPA_SCC_ART46",
      result: "FAIL",
      blocking: true,
      finding: "No DPA, SCC module, Article 46 transfer safeguard, or API-specific TIA commitment was verified for downstream case-file data.",
      requiredAction: "Obtain and legally approve contractual transfer safeguards before any real-data use.",
      sourceUrls: [deepSeekSources.openPlatformTerms, deepSeekSources.privacyPolicy],
    },
    {
      id: "DEEPSEEK_API_RETENTION_TRAINING",
      result: "FAIL",
      blocking: true,
      finding: "Retention and training commitments applicable to downstream Open Platform API payloads were not documented.",
      requiredAction: "Obtain written API-specific retention, deletion, training-exclusion, and audit commitments.",
      sourceUrls: [deepSeekSources.openPlatformTerms, deepSeekSources.privacyPolicy],
    },
    {
      id: "DEEPSEEK_HOSTING_SUBPROCESSORS",
      result: "FAIL",
      blocking: true,
      finding: "Hosting locations, subprocessors, and transfer destinations for downstream API payloads were not documented.",
      requiredAction: "Obtain and assess the complete hosting, subprocessor, transfer, and security schedule.",
      sourceUrls: [deepSeekSources.openPlatformTerms, deepSeekSources.privacyPolicy],
    },
    {
      id: "DEEPSEEK_GARANTE_SCOPE",
      result: "NOT_TESTED",
      blocking: true,
      finding: "The Garante order broadly addresses the DeepSeek service on consumer-service facts but does not expressly include or exclude the Open Platform API.",
      requiredAction: "Obtain authoritative legal clarification; do not infer that API processing is outside the order.",
      sourceUrls: [deepSeekSources.garanteDecision],
    },
    {
      id: "DEEPSEEK_NOETRA_GOVERNANCE",
      result: "NOT_TESTED",
      blocking: true,
      finding: "NOETRA legal basis, customer information, professional secrecy, tenant authorization, and incident procedures are not approved.",
      requiredAction: "Maintain the absolute real-data block unless every contractual, GDPR, security, and administrative gate is approved.",
      sourceUrls: [deepSeekSources.openPlatformTerms],
    },
  ],
} as const satisfies ProviderPrivacyQualificationChecklist;
