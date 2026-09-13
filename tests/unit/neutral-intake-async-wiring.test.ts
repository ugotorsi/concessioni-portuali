import { beforeEach, describe, expect, it, vi } from "vitest";

const worker = vi.hoisted(() => ({ drainOneAsyncJob: vi.fn() }));

vi.mock("@/server/async-jobs/worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/async-jobs/worker")>();
  return { ...actual, drainOneAsyncJob: worker.drainOneAsyncJob };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    asyncJob: { findUnique: vi.fn() },
    neutralIntake: { findUnique: vi.fn() },
  },
}));

import {
  applicationAsyncJobRegistry,
  drainOneApplicationAsyncJob,
} from "@/server/async-jobs/applicationWorker";
import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import {
  buildNeutralIntakeExtractionAdmission,
  createNeutralIntakeExtractionHandler,
  NEUTRAL_INTAKE_EXTRACTION_OPERATION,
  type NeutralIntakeExtractionHandlerDependencies,
} from "@/server/intake/neutralIntakeExtractionJob";

const reference = {
  referenceType: "NEUTRAL_INTAKE",
  referenceId: "intake-1",
  referenceVersion: "V1",
  metadata: {},
} as const;

function context() {
  return {
    jobId: "job-1",
    correlationId: "correlation-1",
    attempt: 1,
    isCancellationRequested: vi.fn(async () => false),
    heartbeat: vi.fn(async () => undefined),
  };
}

function dependencies(overrides: Partial<NeutralIntakeExtractionHandlerDependencies> = {}) {
  return {
    loadAuthority: vi.fn(async () => ({
      job: { operation: NEUTRAL_INTAKE_EXTRACTION_OPERATION, tenantId: "ente-1" },
      intake: { id: "intake-1", enteId: "ente-1", status: "RECEIVED" },
    })),
    extract: vi.fn(async () => ({
      outcome: "SUCCEEDED" as const,
      attempt: { id: "attempt-1" },
    })),
    ensureClassification: vi.fn(async () => ({ outcome: "CREATED" as const, job: { id: "classification-job-1" } })),
    ...overrides,
  } as NeutralIntakeExtractionHandlerDependencies;
}

describe("B2C9 Block 3B.2C NeutralIntake async extraction wiring", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers the server-owned extraction operation in the application registry", () => {
    expect(applicationAsyncJobRegistry.resolve(NEUTRAL_INTAKE_EXTRACTION_OPERATION)).not.toBeNull();
    expect(applicationAsyncJobRegistry.resolve("UNKNOWN.OPERATION")).toBeNull();
  });

  it("builds deterministic authenticated admission while preserving a distinct receipt actor", () => {
    const admission = buildNeutralIntakeExtractionAdmission({
      id: "intake-1",
      idempotencyKey: "a".repeat(64),
      enteId: "ente-1",
      receivedByUserId: "user-1",
      receivedByActorId: "provider-actor-1",
      receivedByRole: "ADMIN",
      initiatingUserRole: "TECNICO",
      receivedAt: new Date("2026-09-13T10:00:00.000Z"),
    });
    const normalized = normalizeAsyncJobAdmission(admission);
    expect(normalized.admission).toMatchObject({
      admissionType: "AUTHENTICATED_USER",
      tenantId: "ente-1",
      initiatingUserId: "user-1",
      actor: { actorId: "user-1", actorRole: "TECNICO" },
    });
    expect(normalized.inputReference.metadata).toEqual({
      receivedActorId: "provider-actor-1",
      receivedActorRoleCode: "ADMIN",
    });
    expect(normalizeAsyncJobAdmission(admission).idempotencyKey).toBe(normalized.idempotencyKey);
  });

  it("keeps the same authenticated actor snapshot when user and receipt actor are identical", () => {
    const normalized = normalizeAsyncJobAdmission(buildNeutralIntakeExtractionAdmission({
      id: "intake-1",
      idempotencyKey: "a".repeat(64),
      enteId: "ente-1",
      receivedByUserId: "user-1",
      receivedByActorId: "user-1",
      receivedByRole: "GIURIDICO",
      initiatingUserRole: "GIURIDICO",
      receivedAt: new Date("2026-09-13T10:00:00.000Z"),
    }));
    expect(normalized.admission.actor).toMatchObject({ actorId: "user-1", actorRole: "GIURIDICO" });
    expect(normalized.inputReference.metadata).toEqual({});
  });

  it("rejects malformed or expanded payloads", () => {
    const handler = createNeutralIntakeExtractionHandler(dependencies());
    expect(() => handler.parseInput({ ...reference, text: "forbidden" })).toThrow();
    expect(() => handler.parseInput({ ...reference, referenceId: "" })).toThrow();
  });

  it.each([
    ["missing intake", { job: { operation: NEUTRAL_INTAKE_EXTRACTION_OPERATION, tenantId: "ente-1" }, intake: null }],
    ["tenant mismatch", { job: { operation: NEUTRAL_INTAKE_EXTRACTION_OPERATION, tenantId: "ente-2" }, intake: { id: "intake-1", enteId: "ente-1", status: "RECEIVED" } }],
    ["wrong operation", { job: { operation: "OTHER_OPERATION", tenantId: "ente-1" }, intake: { id: "intake-1", enteId: "ente-1", status: "RECEIVED" } }],
  ])("fails closed for %s", async (_case, authority) => {
    const deps = dependencies({ loadAuthority: vi.fn(async () => authority) });
    const handler = createNeutralIntakeExtractionHandler(deps);
    await expect(handler.execute(handler.parseInput(reference), context()))
      .rejects.toMatchObject({ code: "NEUTRAL_INTAKE_AUTHORITY_MISMATCH", retryable: false });
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it("calls the existing extractor once and returns bounded reference metadata", async () => {
    const deps = dependencies();
    deps.loadAuthority = vi.fn()
      .mockResolvedValueOnce({
        job: { operation: NEUTRAL_INTAKE_EXTRACTION_OPERATION, tenantId: "ente-1" },
        intake: { id: "intake-1", enteId: "ente-1", status: "RECEIVED" },
      })
      .mockResolvedValueOnce({
        job: { operation: NEUTRAL_INTAKE_EXTRACTION_OPERATION, tenantId: "ente-1" },
        intake: { id: "intake-1", enteId: "ente-1", status: "EVIDENCE_READY" },
      });
    const handlerContext = context();
    const result = await createNeutralIntakeExtractionHandler(deps)
      .execute(reference, handlerContext);
    expect(deps.extract).toHaveBeenCalledOnce();
    expect(deps.extract).toHaveBeenCalledWith("intake-1");
    expect(deps.ensureClassification).toHaveBeenCalledWith({
      sourceJobId: "job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "attempt-1",
    });
    expect(handlerContext.heartbeat).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      referenceType: "NEUTRAL_INTAKE_EXTRACTION",
      referenceId: "intake-1",
      referenceVersion: "V1",
      metadata: { statusCode: "EVIDENCE_READY" },
    });
    expect(JSON.stringify(result)).not.toMatch(/text|body|bytes|ocr/i);
  });

  it("treats an already evidence-ready intake as completed without another extraction attempt", async () => {
    const deps = dependencies({
      loadAuthority: vi.fn(async () => ({
        job: { operation: NEUTRAL_INTAKE_EXTRACTION_OPERATION, tenantId: "ente-1" },
        intake: { id: "intake-1", enteId: "ente-1", status: "EVIDENCE_READY" },
      })),
    });
    await expect(createNeutralIntakeExtractionHandler(deps).execute(reference, context()))
      .resolves.toMatchObject({ metadata: { statusCode: "EVIDENCE_READY" } });
    expect(deps.extract).not.toHaveBeenCalled();
    expect(deps.ensureClassification).toHaveBeenCalledWith({
      sourceJobId: "job-1",
      neutralIntakeId: "intake-1",
    });
  });

  it("makes classification admission failure retryable for crash-window recovery", async () => {
    const deps = dependencies({
      loadAuthority: vi.fn(async () => ({
        job: { operation: NEUTRAL_INTAKE_EXTRACTION_OPERATION, tenantId: "ente-1" },
        intake: { id: "intake-1", enteId: "ente-1", status: "EVIDENCE_READY" },
      })),
      ensureClassification: vi.fn(async () => { throw new Error("transient persistence failure"); }),
    });
    await expect(createNeutralIntakeExtractionHandler(deps).execute(reference, context()))
      .rejects.toEqual(new AsyncJobExecutionError(
        "CLASSIFICATION_ADMISSION",
        "CLASSIFICATION_ADMISSION_FAILED",
        true,
      ));
  });

  it("maps persisted extraction failures to terminal async failures", async () => {
    const deps = dependencies({
      extract: vi.fn(async () => ({
        outcome: "FAILED" as const,
        failureCode: "OCR_TIMEOUT" as const,
        attempt: { id: "attempt-1" },
      })),
    });
    const handler = createNeutralIntakeExtractionHandler(deps);
    await expect(handler.execute(reference, context()))
      .rejects.toEqual(new AsyncJobExecutionError("EXTRACTION", "OCR_TIMEOUT", false));
  });

  it("does not start extraction after cancellation is observed", async () => {
    const deps = dependencies();
    const handlerContext = context();
    handlerContext.isCancellationRequested.mockResolvedValueOnce(true);
    await expect(createNeutralIntakeExtractionHandler(deps).execute(reference, handlerContext))
      .rejects.toMatchObject({ code: "CANCELLATION_REQUESTED", retryable: false });
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it("delegates application draining to the generic worker with the application registry", async () => {
    worker.drainOneAsyncJob.mockResolvedValueOnce({ outcome: "IDLE" });
    await expect(drainOneApplicationAsyncJob({ workerId: "worker-1", retryDelayMs: 1_000 }))
      .resolves.toEqual({ outcome: "IDLE" });
    expect(worker.drainOneAsyncJob).toHaveBeenCalledWith({
      workerId: "worker-1",
      retryDelayMs: 1_000,
      leaseDurationMs: 300_000,
      registry: applicationAsyncJobRegistry,
    });
  });

  it("renews the five-minute lease every minute while extraction remains pending", async () => {
    vi.useFakeTimers();
    try {
      let completeExtraction!: (value: { outcome: "SUCCEEDED"; attempt: { id: string } }) => void;
      const extraction = new Promise<{ outcome: "SUCCEEDED"; attempt: { id: string } }>((resolve) => {
        completeExtraction = resolve;
      });
      const deps = dependencies({
        loadAuthority: vi.fn()
          .mockResolvedValueOnce({
            job: { operation: NEUTRAL_INTAKE_EXTRACTION_OPERATION, tenantId: "ente-1" },
            intake: { id: "intake-1", enteId: "ente-1", status: "RECEIVED" },
          })
          .mockResolvedValueOnce({
            job: { operation: NEUTRAL_INTAKE_EXTRACTION_OPERATION, tenantId: "ente-1" },
            intake: { id: "intake-1", enteId: "ente-1", status: "EVIDENCE_READY" },
          }),
        extract: vi.fn(() => extraction),
      });
      const handlerContext = context();
      const execution = createNeutralIntakeExtractionHandler(deps).execute(reference, handlerContext);
      await vi.advanceTimersByTimeAsync(0);
      expect(handlerContext.heartbeat).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(handlerContext.heartbeat).toHaveBeenCalledTimes(3);
      completeExtraction({ outcome: "SUCCEEDED", attempt: { id: "attempt-1" } });
      await expect(execution).resolves.toMatchObject({ metadata: { statusCode: "EVIDENCE_READY" } });
      expect(handlerContext.heartbeat).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});