import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { admitAsyncJob } from "@/server/async-jobs/persistence";
import { normalizeAsyncJobAdmission, type AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import type { AsyncJobHandler } from "@/server/async-jobs/registry";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import { withRuntimeCostGate } from "@/server/runtime/cost";
import { runtimeCostEstimate } from "@/server/runtime/costConfig";
import {
  buildResearchMissionAsyncJobAdmission,
  getResearchMission,
  RESEARCH_MISSION_EXECUTION_OPERATION,
} from "./persistence";
import {
  researchMissionExecutionChannel,
  type ResearchMission,
} from "./bridge";
import {
  evaluateAutomaticResearchPolicy,
  type AutomaticResearchPolicyDecision,
  type AutomaticResearchPolicyEnv,
} from "./automatic-research-policy";
import { createAutomaticResearchProviderAdapters } from "./automatic-research-providers";
import { createLocalTrustedResearchClient } from "./local-trusted-research-client";
import { createTrustedMissionExecutor, type TrustedMissionExecutorResult } from "./trusted-mission-executor";
import { completeAdverseResearchRequirement, ensureAdverseResearchMission } from "./source-chain-persistence";
import { verifyOfficialResearchSources } from "./official-source-verification";
import { produceAndPersistAutomaticLegalApplicabilityReviews } from "./legal-applicability-producer";
import { assertGlobalAiExecutionAllowed } from "@/server/ai/globalAiControl";
import { refreshStructuredReportAfterResearch } from "@/server/fascicolo-report/auto-refresh";

const referenceSchema = z.object({
  referenceType: z.literal("LEGAL_RESEARCH_MISSION"),
  referenceId: z.string().trim().min(1).max(96),
  referenceVersion: z.string().trim().min(1),
  metadata: z.object({ contractVersion: z.string().trim().min(1) }).strict(),
}).strict();

type ResearchExecutionReference = z.output<typeof referenceSchema>;

function executionFailureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_:.-]{1,200}$/.test(code)) return code;
  }
  if (error instanceof Error && /^[A-Z0-9_:.-]{1,200}$/.test(error.message)) {
    return error.message;
  }
  return "AUTOMATIC_RESEARCH_EXECUTION_FAILED";
}

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
}>, dependencies: Readonly<{
  findJobByIdempotencyKey?(idempotencyKey: string): Promise<{ id: string; status: string } | null>;
  admitJob?(admission: AsyncJobAdmissionInput): Promise<{ job: { id: string } }>;
}> = {}): Promise<AutomaticResearchAdmissionResult> {
  const decision = evaluateAutomaticResearchPolicy({
    tenantId: input.tenantId,
    mission: input.mission,
    env: input.env,
  });
  if (!decision.authorized || !decision.policyDecisionRef) {
    return { outcome: "NOT_AUTHORIZED", requirementCode: decision.requirementCode, jobId: null };
  }
  const findJob = dependencies.findJobByIdempotencyKey ?? defaultFindJobByIdempotencyKey;
  const admit = dependencies.admitJob ?? admitAsyncJob;
  for (let generation = 0; generation < MAX_RESEARCH_EXECUTION_GENERATIONS; generation += 1) {
    const admission = buildResearchMissionAsyncJobAdmission({
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
      executionGeneration: generation,
    });
    const existing = await findJob(normalizeAsyncJobAdmission(admission).idempotencyKey);
    if (!existing) {
      const admitted = await admit(admission);
      return { outcome: "ADMITTED", requirementCode: null, jobId: admitted.job.id };
    }
    // A live job already covers this mission: never enqueue a concurrent duplicate.
    if (!TERMINAL_RESEARCH_JOB_STATUSES.has(existing.status)) {
      return { outcome: "ADMITTED", requirementCode: null, jobId: existing.id };
    }
    // The previous run ended while the mission is PENDING again: admit the next bounded generation.
  }
  return { outcome: "NOT_AUTHORIZED", requirementCode: "RESEARCH_EXECUTION_RETRY_LIMIT_REACHED", jobId: null };
}

const TERMINAL_RESEARCH_JOB_STATUSES = new Set(["SUCCEEDED", "TERMINAL_FAILED", "CANCELLED"]);
export const MAX_RESEARCH_EXECUTION_GENERATIONS = 5;

async function defaultFindJobByIdempotencyKey(idempotencyKey: string) {
  return prisma.asyncJob.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true },
  });
}

export type CurrentKnowledgeResearchAdmission = Readonly<{
  missionId: string;
  outcome: AutomaticResearchAdmissionResult["outcome"];
  requirementCode: string | null;
  jobId: string | null;
}>;

/** Schedules worker execution for current V7 knowledge missions on the SERVER_AUTONOMOUS channel. */
export async function admitCurrentKnowledgeAutonomousResearch(input: Readonly<{
  tenantId?: string;
  procedimentoId?: string;
  limit?: number;
  correlationId?: string;
}> = {}): Promise<readonly CurrentKnowledgeResearchAdmission[]> {
  const records = await prisma.researchMissionRecord.findMany({
    where: {
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.procedimentoId ? { caseId: input.procedimentoId } : {}),
      lifecycleStatus: "CURRENT",
      status: "PENDING",
      researchQuestionSemanticKey: { not: null },
      assignedActorId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    take: input.limit ?? 25,
    select: { id: true, tenantId: true, assignedActorId: true, payload: true },
  });
  const admissions: CurrentKnowledgeResearchAdmission[] = [];
  for (const record of records) {
    const mission = record.payload as unknown as ResearchMission;
    if (!record.tenantId || researchMissionExecutionChannel(mission) !== "SERVER_AUTONOMOUS") continue;
    const result = await ensureAutomaticResearchExecution({
      mission,
      tenantId: record.tenantId,
      actorId: record.assignedActorId!,
      correlationId: input.correlationId ?? `automatic-research:${mission.missionId}`,
    });
    admissions.push({ missionId: record.id, ...result });
  }
  return admissions;
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
    if (researchMissionExecutionChannel(mission) !== "SERVER_AUTONOMOUS") continue;
    const result = await ensureAutomaticResearchExecution({
      mission,
      tenantId: link.report.tenantId,
      actorId: link.report.createdByActorId,
      correlationId: `automatic-research:${mission.missionId}`,
    });
    if (result.outcome === "ADMITTED") admitted += 1;
  }
  const knowledgeAdmissions = await admitCurrentKnowledgeAutonomousResearch({ limit });
  return admitted + knowledgeAdmissions.filter((entry) => entry.outcome === "ADMITTED").length;
}

type ExecutionAuthority = Readonly<{
  mission: ResearchMission;
  tenantId: string;
  actorId: string;
  decision: AutomaticResearchPolicyDecision;
}>;

export interface AutomaticResearchExecutionDependencies {
  assertAiExecutionAllowed(): Promise<void>;
  loadAuthority(input: Readonly<{
    jobId: string;
    missionId: string;
  }>): Promise<ExecutionAuthority | null>;
  createProviderAdapters(input: Readonly<{ requestTimeoutMs: number }>): Promise<readonly import("./provider-research-adapters").ResearchProviderAdapter[]>;
  execute(input: Readonly<{
    authority: ExecutionAuthority;
    providerAdapters: readonly import("./provider-research-adapters").ResearchProviderAdapter[];
    jobId: string;
    attempt: number;
  }>): Promise<TrustedMissionExecutorResult>;
  orchestrateSourceChain(input: Readonly<{
    authority: ExecutionAuthority;
    result: TrustedMissionExecutorResult;
  }>): Promise<void>;
}

const defaultDependencies: AutomaticResearchExecutionDependencies = {
  assertAiExecutionAllowed: assertGlobalAiExecutionAllowed,
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
    const [activeLink, currentKnowledgeMission] = await Promise.all([
      prisma.automaticFascicoloReportMission.findFirst({
        where: {
          missionId: input.missionId,
          purpose: "PRELIMINARY_DISCOVERY",
          report: {
            tenantId: job.tenantId,
            status: { not: "SUPERSEDED" },
          },
        },
        select: { missionId: true },
      }),
      // V7 missions are anchored to the current knowledge revision instead of a V6 report link.
      prisma.researchMissionRecord.findFirst({
        where: {
          id: input.missionId,
          tenantId: job.tenantId,
          lifecycleStatus: "CURRENT",
          researchQuestionSemanticKey: { not: null },
        },
        select: { id: true },
      }),
    ]);
    if (!activeLink && !currentKnowledgeMission) return null;
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
      executionId: () => `automatic-research-execution:${input.jobId}:${input.attempt}`,
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
      idempotencyKey: `${RESEARCH_MISSION_EXECUTION_OPERATION}:${input.jobId}:${input.attempt}`,
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
    if (process.env.AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED === "true") {
      if (input.authority.decision.maxOfficialSourceAcquisitions === null) {
        throw new Error("AUTOMATIC_OFFICIAL_SOURCE_ACQUISITION_LIMIT_MISSING");
      }
      await verifyOfficialResearchSources({
        missionId: input.authority.mission.missionId,
        tenantId: input.authority.tenantId,
        caseId: input.authority.mission.caseReference.caseId,
        actorId: input.authority.actorId,
        maxAcquisitions: input.authority.decision.maxOfficialSourceAcquisitions,
      });
      await produceAndPersistAutomaticLegalApplicabilityReviews({
        missionId: input.authority.mission.missionId,
        tenantId: input.authority.tenantId,
        caseId: input.authority.mission.caseReference.caseId,
        actorId: input.authority.actorId,
      });
    }
    await ensureAdverseResearchMission({
      tenantId: input.authority.tenantId,
      caseId: input.authority.mission.caseReference.caseId,
      primaryMissionId: input.authority.mission.missionId,
    });
    // Archive a new report draft so research results appear in the versioned report history.
    await refreshStructuredReportAfterResearch({
      tenantId: input.authority.tenantId,
      procedimentoId: input.authority.mission.caseReference.caseId,
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
      await dependencies.assertAiExecutionAllowed();
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
      await dependencies.assertAiExecutionAllowed();
      let result: TrustedMissionExecutorResult;
      try {
        result = await dependencies.execute({
          authority,
          providerAdapters: adapters,
          jobId: context.jobId,
          attempt: context.attempt,
        });
      } catch (error) {
        if (error instanceof AsyncJobExecutionError) throw error;
        throw new AsyncJobExecutionError("RESEARCH", executionFailureCode(error), false);
      }
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
