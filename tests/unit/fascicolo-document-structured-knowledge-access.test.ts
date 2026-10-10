import { describe, expect, it } from "vitest";

import {
  E2E_STRUCTURED_KNOWLEDGE_DATABASE_HOST,
  E2E_STRUCTURED_KNOWLEDGE_GIT_BRANCH,
  E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
  getFascicoloDocumentStructuredKnowledgeAccessCode,
} from "@/server/ai/fascicoloDocumentStructuredKnowledgeAccess";

function authorizedEnvironment() {
  return {
    E2E_FASCICOLO_STRUCTURED_ANALYSIS_ENABLED: "true",
    E2E_FASCICOLO_STRUCTURED_ANALYSIS_BUDGET_APPROVED: "true",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: E2E_STRUCTURED_KNOWLEDGE_GIT_BRANCH,
    DATABASE_URL: `postgresql://local-test:local-test@${E2E_STRUCTURED_KNOWLEDGE_DATABASE_HOST}/neondb`,
    AI_REAL_DATA_ENABLED: "true",
    AI_REAL_DATA_APPROVAL_ID: "local-test-approval",
    AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
    AI_OPENAI_API_KEY: "local-test-key",
    AI_OPENAI_REGION: "EU",
    AI_OPENAI_TIMEOUT_MS: "1000",
    AI_OPENAI_MAX_RAW_RESPONSE_BYTES: "10000",
    AI_OPENAI_MAX_OUTPUT_TOKENS: "1000",
    AI_MAX_INPUT_BYTES: "10000",
  };
}

describe("E2E fascicolo document structured knowledge access", () => {
  it("is disabled by default", () => {
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: {},
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
    })).toBe("FEATURE_DISABLED");
  });

  it("requires explicit budget approval after enablement", () => {
    const env = authorizedEnvironment();
    env.E2E_FASCICOLO_STRUCTURED_ANALYSIS_BUDGET_APPROVED = "false";

    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
    })).toBe("BUDGET_APPROVAL_REQUIRED");
  });

  it("rejects a different Git branch or deployment environment", () => {
    const env = authorizedEnvironment();
    env.VERCEL_GIT_COMMIT_REF = "staging-operativo";

    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
    })).toBe("ENVIRONMENT_NOT_ALLOWED");
  });

  it("requires real-data provider approval and complete runtime configuration", () => {
    const approvalMissing = authorizedEnvironment();
    approvalMissing.AI_REAL_DATA_APPROVAL_ID = "";
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: approvalMissing,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
    })).toBe("PROVIDER_APPROVAL_REQUIRED");

    const configurationMissing = authorizedEnvironment();
    configurationMissing.AI_OPENAI_API_KEY = "";
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: configurationMissing,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
    })).toBe("PROVIDER_CONFIGURATION_REQUIRED");
  });

  it("rejects a different database host without rewriting the URL", () => {
    const env = authorizedEnvironment();
    env.DATABASE_URL = "postgresql://local-test:local-test@ep-jolly-hall.invalid/neondb";

    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
    })).toBe("DESTINATION_NOT_ALLOWED");
  });

  it("rejects any other procedimento", () => {
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: authorizedEnvironment(),
      procedimentoId: "procedimento-non-autorizzato",
    })).toBe("PROCEDIMENTO_NOT_ALLOWED");
  });

  it("allows only the explicitly authorized E2E combination", () => {
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: authorizedEnvironment(),
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
    })).toBeNull();
  });
});
