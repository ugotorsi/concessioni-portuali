import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJob } from "@/server/async-jobs/persistence";
import { requestDocumentWorkerActivation } from "@/server/async-jobs/documentWorkerActivation";
import { z } from "zod";
import {
  buildFascicoloDocumentCorpusUpdateAdmission,
  FASCICOLO_V7_CONTROLLED_ANALYSIS_PURPOSE,
} from "@/server/ai/fascicoloAutomaticAnalysisJob";
import {
  buildFascicoloV7ControlledLogicalOperationId,
  inspectFascicoloV7BudgetCompatibility,
} from "@/server/ai/fascicoloV7Preflight";
import { FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION } from "@/server/ai/fascicoloDocumentAnalysis";
import { getGlobalAiControlState } from "@/server/ai/globalAiControl";
import { createRealDataActivationPolicy } from "@/server/ai/realDataActivation";
import {
  aiSelectionMetadata,
  DEFAULT_AI_MODEL_SELECTION,
  getAiModelCatalogEntry,
  type AiModelSelection,
} from "@/server/ai/providerCatalog";
import {
  aiModelEstimatedAmountEur,
  isAiModelReadyForRealData,
} from "@/server/ai/providerRuntime";
import { getAiProviderControlSnapshot } from "@/server/ai/providerControl";
import { SELVARA_PILOT_AUTHORIZATION } from "@/server/ai/selvaraPilotAuthorization";
import {
  getFascicoloDocumentCorpusForTenant,
} from "@/server/queries/fascicolo-document-corpus";

export const FASCICOLO_EXISTING_CORPUS_ANALYSIS_PURPOSE =
  "FASCICOLO_MANUAL_ANALYSIS" as const;

const TERMINAL_ANALYSIS_JOB_STATUSES = new Set([
  "SUCCEEDED",
  "TERMINAL_FAILED",
  "CANCELLED",
]);
const manualAnalysisExecutionIdSchema = z.string().uuid().transform((value) => value.toLowerCase());

function manualLogicalOperationId(input: {
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
  executionId: string;
}): string {
  const executionId = manualAnalysisExecutionIdSchema.parse(input.executionId);
  return [
    FASCICOLO_EXISTING_CORPUS_ANALYSIS_PURPOSE,
    input.tenantId,
    input.procedimentoId,
    input.corpusFingerprint,
    executionId,
  ].join(":");
}

export function buildFascicoloExistingCorpusAnalysisAdmission(input: {
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
  executionId: string;
  preflightFingerprint?: string;
  initiatingUserId: string;
  actorEmail: string;
  selection?: AiModelSelection;
  authorizationRef?: string;
}): AsyncJobAdmissionInput {
  const controlledV7 = Boolean(input.preflightFingerprint);
  const selection = input.selection ?? DEFAULT_AI_MODEL_SELECTION;
  if (controlledV7 && (
    selection.provider !== DEFAULT_AI_MODEL_SELECTION.provider
    || selection.model !== DEFAULT_AI_MODEL_SELECTION.model
  )) {
    throw new ExistingCorpusAnalysisRequestError("AI_PROVIDER_NOT_APPROVED");
  }
  const authorizationRef = input.authorizationRef ?? SELVARA_PILOT_AUTHORIZATION.approvalId;
  const baseAdmission = buildFascicoloDocumentCorpusUpdateAdmission({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    corpusFingerprint: input.corpusFingerprint,
    correlationId: controlledV7
      ? buildFascicoloV7ControlledLogicalOperationId(input)
      : manualLogicalOperationId(input),
    policyDecisionRef: null,
    admissionType: "AUTHENTICATED_USER",
    initiatingUserId: input.initiatingUserId,
    actorId: input.initiatingUserId,
    actorEmail: input.actorEmail,
    actorRole: "ADMIN",
  });
  const logicalOperationId = controlledV7
    ? buildFascicoloV7ControlledLogicalOperationId(input)
    : manualLogicalOperationId(input);
  return {
    ...baseAdmission,
    logicalOperationId,
    purpose: controlledV7
      ? FASCICOLO_V7_CONTROLLED_ANALYSIS_PURPOSE
      : FASCICOLO_EXISTING_CORPUS_ANALYSIS_PURPOSE,
    maxAttempts: 1,
    ...(controlledV7
      ? {
          inputReference: {
            referenceType: "FASCICOLO_DOCUMENT_CORPUS" as const,
            referenceId: input.corpusFingerprint,
            referenceVersion: "V1" as const,
            metadata: {
              procedimentoId: input.procedimentoId,
              corpusHash: input.corpusFingerprint,
              trialContractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
              trialApprovalRef: SELVARA_PILOT_AUTHORIZATION.approvalId,
              trialPreflightHash: input.preflightFingerprint!,
            },
          },
        }
      : {
          inputReference: {
            referenceType: "FASCICOLO_DOCUMENT_CORPUS" as const,
            referenceId: input.corpusFingerprint,
            referenceVersion: "V1" as const,
            metadata: {
              procedimentoId: input.procedimentoId,
              corpusHash: input.corpusFingerprint,
              ...aiSelectionMetadata(selection, authorizationRef),
            },
          },
        }),
  };
}

export class ExistingCorpusAnalysisRequestError extends Error {
  constructor(readonly code:
    | "ANALYSIS_ACTIVATION_DISABLED"
    | "CORPUS_NOT_READY"
    | "ECONOMIC_PREFLIGHT_FAILED"
    | "AI_GLOBALLY_DISABLED"
    | "AI_PROVIDER_NOT_APPROVED"
    | "AI_PROVIDER_MANUAL_DISABLED") {
    super(code);
    this.name = "ExistingCorpusAnalysisRequestError";
  }
}

export function isExistingCorpusAnalysisRequestEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  selection: AiModelSelection = DEFAULT_AI_MODEL_SELECTION,
): boolean {
  try {
    getAiModelCatalogEntry(selection);
    if (!isAiModelReadyForRealData(selection) || selection.provider !== "OPENAI") {
      return false;
    }
  } catch {
    return false;
  }
  const runtimeValuesPresent = [
    "AI_OPENAI_API_KEY",
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
  return environment.ASYNC_PROVIDER_EXECUTION_ENABLED?.trim().toLowerCase() === "true"
    && environment.AI_GLOBAL_EMERGENCY_DISABLED?.trim().toLowerCase() !== "true"
    && runtimeValuesPresent
    && createRealDataActivationPolicy({
      AI_REAL_DATA_ENABLED: environment.AI_REAL_DATA_ENABLED,
      AI_REAL_DATA_APPROVAL_ID: environment.AI_REAL_DATA_APPROVAL_ID,
      AI_PROVIDER_PROJECT_CLASS: environment.AI_PROVIDER_PROJECT_CLASS,
    }).enabled;
}

interface ExistingCorpusAnalysisDependencies {
  loadCorpus: typeof getFascicoloDocumentCorpusForTenant;
  loadGlobalAiControl: typeof getGlobalAiControlState;
  loadProviderControl: typeof getAiProviderControlSnapshot;
  inspectBudgetCompatibility: typeof inspectFascicoloV7BudgetCompatibility;
  admitJob: typeof admitAsyncJob;
  activateWorker: typeof requestDocumentWorkerActivation;
}

const defaultDependencies: ExistingCorpusAnalysisDependencies = {
  loadCorpus: getFascicoloDocumentCorpusForTenant,
  loadGlobalAiControl: getGlobalAiControlState,
  loadProviderControl: getAiProviderControlSnapshot,
  inspectBudgetCompatibility: inspectFascicoloV7BudgetCompatibility,
  admitJob: admitAsyncJob,
  activateWorker: requestDocumentWorkerActivation,
};

export async function requestExistingCorpusAnalysis(input: {
  tenantId: string;
  procedimentoId: string;
  executionId: string;
  actor: {
    id: string;
    email: string;
    role: "ADMIN";
  };
  environment?: Readonly<Record<string, string | undefined>>;
  withLegalResearch?: boolean;
  selection?: AiModelSelection;
}, dependencies: ExistingCorpusAnalysisDependencies = defaultDependencies) {
  const environment = input.environment ?? process.env;
  const selection = input.selection ?? DEFAULT_AI_MODEL_SELECTION;
  getAiModelCatalogEntry(selection);
  if (!isAiModelReadyForRealData(selection)) {
    throw new ExistingCorpusAnalysisRequestError("AI_PROVIDER_NOT_APPROVED");
  }
  if (!isExistingCorpusAnalysisRequestEnabled(environment, selection)) {
    throw new ExistingCorpusAnalysisRequestError("ANALYSIS_ACTIVATION_DISABLED");
  }
  const aiControl = await dependencies.loadGlobalAiControl(environment);
  if (!aiControl.effectiveEnabled) {
    throw new ExistingCorpusAnalysisRequestError("AI_GLOBALLY_DISABLED");
  }
  const providerControl = await dependencies.loadProviderControl();
  const selectedControl = providerControl.providers.find(
    (provider) => provider.provider === selection.provider,
  );
  if (!selectedControl?.manualEnabled) {
    throw new ExistingCorpusAnalysisRequestError("AI_PROVIDER_MANUAL_DISABLED");
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
  let estimatedCostEur: number;
  try {
    estimatedCostEur = aiModelEstimatedAmountEur(selection, environment);
  } catch {
    throw new ExistingCorpusAnalysisRequestError("ECONOMIC_PREFLIGHT_FAILED");
  }
  let budgetCompatibility: Awaited<ReturnType<typeof inspectFascicoloV7BudgetCompatibility>>;
  try {
    budgetCompatibility = await dependencies.inspectBudgetCompatibility({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      requiredAmountEur: estimatedCostEur,
    });
    if (!budgetCompatibility.compatible) {
      throw new ExistingCorpusAnalysisRequestError("ECONOMIC_PREFLIGHT_FAILED");
    }
  } catch (error) {
    if (error instanceof ExistingCorpusAnalysisRequestError) throw error;
    throw error;
  }
  const admission = await dependencies.admitJob(
    buildFascicoloExistingCorpusAnalysisAdmission({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      corpusFingerprint: corpus.corpusFingerprint,
      executionId: input.executionId,
      initiatingUserId: input.actor.id,
      actorEmail: input.actor.email,
      selection,
      authorizationRef: environment.AI_REAL_DATA_APPROVAL_ID?.trim()
        || SELVARA_PILOT_AUTHORIZATION.approvalId,
    }),
  );
  const activation = TERMINAL_ANALYSIS_JOB_STATUSES.has(admission.job.status)
    ? { outcome: "NOT_REQUIRED" as const }
    : await dependencies.activateWorker({
        kind: "DOCUMENT_ANALYSIS",
        applicationJobId: admission.job.id,
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        ...(input.withLegalResearch ? { withLegalResearch: true } : {}),
      });
  return {
    admission,
    activation,
    budgetCompatibility,
    selection,
    authorizationRef: environment.AI_REAL_DATA_APPROVAL_ID?.trim()
      || SELVARA_PILOT_AUTHORIZATION.approvalId,
  };
}
