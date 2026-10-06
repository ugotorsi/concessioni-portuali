import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { admitAsyncJob } from "@/server/async-jobs/persistence";
import type { AsyncJobHandler } from "@/server/async-jobs/registry";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import { withRuntimeCostGate } from "@/server/runtime/cost";
import { runtimeCostEstimate } from "@/server/runtime/costConfig";
import {
  buildResearchMissionAsyncJobAdmission,
  getResearchMission,
  RESEARCH_MISSION_EXECUTION_OPERATION,
} from "./persistence";
import type { ResearchMission } from "./bridge";
import {
  evaluateAutomaticResearchPolicy,
  type AutomaticResearchPolicyDecision,
  type AutomaticResearchPolicyEnv,
} from "./automatic-research-policy";
import { createAutomaticResearchProviderAdapters } from "./automatic-research-providers";
import { createLocalTrustedResearchClient } from "./local-trusted-research-client";
import { createTrustedMissionExecutor, type TrustedMissionExecutorResult } from "./trusted-mission-executor";
import { completeAdverseResearchRequirement, ensureAdverseResearchMission } from "./source-chain-persistence";

const referenceSchema = z.object({
  referenceType: z.literal("LEGAL_RESEARCH_MISSION"),
  referenceId: z.string().trim().min(1).max(96),
  referenceVersion: z.string().trim().min(1),
  metadata: z.object({ contractVersion: z.string().trim().min(1) }).strict(),
}).strict();

type ResearchExecutionReference = z.output<typeof referenceSchema>;

export type AutomaticResearchAdmissionResult = Readonly<{
  outcome: "ADMITTED" | "NOT_AUTHORIZED";
  requirementCode: string | null;
  jobId: string | null;
}>;

export async function ensureAutomaticResearchExecution(input: Readonly<{
  mission: ResearchMission;
  tenantId: string;
  actorId: string;
  correlationId: string;
  now?: Date;
  env?: AutomaticResearchPolicyEnv;
}>): Promise<AutomaticResearchAdmissionResult> {
  const decision = evaluateAutomaticResearchPolicy({
    tenantId: input.tenantId,
    mission: input.mission,
    env: input.env,
  });
  if (!decision.authorized || !decision.policyDecisionRef) {
    return { outcome: "NOT_AUTHORIZED", requirementCode: decision.requirementCode, jobId: null };
  }
  const admitted = await admitAsyncJob(buildResearchMissionAsyncJobAdmission({
    mission: input.mission,
    actor: {
      actorId: input.actorId,
      actorEmail: null,
      actorRole: "AUTOMATIC_FASCICOLO_RESEARCH",
      initiatingUserId: null,
      admissionType: "AUTHORIZED_SYSTEM",
      tenantId: input.tenantId,
    },
    correlationId: input.correlationId,
    policyDecisionRef: decision.policyDecisionRef,
    availableAt: input.now ?? new Date(),
    maxAttempts: 1,
  }));
  return { outcome: "ADMITTED", requirementCode: null, jobId: admitted.job.id };
}

export async function reconcilePendingAutomaticResearchExecutions(limit = 25): Promise<number> {
  const links = await prisma.automaticFascicoloReportMission.findMany({
    where: {
      purpose: "PRELIMINARY_DISCOVERY",
      report: { status: { not: "SUPERSEDED" } },
      mission: { status: "PENDING" },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      report: { select: { tenantId: true, createdByActorId: true } },
      mission: { select: { payload: true } },
    },
  });
  let admitted = 0;
  for (const link of links) {
    const mission = link.mission.payload as unknown as ResearchMission;
    const result = await ensureAutomaticResearchExecution({
      mission,
      tenantId: link.report.tenantId,
      actorId: link.report.createdByActorId,
      correlationId: `automatic-research:${mission.missionId}`,
    });
    if (result.outcome === "ADMITTED") admitted += 1;
  }
  return admitted;
}

type ExecutionAuthority = Readonly<{
  mission: ResearchMission;
  tenantId: string;
  actorId: string;
  decision: AutomaticResearchPolicyDecision;
}>;

export interface AutomaticResearchExecutionDependencies {
  loadAuthority(input: Readonly<{
    jobId: string;
    missionId: string;
  }>): Promise<ExecutionAuthority | null>;
  createProviderAdapters(input: Readonly<{ requestTimeoutMs: number }>): Promise<readonly import("./provider-research-adapters").ResearchProviderAdapter[]>;
  execute(input: Readonly<{
    authority: ExecutionAuthority;
    providerAdapters: readonly import("./provider-research-adapters").ResearchProviderAdapter[];
    jobId: string;
  }>): Promise<TrustedMissionExecutorResult>;
  orchestrateSourceChain(input: Readonly<{
    authority: ExecutionAuthority;
    result: TrustedMissionExecutorResult;
  }>): Promise<void>;
}

const defaultDependencies: AutomaticResearchExecutionDependencies = {
  async loadAuthority(input) {
    const job = await prisma.asyncJob.findUnique({
      where: { id: input.jobId },
      select: {
        operation: true,
        tenantId: true,
        actorId: true,
        policyDecisionRef: true,
      },
    });
    if (!job || job.operation !== RESEARCH_MISSION_EXECUTION_OPERATION || !job.tenantId) return null;
    const activeLink = await prisma.automaticFascicoloReportMission.findFirst({
      where: {
        missionId: input.missionId,
        purpose: "PRELIMINARY_DISCOVERY",
        report: {
          tenantId: job.tenantId,
          status: { not: "SUPERSEDED" },
        },
      },
      select: { missionId: true },
    });
    if (!activeLink) return null;
    const stored = await getResearchMission(input.missionId, { actorId: job.actorId, tenantId: job.tenantId });
    if (!stored) return null;
    const decision = evaluateAutomaticResearchPolicy({ tenantId: job.tenantId, mission: stored.mission });
    if (!decision.authorized || decision.policyDecisionRef !== job.policyDecisionRef) return null;
    return {
      mission: stored.mission,
      tenantId: job.tenantId,
      actorId: job.actorId,
      decision,
    };
  },
  createProviderAdapters: createAutomaticResearchProviderAdapters,
  async execute(input) {
    const decision = input.authority.decision;
    const executor = createTrustedMissionExecutor({
      client: createLocalTrustedResearchClient({
        actor: { actorId: decision.workerActorId!, tenantId: input.authority.tenantId },
        claimantId: decision.workerActorId!,
      }),
      legalDataHunterApiKey: process.env.LEGAL_DATA_HUNTER_API_KEY ?? null,
      providerAdapters: input.providerAdapters,
      leaseDurationMs: decision.leaseDurationMs!,
      executionId: () => `automatic-research-execution:${input.jobId}`,
    });
    const unitCost = runtimeCostEstimate("ASYNC_COST_RESEARCH_CALL_ESTIMATE_EUR");
    const estimatedAmount = unitCost * input.authority.mission.budget.maxTotalResearchCalls;
    return withRuntimeCostGate({
      tenantId: input.authority.tenantId,
      procedimentoId: input.authority.mission.caseReference.caseId,
      jobId: input.jobId,
      provider: "TRUSTED_RESEARCH_MULTI_PROVIDER",
      operationType: RESEARCH_MISSION_EXECUTION_OPERATION,
      estimatedAmount,
      idempotencyKey: `${RESEARCH_MISSION_EXECUTION_OPERATION}:${input.jobId}`,
    }, async () => {
      const result = await executor.execute(input.authority.mission.missionId);
      return { value: result, actualAmount: result.callsConsumed * unitCost };
    });
  },
  async orchestrateSourceChain(input) {
    if (input.authority.mission.mode === "ADVERSE_SEARCH") {
      await completeAdverseResearchRequirement({
        tenantId: input.authority.tenantId,
        caseId: input.authority.mission.caseReference.caseId,
        adverseMissionId: input.authority.mission.missionId,
      });
      return;
    }
    await ensureAdverseResearchMission({
      tenantId: input.authority.tenantId,
      caseId: input.authority.mission.caseReference.caseId,
      primaryMissionId: input.authority.mission.missionId,
    });
  },
};

export function createAutomaticResearchExecutionHandler(
  overrides: Partial<AutomaticResearchExecutionDependencies> = {},
): AsyncJobHandler<ResearchExecutionReference> {
  const dependencies = { ...defaultDependencies, ...overrides };
  return {
    operation: RESEARCH_MISSION_EXECUTION_OPERATION,
    parseInput: (input) => referenceSchema.parse(input),
    async execute(reference, context) {
      const authority = await dependencies.loadAuthority({ jobId: context.jobId, missionId: reference.referenceId });
      if (!authority) {
        throw new AsyncJobExecutionError("AUTHORIZATION", "AUTOMATIC_RESEARCH_POLICY_OR_SCOPE_INVALID", false);
      }
      if (await context.isCancellationRequested()) {
        throw new AsyncJobExecutionError("CANCELLATION", "CANCELLATION_REQUESTED", false);
      }
      const adapters = await dependencies.createProviderAdapters({
        requestTimeoutMs: authority.decision.providerTimeoutMs!,
      });
      const availableCapabilities = new Set(adapters.map((adapter) => adapter.capability));
      availableCapabilities.add("KEYWORD_DISCOVERY");
      const missingCapability = authority.mission.executionPlan?.requiredCapabilities
        .find((capability) => !availableCapabilities.has(capability));
      if (missingCapability) {
        throw new AsyncJobExecutionError(
          "CONFIGURATION",
          `AUTOMATIC_RESEARCH_PROVIDER_CAPABILITY_UNAVAILABLE:${missingCapability}`,
          false,
        );
      }
      await context.heartbeat();
      const result = await dependencies.execute({ authority, providerAdapters: adapters, jobId: context.jobId });
      if (["RECOVERY_REQUIRED", "LEASE_EXPIRED", "BLOCKED"].includes(result.status)) {
        throw new AsyncJobExecutionError(
          result.status === "RECOVERY_REQUIRED" ? "UNCERTAIN_OUTCOME" : "RESEARCH",
          result.blockerCodes[0] ?? `AUTOMATIC_RESEARCH_${result.status}`,
          false,
        );
      }
      await dependencies.orchestrateSourceChain({ authority, result });
      return {
        referenceType: "LEGAL_RESEARCH_RESULT",
        referenceId: result.bundleId ?? authority.mission.missionId,
        referenceVersion: reference.referenceVersion,
        metadata: {
          missionId: authority.mission.missionId,
          executionId: result.executionId ?? null,
          completionCode: result.status,
          callCount: result.callsConsumed,
        },
      };
    },
  };
}
