import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJob } from "@/server/async-jobs/persistence";
import { requestDocumentWorkerActivation } from "@/server/async-jobs/documentWorkerActivation";
import {
  buildFascicoloDocumentAnalysisInputFromCorpus,
  buildFascicoloDocumentCorpusUpdateAdmission,
  FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
  FASCICOLO_V7_CONTROLLED_ANALYSIS_PURPOSE,
} from "@/server/ai/fascicoloAutomaticAnalysisJob";
import { FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION } from "@/server/ai/fascicoloDocumentAnalysis";
import {
  buildFascicoloV7ControlledLogicalOperationId,
  createFascicoloV7EconomicPreflight,
  FascicoloV7PreflightError,
  inspectFascicoloV7BudgetCompatibility,
  type FascicoloV7EconomicPreflight,
} from "@/server/ai/fascicoloV7Preflight";
import { getGlobalAiControlState } from "@/server/ai/globalAiControl";
import { createRealDataActivationPolicy } from "@/server/ai/realDataActivation";
import {
  assertSelvaraPilotAuthorization,
  isSelvaraPilotApprovalId,
  SELVARA_PILOT_AUTHORIZATION,
  SelvaraPilotAuthorizationError,
} from "@/server/ai/selvaraPilotAuthorization";
import {
  getFascicoloDocumentCorpusForTenant,
} from "@/server/queries/fascicolo-document-corpus";

export const FASCICOLO_EXISTING_CORPUS_ANALYSIS_PURPOSE =
  FASCICOLO_V7_CONTROLLED_ANALYSIS_PURPOSE;

export function buildFascicoloExistingCorpusAnalysisAdmission(input: {
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
  preflightFingerprint: string;
  initiatingUserId: string;
  actorEmail: string;
}): AsyncJobAdmissionInput {
  const logicalOperationId = buildFascicoloV7ControlledLogicalOperationId(input);
  return {
    ...buildFascicoloDocumentCorpusUpdateAdmission({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      corpusFingerprint: input.corpusFingerprint,
      correlationId: logicalOperationId,
      policyDecisionRef: null,
      admissionType: "AUTHENTICATED_USER",
      initiatingUserId: input.initiatingUserId,
      actorId: input.initiatingUserId,
      actorEmail: input.actorEmail,
      actorRole: "ADMIN",
    }),
    logicalOperationId,
    purpose: FASCICOLO_EXISTING_CORPUS_ANALYSIS_PURPOSE,
    maxAttempts: 1,
    inputReference: {
      referenceType: "FASCICOLO_DOCUMENT_CORPUS",
      referenceId: input.corpusFingerprint,
      referenceVersion: "V1",
      metadata: {
        procedimentoId: input.procedimentoId,
        corpusHash: input.corpusFingerprint,
        trialContractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
        trialApprovalRef: SELVARA_PILOT_AUTHORIZATION.approvalId,
        trialPreflightHash: input.preflightFingerprint,
      },
    },
  };
}

export class ExistingCorpusAnalysisRequestError extends Error {
  constructor(readonly code:
    | "ANALYSIS_ACTIVATION_DISABLED"
    | "CORPUS_NOT_READY"
    | "ECONOMIC_PREFLIGHT_FAILED"
    | "AI_GLOBALLY_DISABLED"
    | "SELVARA_PILOT_AUTHORIZATION_MISMATCH") {
    super(code);
    this.name = "ExistingCorpusAnalysisRequestError";
  }
}

export function isExistingCorpusAnalysisRequestEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const preflightValuesPresent = [
    "AI_V7_APPROVED_MAX_OUTPUT_TOKENS",
    "AI_V7_APPROVED_MAX_COST_EUR",
    "AI_OPENAI_MAX_INPUT_TOKENS",
    "AI_OPENAI_MAX_OUTPUT_TOKENS",
    "AI_MAX_INPUT_BYTES",
    "AI_OPENAI_MAX_RAW_RESPONSE_BYTES",
    "AI_OPENAI_TIMEOUT_MS",
    "AI_OPENAI_USD_TO_EUR_RATE",
    "AI_OPENAI_USD_TO_EUR_RATE_DATE",
    "AI_OPENAI_USD_TO_EUR_RATE_SOURCE",
    "ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR",
  ].every((name) => Boolean(environment[name]?.trim()));
  return environment.DOCUMENT_WORKER_ACTIVATION_MODE === "RENDER_ONE_OFF"
    && /^srv-[a-z0-9]+$/.test(
      environment.RENDER_APPLICATION_WORKER_SERVICE_ID?.trim() ?? "",
    )
    && Boolean(environment.RENDER_WORKER_API_KEY?.trim())
    && environment.AI_GLOBAL_EMERGENCY_DISABLED?.trim().toLowerCase() !== "true"
    && environment.NOETRA_CANONICAL_IDENTITY_V3_ENABLED?.trim().toLowerCase() !== "true"
    && isSelvaraPilotApprovalId(environment)
    && environment.AI_V7_PREFLIGHT_APPROVAL_ID?.trim()
      === SELVARA_PILOT_AUTHORIZATION.approvalId
    && preflightValuesPresent
    && createRealDataActivationPolicy({
      AI_REAL_DATA_ENABLED: environment.AI_REAL_DATA_ENABLED,
      AI_REAL_DATA_APPROVAL_ID: environment.AI_REAL_DATA_APPROVAL_ID,
      AI_PROVIDER_PROJECT_CLASS: environment.AI_PROVIDER_PROJECT_CLASS,
    }).enabled;
}

interface ExistingCorpusAnalysisDependencies {
  loadCorpus: typeof getFascicoloDocumentCorpusForTenant;
  loadGlobalAiControl: typeof getGlobalAiControlState;
  inspectBudgetCompatibility: typeof inspectFascicoloV7BudgetCompatibility;
  createPreflight(input: {
    analysisInput: ReturnType<typeof buildFascicoloDocumentAnalysisInputFromCorpus>;
    environment: Readonly<Record<string, string | undefined>>;
    budgetCompatibility: Awaited<ReturnType<typeof inspectFascicoloV7BudgetCompatibility>>;
  }): FascicoloV7EconomicPreflight;
  admitJob: typeof admitAsyncJob;
  activateWorker: typeof requestDocumentWorkerActivation;
}

const defaultDependencies: ExistingCorpusAnalysisDependencies = {
  loadCorpus: getFascicoloDocumentCorpusForTenant,
  loadGlobalAiControl: getGlobalAiControlState,
  inspectBudgetCompatibility: inspectFascicoloV7BudgetCompatibility,
  createPreflight: createFascicoloV7EconomicPreflight,
  admitJob: admitAsyncJob,
  activateWorker: requestDocumentWorkerActivation,
};

export async function requestExistingCorpusAnalysis(input: {
  tenantId: string;
  procedimentoId: string;
  actor: {
    id: string;
    email: string;
    role: "ADMIN";
  };
  environment?: Readonly<Record<string, string | undefined>>;
}, dependencies: ExistingCorpusAnalysisDependencies = defaultDependencies) {
  const environment = input.environment ?? process.env;
  if (!isExistingCorpusAnalysisRequestEnabled(environment)) {
    throw new ExistingCorpusAnalysisRequestError("ANALYSIS_ACTIVATION_DISABLED");
  }
  try {
    assertSelvaraPilotAuthorization(environment, {
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      corpusFingerprint: SELVARA_PILOT_AUTHORIZATION.corpusFingerprint,
      purpose: FASCICOLO_EXISTING_CORPUS_ANALYSIS_PURPOSE,
      operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
    });
  } catch (error) {
    if (error instanceof SelvaraPilotAuthorizationError) {
      throw new ExistingCorpusAnalysisRequestError("SELVARA_PILOT_AUTHORIZATION_MISMATCH");
    }
    throw error;
  }
  const aiControl = await dependencies.loadGlobalAiControl(environment);
  if (!aiControl.effectiveEnabled) {
    throw new ExistingCorpusAnalysisRequestError("AI_GLOBALLY_DISABLED");
  }
  const corpus = await dependencies.loadCorpus({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
  });
  if (
    !corpus
    || corpus.availability !== "READY"
    || corpus.documentCount === 0
    || corpus.availableDocumentCount !== corpus.documentCount
    || corpus.textPageCount === 0
  ) {
    throw new ExistingCorpusAnalysisRequestError("CORPUS_NOT_READY");
  }
  try {
    assertSelvaraPilotAuthorization(environment, {
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      corpusFingerprint: corpus.corpusFingerprint,
      purpose: FASCICOLO_EXISTING_CORPUS_ANALYSIS_PURPOSE,
      operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
    });
  } catch (error) {
    if (error instanceof SelvaraPilotAuthorizationError) {
      throw new ExistingCorpusAnalysisRequestError("SELVARA_PILOT_AUTHORIZATION_MISMATCH");
    }
    throw error;
  }
  const approvedMaximumCostEur = Number(environment.AI_V7_APPROVED_MAX_COST_EUR);
  if (!Number.isFinite(approvedMaximumCostEur) || approvedMaximumCostEur <= 0) {
    throw new ExistingCorpusAnalysisRequestError("ECONOMIC_PREFLIGHT_FAILED");
  }
  let preflight: FascicoloV7EconomicPreflight;
  try {
    const budgetCompatibility = await dependencies.inspectBudgetCompatibility({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      requiredAmountEur: approvedMaximumCostEur,
    });
    preflight = dependencies.createPreflight({
      analysisInput: buildFascicoloDocumentAnalysisInputFromCorpus(corpus),
      environment,
      budgetCompatibility,
    });
  } catch (error) {
    if (error instanceof FascicoloV7PreflightError) {
      throw new ExistingCorpusAnalysisRequestError("ECONOMIC_PREFLIGHT_FAILED");
    }
    throw error;
  }
  const admission = await dependencies.admitJob(
    buildFascicoloExistingCorpusAnalysisAdmission({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      corpusFingerprint: corpus.corpusFingerprint,
      preflightFingerprint: preflight.preflightFingerprint,
      initiatingUserId: input.actor.id,
      actorEmail: input.actor.email,
    }),
  );
  const activation = await dependencies.activateWorker({
    kind: "DOCUMENT_ANALYSIS",
    applicationJobId: admission.job.id,
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
  });
  return { admission, activation, preflight };
}
