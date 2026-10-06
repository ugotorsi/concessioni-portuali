import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { admitAsyncJob } from "@/server/async-jobs/persistence";
import { AsyncJobHandlerRegistry } from "@/server/async-jobs/registry";
import { drainOneAsyncJob } from "@/server/async-jobs/worker";
import { discoverItalianLegalReferences } from "@/server/intake/legal-reference-discovery/parser";
import { createAutomaticResearchExecutionHandler } from "@/server/legal-research/automatic-research-job";
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
  assertStaging();
  const [
    tenant,
    mission,
    results,
    assessments,
    protectedMission,
    protectedBundleCount,
    jobs,
    attempts,
    bundles,
    adverseRequirements,
    acquisitions,
    automaticReportCount,
    structuredReportCount,
    proposalCount,
    materializationCount,
  ] =
      await Promise.all([
        prisma.ente.findUnique({
          where: { codice: TENANT_CODE },
          select: { id: true, codice: true },
        }),
        prisma.researchMissionRecord.findUnique({
          where: { id: MISSION_ID },
          select: {
            id: true,
            status: true,
            lifecycleStatus: true,
            caseId: true,
            tenantId: true,
            referenceDate: true,
            referenceDateBasis: true,
            payload: true,
            updatedAt: true,
          },
        }),
        prisma.researchQuestionResultRecord.findMany({
          where: { missionId: MISSION_ID },
          select: {
            id: true,
            candidateId: true,
            candidateSnapshot: true,
            supportDirection: true,
          },
          orderBy: { id: "asc" },
        }),
        prisma.researchSourceAssessmentRecord.findMany({
          where: { missionId: MISSION_ID, isCurrent: true },
          select: {
            resultId: true,
            retrievalState: true,
            textState: true,
            identityState: true,
            contentState: true,
            temporalState: true,
            adverseState: true,
            blockingReasons: true,
            usable: true,
          },
          orderBy: { resultId: "asc" },
        }),
        prisma.researchMissionRecord.findUnique({
          where: { id: PROTECTED_MISSION_ID },
          include: { executionAttempts: { orderBy: { id: "asc" } } },
        }),
        prisma.researchEvidenceBundleRecord.count({
          where: { missionId: PROTECTED_MISSION_ID },
        }),
        prisma.asyncJob.findMany({
          where: {
            operation: RESEARCH_MISSION_EXECUTION_OPERATION,
            procedimentoId: PROCEDIMENTO_ID,
          },
          select: {
            id: true,
            logicalOperationId: true,
            status: true,
            attemptCount: true,
            maxAttempts: true,
            resultReference: true,
            failureCategory: true,
            failureCode: true,
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
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.researchEvidenceBundleRecord.findMany({
          where: { missionId: MISSION_ID },
          select: {
            id: true,
            executionId: true,
            completionState: true,
            totalCalls: true,
            moonlitCalls: true,
            simpliciterCalls: true,
            legalDataHunterCalls: true,
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.researchAdverseRequirement.findMany({
          where: { primaryMissionId: MISSION_ID },
          select: { id: true, status: true, adverseMissionId: true },
        }),
        prisma.legalSourceAcquisition.findMany({
          where: {
            acquiredByProcess: "LEGAL_RESEARCH_OFFICIAL_SOURCE_VERIFICATION_V1",
            sourceFamily: {
              researchSourceAssessments: { some: { missionId: MISSION_ID } },
            },
          },
          select: {
            id: true,
            providerOrChannel: true,
            externalSourceId: true,
            outcome: true,
            observedSha256: true,
            observedSizeBytes: true,
            observedMimeType: true,
          },
        }),
        prisma.automaticFascicoloReport.count({ where: { procedimentoId: PROCEDIMENTO_ID } }),
        prisma.structuredFascicoloReportSnapshot.count({ where: { procedimentoId: PROCEDIMENTO_ID } }),
        prisma.fascicoloOperationalProposal.count({ where: { procedimentoId: PROCEDIMENTO_ID } }),
        prisma.fascicoloOperationalProposalMaterialization.count({
          where: { procedimentoId: PROCEDIMENTO_ID },
        }),
      ]);
    if (!tenant || !mission || mission.caseId !== PROCEDIMENTO_ID || mission.tenantId !== tenant.id) {
      throw new Error("MISSION_SCOPE_MISMATCH");
    }
    const protectedView = protectedMission
      ? {
          mission: protectedMission,
          attemptCount: protectedMission.executionAttempts.length,
          bundleCount: protectedBundleCount,
        }
      : null;
    const candidates = results.map((result) => {
      const candidate = result.candidateSnapshot as {
        toolId?: unknown;
        providerId?: unknown;
        courtOrBody?: unknown;
        documentType?: unknown;
        number?: unknown;
        year?: unknown;
        documentDate?: unknown;
        ecli?: unknown;
        celex?: unknown;
        officialIdentifier?: unknown;
        title?: unknown;
        sourceUrl?: unknown;
        providerDocumentId?: unknown;
        providerDates?: unknown;
        exactReferenceMatch?: unknown;
        fullTextAvailable?: unknown;
        verificationState?: unknown;
      };
      const parseInput = [
        candidate.officialIdentifier,
        candidate.title,
        candidate.courtOrBody,
      ].filter((value): value is string => typeof value === "string").join(" ");
      return {
        resultId: result.id,
        candidateId: result.candidateId,
        supportDirection: result.supportDirection,
        toolId: candidate.toolId ?? null,
        providerId: candidate.providerId ?? null,
        courtOrBody: candidate.courtOrBody ?? null,
        documentType: candidate.documentType ?? null,
        number: candidate.number ?? null,
        year: candidate.year ?? null,
        documentDate: candidate.documentDate ?? null,
        ecli: candidate.ecli ?? null,
        celex: candidate.celex ?? null,
        officialIdentifier: candidate.officialIdentifier ?? null,
        title: candidate.title ?? null,
        sourceUrl: candidate.sourceUrl ?? null,
        providerDocumentId: candidate.providerDocumentId ?? null,
        providerDates: candidate.providerDates ?? null,
        exactReferenceMatch: candidate.exactReferenceMatch ?? null,
        fullTextAvailable: candidate.fullTextAvailable ?? null,
        verificationState: candidate.verificationState ?? null,
        parsedReferences: parseInput
          ? discoverItalianLegalReferences(parseInput).map((reference) => ({
              kind: reference.kind,
              authorityHint: reference.authorityHint,
              actType: reference.actType,
              actNumber: reference.actNumber,
              year: reference.year,
              chamberSection: reference.chamberSection,
            }))
          : [],
      };
    });
    return {
      tenant,
      mission,
      candidates,
      assessments,
      jobs,
      attempts,
      bundles,
      adverseRequirements,
      acquisitions,
      outputs: {
        automaticReportCount,
        structuredReportCount,
        proposalCount,
        materializationCount,
      },
      credentials: {
        legalDataHunterPresent:
          typeof process.env.LEGAL_DATA_HUNTER_API_KEY === "string"
          && process.env.LEGAL_DATA_HUNTER_API_KEY.trim().length > 0,
        moonlitGateTokenPresent:
          typeof process.env.RESEARCH_GATE_MOONLIT_ACCESS_TOKEN === "string"
          && process.env.RESEARCH_GATE_MOONLIT_ACCESS_TOKEN.trim().length > 0,
      },
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
    const spentRows = await tx.$queryRaw<Array<{ global: string; tenant: string; procedimento: string }>>`
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

async function runOfficialResearchRerun() {
  const before = await snapshot();
  if (before.mission.status !== "BUDGET_EXHAUSTED"
    || before.mission.lifecycleStatus !== "CURRENT") {
    throw new Error("MISSION_NOT_RECOVERABLE");
  }
  if (!before.credentials.moonlitGateTokenPresent) {
    throw new Error("RESEARCH_PROVIDER_CREDENTIAL_MISSING");
  }
  if (process.env.AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED !== "true") {
    throw new Error("OFFICIAL_SOURCE_VERIFICATION_NOT_ENABLED");
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
  const availableCapabilities = new Set(adapters.map((adapter) => adapter.capability));
  availableCapabilities.add("KEYWORD_DISCOVERY");
  const missingCapability = stored.mission.executionPlan?.requiredCapabilities
    .find((capability) => !availableCapabilities.has(capability));
  if (missingCapability) throw new Error(`RESEARCH_CAPABILITY_MISSING:${missingCapability}`);
  const unitCost = Number(process.env.ASYNC_COST_RESEARCH_CALL_ESTIMATE_EUR);
  await configureMinimumBudget(
    before.tenant.id,
    unitCost * stored.mission.budget.maxTotalResearchCalls,
  );
  const reopened = await prisma.researchMissionRecord.updateMany({
    where: {
      id: MISSION_ID,
      tenantId: before.tenant.id,
      caseId: PROCEDIMENTO_ID,
      lifecycleStatus: "CURRENT",
      status: "BUDGET_EXHAUSTED",
      activeExecutionId: null,
    },
    data: {
      status: "PENDING",
      completedAt: null,
      deferredAt: null,
      claimantId: null,
      claimToken: null,
      claimExpiresAt: null,
      stateVersion: { increment: 1 },
    },
  });
  if (reopened.count !== 1) throw new Error("MISSION_REOPEN_CONFLICT");
  const admission = buildResearchMissionAsyncJobAdmission({
    mission: stored.mission,
    actor: {
      actorId: decision.workerActorId,
      actorEmail: null,
      actorRole: "STAGING_RESEARCH_GATE",
      initiatingUserId: null,
      admissionType: "AUTHORIZED_SYSTEM",
      tenantId: before.tenant.id,
    },
    correlationId: `research-official-rerun:${MISSION_ID}`,
    policyDecisionRef: decision.policyDecisionRef,
    availableAt: new Date(),
    maxAttempts: 1,
  });
  const admitted = await admitAsyncJob({
    ...admission,
    logicalOperationId: `${MISSION_ID}:official-verification-v1`,
  });
  const handler = createAutomaticResearchExecutionHandler({
    async loadAuthority(input) {
      if (input.jobId !== admitted.job.id || input.missionId !== MISSION_ID) return null;
      const current = await getResearchMission(MISSION_ID, {
        actorId: decision.workerActorId!,
        tenantId: before.tenant.id,
      });
      if (!current || current.operational.status !== "PENDING") return null;
      return {
        mission: current.mission,
        tenantId: before.tenant.id,
        actorId: decision.workerActorId!,
        decision,
      };
    },
    createProviderAdapters: ({ requestTimeoutMs }) => researchProviderAdapters(requestTimeoutMs),
  });
  const registry = new AsyncJobHandlerRegistry([handler]);
  const drainOutcome = await drainOneAsyncJob({
    workerId: `research-official-gate-${Date.now()}`,
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
    protectedMissionUnchanged: before.protectedMission.digest === after.protectedMission.digest,
    before: {
      missionStatus: before.mission.status,
      attemptCount: before.attempts.length,
      resultCount: before.candidates.length,
      usableCount: before.assessments.filter((assessment) => assessment.usable).length,
    },
    after,
  };
}

export async function GET() {
  try {
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
    if (request.headers.get("x-research-gate-confirmation")
      !== "E2E-TEST-001-OFFICIAL-RESEARCH-RERUN") {
      return NextResponse.json(
        { error: "CONFIRMATION_REQUIRED" },
        { status: 403, headers: NO_STORE },
      );
    }
    return NextResponse.json(await runOfficialResearchRerun(), { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "UNKNOWN_ERROR" },
      { status: 500, headers: NO_STORE },
    );
  }
}
