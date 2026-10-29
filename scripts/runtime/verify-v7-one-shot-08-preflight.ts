import { prisma } from "../../src/lib/prisma";
import {
  buildFascicoloDocumentAnalysisInputFromCorpus,
} from "../../src/server/ai/fascicoloAutomaticAnalysisJob";
import {
  buildFascicoloExistingCorpusAnalysisAdmission,
} from "../../src/server/ai/fascicoloExistingCorpusAnalysis";
import {
  buildFascicoloV7ControlledLogicalOperationId,
  createFascicoloV7EconomicPreflight,
  inspectFascicoloV7BudgetCompatibility,
} from "../../src/server/ai/fascicoloV7Preflight";
import {
  SELVARA_PILOT_AUTHORIZATION,
} from "../../src/server/ai/selvaraPilotAuthorization";
import {
  getFascicoloDocumentCorpusForTenant,
} from "../../src/server/queries/fascicolo-document-corpus";

const ABSOLUTE_COST_LIMIT_EUR = 0.762;
const EXPECTED_MAXIMUM_COST_EUR = 0.754038;

function assertDisabled(name: string, expected: string): void {
  if (process.env[name] !== expected) {
    throw new Error(`${name} must remain ${expected}.`);
  }
}

async function main(): Promise<void> {
  assertDisabled("AI_REAL_DATA_ENABLED", "false");
  assertDisabled("ASYNC_PROVIDER_EXECUTION_ENABLED", "false");
  assertDisabled("DOCUMENT_WORKER_ACTIVATION_MODE", "DISABLED");
  assertDisabled("AUTOMATIC_RESEARCH_EXECUTION_ENABLED", "false");
  assertDisabled("AI_PROVIDER_OUTPUT_RECOVERY_ENABLED", "false");
  const recoveryKey = Buffer.from(
    process.env.AI_PROVIDER_OUTPUT_RECOVERY_KEY?.trim() ?? "",
    "base64",
  );
  if (recoveryKey.length !== 32) {
    throw new Error("AI_PROVIDER_OUTPUT_RECOVERY_KEY is not a 32-byte key.");
  }

  const corpus = await getFascicoloDocumentCorpusForTenant({
    tenantId: SELVARA_PILOT_AUTHORIZATION.tenantId,
    procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
  });
  if (
    !corpus
    || corpus.availability !== "READY"
    || corpus.corpusFingerprint !== SELVARA_PILOT_AUTHORIZATION.corpusFingerprint
    || corpus.textPageCount !== 40
    || corpus.availableDocumentCount !== corpus.documentCount
  ) {
    throw new Error("SELVARA_CORPUS_NOT_READY");
  }
  const analysisInput = buildFascicoloDocumentAnalysisInputFromCorpus(corpus);
  const requiredAmountEur = Number(process.env.AI_V7_APPROVED_MAX_COST_EUR);
  const budgetCompatibility = await inspectFascicoloV7BudgetCompatibility({
    tenantId: corpus.tenantId,
    procedimentoId: corpus.procedimentoId,
    requiredAmountEur,
  });
  const preflight = createFascicoloV7EconomicPreflight({
    analysisInput,
    environment: process.env,
    budgetCompatibility,
  });
  if (
    preflight.maximumCostEur !== EXPECTED_MAXIMUM_COST_EUR
    || preflight.approvedMaximumCostEur !== EXPECTED_MAXIMUM_COST_EUR
    || preflight.runtimeReservedCostEur !== EXPECTED_MAXIMUM_COST_EUR
    || preflight.maximumCostEur > ABSOLUTE_COST_LIMIT_EUR
    || !preflight.budgetCompatibility.compatible
  ) {
    throw new Error("ONE_SHOT_08_ECONOMIC_PREFLIGHT_MISMATCH");
  }

  const logicalOperationId = buildFascicoloV7ControlledLogicalOperationId({
    tenantId: corpus.tenantId,
    procedimentoId: corpus.procedimentoId,
    corpusFingerprint: corpus.corpusFingerprint,
  });
  const existingJobCount = await prisma.asyncJob.count({
    where: {
      logicalOperationId,
      purpose: SELVARA_PILOT_AUTHORIZATION.purpose,
    },
  });
  if (existingJobCount !== 0) {
    throw new Error("ONE_SHOT_08_ALREADY_ADMITTED");
  }
  const admission = buildFascicoloExistingCorpusAnalysisAdmission({
    tenantId: corpus.tenantId,
    procedimentoId: corpus.procedimentoId,
    corpusFingerprint: corpus.corpusFingerprint,
    preflightFingerprint: preflight.preflightFingerprint,
    initiatingUserId: "preflight-only-admin",
    actorEmail: "preflight-only@example.invalid",
  });
  if (admission.maxAttempts !== 1) {
    throw new Error("ONE_SHOT_08_MAX_ATTEMPTS_INVALID");
  }

  console.info(JSON.stringify({
    outcome: "ONE_SHOT_08_PREFLIGHT_READY",
    approvalId: SELVARA_PILOT_AUTHORIZATION.approvalId,
    corpusFingerprint: corpus.corpusFingerprint,
    documentCount: corpus.documentCount,
    pageCount: corpus.textPageCount,
    estimatedInputTokens: preflight.estimatedInputTokens,
    maxOutputTokens: preflight.maxOutputTokens,
    maximumCostEur: preflight.maximumCostEur,
    absoluteCostLimitEur: ABSOLUTE_COST_LIMIT_EUR,
    runtimeReservedCostEur: preflight.runtimeReservedCostEur,
    budgetCompatibility: preflight.budgetCompatibility,
    preflightFingerprint: preflight.preflightFingerprint,
    maxAttempts: admission.maxAttempts,
    existingJobCount,
    paidProviderCalled: false,
    providerGatesEnabled: false,
    persistenceRecoveryReady: true,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "UNKNOWN_PREFLIGHT_ERROR");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
