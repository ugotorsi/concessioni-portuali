import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
  buildFascicoloDocumentProviderRequest,
  FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
  type FascicoloDocumentAnalysisInput,
} from "@/server/ai/fascicoloDocumentAnalysis";
import {
  calculateGpt56TerraCost,
  GPT_5_6_TERRA_PRICING,
} from "@/server/ai/openaiAccounting";
import {
  estimateOpenAiAnalysisRequest,
  OPENAI_ANALYSIS_MODEL,
  type OpenAiTokenCounter,
} from "@/server/ai/providers/openai";
import {
  assertSelvaraPilotAuthorization,
  SELVARA_PILOT_AUTHORIZATION,
} from "@/server/ai/selvaraPilotAuthorization";

const REQUIRED_BUDGET_SCOPES = ["GLOBAL", "TENANT", "PROCEDIMENTO"] as const;
type RequiredBudgetScope = (typeof REQUIRED_BUDGET_SCOPES)[number];

export interface FascicoloV7BudgetScopeAssessment {
  readonly scope: RequiredBudgetScope;
  readonly policyId: string;
  readonly hardCapEur: number;
  readonly committedEur: number;
  readonly availableEur: number;
  readonly compatible: boolean;
}

export interface FascicoloV7BudgetCompatibility {
  readonly compatible: boolean;
  readonly scopes: readonly FascicoloV7BudgetScopeAssessment[];
}

export interface FascicoloV7EconomicPreflight {
  readonly contractVersion: typeof FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION;
  readonly authorizationId: string;
  readonly model: typeof OPENAI_ANALYSIS_MODEL;
  readonly estimatedInputTokens: number;
  readonly inputTokenLimit: number;
  readonly maxOutputTokens: number;
  readonly reasoningTokensIncludedInOutputLimit: true;
  readonly providerRequestBytes: number;
  readonly serviceInputBytes: number;
  readonly serviceInputByteLimit: number;
  readonly rawResponseByteLimit: number;
  readonly timeoutMs: number;
  readonly pricing: typeof GPT_5_6_TERRA_PRICING;
  readonly usdToEurRate: number;
  readonly usdToEurRateDate: string;
  readonly usdToEurRateSource: string;
  readonly maximumCostUsd: number;
  readonly maximumCostEur: number;
  readonly runtimeReservedCostEur: number;
  readonly approvedMaximumCostEur: number;
  readonly budgetCompatibility: FascicoloV7BudgetCompatibility;
  readonly preflightFingerprint: string;
}

export class FascicoloV7PreflightError extends Error {
  constructor(readonly code:
    | "V7_PREFLIGHT_CONFIGURATION_INVALID"
    | "V7_PREFLIGHT_APPROVAL_MISMATCH"
    | "V7_PREFLIGHT_IDENTITY_MISMATCH"
    | "V7_PREFLIGHT_FINGERPRINT_MISMATCH"
    | "V7_PREFLIGHT_INPUT_LIMIT_EXCEEDED"
    | "V7_PREFLIGHT_BYTE_LIMIT_EXCEEDED"
    | "V7_PREFLIGHT_COST_NOT_APPROVED"
    | "V7_PREFLIGHT_BUDGET_INCOMPATIBLE") {
    super(code);
    this.name = "FascicoloV7PreflightError";
  }
}

export function buildFascicoloV7ControlledLogicalOperationId(input: {
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
}): string {
  return createHash("sha256").update([
    SELVARA_PILOT_AUTHORIZATION.operation,
    "DOCUMENT_CORPUS",
    "ADMIN_EXISTING_CORPUS_V7_CONTROLLED",
    FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
    SELVARA_PILOT_AUTHORIZATION.approvalId,
    input.tenantId,
    input.procedimentoId,
    input.corpusFingerprint,
  ].join("\n"), "utf8").digest("hex");
}

function required(environment: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new FascicoloV7PreflightError("V7_PREFLIGHT_CONFIGURATION_INVALID");
  return value;
}

function positiveInteger(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): number {
  const value = required(environment, name);
  if (!/^\d+$/.test(value)) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_CONFIGURATION_INVALID");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_CONFIGURATION_INVALID");
  }
  return parsed;
}

function positiveAmount(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): number {
  const parsed = Number(required(environment, name));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_CONFIGURATION_INVALID");
  }
  return parsed;
}

function roundDownSix(value: number): number {
  return Math.floor((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export async function inspectFascicoloV7BudgetCompatibility(input: {
  tenantId: string;
  procedimentoId: string;
  requiredAmountEur: number;
  now?: Date;
}): Promise<FascicoloV7BudgetCompatibility> {
  const now = input.now ?? new Date();
  const policies = await prisma.runtimeBudgetPolicy.findMany({
    where: {
      enabled: true,
      currency: "EUR",
      effectiveFrom: { lte: now },
      OR: [
        { scope: "GLOBAL", tenantId: null, procedimentoId: null },
        { scope: "TENANT", tenantId: input.tenantId, procedimentoId: null },
        {
          scope: "PROCEDIMENTO",
          tenantId: input.tenantId,
          procedimentoId: input.procedimentoId,
        },
      ],
    },
    orderBy: [{ scope: "asc" }, { id: "asc" }],
  });
  const scopes: FascicoloV7BudgetScopeAssessment[] = [];
  for (const scope of REQUIRED_BUDGET_SCOPES) {
    const scopedPolicies = policies.filter((policy) => policy.scope === scope);
    if (scopedPolicies.length === 0) {
      return { compatible: false, scopes };
    }
    for (const policy of scopedPolicies) {
      const createdAt = new Date(now.getTime() - policy.windowSeconds * 1_000);
      const reservations = await prisma.runtimeCostReservation.findMany({
        where: {
          currency: "EUR",
          createdAt: { gte: createdAt },
          ...(scope === "TENANT" ? { tenantId: input.tenantId } : {}),
          ...(scope === "PROCEDIMENTO"
            ? { tenantId: input.tenantId, procedimentoId: input.procedimentoId }
            : {}),
          OR: [
            { status: "SETTLED" },
            { status: "RESERVED", expiresAt: { gt: now } },
          ],
        },
        select: { status: true, actualAmount: true, reservedAmount: true },
      });
      const committedEur = reservations.reduce((total, reservation) => (
        total + Number(
          reservation.status === "SETTLED"
            ? reservation.actualAmount ?? reservation.reservedAmount
            : reservation.reservedAmount,
        )
      ), 0);
      const hardCapEur = Number(policy.hardCapAmount);
      const availableEur = roundDownSix(Math.max(0, hardCapEur - committedEur));
      scopes.push({
        scope,
        policyId: policy.id,
        hardCapEur,
        committedEur,
        availableEur,
        compatible: availableEur >= input.requiredAmountEur,
      });
    }
  }
  return {
    compatible: REQUIRED_BUDGET_SCOPES.every((scope) =>
      scopes.some((assessment) => assessment.scope === scope)
      && scopes
        .filter((assessment) => assessment.scope === scope)
        .every((assessment) => assessment.compatible)),
    scopes,
  };
}

export function createFascicoloV7EconomicPreflight(input: {
  analysisInput: FascicoloDocumentAnalysisInput;
  environment: Readonly<Record<string, string | undefined>>;
  budgetCompatibility: FascicoloV7BudgetCompatibility;
  tokenCounter?: OpenAiTokenCounter;
}): FascicoloV7EconomicPreflight {
  if (input.environment.NOETRA_CANONICAL_IDENTITY_V3_ENABLED === "true") {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_CONFIGURATION_INVALID");
  }
  const approvalId = required(input.environment, "AI_V7_PREFLIGHT_APPROVAL_ID");
  if (approvalId !== SELVARA_PILOT_AUTHORIZATION.approvalId) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_APPROVAL_MISMATCH");
  }
  const maxInputTokens = positiveInteger(input.environment, "AI_OPENAI_MAX_INPUT_TOKENS");
  const maxOutputTokens = positiveInteger(input.environment, "AI_OPENAI_MAX_OUTPUT_TOKENS");
  const approvedOutputTokens = positiveInteger(
    input.environment,
    "AI_V7_APPROVED_MAX_OUTPUT_TOKENS",
  );
  if (approvedOutputTokens !== maxOutputTokens) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_APPROVAL_MISMATCH");
  }
  const maxInputBytes = positiveInteger(input.environment, "AI_MAX_INPUT_BYTES");
  const maxRawResponseBytes = positiveInteger(
    input.environment,
    "AI_OPENAI_MAX_RAW_RESPONSE_BYTES",
  );
  const timeoutMs = positiveInteger(input.environment, "AI_OPENAI_TIMEOUT_MS");
  const usdToEurRate = positiveAmount(input.environment, "AI_OPENAI_USD_TO_EUR_RATE");
  const usdToEurRateDate = required(input.environment, "AI_OPENAI_USD_TO_EUR_RATE_DATE");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(usdToEurRateDate)) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_CONFIGURATION_INVALID");
  }
  const usdToEurRateSource = required(input.environment, "AI_OPENAI_USD_TO_EUR_RATE_SOURCE");
  const approvedMaximumCostEur = positiveAmount(
    input.environment,
    "AI_V7_APPROVED_MAX_COST_EUR",
  );
  const runtimeReservedCostEur = positiveAmount(
    input.environment,
    "ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR",
  );
  const providerRequest = buildFascicoloDocumentProviderRequest(input.analysisInput);
  const estimate = estimateOpenAiAnalysisRequest(
    providerRequest,
    maxOutputTokens,
    input.tokenCounter,
  );
  const serviceInputBytes = Buffer.byteLength(JSON.stringify(providerRequest), "utf8");
  if (estimate.inputTokens > maxInputTokens) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_INPUT_LIMIT_EXCEEDED");
  }
  if (serviceInputBytes > maxInputBytes) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_BYTE_LIMIT_EXCEEDED");
  }
  const maximum = calculateGpt56TerraCost({
    usage: {
      inputTokens: estimate.inputTokens,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: maxOutputTokens,
      reasoningOutputTokens: maxOutputTokens,
    },
    usdToEurRate,
  });
  if (maximum.accountedEur > approvedMaximumCostEur) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_COST_NOT_APPROVED");
  }
  if (Math.abs(runtimeReservedCostEur - maximum.accountedEur) > 0.000001) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_CONFIGURATION_INVALID");
  }
  if (!input.budgetCompatibility.compatible
    || REQUIRED_BUDGET_SCOPES.some((scope) =>
      !input.budgetCompatibility.scopes.some((assessment) =>
        assessment.scope === scope
        && assessment.compatible
        && assessment.availableEur >= maximum.accountedEur))) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_BUDGET_INCOMPATIBLE");
  }
  const fingerprintInput = {
    contractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
    authorizationId: approvalId,
    model: OPENAI_ANALYSIS_MODEL,
    corpusFingerprint: input.analysisInput.corpusFingerprint,
    estimatedInputTokens: estimate.inputTokens,
    inputTokenLimit: maxInputTokens,
    maxOutputTokens,
    providerRequestBytes: estimate.requestBytes,
    serviceInputBytes,
    serviceInputByteLimit: maxInputBytes,
    rawResponseByteLimit: maxRawResponseBytes,
    timeoutMs,
    pricing: GPT_5_6_TERRA_PRICING,
    usdToEurRate,
    usdToEurRateDate,
    usdToEurRateSource,
    maximumCostEur: maximum.accountedEur,
    runtimeReservedCostEur,
    approvedMaximumCostEur,
    budgetScopes: input.budgetCompatibility.scopes,
  };
  return Object.freeze({
    contractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
    authorizationId: approvalId,
    model: OPENAI_ANALYSIS_MODEL,
    estimatedInputTokens: estimate.inputTokens,
    inputTokenLimit: maxInputTokens,
    maxOutputTokens,
    reasoningTokensIncludedInOutputLimit: true,
    providerRequestBytes: estimate.requestBytes,
    serviceInputBytes,
    serviceInputByteLimit: maxInputBytes,
    rawResponseByteLimit: maxRawResponseBytes,
    timeoutMs,
    pricing: GPT_5_6_TERRA_PRICING,
    usdToEurRate,
    usdToEurRateDate,
    usdToEurRateSource,
    maximumCostUsd: maximum.billableUsd,
    maximumCostEur: maximum.accountedEur,
    runtimeReservedCostEur,
    approvedMaximumCostEur,
    budgetCompatibility: input.budgetCompatibility,
    preflightFingerprint: createHash("sha256")
      .update(JSON.stringify(fingerprintInput), "utf8")
      .digest("hex"),
  });
}

export async function revalidateFascicoloV7EconomicPreflight(input: {
  job: {
    tenantId: string | null;
    procedimentoId: string | null;
    purpose: string;
    operation: string;
    logicalOperationId: string;
    maxAttempts: number;
  };
  analysisInput: FascicoloDocumentAnalysisInput;
  referenceCorpusFingerprint: string;
  persistedContractVersion: string;
  persistedApprovalRef: string;
  persistedPreflightFingerprint: string;
  environment: Readonly<Record<string, string | undefined>>;
  inspectBudgetCompatibility?: typeof inspectFascicoloV7BudgetCompatibility;
  tokenCounter?: OpenAiTokenCounter;
}): Promise<FascicoloV7EconomicPreflight> {
  const { job, analysisInput } = input;
  const expectedLogicalOperationId = buildFascicoloV7ControlledLogicalOperationId({
    tenantId: analysisInput.tenantId,
    procedimentoId: analysisInput.procedimentoId,
    corpusFingerprint: analysisInput.corpusFingerprint,
  });
  if (
    job.tenantId !== analysisInput.tenantId
    || job.procedimentoId !== analysisInput.procedimentoId
    || job.purpose !== SELVARA_PILOT_AUTHORIZATION.purpose
    || job.operation !== SELVARA_PILOT_AUTHORIZATION.operation
    || job.logicalOperationId !== expectedLogicalOperationId
    || job.maxAttempts !== 1
    || analysisInput.contractVersion !== FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION
    || analysisInput.corpusFingerprint !== input.referenceCorpusFingerprint
    || input.persistedContractVersion !== FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION
    || input.persistedApprovalRef !== SELVARA_PILOT_AUTHORIZATION.approvalId
  ) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_IDENTITY_MISMATCH");
  }
  if (
    input.environment.AI_REAL_DATA_APPROVAL_ID?.trim()
      !== SELVARA_PILOT_AUTHORIZATION.approvalId
  ) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_APPROVAL_MISMATCH");
  }
  assertSelvaraPilotAuthorization(input.environment, {
    tenantId: analysisInput.tenantId,
    procedimentoId: analysisInput.procedimentoId,
    corpusFingerprint: analysisInput.corpusFingerprint,
    purpose: job.purpose,
    operation: job.operation,
  });
  const approvedMaximumCostEur = positiveAmount(
    input.environment,
    "AI_V7_APPROVED_MAX_COST_EUR",
  );
  const budgetCompatibility = await (
    input.inspectBudgetCompatibility ?? inspectFascicoloV7BudgetCompatibility
  )({
    tenantId: analysisInput.tenantId,
    procedimentoId: analysisInput.procedimentoId,
    requiredAmountEur: approvedMaximumCostEur,
  });
  const preflight = createFascicoloV7EconomicPreflight({
    analysisInput,
    environment: input.environment,
    budgetCompatibility,
    tokenCounter: input.tokenCounter,
  });
  if (preflight.preflightFingerprint !== input.persistedPreflightFingerprint) {
    throw new FascicoloV7PreflightError("V7_PREFLIGHT_FINGERPRINT_MISMATCH");
  }
  return preflight;
}
