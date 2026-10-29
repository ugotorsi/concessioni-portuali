import { prisma } from "../../src/lib/prisma";
import {
  createDefaultFascicoloAutomaticAnalysisDependencies,
  createFascicoloAutomaticAnalysisHandler,
  FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
  FASCICOLO_V7_CONTROLLED_ANALYSIS_PURPOSE,
} from "../../src/server/ai/fascicoloAutomaticAnalysisJob";
import {
  SELVARA_PILOT_AUTHORIZATION,
} from "../../src/server/ai/selvaraPilotAuthorization";
import {
  deleteV7ProviderOutputRecoveryArtifact,
  loadV7ProviderOutputRecoveryArtifact,
} from "../../src/server/ai/v7ProviderOutputRecovery";
import { auditSuccess } from "../../src/server/audit/auditLog";

const CONFIRMATION = "PERSIST_ONLY_WITHOUT_PROVIDER_CALL";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : "";
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

async function main(): Promise<void> {
  if (process.env.AI_PROVIDER_OUTPUT_RECOVERY_ENABLED !== "true") {
    throw new Error("AI_PROVIDER_OUTPUT_RECOVERY_ENABLED must be true.");
  }
  const jobId = argument("--job-id");
  const approvalId = argument("--approval-id");
  const confirmation = argument("--confirm");
  if (
    approvalId !== SELVARA_PILOT_AUTHORIZATION.approvalId
    || confirmation !== CONFIRMATION
  ) {
    throw new Error("Recovery authorization mismatch.");
  }

  const job = await prisma.asyncJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      operation: true,
      purpose: true,
      tenantId: true,
      procedimentoId: true,
      correlationId: true,
      inputReference: true,
      attemptCount: true,
      maxAttempts: true,
      failureCategory: true,
      failureCode: true,
      resultReference: true,
    },
  });
  if (
    !job
    || job.status !== "TERMINAL_FAILED"
    || job.operation !== FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION
    || job.purpose !== FASCICOLO_V7_CONTROLLED_ANALYSIS_PURPOSE
    || !job.tenantId
    || !job.procedimentoId
    || job.attemptCount !== 1
    || job.maxAttempts !== 1
    || job.failureCategory !== "PERSISTENCE"
  ) {
    throw new Error("Job is not eligible for persistence-only recovery.");
  }
  const reference = job.inputReference as {
    referenceType?: unknown;
    metadata?: {
      corpusHash?: unknown;
      trialApprovalRef?: unknown;
    };
  };
  if (
    reference.referenceType !== "FASCICOLO_DOCUMENT_CORPUS"
    || reference.metadata?.trialApprovalRef !== approvalId
    || typeof reference.metadata.corpusHash !== "string"
  ) {
    throw new Error("Recovery artifact binding mismatch.");
  }
  const binding = {
    jobId: job.id,
    tenantId: job.tenantId,
    procedimentoId: job.procedimentoId,
    corpusFingerprint: reference.metadata.corpusHash,
    approvalId,
  };
  const recovered = await loadV7ProviderOutputRecoveryArtifact({ binding });
  const defaults = createDefaultFascicoloAutomaticAnalysisDependencies();
  const handler = createFascicoloAutomaticAnalysisHandler({
    ...defaults,
    validateControlledV7Preflight: async () => undefined,
    analyze: async () => recovered.output,
    persistProviderOutputRecovery: async () => ({
      storageKey: recovered.storageKey,
      outputFingerprint: recovered.outputFingerprint,
      sizeBytes: 0,
    }),
    auditProviderOutputRecovery: async () => undefined,
    deleteProviderOutputRecovery: async () => undefined,
  });
  const parsedReference = handler.parseInput(job.inputReference);
  const result = await handler.execute(parsedReference, {
    jobId: job.id,
    correlationId: job.correlationId,
    attempt: 1,
    isCancellationRequested: async () => false,
    heartbeat: async () => undefined,
  });

  const unchanged = await prisma.asyncJob.findUnique({
    where: { id: job.id },
    select: {
      status: true,
      failureCategory: true,
      failureCode: true,
      resultReference: true,
    },
  });
  if (
    unchanged?.status !== job.status
    || unchanged.failureCategory !== job.failureCategory
    || unchanged.failureCode !== job.failureCode
    || JSON.stringify(unchanged.resultReference) !== JSON.stringify(job.resultReference)
  ) {
    throw new Error("Historical job state changed during recovery.");
  }

  await auditSuccess({
    azione: "FASCICOLO_V7_PROVIDER_OUTPUT_RECOVERED",
    entita: "AsyncJob",
    entitaId: job.id,
    enteId: job.tenantId,
    actor: { userId: null, userRole: "SYSTEM" },
    metadata: {
      procedimentoId: job.procedimentoId,
      approvalId,
      outputFingerprint: recovered.outputFingerprint,
      originalFailureCode: job.failureCode,
      providerCalled: false,
    },
  });
  await deleteV7ProviderOutputRecoveryArtifact({ binding });
  console.info(JSON.stringify({
    outcome: "PERSISTENCE_RECOVERED",
    jobId: job.id,
    historicalJobStatus: job.status,
    providerCalled: false,
    outputFingerprint: recovered.outputFingerprint,
    result,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "UNKNOWN_RECOVERY_ERROR");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
