import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SELVARA_PILOT_AUTHORIZATION } from "@/server/ai/selvaraPilotAuthorization";

const databaseUrl = process.env.POSTGRES_INTEGRATION_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("document analysis activation on PostgreSQL", () => {
  const tenantOne = "pg-tenant-activation-1";
  const tenantTwo = "pg-tenant-activation-2";
  const procedureOne = "pg-procedure-activation-1";
  const procedureTwo = "pg-procedure-activation-2";
  const userId = "pg-user-activation-1";

  let prisma: typeof import("@/lib/prisma").prisma;
  let activation: typeof import("@/server/async-jobs/documentWorkerActivation");
  let activationPersistence:
    typeof import("@/server/async-jobs/documentAnalysisActivationPersistence");
  let persistence: typeof import("@/server/async-jobs/persistence");

  const environment = {
    DOCUMENT_WORKER_ACTIVATION_MODE: "RENDER_ONE_OFF",
    DOCUMENT_WORKER_ACTIVATION_TIMEOUT_MS: "1000",
    RENDER_APPLICATION_WORKER_SERVICE_ID: "srv-postgresintegration",
    RENDER_WORKER_API_KEY: "local-test-key",
  };

  function target(applicationJobId: string, tenantId = tenantOne, procedimentoId = procedureOne) {
    return {
      kind: "DOCUMENT_ANALYSIS" as const,
      applicationJobId,
      tenantId,
      procedimentoId,
    };
  }

  async function createAnalysisJob(input: {
    id: string;
    tenantId?: string;
    procedimentoId?: string;
    status?: "QUEUED" | "RUNNING" | "SUCCEEDED" | "TERMINAL_FAILED";
  }) {
    const tenantId = input.tenantId ?? tenantOne;
    const procedimentoId = input.procedimentoId ?? procedureOne;
    return prisma.asyncJob.create({
      data: {
        id: input.id,
        idempotencyKey: input.id.padEnd(64, "0").slice(0, 64),
        requestFingerprint: input.id.padEnd(64, "1").slice(0, 64),
        operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
        logicalOperationId: `logical-${input.id}`,
        purpose: "FASCICOLO_AUTOMATIC_ANALYSIS",
        correlationId: `correlation-${input.id}`,
        inputReference: {
          referenceType: "FASCICOLO_DOCUMENT_CORPUS",
          referenceId: `corpus-${input.id}`,
          referenceVersion: "V1",
          metadata: { procedimentoId },
        },
        admissionType: "AUTHENTICATED_USER",
        tenantId,
        procedimentoId,
        initiatingUserId: userId,
        actorId: userId,
        actorEmail: "postgres-activation@example.test",
        actorRole: "ADMIN",
        status: input.status ?? "QUEUED",
        maxAttempts: 3,
        availableAt: new Date(0),
      },
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ prisma } = await import("@/lib/prisma"));
    activation = await import("@/server/async-jobs/documentWorkerActivation");
    activationPersistence = await import(
      "@/server/async-jobs/documentAnalysisActivationPersistence"
    );
    persistence = await import("@/server/async-jobs/persistence");

    await prisma.ente.createMany({
      data: [
        { id: tenantOne, nome: "PostgreSQL Activation Tenant 1", codice: "PG-ACTIVATION-1" },
        { id: tenantTwo, nome: "PostgreSQL Activation Tenant 2", codice: "PG-ACTIVATION-2" },
      ],
      skipDuplicates: true,
    });
    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        nome: "PostgreSQL Activation User",
        email: "postgres-activation@example.test",
        ruolo: "ADMIN",
      },
      update: {},
    });
    await prisma.procedimento.createMany({
      data: [
        {
          id: procedureOne,
          enteId: tenantOne,
          tipologia: "ALTRO",
          stato: "DA_AVVIARE",
        },
        {
          id: procedureTwo,
          enteId: tenantTwo,
          tipologia: "ALTRO",
          stato: "DA_AVVIARE",
        },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    await prisma.activityLog.deleteMany({
      where: { entita: "AsyncJob", entitaId: { startsWith: "pg-analysis-" } },
    });
    await prisma.asyncJob.deleteMany({ where: { id: { startsWith: "pg-analysis-" } } });
    await prisma.procedimento.deleteMany({ where: { id: { in: [procedureOne, procedureTwo] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.ente.deleteMany({ where: { id: { in: [tenantOne, tenantTwo] } } });
    await prisma.$disconnect();
  });

  it("allows one concurrent reservation and one external POST", async () => {
    const applicationJobId = "pg-analysis-concurrent";
    await createAnalysisJob({ id: applicationJobId });
    let releaseFetch!: () => void;
    const fetch = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseFetch = resolve;
      });
      return new Response(
        JSON.stringify({ id: "job-postgresconcurrent" }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });

    const first = activation.activateDocumentWorker(target(applicationJobId), {
      environment,
      fetch,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const second = activation.activateDocumentWorker(target(applicationJobId), {
      environment,
      fetch,
    });
    await expect(second).resolves.toMatchObject({
      outcome: "ALREADY_REQUESTED",
      activationState: "REQUESTING",
    });
    releaseFetch();
    await expect(first).resolves.toEqual({
      outcome: "REQUESTED",
      renderJobId: "job-postgresconcurrent",
    });

    expect(fetch).toHaveBeenCalledOnce();
    const ledger = await prisma.activityLog.findMany({
      where: { entita: "AsyncJob", entitaId: applicationJobId },
      orderBy: { createdAt: "asc" },
      select: { azione: true, metadata: true },
    });
    expect(ledger.map((entry) => entry.azione)).toEqual([
      "DOCUMENT_ANALYSIS_ACTIVATION_REQUESTING",
      "DOCUMENT_ANALYSIS_ACTIVATION_CONFIRMED",
    ]);
    expect(ledger.map((entry) => (
      entry.metadata as { activationSequence: number }
    ).activationSequence)).toEqual([1, 2]);
    await expect(
      activationPersistence.readDocumentAnalysisActivation(applicationJobId),
    ).resolves.toMatchObject({
      state: "CONFIRMED",
      renderJobId: "job-postgresconcurrent",
    });
  });

  it("allows only one concurrent Selvara recovery without duplicating the ledger", async () => {
    const recovery = activationPersistence.SELVARA_FAILED_ACTIVATION_RECOVERY;
    const applicationJobId = recovery.applicationJobId;
    const target = {
      applicationJobId,
      tenantId: SELVARA_PILOT_AUTHORIZATION.tenantId,
      procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
    };
    const renderJob = {
      id: recovery.renderJobId,
      serviceId: recovery.renderServiceId,
      startCommand: recovery.renderStartCommand,
      status: "failed",
      createdAt: "2026-10-25T11:36:55.003319Z",
      startedAt: "2026-10-25T11:36:55.000Z",
      finishedAt: "2026-10-25T11:37:33.000Z",
    };
    const renderLog = (id: string, timestamp: string, message: string) => ({
      id,
      timestamp,
      message,
      labels: [{ name: "resource", value: recovery.renderJobId }],
    });

    vi.stubEnv("RENDER_APPLICATION_WORKER_SERVICE_ID", recovery.renderServiceId);
    vi.stubEnv("RENDER_WORKER_API_KEY", "isolated-postgres-test-key");
    vi.stubEnv("DOCUMENT_WORKER_ACTIVATION_MODE", "DISABLED");
    vi.stubEnv("AI_REAL_DATA_ENABLED", "false");
    vi.stubEnv("ASYNC_PROVIDER_EXECUTION_ENABLED", "false");
    vi.stubEnv("AUTOMATIC_RESEARCH_EXECUTION_ENABLED", "false");
    vi.stubEnv("AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn(async (request: string | URL | Request) => {
      const url = new URL(
        typeof request === "string"
          ? request
          : request instanceof URL
            ? request.href
            : request.url,
      );
      if (url.pathname === `/v1/services/${recovery.renderServiceId}`) {
        return Response.json({
          id: recovery.renderServiceId,
          ownerId: "tea-isolated-postgres",
          suspended: "suspended",
        });
      }
      if (
        url.pathname
        === `/v1/services/${recovery.renderServiceId}/jobs/${recovery.renderJobId}`
      ) {
        return Response.json(renderJob);
      }
      if (url.pathname === `/v1/services/${recovery.renderServiceId}/jobs`) {
        return Response.json(
          url.searchParams.has("cursor")
            ? []
            : [{ job: renderJob, cursor: "cursor-final" }],
        );
      }
      if (url.pathname === "/v1/logs") {
        return Response.json({
          hasMore: false,
          nextStartTime: "2026-10-25T11:37:27.000Z",
          nextEndTime: "2026-10-25T11:38:33.000Z",
          logs: [
            renderLog(
              "log-command",
              "2026-10-25T11:37:24.947090372Z",
              `==> Running '${recovery.renderStartCommand}'`,
            ),
            renderLog(
              "log-npm",
              "2026-10-25T11:37:25.443242773Z",
              "> concessioni-portuali@0.1.0 worker:async",
            ),
            renderLog(
              "log-process",
              "2026-10-25T11:37:25.443248853Z",
              "> tsx src/server/async-jobs/applicationWorkerProcess.ts",
            ),
            renderLog(
              "log-fatal",
              "2026-10-25T11:37:27.720728303Z",
              JSON.stringify({
                event: recovery.failureEvent,
                errorName: "ApplicationAsyncWorkerConfigurationError",
                errorCode: "INVALID_CONFIGURATION",
                timestamp: "2026-10-25T11:37:27.720Z",
              }),
            ),
          ],
        });
      }
      return new Response(null, { status: 404 });
    }));

    try {
      await prisma.ente.create({
        data: {
          id: SELVARA_PILOT_AUTHORIZATION.tenantId,
          nome: "Isolated PostgreSQL Selvara Tenant",
          codice: "PG-SELVARA-RECOVERY",
        },
      });
      await prisma.procedimento.create({
        data: {
          id: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
          enteId: SELVARA_PILOT_AUTHORIZATION.tenantId,
          tipologia: "ALTRO",
          stato: "DA_AVVIARE",
        },
      });
      await prisma.asyncJob.create({
        data: {
          id: applicationJobId,
          idempotencyKey: "selvara-recovery-postgres".padEnd(64, "0"),
          requestFingerprint: "selvara-recovery-postgres".padEnd(64, "1"),
          operation: SELVARA_PILOT_AUTHORIZATION.operation,
          logicalOperationId: "isolated-postgres-selvara-recovery",
          purpose: SELVARA_PILOT_AUTHORIZATION.purpose,
          correlationId: "isolated-postgres-selvara-recovery",
          inputReference: {
            referenceType: "FASCICOLO_DOCUMENT_CORPUS",
            referenceId: SELVARA_PILOT_AUTHORIZATION.corpusFingerprint,
            referenceVersion: "V1",
            metadata: {
              procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
              corpusHash: SELVARA_PILOT_AUTHORIZATION.corpusFingerprint,
            },
          },
          admissionType: "AUTHENTICATED_USER",
          tenantId: SELVARA_PILOT_AUTHORIZATION.tenantId,
          procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
          initiatingUserId: userId,
          actorId: userId,
          actorEmail: "postgres-activation@example.test",
          actorRole: "ADMIN",
          status: "QUEUED",
          maxAttempts: 3,
          availableAt: new Date(0),
        },
      });
      const reservation = await activationPersistence.beginDocumentAnalysisActivation(target);
      expect(reservation.outcome).toBe("RESERVED");
      if (reservation.outcome !== "RESERVED") throw new Error("reservation failed");
      await activationPersistence.completeDocumentAnalysisActivation({
        target,
        activationAttemptId: reservation.snapshot.activationAttemptId,
        state: "CONFIRMED",
        renderJobId: recovery.renderJobId,
      });

      const results = await Promise.allSettled([
        activationPersistence.recoverSelvaraFailedDocumentAnalysisActivation({
          actor: {
            userId,
            userEmail: "postgres-activation@example.test",
            userRole: "ADMIN",
          },
        }),
        activationPersistence.recoverSelvaraFailedDocumentAnalysisActivation({
          actor: {
            userId,
            userEmail: "postgres-activation@example.test",
            userRole: "ADMIN",
          },
        }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const ledger = await prisma.activityLog.findMany({
        where: { entita: "AsyncJob", entitaId: applicationJobId },
        orderBy: { createdAt: "asc" },
        select: { azione: true, metadata: true },
      });
      expect(ledger.map((entry) => entry.azione)).toEqual([
        "DOCUMENT_ANALYSIS_ACTIVATION_REQUESTING",
        "DOCUMENT_ANALYSIS_ACTIVATION_CONFIRMED",
        "DOCUMENT_ANALYSIS_ACTIVATION_NOT_REQUESTED",
      ]);
      expect(ledger.map((entry) => (
        entry.metadata as { activationSequence: number }
      ).activationSequence)).toEqual([1, 2, 3]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await prisma.activityLog.deleteMany({
        where: { entita: "AsyncJob", entitaId: applicationJobId },
      });
      await prisma.asyncJob.deleteMany({ where: { id: applicationJobId } });
      await prisma.procedimento.deleteMany({
        where: { id: SELVARA_PILOT_AUTHORIZATION.procedimentoId },
      });
      await prisma.ente.deleteMany({
        where: { id: SELVARA_PILOT_AUTHORIZATION.tenantId },
      });
    }
  });

  it("does not let a stale response overwrite a reconciled state", async () => {
    const applicationJobId = "pg-analysis-stale";
    await createAnalysisJob({ id: applicationJobId });
    let releaseFetch!: () => void;
    const fetch = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseFetch = resolve;
      });
      return new Response(
        JSON.stringify({ id: "job-postgresstale" }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });
    const pending = activation.requestDocumentWorkerActivation(target(applicationJobId), {
      environment,
      fetch,
      report: vi.fn(),
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await activationPersistence.reconcileDocumentAnalysisActivation({
      target: {
        applicationJobId,
        tenantId: tenantOne,
        procedimentoId: procedureOne,
      },
      state: "FAILED_VERIFIED",
      failureCode: "RECONCILED_NO_REMOTE_JOB",
    });
    releaseFetch();

    await expect(pending).resolves.toMatchObject({
      outcome: "DEFERRED",
      errorCode: "ACTIVATION_PERSISTENCE_FAILED",
    });
    await expect(
      activationPersistence.readDocumentAnalysisActivation(applicationJobId),
    ).resolves.toMatchObject({
      state: "FAILED_VERIFIED",
      failureCode: "RECONCILED_NO_REMOTE_JOB",
    });
  });

  it("does not repeat a POST after an uncertain remote outcome", async () => {
    const applicationJobId = "pg-analysis-unknown";
    await createAnalysisJob({ id: applicationJobId });
    const fetch = vi.fn(async () => {
      throw new TypeError("local simulated connection reset");
    });

    await expect(activation.requestDocumentWorkerActivation(target(applicationJobId), {
      environment,
      fetch,
      report: vi.fn(),
    })).resolves.toMatchObject({ outcome: "DEFERRED", errorCode: "REQUEST_FAILED" });
    await expect(activation.activateDocumentWorker(target(applicationJobId), {
      environment,
      fetch,
    })).resolves.toMatchObject({
      outcome: "ALREADY_REQUESTED",
      activationState: "REMOTE_UNKNOWN",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("claims only the requested job and never crosses tenant scope", async () => {
    const previousId = "pg-analysis-previous";
    const requestedId = "pg-analysis-requested";
    const otherTenantId = "pg-analysis-other-tenant";
    await createAnalysisJob({ id: previousId });
    await createAnalysisJob({ id: requestedId });
    await createAnalysisJob({
      id: otherTenantId,
      tenantId: tenantTwo,
      procedimentoId: procedureTwo,
    });

    await expect(persistence.claimAsyncJobById({
      jobId: requestedId,
      expectedOperation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
      expectedTenantId: tenantOne,
      expectedProcedimentoId: procedureOne,
      workerId: "pg-target-worker",
      leaseDurationMs: 60_000,
    })).resolves.toMatchObject({ id: requestedId, tenantId: tenantOne, status: "RUNNING" });

    await expect(persistence.claimAsyncJobById({
      jobId: otherTenantId,
      expectedOperation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
      expectedTenantId: tenantOne,
      expectedProcedimentoId: procedureOne,
      workerId: "pg-target-worker",
      leaseDurationMs: 60_000,
    })).resolves.toBeNull();

    const jobs = await prisma.asyncJob.findMany({
      where: { id: { in: [previousId, requestedId, otherTenantId] } },
      orderBy: { id: "asc" },
      select: { id: true, status: true, tenantId: true },
    });
    expect(jobs).toEqual([
      { id: otherTenantId, status: "QUEUED", tenantId: tenantTwo },
      { id: previousId, status: "QUEUED", tenantId: tenantOne },
      { id: requestedId, status: "RUNNING", tenantId: tenantOne },
    ]);
  });
});
