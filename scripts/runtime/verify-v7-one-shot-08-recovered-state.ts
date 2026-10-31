import { prisma } from "../../src/lib/prisma";
import { FASCICOLO_V7_KNOWLEDGE_REVISION_CONTRACT } from "../../src/server/ai/fascicoloAutomaticAnalysisJob";
import { SELVARA_PILOT_AUTHORIZATION } from "../../src/server/ai/selvaraPilotAuthorization";

const JOB_ID = "cmvtu2wgi0000260h2ovc1igi";

function amount(value: { toNumber(): number } | null): number {
  return value?.toNumber() ?? 0;
}

async function main(): Promise<void> {
  const job = await prisma.asyncJob.findUnique({
    where: { id: JOB_ID },
    select: {
      id: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      failureCategory: true,
      failureCode: true,
      tenantId: true,
      procedimentoId: true,
      inputReference: true,
      completedAt: true,
    },
  });
  if (
    !job
    || job.status !== "TERMINAL_FAILED"
    || job.attemptCount !== 1
    || job.maxAttempts !== 1
    || job.failureCategory !== "PERSISTENCE"
    || job.failureCode !== "RESEARCH_MISSION_RECONCILIATION_FAILED"
    || !job.tenantId
    || !job.procedimentoId
    || !job.completedAt
  ) {
    throw new Error("ONE_SHOT_08_FAILURE_BINDING_INVALID");
  }
  const reference = job.inputReference as {
    metadata?: {
      corpusHash?: unknown;
      trialApprovalRef?: unknown;
      trialContractVersion?: unknown;
    };
  };
  if (
    reference.metadata?.corpusHash !== SELVARA_PILOT_AUTHORIZATION.corpusFingerprint
    || reference.metadata.trialApprovalRef !== SELVARA_PILOT_AUTHORIZATION.approvalId
  ) {
    throw new Error("ONE_SHOT_08_REFERENCE_BINDING_INVALID");
  }

  const [recoveryAudit, revision, reservation, artifact] = await Promise.all([
    prisma.activityLog.findFirst({
      where: {
        azione: "FASCICOLO_V7_PROVIDER_OUTPUT_RECOVERED",
        entita: "AsyncJob",
        entitaId: job.id,
        esito: "SUCCESS",
        createdAt: { gt: job.completedAt },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.fascicoloKnowledgeRevision.findFirst({
      where: {
        tenantId: job.tenantId,
        procedimentoId: job.procedimentoId,
        corpusFingerprint: SELVARA_PILOT_AUTHORIZATION.corpusFingerprint,
        contractVersion: FASCICOLO_V7_KNOWLEDGE_REVISION_CONTRACT,
        status: "CURRENT",
      },
      select: {
        id: true,
        completedAt: true,
        _count: {
          select: {
            items: true,
            researchMissions: true,
            structuredReports: true,
          },
        },
      },
    }),
    prisma.runtimeCostReservation.findFirst({
      where: { jobId: job.id },
      select: {
        status: true,
        reservedAmount: true,
        actualAmount: true,
        releasedAmount: true,
        settledAt: true,
      },
    }),
    prisma.v7ProviderOutputRecoveryArtifact.findUnique({
      where: { jobId: job.id },
      select: { id: true },
    }),
  ]);
  if (
    !recoveryAudit
    || !revision
    || !revision.completedAt
    || revision.completedAt > recoveryAudit.createdAt
    || revision._count.items === 0
    || revision._count.researchMissions === 0
    || revision._count.structuredReports === 0
    || artifact !== null
  ) {
    throw new Error("ONE_SHOT_08_RECOVERY_PERSISTENCE_INVALID");
  }
  if (!reservation
    || reservation.status !== "SETTLED"
    || !reservation.settledAt
    || reservation.settledAt > job.completedAt) {
    throw new Error("ONE_SHOT_08_COST_SETTLEMENT_INVALID");
  }
  const reservedAmount = amount(reservation.reservedAmount);
  const actualAmount = amount(reservation.actualAmount);
  const releasedAmount = amount(reservation.releasedAmount);
  if (Math.abs(reservedAmount - actualAmount - releasedAmount) > 0.000001) {
    throw new Error("ONE_SHOT_08_COST_RECONCILIATION_INVALID");
  }

  console.info(JSON.stringify({
    outcome: "ONE_SHOT_08_RECOVERED_AND_RECONCILED",
    jobId: job.id,
    historicalJobStatus: job.status,
    recoveryArtifactDeleted: true,
    persisted: {
      knowledgeItems: revision._count.items,
      researchMissions: revision._count.researchMissions,
      structuredReports: revision._count.structuredReports,
    },
    cost: {
      status: reservation.status,
      reservedAmount,
      actualAmount,
      releasedAmount,
      reconciled: true,
    },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "ONE_SHOT_08_RECOVERY_STATE_UNKNOWN");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
