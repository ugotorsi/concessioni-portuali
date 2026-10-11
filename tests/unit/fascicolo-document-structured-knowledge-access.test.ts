import { describe, expect, it } from "vitest";

import {
  E2E_STRUCTURED_KNOWLEDGE_DATABASE_BRANCH,
  E2E_STRUCTURED_KNOWLEDGE_DATABASE_HOST,
  E2E_STRUCTURED_KNOWLEDGE_GIT_BRANCH,
  E2E_STRUCTURED_KNOWLEDGE_OPENAI_PROJECT_ID,
  E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
  E2E_STRUCTURED_KNOWLEDGE_TENANT_ID,
  getFascicoloDocumentStructuredKnowledgeAccessCode,
} from "@/server/ai/fascicoloDocumentStructuredKnowledgeAccess";

const AUTHORIZED_NOW = new Date("2026-10-11T11:05:00.000Z");

function authorizedEnvironment() {
  return {
    E2E_FASCICOLO_STRUCTURED_ANALYSIS_ENABLED: "true",
    E2E_FASCICOLO_STRUCTURED_ANALYSIS_BUDGET_APPROVED: "true",
    E2E_FASCICOLO_STRUCTURED_ANALYSIS_NOT_BEFORE: "2026-10-11T11:00:00.000Z",
    E2E_FASCICOLO_STRUCTURED_ANALYSIS_EXPIRES_AT: "2026-10-11T11:10:00.000Z",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: E2E_STRUCTURED_KNOWLEDGE_GIT_BRANCH,
    NEON_BRANCH_ID: E2E_STRUCTURED_KNOWLEDGE_DATABASE_BRANCH,
    DATABASE_URL: `postgresql://local-test:local-test@${E2E_STRUCTURED_KNOWLEDGE_DATABASE_HOST}/neondb`,
    AI_OPENAI_API_KEY: "local-test-key",
    AI_OPENAI_PROJECT_ID: E2E_STRUCTURED_KNOWLEDGE_OPENAI_PROJECT_ID,
    AI_OPENAI_REGION: "GLOBAL",
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
      now: AUTHORIZED_NOW,
    })).toBe("FEATURE_DISABLED");
  });

  it("requires explicit budget approval after enablement", () => {
    const env = authorizedEnvironment();
    env.E2E_FASCICOLO_STRUCTURED_ANALYSIS_BUDGET_APPROVED = "false";

    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      now: AUTHORIZED_NOW,
    })).toBe("BUDGET_APPROVAL_REQUIRED");
  });

  it("rejects a different Git branch or deployment environment", () => {
    const env = authorizedEnvironment();
    env.VERCEL_GIT_COMMIT_REF = "staging-operativo";

    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      now: AUTHORIZED_NOW,
    })).toBe("ENVIRONMENT_NOT_ALLOWED");
  });

  it("requires complete provider configuration without global AI activation", () => {
    const configurationMissing = authorizedEnvironment();
    configurationMissing.AI_OPENAI_API_KEY = "";
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: configurationMissing,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      now: AUTHORIZED_NOW,
    })).toBe("PROVIDER_CONFIGURATION_REQUIRED");
  });

  it("rejects a different database host without rewriting the URL", () => {
    const env = authorizedEnvironment();
    env.DATABASE_URL = "postgresql://local-test:local-test@ep-jolly-hall.invalid/neondb";

    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      now: AUTHORIZED_NOW,
    })).toBe("DESTINATION_NOT_ALLOWED");
  });

  it("requires the exact Neon branch and an explicit OpenAI project", () => {
    const wrongBranch = authorizedEnvironment();
    wrongBranch.NEON_BRANCH_ID = "br-staging";
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: wrongBranch,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      now: AUTHORIZED_NOW,
    })).toBe("DESTINATION_NOT_ALLOWED");

    const projectMissing = authorizedEnvironment();
    projectMissing.AI_OPENAI_PROJECT_ID = "";
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: projectMissing,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      now: AUTHORIZED_NOW,
    })).toBe("PROVIDER_CONFIGURATION_REQUIRED");
  });

  it("rejects any other procedimento", () => {
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: authorizedEnvironment(),
      procedimentoId: "procedimento-non-autorizzato",
      now: AUTHORIZED_NOW,
    })).toBe("PROCEDIMENTO_NOT_ALLOWED");
  });

  it("rejects absent, expired, or overlong temporal authorization", () => {
    const absent = authorizedEnvironment();
    absent.E2E_FASCICOLO_STRUCTURED_ANALYSIS_EXPIRES_AT = "";
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: absent,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      now: AUTHORIZED_NOW,
    })).toBe("AUTHORIZATION_INVALID");

    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: authorizedEnvironment(),
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      now: new Date("2026-10-11T11:10:00.000Z"),
    })).toBe("AUTHORIZATION_EXPIRED");

    const overlong = authorizedEnvironment();
    overlong.E2E_FASCICOLO_STRUCTURED_ANALYSIS_EXPIRES_AT =
      "2026-10-11T11:10:00.001Z";
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: overlong,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      now: AUTHORIZED_NOW,
    })).toBe("AUTHORIZATION_INVALID");
  });

  it("rejects a different tenant", () => {
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: authorizedEnvironment(),
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      tenantId: "tenant-altro",
      now: AUTHORIZED_NOW,
    })).toBe("TENANT_NOT_ALLOWED");
  });

  it("allows only the explicitly authorized E2E combination", () => {
    expect(getFascicoloDocumentStructuredKnowledgeAccessCode({
      env: authorizedEnvironment(),
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      tenantId: E2E_STRUCTURED_KNOWLEDGE_TENANT_ID,
      now: AUTHORIZED_NOW,
    })).toBeNull();
  });
});
