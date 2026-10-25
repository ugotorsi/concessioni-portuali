import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
