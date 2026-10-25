import { createHash } from "node:crypto";

import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJob } from "@/server/async-jobs/persistence";
import { requestDocumentWorkerActivation } from "@/server/async-jobs/documentWorkerActivation";
import {
  buildFascicoloDocumentCorpusUpdateAdmission,
  FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
} from "@/server/ai/fascicoloAutomaticAnalysisJob";
import { getGlobalAiControlState } from "@/server/ai/globalAiControl";
import { createRealDataActivationPolicy } from "@/server/ai/realDataActivation";
import {
  assertSelvaraPilotAuthorization,
  isSelvaraPilotApprovalId,
  SELVARA_PILOT_AUTHORIZATION,
  SelvaraPilotAuthorizationError,
} from "@/server/ai/selvaraPilotAuthorization";
import { getCurrentKnowledgeRevision } from "@/server/fascicolo-knowledge";
import {
  getFascicoloDocumentCorpusForTenant,
} from "@/server/queries/fascicolo-document-corpus";

export const FASCICOLO_EXISTING_CORPUS_ANALYSIS_PURPOSE =
  "FASCICOLO_EXISTING_CORPUS_ANALYSIS" as const;

export function buildFascicoloExistingCorpusAnalysisAdmission(input: {
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
  initiatingUserId: string;
  actorEmail: string;
}): AsyncJobAdmissionInput {
  const logicalOperationId = createHash("sha256").update([
    FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
    "DOCUMENT_CORPUS",
    "ADMIN_EXISTING_CORPUS_V1",
    input.tenantId,
    input.procedimentoId,
    input.corpusFingerprint,
  ].join("\n"), "utf8").digest("hex");
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
  };
}

export class ExistingCorpusAnalysisRequestError extends Error {
  constructor(readonly code:
    | "ANALYSIS_ACTIVATION_DISABLED"
    | "CORPUS_NOT_READY"
    | "KNOWLEDGE_REVISION_ALREADY_EXISTS"
    | "AI_GLOBALLY_DISABLED"
    | "SELVARA_PILOT_AUTHORIZATION_MISMATCH") {
    super(code);
    this.name = "ExistingCorpusAnalysisRequestError";
  }
}

export function isExistingCorpusAnalysisRequestEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.DOCUMENT_WORKER_ACTIVATION_MODE === "RENDER_ONE_OFF"
    && /^srv-[a-z0-9]+$/.test(
      environment.RENDER_APPLICATION_WORKER_SERVICE_ID?.trim() ?? "",
    )
    && Boolean(environment.RENDER_WORKER_API_KEY?.trim())
    && environment.AI_GLOBAL_EMERGENCY_DISABLED?.trim().toLowerCase() !== "true"
    && isSelvaraPilotApprovalId(environment)
    && createRealDataActivationPolicy({
      AI_REAL_DATA_ENABLED: environment.AI_REAL_DATA_ENABLED,
      AI_REAL_DATA_APPROVAL_ID: environment.AI_REAL_DATA_APPROVAL_ID,
      AI_PROVIDER_PROJECT_CLASS: environment.AI_PROVIDER_PROJECT_CLASS,
    }).enabled;
}

interface ExistingCorpusAnalysisDependencies {
  loadCorpus: typeof getFascicoloDocumentCorpusForTenant;
  loadCurrentRevision: typeof getCurrentKnowledgeRevision;
  loadGlobalAiControl: typeof getGlobalAiControlState;
  admitJob: typeof admitAsyncJob;
  activateWorker: typeof requestDocumentWorkerActivation;
}

const defaultDependencies: ExistingCorpusAnalysisDependencies = {
  loadCorpus: getFascicoloDocumentCorpusForTenant,
  loadCurrentRevision: getCurrentKnowledgeRevision,
  loadGlobalAiControl: getGlobalAiControlState,
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
  const currentRevision = await dependencies.loadCurrentRevision({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
  });
  if (currentRevision) {
    throw new ExistingCorpusAnalysisRequestError("KNOWLEDGE_REVISION_ALREADY_EXISTS");
  }
  const admission = await dependencies.admitJob(
    buildFascicoloExistingCorpusAnalysisAdmission({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      corpusFingerprint: corpus.corpusFingerprint,
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
  return { admission, activation };
}
