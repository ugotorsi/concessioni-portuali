import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  getControl: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityLog: { findMany: mocks.findMany },
  },
}));
vi.mock("@/server/ai/providerControl", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/ai/providerControl")>(),
  getAiProviderControlSnapshot: mocks.getControl,
}));

import { getAiProviderReadiness } from "@/server/ai/providerReadiness";
import { aiProviderConfigurationFingerprint } from "@/server/ai/providerConfiguration";

const control = {
  workflow: "FASCICOLO.AUTOMATIC_ANALYSIS_V1" as const,
  automaticSelection: {
    provider: "OPENAI" as const,
    model: "gpt-5.6-terra" as const,
    selectionVersion: "AI_MODEL_SELECTION_V1" as const,
  },
  automaticUpdatedAt: null,
  providers: [
    { provider: "OPENAI" as const, manualEnabled: true, manualUpdatedAt: null, manualUpdatedBy: null, automaticSelected: true },
    { provider: "ANTHROPIC" as const, manualEnabled: false, manualUpdatedAt: null, manualUpdatedBy: null, automaticSelected: false },
    { provider: "DEEPSEEK" as const, manualEnabled: false, manualUpdatedAt: null, manualUpdatedBy: null, automaticSelected: false },
  ],
};

const openAiEnvironment = {
  NEXTAUTH_SECRET: "test-fingerprint-secret-at-least-32-characters",
  AI_OPENAI_API_KEY: "configured-not-exposed",
  ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR: "0.5",
  AI_REAL_DATA_ENABLED: "true",
  AI_REAL_DATA_APPROVAL_ID: "approval-1",
  AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
};
const openAiFingerprint = aiProviderConfigurationFingerprint({
  provider: "OPENAI",
  model: "gpt-5.6-terra",
  apiKey: openAiEnvironment.AI_OPENAI_API_KEY,
  fingerprintSecret: openAiEnvironment.NEXTAUTH_SECRET,
});

describe("AI provider readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.getControl.mockResolvedValue(control);
  });

  it("distinguishes configured credentials from connection verification", async () => {
    const readiness = await getAiProviderReadiness({
      globalAiEnabled: true,
      generalAutomationEnabled: false,
      environment: openAiEnvironment,
      control,
    });
    const openAi = readiness.find((provider) => provider.provider === "OPENAI");

    expect(openAi).toMatchObject({
      credentialConfigured: true,
      connectionStatus: "NOT_VERIFIED",
      credentialValid: false,
      modelAvailable: false,
      modelTechnicallyQualified: true,
      realDataAuthorized: true,
      manualEnabled: true,
      manualEligible: true,
      automaticEligible: true,
      generalAutomationEnabled: false,
      operational: true,
      billingApproval: "INTERNAL_LIMIT_CONFIGURED",
    });
  });

  it("fails closed when credentials, pricing or real-data approval are missing", async () => {
    const readiness = await getAiProviderReadiness({
      globalAiEnabled: true,
      generalAutomationEnabled: true,
      environment: {},
      control,
    });

    expect(readiness.find((provider) => provider.provider === "OPENAI")).toMatchObject({
      credentialConfigured: false,
      realDataAuthorized: false,
      manualEligible: false,
      automaticEligible: false,
      operational: false,
      error: "Credenziale API non configurata.",
    });
    expect(readiness.find((provider) => provider.provider === "ANTHROPIC")).toMatchObject({
      manualEnabled: false,
      realDataAuthorized: false,
      manualEligible: false,
      automaticEligible: false,
    });
  });

  it("reports failed technical verification without exposing metadata details", async () => {
    mocks.findMany.mockResolvedValue([{
      entitaId: "OPENAI",
      esito: "FAILURE",
      metadata: {
        verified: false,
        credentialValid: false,
        modelAvailable: false,
        model: "gpt-5.6-terra",
        configurationFingerprint: openAiFingerprint,
        code: "AI_PROVIDER_CREDENTIAL_REJECTED",
      },
      createdAt: new Date("2026-11-05T12:00:00Z"),
    }]);

    const readiness = await getAiProviderReadiness({
      globalAiEnabled: true,
      generalAutomationEnabled: true,
      environment: openAiEnvironment,
      control,
    });

    expect(readiness.find((provider) => provider.provider === "OPENAI")).toMatchObject({
      connectionStatus: "FAILED",
      status: "ATTENTION",
      error: "L'ultima verifica di connessione non è riuscita.",
    });
  });

  it("surfaces a successful DeepSeek balance verification without amounts", async () => {
    const deepSeekEnvironment = {
      NEXTAUTH_SECRET: openAiEnvironment.NEXTAUTH_SECRET,
      AI_DEEPSEEK_API_KEY: "configured-deepseek-not-exposed",
    };
    const deepSeekFingerprint = aiProviderConfigurationFingerprint({
      provider: "DEEPSEEK",
      model: "deepseek-v4-pro",
      apiKey: deepSeekEnvironment.AI_DEEPSEEK_API_KEY,
      fingerprintSecret: deepSeekEnvironment.NEXTAUTH_SECRET,
    });
    mocks.findMany.mockResolvedValue([{
      entitaId: "DEEPSEEK",
      esito: "SUCCESS",
      metadata: {
        verified: true,
        credentialValid: true,
        modelAvailable: true,
        balanceSufficient: true,
        httpStatus: 200,
        code: "AI_PROVIDER_CONNECTION_VERIFIED",
        model: "deepseek-v4-pro",
        configurationFingerprint: deepSeekFingerprint,
      },
      createdAt: new Date("2026-11-07T08:00:00Z"),
    }]);

    const readiness = await getAiProviderReadiness({
      globalAiEnabled: false,
      generalAutomationEnabled: false,
      environment: deepSeekEnvironment,
      control,
    });

    expect(readiness.find((provider) => provider.provider === "DEEPSEEK")).toMatchObject({
      connectionStatus: "VERIFIED",
      credentialValid: true,
      modelAvailable: true,
      balanceSufficient: true,
      verificationCode: "AI_PROVIDER_CONNECTION_VERIFIED",
      verificationHttpStatus: 200,
    });
  });

  it("reports a DeepSeek insufficient-balance failure before real-data eligibility", async () => {
    const deepSeekEnvironment = {
      NEXTAUTH_SECRET: openAiEnvironment.NEXTAUTH_SECRET,
      AI_DEEPSEEK_API_KEY: "configured-deepseek-not-exposed",
    };
    const deepSeekFingerprint = aiProviderConfigurationFingerprint({
      provider: "DEEPSEEK",
      model: "deepseek-v4-pro",
      apiKey: deepSeekEnvironment.AI_DEEPSEEK_API_KEY,
      fingerprintSecret: deepSeekEnvironment.NEXTAUTH_SECRET,
    });
    mocks.findMany.mockResolvedValue([{
      entitaId: "DEEPSEEK",
      esito: "FAILURE",
      metadata: {
        verified: false,
        credentialValid: true,
        modelAvailable: true,
        balanceSufficient: false,
        httpStatus: 402,
        code: "AI_PROVIDER_BALANCE_INSUFFICIENT",
        model: "deepseek-v4-pro",
        configurationFingerprint: deepSeekFingerprint,
      },
      createdAt: new Date("2026-11-07T08:00:00Z"),
    }]);

    const readiness = await getAiProviderReadiness({
      globalAiEnabled: false,
      generalAutomationEnabled: false,
      environment: deepSeekEnvironment,
      control,
    });

    expect(readiness.find((provider) => provider.provider === "DEEPSEEK")).toMatchObject({
      connectionStatus: "FAILED",
      credentialValid: true,
      modelAvailable: true,
      balanceSufficient: false,
      verificationCode: "AI_PROVIDER_BALANCE_INSUFFICIENT",
      verificationHttpStatus: 402,
      error: "Il saldo API DeepSeek non risulta utilizzabile.",
    });
  });

  it("invalidates verification after the credential or model configuration changes", async () => {
    mocks.findMany.mockResolvedValue([{
      entitaId: "OPENAI",
      esito: "SUCCESS",
      metadata: {
        verified: true,
        credentialValid: true,
        modelAvailable: true,
        model: "gpt-5.6-terra",
        configurationFingerprint: openAiFingerprint,
      },
      createdAt: new Date("2026-11-05T12:00:00Z"),
    }]);

    const readiness = await getAiProviderReadiness({
      globalAiEnabled: true,
      generalAutomationEnabled: true,
      environment: {
        ...openAiEnvironment,
        AI_OPENAI_API_KEY: "rotated-credential",
      },
      control,
    });

    expect(readiness.find((provider) => provider.provider === "OPENAI")).toMatchObject({
      connectionStatus: "STALE",
      credentialValid: false,
      modelAvailable: false,
    });
  });

  it("keeps all providers non-operational when the global AI gate is off", async () => {
    const readiness = await getAiProviderReadiness({
      globalAiEnabled: false,
      generalAutomationEnabled: true,
      environment: openAiEnvironment,
      control,
    });

    expect(readiness.every((provider) => !provider.operational)).toBe(true);
    expect(readiness.find((provider) => provider.provider === "OPENAI")?.error)
      .toBe("Controllo generale AI disabilitato.");
  });
});
