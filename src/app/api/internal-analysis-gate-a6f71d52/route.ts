import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
  createDefaultFascicoloAutomaticAnalysisDependencies,
  createFascicoloAutomaticAnalysisHandler,
  ensureFascicoloAutomaticAnalysisJob,
} from "@/server/ai/fascicoloAutomaticAnalysisJob";
import { retryTerminalAsyncJob } from "@/server/async-jobs/persistence";
import { AsyncJobHandlerRegistry } from "@/server/async-jobs/registry";
import { drainOneAsyncJob } from "@/server/async-jobs/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PROCEDIMENTO_ID = "staging-e2e-test-001-procedimento";
const TENANT_CODE = "DEMO-COMUNE-COSTIERO";
const PROTECTED_MISSION_ID =
  "research-mission:7cd3faa5f4294068fc30558e65b4229ff46359463fa0039c61717b5da30e0b63";
const EXPECTED_ENDPOINT = "ep-jolly-hall-atts00ke";
const LEGAL_RESEARCH_OPERATION = "LEGAL_RESEARCH.EXECUTE_V1";
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

  const [
    procedimento,
    policies,
    jobs,
    workers,
    missions,
    attempts,
    revisions,
    itemCounts,
    subjectCountRows,
    automaticReportCount,
    reportCount,
    structuredReportCount,
    proposalCount,
    materializationCount,
    reservations,
    protectedMission,
    groundingIntakes,
    groundingDocuments,
  ] = await Promise.all([
    prisma.procedimento.findUnique({
      where: { id: PROCEDIMENTO_ID },
      select: { id: true, concessioneId: true, createdAt: true, updatedAt: true },
    }),
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
        effectiveFrom: true,
        updatedAt: true,
      },
      orderBy: [{ scope: "asc" }, { id: "asc" }],
    }),
    prisma.asyncJob.findMany({
      where: { procedimentoId: PROCEDIMENTO_ID },
      select: {
        id: true,
        operation: true,
        status: true,
        attemptCount: true,
        maxAttempts: true,
        failureCategory: true,
        failureCode: true,
        resultReference: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.runtimeWorkerHeartbeat.findMany({
      select: {
        workerId: true,
        status: true,
        concurrency: true,
        providerExecutionEnabled: true,
        startedAt: true,
        lastSeenAt: true,
        stoppedAt: true,
      },
      orderBy: { lastSeenAt: "desc" },
      take: 10,
    }),
    prisma.researchMissionRecord.findMany({
      where: { caseId: PROCEDIMENTO_ID },
      select: {
        id: true,
        caseId: true,
        status: true,
        knowledgeRevisionId: true,
        firstKnowledgeRevisionId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.researchExecutionAttempt.findMany({
      where: { mission: { caseId: PROCEDIMENTO_ID } },
      select: {
        id: true,
        missionId: true,
        completionState: true,
        totalCalls: true,
        moonlitCalls: true,
        simpliciterCalls: true,
        legalDataHunterCalls: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.fascicoloKnowledgeRevision.findMany({
      where: { procedimentoId: PROCEDIMENTO_ID },
      select: {
        id: true,
        status: true,
        corpusFingerprint: true,
        createdAt: true,
        completedAt: true,
        supersededAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.fascicoloKnowledgeItem.groupBy({
      by: ["kind"],
      where: { procedimentoId: PROCEDIMENTO_ID },
      _count: { _all: true },
      orderBy: { kind: "asc" },
    }),
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT subject_id)::int AS count
      FROM "FascicoloKnowledgeItem" item
      CROSS JOIN LATERAL jsonb_array_elements_text(
        COALESCE(item."structuredPayload"->'subjectIds', '[]'::jsonb)
      ) AS subject_id
      WHERE item."procedimentoId" = ${PROCEDIMENTO_ID}
    `,
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
    prisma.researchMissionRecord.findUnique({
      where: { id: PROTECTED_MISSION_ID },
      include: {
        executionAttempts: {
          select: {
            id: true,
            completionState: true,
            totalCalls: true,
            updatedAt: true,
          },
          orderBy: { id: "asc" },
        },
      },
    }),
    prisma.neutralIntake.findMany({
      where: { destination: { procedimentoId: PROCEDIMENTO_ID } },
      select: {
        id: true,
        status: true,
        sha256: true,
        classificationAttempts: {
          orderBy: [{ classifiedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            id: true,
            extractionAttemptId: true,
            evidenceHash: true,
            classifierVersion: true,
            outcome: true,
          },
        },
        extractionAttempts: {
          where: { outcome: "SUCCEEDED" },
          orderBy: [{ completedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            id: true,
            artifactSha256: true,
            _count: { select: { pages: true } },
          },
        },
      },
      orderBy: { id: "asc" },
    }),
    prisma.documento.findMany({
      where: {
        procedimentoId: PROCEDIMENTO_ID,
        currentFileVersionId: { not: null },
      },
      select: { id: true, sha256: true, currentFileVersionId: true },
      orderBy: { id: "asc" },
    }),
  ]);

  if (!procedimento) throw new Error("PROCEDIMENTO_NOT_FOUND");
  const protectedBundles = await prisma.researchEvidenceBundleRecord.count({
    where: { missionId: PROTECTED_MISSION_ID },
  });
  const protectedView = {
    mission: protectedMission,
    bundleCount: protectedBundles,
  };

  return {
    provider: {
      name: "OPENAI",
      credentialPresent:
        typeof process.env.AI_OPENAI_API_KEY === "string"
        && process.env.AI_OPENAI_API_KEY.trim().length > 0,
      projectClass: process.env.AI_PROVIDER_PROJECT_CLASS ?? null,
      region: process.env.AI_OPENAI_REGION ?? null,
    },
    configuredWorkerGate: {
      providerExecutionEnabled: process.env.ASYNC_PROVIDER_EXECUTION_ENABLED ?? null,
      operationAllowlist: process.env.ASYNC_WORKER_OPERATION_ALLOWLIST ?? null,
      procedimentoAllowlist: process.env.ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST ?? null,
      automaticResearchEnabled: process.env.AUTOMATIC_RESEARCH_EXECUTION_ENABLED ?? null,
    },
    tenant,
    procedimento,
    policies,
    jobs,
    workers,
    missions,
    attempts,
    revisions,
    itemCounts: Object.fromEntries(
      itemCounts.map((item) => [item.kind, item._count._all]),
    ),
    subjectCount: subjectCountRows[0]?.count ?? 0,
    outputs: {
      automaticReportCount,
      reportCount: reportCount[0]?.count ?? 0,
      structuredReportCount,
      proposalCount,
      materializationCount,
    },
    reservations,
    documentGrounding: {
      intakes: groundingIntakes,
      documents: groundingDocuments,
    },
    protectedMission: {
      id: protectedMission?.id ?? null,
      status: protectedMission?.status ?? null,
      attemptCount: protectedMission?.executionAttempts.length ?? 0,
      bundleCount: protectedBundles,
      digest: digest(protectedView),
    },
  };
}

async function configureMinimumBudget(tenantId: string): Promise<void> {
  const estimate = Number(process.env.ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR);
  if (!Number.isFinite(estimate) || estimate <= 0) {
    throw new Error("INVALID_ANALYSIS_COST_ESTIMATE");
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
        hardCapAmount: (policy.spent + estimate).toFixed(6),
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

async function ensureExistingArtifactGroundingDocument(tenantId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const intakes = await tx.neutralIntake.findMany({
      where: {
        enteId: tenantId,
        destination: { is: { procedimentoId: PROCEDIMENTO_ID } },
      },
      select: {
        id: true,
        sha256: true,
        storageProvider: true,
        storageBucket: true,
        storageKey: true,
        mimeType: true,
        sizeBytes: true,
        originalName: true,
        receivedAt: true,
        extractionAttempts: {
          where: { outcome: "SUCCEEDED" },
          orderBy: [{ completedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { artifactSha256: true },
        },
      },
    });
    if (intakes.length !== 1) throw new Error("GROUNDING_INTAKE_NOT_UNIQUE");
    const intake = intakes[0];
    const extraction = intake.extractionAttempts[0];
    if (!extraction || extraction.artifactSha256 !== intake.sha256) {
      throw new Error("GROUNDING_ARTIFACT_IDENTITY_MISMATCH");
    }

    const existing = await tx.documento.findMany({
      where: {
        enteId: tenantId,
        procedimentoId: PROCEDIMENTO_ID,
        sha256: intake.sha256,
        currentFileVersionId: { not: null },
      },
      select: { id: true },
    });
    if (existing.length === 1) return;
    if (existing.length > 1) throw new Error("GROUNDING_DOCUMENT_AMBIGUOUS");

    const procedimento = await tx.procedimento.findUnique({
      where: { id: PROCEDIMENTO_ID },
      select: { concessioneId: true },
    });
    const job = await tx.asyncJob.findFirst({
      where: {
        procedimentoId: PROCEDIMENTO_ID,
        operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
      },
      select: {
        initiatingUserId: true,
        actorId: true,
        actorEmail: true,
        actorRole: true,
      },
    });
    if (!procedimento || !job) throw new Error("GROUNDING_AUTHORITY_MISSING");

    const documentId = digest([
      "ANALYSIS_GATE_EXISTING_ARTIFACT_BINDING_V1",
      tenantId,
      PROCEDIMENTO_ID,
      intake.id,
      intake.sha256,
    ]);
    const fileVersionId = digest([
      "ANALYSIS_GATE_EXISTING_ARTIFACT_VERSION_V1",
      documentId,
      intake.sha256,
    ]);
    await tx.documento.create({
      data: {
        id: documentId,
        nome: intake.originalName ?? `Neutral intake ${intake.id}`,
        tipologia: "ALTRO",
        statoDocumento: "ATTIVO",
        mimeType: intake.mimeType,
        dimensioneBytes: intake.sizeBytes,
        checksumSha256: intake.sha256,
        sha256: intake.sha256,
        url: `/documenti/${documentId}/download`,
        storagePath: intake.storageKey,
        storageKey: intake.storageKey,
        storageProvider: intake.storageProvider,
        storageBucket: intake.storageBucket,
        nomeStorage: intake.sha256,
        originalName: intake.originalName,
        sizeBytes: intake.sizeBytes,
        documentType: "ALTRO",
        documentDate: intake.receivedAt,
        source: "ANALYSIS_GATE_EXISTING_ARTIFACT_BINDING",
        status: "ATTIVO",
        uploadedByUserId: job.initiatingUserId,
        uploadedByUserEmail: job.actorEmail,
        uploadedByUserRole: job.actorRole,
        enteId: tenantId,
        concessioneId: procedimento.concessioneId,
        procedimentoId: PROCEDIMENTO_ID,
        fileVersions: {
          create: {
            id: fileVersionId,
            canonicalEnteId: tenantId,
            storageProvider: intake.storageProvider,
            storageKey: intake.storageKey,
            storageBucket: intake.storageBucket,
            mimeType: intake.mimeType,
            sizeBytes: intake.sizeBytes,
            sha256: intake.sha256,
            createdByUserId: job.initiatingUserId,
            createdByActorId: job.actorId,
            createdByRole: job.actorRole,
          },
        },
      },
    });
    await tx.documento.update({
      where: { id: documentId },
      data: { currentFileVersionId: fileVersionId },
    });
  });
}

async function runAnalysisGate() {
  const before = await snapshot();
  if (!before.provider.credentialPresent) throw new Error("ANALYSIS_PROVIDER_CREDENTIAL_MISSING");
  if (before.provider.projectClass !== "REAL_DATA_APPROVED") {
    throw new Error("ANALYSIS_PROVIDER_PROJECT_NOT_APPROVED");
  }
  if (before.protectedMission.id !== PROTECTED_MISSION_ID) {
    throw new Error("PROTECTED_MISSION_MISSING");
  }
  if (before.attempts.length !== 0) throw new Error("LEGAL_RESEARCH_ALREADY_EXECUTED_FOR_E2E");

  await ensureExistingArtifactGroundingDocument(before.tenant.id);
  await configureMinimumBudget(before.tenant.id);
  process.env.AUTOMATIC_RESEARCH_EXECUTION_ENABLED = "false";

  let analysisJobs = await prisma.asyncJob.findMany({
    where: {
      procedimentoId: PROCEDIMENTO_ID,
      operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
    },
    orderBy: { createdAt: "asc" },
  });
  if (analysisJobs.length > 1) throw new Error("MULTIPLE_ANALYSIS_JOBS");

  if (analysisJobs.length === 0) {
    const intake = await prisma.neutralIntake.findFirst({
      where: {
        destination: { procedimentoId: PROCEDIMENTO_ID },
      },
      select: { id: true },
    });
    if (!intake) throw new Error("ROUTED_NEUTRAL_INTAKE_NOT_FOUND");
    const extractionJobs = await prisma.asyncJob.findMany({
      where: {
        operation: "NEUTRAL_INTAKE_EXTRACTION_V1",
        status: "SUCCEEDED",
      },
      select: { id: true, inputReference: true },
      orderBy: { completedAt: "desc" },
      take: 50,
    });
    const source = extractionJobs.find((candidate) => {
      const input = candidate.inputReference as { referenceId?: unknown };
      return input.referenceId === intake.id;
    });
    const input = source?.inputReference as {
      referenceId?: unknown;
      metadata?: { extractionAttemptId?: unknown };
    } | null;
    if (!source || typeof input?.referenceId !== "string") {
      throw new Error("COMPLETED_EXTRACTION_SOURCE_NOT_FOUND");
    }
    await ensureFascicoloAutomaticAnalysisJob({
      sourceJobId: source.id,
      neutralIntakeId: input.referenceId,
      ...(typeof input.metadata?.extractionAttemptId === "string"
        ? { extractionAttemptId: input.metadata.extractionAttemptId }
        : {}),
    });
    analysisJobs = await prisma.asyncJob.findMany({
      where: {
        procedimentoId: PROCEDIMENTO_ID,
        operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
      },
      orderBy: { createdAt: "asc" },
    });
  }
  const job = analysisJobs[0];
  if (!job) throw new Error("ANALYSIS_JOB_NOT_ADMITTED");
  if (job.status === "TERMINAL_FAILED") {
    await enableBoundedManualRetry();
    const retried = await retryTerminalAsyncJob({
      jobId: job.id,
      actor: {
        userId: null,
        userEmail: null,
        userRole: "STAGING_ANALYSIS_GATE",
      },
    });
    if (retried.outcome !== "REQUEUED") throw new Error("ANALYSIS_JOB_NOT_REQUEUED");
  } else if (job.status !== "QUEUED" && job.status !== "SUCCEEDED") {
    throw new Error(`ANALYSIS_JOB_NOT_EXECUTABLE_${job.status}`);
  }

  let drainOutcome: unknown = { outcome: "ALREADY_SUCCEEDED", jobId: job.id };
  if (job.status !== "SUCCEEDED") {
    const analysisDependencies = createDefaultFascicoloAutomaticAnalysisDependencies();
    const registry = new AsyncJobHandlerRegistry([
      createFascicoloAutomaticAnalysisHandler({
        ...analysisDependencies,
        persistReport: async (report) => ({
          outcome: "REUSED",
          reportId: report.reportId,
        }),
      }),
    ]);
    drainOutcome = await drainOneAsyncJob({
      workerId: `analysis-gate-${Date.now()}`,
      leaseDurationMs: 5 * 60 * 1000,
      retryDelayMs: 0,
      operationAllowlist: [FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION],
      operationBlocklist: [LEGAL_RESEARCH_OPERATION],
      procedimentoAllowlist: [PROCEDIMENTO_ID],
      registry,
    });
  }

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
    if (request.headers.get("x-analysis-gate-confirm") !== "E2E-TEST-001") {
      return NextResponse.json({ error: "CONFIRMATION_REQUIRED" }, { status: 403, headers: NO_STORE });
    }
    return NextResponse.json(await runAnalysisGate(), { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "UNKNOWN_ERROR" },
      { status: 500, headers: NO_STORE },
    );
  }
}
