import { describe, expect, it, vi } from "vitest";

import {
  FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
  type FascicoloDocumentAnalysisInput,
} from "@/server/ai/fascicoloDocumentAnalysis";
import {
  buildFascicoloV7ControlledLogicalOperationId,
  createFascicoloV7EconomicPreflight,
  FascicoloV7PreflightError,
  revalidateFascicoloV7EconomicPreflight,
  type FascicoloV7BudgetCompatibility,
} from "@/server/ai/fascicoloV7Preflight";
import {
  SELVARA_PILOT_AUTHORIZATION,
  SELVARA_V3_RECOVERY_AUTHORIZATION,
} from "@/server/ai/selvaraPilotAuthorization";

const analysisInput: FascicoloDocumentAnalysisInput = {
  contractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
  tenantId: SELVARA_PILOT_AUTHORIZATION.tenantId,
  procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
  neutralIntakeId: "",
  documentVersionId: "attempt-1",
  artifactSha256: "a".repeat(64),
  corpusFingerprint: SELVARA_PILOT_AUTHORIZATION.corpusFingerprint,
  documents: [{
    documentVersionId: "attempt-1",
    artifactSha256: "a".repeat(64),
  }],
  documentsAreUntrustedData: true,
  externalToolsAllowed: false,
  excerpts: [{
    reference: "DOCUMENT_1.PAGE_1",
    pageNumber: 1,
    documentVersionId: "attempt-1",
    artifactSha256: "a".repeat(64),
    text: "Testo autentico del documento.",
    textSha256: "b".repeat(64),
    extractionMethod: "PDFJS",
    ocrConfidence: null,
  }],
};

const environment = {
  AI_REAL_DATA_APPROVAL_ID: SELVARA_PILOT_AUTHORIZATION.approvalId,
  AI_V7_PREFLIGHT_APPROVAL_ID: SELVARA_PILOT_AUTHORIZATION.approvalId,
  AI_V7_APPROVED_MAX_OUTPUT_TOKENS: "64000",
  AI_V7_APPROVED_MAX_COST_EUR: "1.00",
  AI_OPENAI_MAX_INPUT_TOKENS: "100000",
  AI_OPENAI_MAX_OUTPUT_TOKENS: "64000",
  AI_MAX_INPUT_BYTES: "1000000",
  AI_OPENAI_MAX_RAW_RESPONSE_BYTES: "1000000",
  AI_OPENAI_TIMEOUT_MS: "90000",
  AI_OPENAI_USD_TO_EUR_RATE: "0.90",
  AI_OPENAI_USD_TO_EUR_RATE_DATE: "2026-10-26",
  AI_OPENAI_USD_TO_EUR_RATE_SOURCE: "ECB reference rate",
  ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR: "0.693224",
};

const admittedJob = {
  tenantId: SELVARA_PILOT_AUTHORIZATION.tenantId,
  procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
  purpose: SELVARA_PILOT_AUTHORIZATION.purpose,
  operation: SELVARA_PILOT_AUTHORIZATION.operation,
  logicalOperationId: buildFascicoloV7ControlledLogicalOperationId({
    tenantId: SELVARA_PILOT_AUTHORIZATION.tenantId,
    procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
    corpusFingerprint: SELVARA_PILOT_AUTHORIZATION.corpusFingerprint,
  }),
  maxAttempts: 1,
};

const compatibleBudgets: FascicoloV7BudgetCompatibility = {
  compatible: true,
  scopes: ["GLOBAL", "TENANT", "PROCEDIMENTO"].map((scope) => ({
    scope: scope as "GLOBAL" | "TENANT" | "PROCEDIMENTO",
    policyId: `policy-${scope.toLowerCase()}`,
    hardCapEur: 10,
    committedEur: 0,
    availableEur: 10,
    compatible: true,
  })),
};

describe("NOETRA V7 economic preflight", () => {
  it("produces a reproducible complete maximum-cost assessment without a provider call", () => {
    const first = createFascicoloV7EconomicPreflight({
      analysisInput,
      environment,
      budgetCompatibility: compatibleBudgets,
      tokenCounter: () => 100,
    });
    const second = createFascicoloV7EconomicPreflight({
      analysisInput,
      environment,
      budgetCompatibility: compatibleBudgets,
      tokenCounter: () => 100,
    });

    expect(first).toMatchObject({
      contractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
      authorizationId: SELVARA_PILOT_AUTHORIZATION.approvalId,
      estimatedInputTokens: 1124,
      inputTokenLimit: 100000,
      maxOutputTokens: 64000,
      reasoningTokensIncludedInOutputLimit: true,
      serviceInputByteLimit: 1000000,
      rawResponseByteLimit: 1000000,
      timeoutMs: 90000,
      usdToEurRate: 0.9,
      usdToEurRateDate: "2026-10-26",
      usdToEurRateSource: "ECB reference rate",
      approvedMaximumCostEur: 1,
      runtimeReservedCostEur: 0.693224,
    });
    expect(first.maximumCostEur).toBeLessThanOrEqual(1);
    expect(first.preflightFingerprint).toBe(second.preflightFingerprint);
  });

  it.each([
    ["V3 approval", { AI_V7_PREFLIGHT_APPROVAL_ID: SELVARA_V3_RECOVERY_AUTHORIZATION.approvalId }, "V7_PREFLIGHT_APPROVAL_MISMATCH"],
    ["output approval", { AI_V7_APPROVED_MAX_OUTPUT_TOKENS: "48000" }, "V7_PREFLIGHT_APPROVAL_MISMATCH"],
    ["input limit", { AI_OPENAI_MAX_INPUT_TOKENS: "1000" }, "V7_PREFLIGHT_INPUT_LIMIT_EXCEEDED"],
    ["byte limit", { AI_MAX_INPUT_BYTES: "100" }, "V7_PREFLIGHT_BYTE_LIMIT_EXCEEDED"],
    ["cost approval", { AI_V7_APPROVED_MAX_COST_EUR: "0.10" }, "V7_PREFLIGHT_COST_NOT_APPROVED"],
    ["rate source", { AI_OPENAI_USD_TO_EUR_RATE_SOURCE: "" }, "V7_PREFLIGHT_CONFIGURATION_INVALID"],
    ["runtime reservation", { ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR: "0.50" }, "V7_PREFLIGHT_CONFIGURATION_INVALID"],
    ["canonical engine", { NOETRA_CANONICAL_IDENTITY_V3_ENABLED: "true" }, "V7_PREFLIGHT_CONFIGURATION_INVALID"],
  ])("blocks an invalid %s before admission", (_name, override, code) => {
    expect(() => createFascicoloV7EconomicPreflight({
      analysisInput,
      environment: { ...environment, ...override },
      budgetCompatibility: compatibleBudgets,
      tokenCounter: () => 100,
    })).toThrow(new FascicoloV7PreflightError(code as never));
  });

  it("blocks when any global, tenant, or procedure budget is unavailable", () => {
    const incompatible = {
      compatible: false,
      scopes: compatibleBudgets.scopes.map((scope) => (
        scope.scope === "PROCEDIMENTO"
          ? { ...scope, availableEur: 0, compatible: false }
          : scope
      )),
    };
    expect(() => createFascicoloV7EconomicPreflight({
      analysisInput,
      environment,
      budgetCompatibility: incompatible,
      tokenCounter: () => 100,
    })).toThrow(new FascicoloV7PreflightError("V7_PREFLIGHT_BUDGET_INCOMPATIBLE"));
  });

  it("revalidates the exact admitted identity and immutable preflight before execution", async () => {
    const admitted = createFascicoloV7EconomicPreflight({
      analysisInput,
      environment,
      budgetCompatibility: compatibleBudgets,
      tokenCounter: () => 100,
    });
    const inspectBudgetCompatibility = vi.fn(async () => compatibleBudgets);

    await expect(revalidateFascicoloV7EconomicPreflight({
      job: admittedJob,
      analysisInput,
      referenceCorpusFingerprint: analysisInput.corpusFingerprint,
      persistedContractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
      persistedApprovalRef: SELVARA_PILOT_AUTHORIZATION.approvalId,
      persistedPreflightFingerprint: admitted.preflightFingerprint,
      environment,
      inspectBudgetCompatibility,
      tokenCounter: () => 100,
    })).resolves.toMatchObject({
      preflightFingerprint: admitted.preflightFingerprint,
      runtimeReservedCostEur: admitted.runtimeReservedCostEur,
      model: admitted.model,
    });
    expect(inspectBudgetCompatibility).toHaveBeenCalledWith({
      tenantId: analysisInput.tenantId,
      procedimentoId: analysisInput.procedimentoId,
      requiredAmountEur: 1,
    });
  });

  it.each([
    ["approval absent", { AI_REAL_DATA_APPROVAL_ID: "" }, "V7_PREFLIGHT_APPROVAL_MISMATCH"],
    ["approval replaced", { AI_REAL_DATA_APPROVAL_ID: "OTHER-APPROVAL" }, "V7_PREFLIGHT_APPROVAL_MISMATCH"],
    ["output limit changed", { AI_OPENAI_MAX_OUTPUT_TOKENS: "48000" }, "V7_PREFLIGHT_APPROVAL_MISMATCH"],
    ["economic configuration changed", { AI_OPENAI_USD_TO_EUR_RATE: "0.91" }, "V7_PREFLIGHT_CONFIGURATION_INVALID"],
  ])("blocks runtime revalidation when %s", async (_name, override, code) => {
    const admitted = createFascicoloV7EconomicPreflight({
      analysisInput,
      environment,
      budgetCompatibility: compatibleBudgets,
      tokenCounter: () => 100,
    });
    await expect(revalidateFascicoloV7EconomicPreflight({
      job: admittedJob,
      analysisInput,
      referenceCorpusFingerprint: analysisInput.corpusFingerprint,
      persistedContractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
      persistedApprovalRef: SELVARA_PILOT_AUTHORIZATION.approvalId,
      persistedPreflightFingerprint: admitted.preflightFingerprint,
      environment: { ...environment, ...override },
      inspectBudgetCompatibility: async () => compatibleBudgets,
      tokenCounter: () => 100,
    })).rejects.toThrow(new FascicoloV7PreflightError(code as never));
  });

  it("blocks a persisted fingerprint or deterministic job identity mismatch", async () => {
    await expect(revalidateFascicoloV7EconomicPreflight({
      job: admittedJob,
      analysisInput,
      referenceCorpusFingerprint: analysisInput.corpusFingerprint,
      persistedContractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
      persistedApprovalRef: SELVARA_PILOT_AUTHORIZATION.approvalId,
      persistedPreflightFingerprint: "f".repeat(64),
      environment,
      inspectBudgetCompatibility: async () => compatibleBudgets,
      tokenCounter: () => 100,
    })).rejects.toThrow(new FascicoloV7PreflightError("V7_PREFLIGHT_FINGERPRINT_MISMATCH"));

    await expect(revalidateFascicoloV7EconomicPreflight({
      job: { ...admittedJob, logicalOperationId: "wrong-operation-id" },
      analysisInput,
      referenceCorpusFingerprint: analysisInput.corpusFingerprint,
      persistedContractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
      persistedApprovalRef: SELVARA_PILOT_AUTHORIZATION.approvalId,
      persistedPreflightFingerprint: "f".repeat(64),
      environment,
      inspectBudgetCompatibility: async () => compatibleBudgets,
      tokenCounter: () => 100,
    })).rejects.toThrow(new FascicoloV7PreflightError("V7_PREFLIGHT_IDENTITY_MISMATCH"));
  });
});
