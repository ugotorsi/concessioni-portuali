import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { createAutomaticResearchProviderAdapters } from "@/server/legal-research/automatic-research-providers";

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

async function snapshot() {
  const tenant = await prisma.ente.findUnique({
    where: { codice: TENANT_CODE },
    select: { id: true, codice: true },
  });
  if (!tenant) throw new Error("TENANT_NOT_FOUND");

  const adapters = await createAutomaticResearchProviderAdapters({ requestTimeoutMs: 30_000 });
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
      legalDataHunterCredentialPresent:
        typeof process.env.LEGAL_DATA_HUNTER_API_KEY === "string"
        && process.env.LEGAL_DATA_HUNTER_API_KEY.trim().length > 0,
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
