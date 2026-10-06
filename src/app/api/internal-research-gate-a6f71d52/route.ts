import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { admitAsyncJob, retryTerminalAsyncJob } from "@/server/async-jobs/persistence";
import { AsyncJobHandlerRegistry } from "@/server/async-jobs/registry";
import { drainOneAsyncJob } from "@/server/async-jobs/worker";
import {
  createAutomaticResearchExecutionHandler,
} from "@/server/legal-research/automatic-research-job";
import { evaluateAutomaticResearchPolicy } from "@/server/legal-research/automatic-research-policy";
import { createAutomaticResearchProviderAdapters } from "@/server/legal-research/automatic-research-providers";
import {
  buildResearchMissionAsyncJobAdmission,
  getResearchMission,
  RESEARCH_MISSION_EXECUTION_OPERATION,
} from "@/server/legal-research/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PROCEDIMENTO_ID = "staging-e2e-test-001-procedimento";
const TENANT_CODE = "DEMO-COMUNE-COSTIERO";
const MISSION_ID =
  "research-mission:02a5a15216bec4ad028d7cd6893112e344f2fc0303afd488105c4f77b483abe0";
const PROTECTED_MISSION_ID =
  "research-mission:7cd3faa5f4294068fc30558e65b4229ff46359463fa0039c61717b5da30e0b63";
const EXPECTED_ENDPOINT = "ep-jolly-hall-atts00ke";
const NO_STORE = { "Cache-Control": "no-store" };

function assertStaging(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const url = new URL(databaseUrl);
  if (
    process.env.VERCEL_ENV !== "preview"
    || url.protocol !== "postgresql:"
    || !url.hostname.startsWith(EXPECTED_ENDPOINT)
    || url.pathname !== "/neondb"
  ) {
    throw new Error("STAGING_SCOPE_MISMATCH");
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function researchProviderAdapters(requestTimeoutMs: number) {
  const accessToken = process.env.RESEARCH_GATE_MOONLIT_ACCESS_TOKEN?.trim();
  return createAutomaticResearchProviderAdapters({
    requestTimeoutMs,
    ...(accessToken
      ? { moonlitTokenReader: { tokens: async () => ({ access_token: accessToken }) } }
      : {}),
  });
}

async function snapshot() {
  const tenant = await prisma.ente.findUnique({
    where: { codice: TENANT_CODE },
    select: { id: true, codice: true },
  });
  if (!tenant) throw new Error("TENANT_NOT_FOUND");

  const adapters = await researchProviderAdapters(30_000);
  const [
    mission,
    protectedMission,
    protectedBundleCount,
    policies,
    jobs,
    attempts,
    bundles,
    results,
    assessments,
    adverseRequirements,
    automaticReportCount,
    reportCount,
    structuredReportCount,
    proposalCount,
    materializationCount,
    reservations,
  ] = await Promise.all([
    prisma.researchMissionRecord.findUnique({
      where: { id: MISSION_ID },
      select: {
        id: true,
        tenantId: true,
        caseId: true,
        status: true,
        lifecycleStatus: true,
        mode: true,
        payload: true,
        missionFingerprint: true,
        knowledgeRevisionId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.researchMissionRecord.findUnique({
      where: { id: PROTECTED_MISSION_ID },
      include: {
        executionAttempts: { orderBy: { id: "asc" } },
      },
    }),
    prisma.researchEvidenceBundleRecord.count({ where: { missionId: PROTECTED_MISSION_ID } }),
    prisma.runtimeBudgetPolicy.findMany({
      where: { enabled: true },
      select: {
        id: true,
        scope: true,
        tenantId: true,
        procedimentoId: true,
        currency: true,
        hardCapAmount: true,
        windowSeconds: true,
      },
      orderBy: [{ scope: "asc" }, { id: "asc" }],
    }),
    prisma.asyncJob.findMany({
      where: { operation: "LEGAL_RESEARCH.EXECUTE_V1" },
      select: {
        id: true,
        operation: true,
        status: true,
        attemptCount: true,
        maxAttempts: true,
        failureCategory: true,
        failureCode: true,
        inputReference: true,
        resultReference: true,
        createdAt: true,
        completedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.researchExecutionAttempt.findMany({
      where: { missionId: MISSION_ID },
      select: {
        id: true,
        completionState: true,
        totalCalls: true,
        moonlitCalls: true,
        simpliciterCalls: true,
        legalDataHunterCalls: true,
        errorCode: true,
        createdAt: true,
        completedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.researchEvidenceBundleRecord.findMany({
      where: { missionId: MISSION_ID },
      select: { id: true, completionState: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.researchQuestionResultRecord.findMany({
      where: { missionId: MISSION_ID },
      select: {
        id: true,
        providerId: true,
        toolId: true,
        supportDirection: true,
      },
      orderBy: { id: "asc" },
    }),
    prisma.researchSourceAssessmentRecord.findMany({
      where: { missionId: MISSION_ID, isCurrent: true },
      select: {
        id: true,
        resultId: true,
        retrievalState: true,
        textState: true,
        identityState: true,
        contentState: true,
        temporalState: true,
        adverseState: true,
        officiality: true,
        blockingReasons: true,
        usable: true,
        manualReviewRequired: true,
      },
      orderBy: { id: "asc" },
    }),
    prisma.researchAdverseRequirement.findMany({
      where: { primaryMissionId: MISSION_ID },
      select: { id: true, status: true, adverseMissionId: true, rationale: true },
      orderBy: { id: "asc" },
    }),
    prisma.automaticFascicoloReport.count({ where: { procedimentoId: PROCEDIMENTO_ID } }),
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "Report"
      WHERE "concessioneId" = (
        SELECT "concessioneId" FROM "Procedimento" WHERE id = ${PROCEDIMENTO_ID}
      )
    `,
    prisma.structuredFascicoloReportSnapshot.count({ where: { procedimentoId: PROCEDIMENTO_ID } }),
    prisma.fascicoloOperationalProposal.count({ where: { procedimentoId: PROCEDIMENTO_ID } }),
    prisma.fascicoloOperationalProposalMaterialization.count({
      where: { procedimentoId: PROCEDIMENTO_ID },
    }),
    prisma.runtimeCostReservation.findMany({
      where: { procedimentoId: PROCEDIMENTO_ID },
      select: {
        provider: true,
        operationType: true,
        status: true,
        estimatedAmount: true,
        actualAmount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!mission || mission.tenantId !== tenant.id || mission.caseId !== PROCEDIMENTO_ID) {
    throw new Error("MISSION_SCOPE_MISMATCH");
  }
  const protectedView = protectedMission
    ? {
        mission: protectedMission,
        attemptCount: protectedMission.executionAttempts.length,
        bundleCount: protectedBundleCount,
      }
    : null;
  const missionPayload = mission.payload as {
    budget?: { maxTotalResearchCalls?: unknown };
    executionPlan?: { requiredCapabilities?: unknown };
  };

  return {
    tenant,
    mission: {
      ...mission,
      payload: undefined,
      maxTotalResearchCalls: missionPayload.budget?.maxTotalResearchCalls ?? null,
      requiredCapabilities: missionPayload.executionPlan?.requiredCapabilities ?? null,
    },
    providers: {
      moonlitCredentialPresent:
        typeof process.env.RESEARCH_GATE_MOONLIT_ACCESS_TOKEN === "string"
        && process.env.RESEARCH_GATE_MOONLIT_ACCESS_TOKEN.trim().length > 0,
      oauthAdapters: adapters.map((adapter) => ({
        provider: adapter.provider,
        capability: adapter.capability,
      })),
    },
    policies,
    jobs,
    attempts,
    bundles,
    results,
    assessments,
    adverseRequirements,
    outputs: {
      automaticReportCount,
      reportCount: reportCount[0]?.count ?? 0,
      structuredReportCount,
      proposalCount,
      materializationCount,
    },
    reservations,
    protectedMission: {
      id: protectedMission?.id ?? null,
      status: protectedMission?.status ?? null,
      attemptCount: protectedMission?.executionAttempts.length ?? 0,
      bundleCount: protectedBundleCount,
      digest: digest(protectedView),
    },
  };
}

async function configureMinimumBudget(tenantId: string, estimatedAmount: number): Promise<void> {
  if (!Number.isFinite(estimatedAmount) || estimatedAmount <= 0) {
    throw new Error("INVALID_RESEARCH_COST_ESTIMATE");
  }
  const windowSeconds = 900;
  await prisma.$transaction(async (tx) => {
    await tx.runtimeBudgetPolicy.updateMany({ data: { enabled: false } });
    const spentRows = await tx.$queryRaw<Array<{
      global: string;
      tenant: string;
      procedimento: string;
    }>>`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('RESERVED','SETTLED')
          AND (status = 'SETTLED' OR "expiresAt" > CURRENT_TIMESTAMP)
          THEN COALESCE("actualAmount","reservedAmount") ELSE 0 END), 0)::text AS global,
        COALESCE(SUM(CASE WHEN "tenantId" = ${tenantId}
          AND status IN ('RESERVED','SETTLED')
          AND (status = 'SETTLED' OR "expiresAt" > CURRENT_TIMESTAMP)
          THEN COALESCE("actualAmount","reservedAmount") ELSE 0 END), 0)::text AS tenant,
        COALESCE(SUM(CASE WHEN "tenantId" = ${tenantId}
          AND "procedimentoId" = ${PROCEDIMENTO_ID}
          AND status IN ('RESERVED','SETTLED')
          AND (status = 'SETTLED' OR "expiresAt" > CURRENT_TIMESTAMP)
          THEN COALESCE("actualAmount","reservedAmount") ELSE 0 END), 0)::text AS procedimento
      FROM "RuntimeCostReservation"
      WHERE "currency" = 'EUR'
        AND "createdAt" >= CURRENT_TIMESTAMP - (${windowSeconds} * INTERVAL '1 second')
    `;
    const spent = spentRows[0] ?? { global: "0", tenant: "0", procedimento: "0" };
    const policies = [
      { scope: "GLOBAL", tenantId: null, procedimentoId: null, spent: Number(spent.global) },
      { scope: "TENANT", tenantId, procedimentoId: null, spent: Number(spent.tenant) },
      {
        scope: "PROCEDIMENTO",
        tenantId,
        procedimentoId: PROCEDIMENTO_ID,
        spent: Number(spent.procedimento),
      },
    ] as const;
    for (const policy of policies) {
      const data = {
        hardCapAmount: (policy.spent + estimatedAmount).toFixed(6),
        enabled: true,
        effectiveFrom: new Date(),
      };
      const updated = await tx.runtimeBudgetPolicy.updateMany({
        where: {
          scope: policy.scope,
          tenantId: policy.tenantId,
          procedimentoId: policy.procedimentoId,
          currency: "EUR",
          windowSeconds,
        },
        data,
      });
      if (updated.count === 0) {
        await tx.runtimeBudgetPolicy.create({
          data: {
            scope: policy.scope,
            tenantId: policy.tenantId,
            procedimentoId: policy.procedimentoId,
            currency: "EUR",
            windowSeconds,
            ...data,
          },
        });
      }
    }
  });
}

async function enableBoundedManualRetry(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "reject_async_job_admission_mutation"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF ROW(
            NEW."idempotencyKey", NEW."requestFingerprint", NEW."operation", NEW."logicalOperationId",
            NEW."purpose", NEW."correlationId", NEW."policyDecisionRef", NEW."inputReference",
            NEW."admissionType", NEW."tenantId", NEW."initiatingUserId", NEW."actorId",
            NEW."actorEmail", NEW."actorRole", NEW."createdAt"
        ) IS DISTINCT FROM ROW(
            OLD."idempotencyKey", OLD."requestFingerprint", OLD."operation", OLD."logicalOperationId",
            OLD."purpose", OLD."correlationId", OLD."policyDecisionRef", OLD."inputReference",
            OLD."admissionType", OLD."tenantId", OLD."initiatingUserId", OLD."actorId",
            OLD."actorEmail", OLD."actorRole", OLD."createdAt"
        ) THEN
            RAISE EXCEPTION 'Async job admission identity and provenance are immutable';
        END IF;

        IF NEW."maxAttempts" IS DISTINCT FROM OLD."maxAttempts"
           AND NOT (
               OLD."status" = 'TERMINAL_FAILED'
               AND NEW."status" = 'QUEUED'
               AND NEW."maxAttempts" = OLD."attemptCount" + 1
               AND NEW."maxAttempts" <= 100
           )
        THEN
            RAISE EXCEPTION 'Async job attempt budget is immutable outside manual retry';
        END IF;

        RETURN NEW;
    END;
    $$;
  `);
}

async function runResearchGate() {
  const before = await snapshot();
  if (!before.providers.moonlitCredentialPresent) throw new Error("RESEARCH_PROVIDER_CREDENTIAL_MISSING");
  if (before.mission.status !== "PENDING" || before.mission.lifecycleStatus !== "CURRENT") {
    throw new Error("MISSION_NOT_PENDING_CURRENT");
  }
  if (before.attempts.length !== 0 || before.bundles.length !== 0
    || before.results.length !== 0 || before.assessments.length !== 0) {
    throw new Error("MISSION_ALREADY_EXECUTED");
  }
  const missionJobs = before.jobs.filter((job) => {
    const reference = job.inputReference as { referenceId?: unknown };
    return reference.referenceId === MISSION_ID;
  });
  if (missionJobs.length > 1) throw new Error("MISSION_JOB_NOT_UNIQUE");
  const recoverablePlanningFailure = missionJobs.length === 1
    && missionJobs[0].status === "TERMINAL_FAILED"
    && ["PROVIDER_PLAN_BUDGET_INSUFFICIENT", "UNHANDLED_ERROR"].includes(
      missionJobs[0].failureCode ?? "",
    )
    && before.attempts.length === 0
    && before.bundles.length === 0;
  if (missionJobs.length === 1 && !recoverablePlanningFailure) {
    throw new Error("MISSION_JOB_ALREADY_EXISTS");
  }
  if (before.protectedMission.id !== PROTECTED_MISSION_ID) {
    throw new Error("PROTECTED_MISSION_MISSING");
  }

  const stored = await getResearchMission(MISSION_ID, {
    actorId: process.env.AUTOMATIC_RESEARCH_WORKER_ACTOR_ID ?? "",
    tenantId: before.tenant.id,
  });
  if (!stored) throw new Error("MISSION_NOT_FOUND");
  const decision = evaluateAutomaticResearchPolicy({
    tenantId: before.tenant.id,
    mission: stored.mission,
  });
  if (!decision.authorized || !decision.policyDecisionRef || !decision.workerActorId
    || !decision.providerTimeoutMs) {
    throw new Error(decision.requirementCode ?? "RESEARCH_POLICY_NOT_AUTHORIZED");
  }
  const adapters = await researchProviderAdapters(decision.providerTimeoutMs);
  const capabilities = new Set(adapters.map((adapter) => adapter.capability));
  const missingCapability = stored.mission.executionPlan?.requiredCapabilities
    .find((capability) => !capabilities.has(capability));
  if (missingCapability) throw new Error(`RESEARCH_CAPABILITY_MISSING:${missingCapability}`);

  const unitCost = Number(process.env.ASYNC_COST_RESEARCH_CALL_ESTIMATE_EUR);
  await configureMinimumBudget(
    before.tenant.id,
    unitCost * stored.mission.budget.maxTotalResearchCalls,
  );
  let jobId: string;
  if (recoverablePlanningFailure) {
    await enableBoundedManualRetry();
    const retried = await retryTerminalAsyncJob({
      jobId: missionJobs[0].id,
      actor: { userId: null, userEmail: null, userRole: "STAGING_RESEARCH_GATE" },
    });
    if (retried.outcome !== "REQUEUED") throw new Error("MISSION_JOB_NOT_REQUEUED");
    jobId = missionJobs[0].id;
  } else {
    const admitted = await admitAsyncJob(buildResearchMissionAsyncJobAdmission({
      mission: stored.mission,
      actor: {
        actorId: decision.workerActorId,
        actorEmail: null,
        actorRole: "STAGING_RESEARCH_GATE",
        initiatingUserId: null,
        admissionType: "AUTHORIZED_SYSTEM",
        tenantId: before.tenant.id,
      },
      correlationId: `research-gate:${MISSION_ID}`,
      policyDecisionRef: decision.policyDecisionRef,
      availableAt: new Date(),
      maxAttempts: 1,
    }));
    jobId = admitted.job.id;
  }

  const handler = createAutomaticResearchExecutionHandler({
    async loadAuthority(input) {
      if (input.jobId !== jobId || input.missionId !== MISSION_ID) return null;
      const job = await prisma.asyncJob.findUnique({
        where: { id: input.jobId },
        select: { operation: true, tenantId: true, actorId: true, policyDecisionRef: true },
      });
      if (!job || job.operation !== RESEARCH_MISSION_EXECUTION_OPERATION
        || job.tenantId !== before.tenant.id || job.policyDecisionRef !== decision.policyDecisionRef) {
        return null;
      }
      const current = await getResearchMission(MISSION_ID, {
        actorId: job.actorId,
        tenantId: before.tenant.id,
      });
      if (!current || current.operational.status !== "PENDING") return null;
      return {
        mission: current.mission,
        tenantId: before.tenant.id,
        actorId: job.actorId,
        decision,
      };
    },
    async createProviderAdapters({ requestTimeoutMs }) {
      const adapters = await researchProviderAdapters(requestTimeoutMs);
      return adapters.filter((adapter) => adapter.capability !== "KEYWORD_DISCOVERY");
    },
    orchestrateSourceChain: async () => undefined,
  });
  const registry = new AsyncJobHandlerRegistry([handler]);
  const drainOutcome = await drainOneAsyncJob({
    workerId: `research-gate-${Date.now()}`,
    leaseDurationMs: 20 * 60 * 1000,
    retryDelayMs: 0,
    operationAllowlist: [RESEARCH_MISSION_EXECUTION_OPERATION],
    operationBlocklist: ["FASCICOLO.AUTOMATIC_ANALYSIS_V1"],
    procedimentoAllowlist: [PROCEDIMENTO_ID],
    registry,
  });
  const after = await snapshot();
  return {
    drainOutcome,
    protectedMissionUnchanged:
      before.protectedMission.digest === after.protectedMission.digest,
    before,
    after,
  };
}

export async function GET() {
  try {
    assertStaging();
    return NextResponse.json(await snapshot(), { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "UNKNOWN_ERROR" },
      { status: 500, headers: NO_STORE },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    assertStaging();
    if (request.headers.get("x-research-gate-confirm") !== "E2E-TEST-001") {
      return NextResponse.json({ error: "CONFIRMATION_REQUIRED" }, { status: 403, headers: NO_STORE });
    }
    return NextResponse.json(await runResearchGate(), { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "UNKNOWN_ERROR" },
      { status: 500, headers: NO_STORE },
    );
  }
}
