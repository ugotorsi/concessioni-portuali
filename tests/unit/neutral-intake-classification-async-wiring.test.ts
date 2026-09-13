import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  classify: vi.fn(),
  markFailed: vi.fn(),
  runTransaction: vi.fn(),
  prisma: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  },
  tx: {
    asyncJob: { findUnique: vi.fn(), create: vi.fn() },
    neutralIntake: { findUnique: vi.fn() },
    neutralIntakeExtractionAttempt: { findFirst: vi.fn() },
    neutralIntakeClassificationAttempt: { findFirst: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: mocks.audit,
}));

vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: mocks.runTransaction,
}));

vi.mock("@/server/intake/classification/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/intake/classification/service")>();
  return {
    ...actual,
    classifyNeutralIntakeInTransaction: mocks.classify,
    markClassificationExecutionFailedInTransaction: mocks.markFailed,
  };
});

import { applicationAsyncJobRegistry } from "@/server/async-jobs/applicationWorker";
import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import { failAsyncJob } from "@/server/async-jobs/persistence";
import { AsyncJobHandlerRegistry } from "@/server/async-jobs/registry";
import { AsyncJobExecutionError, drainOneAsyncJob } from "@/server/async-jobs/worker";
import { NEUTRAL_INTAKE_CLASSIFIER_VERSION } from "@/server/intake/classification/classifier";
import {
  NeutralIntakeClassificationExecutionError,
} from "@/server/intake/classification/service";
import {
  buildNeutralIntakeClassificationAdmission,
  createNeutralIntakeClassificationHandler,
  ensureNeutralIntakeClassificationJobInTransaction,
  executeBoundClassification,
  NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
} from "@/server/intake/neutralIntakeClassificationJob";

const normalizedText = "REGOLAMENTO GENERALE DEL PORTO\nARTICOLO 1\nARTICOLO 2\nARTICOLO 3";

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: "extraction-1",
    neutralIntakeId: "intake-1",
    policyVersion: "B2C9_EXTRACTION_POLICY_V1",
    artifactSha256: "a".repeat(64),
    warnings: [],
    pages: [{
      pageNumber: 1,
      normalizedText,
      textSha256: "b".repeat(64),
      normalizedCharacterCount: normalizedText.length,
      ocrConfidence: null,
      warnings: [],
    }],
    ...overrides,
  };
}

const provenance = {
  tenantId: "ente-1",
  admissionType: "AUTHENTICATED_USER" as const,
  initiatingUserId: "user-1",
  actorId: "user-1",
  actorEmail: "user@example.test",
  actorRole: "GIURIDICO",
  policyDecisionRef: null,
  correlationId: "intake-correlation-1",
};

function context() {
  return {
    jobId: "classification-job-1",
    correlationId: provenance.correlationId,
    attempt: 1,
    isCancellationRequested: vi.fn(async () => false),
    heartbeat: vi.fn(async () => undefined),
  };
}

function parsedReference() {
  const admission = buildNeutralIntakeClassificationAdmission(evidence(), provenance);
  return createNeutralIntakeClassificationHandler().parseInput(admission.inputReference);
}

function decision(outcome: "LEGAL_SOURCE_CANDIDATE" | "CASE_DOCUMENT" | "UNCERTAIN_REVIEW_REQUIRED") {
  const reference = parsedReference();
  return {
    id: "classification-1",
    extractionAttemptId: "extraction-1",
    evidenceHash: reference.metadata.evidenceHash,
    classifierVersion: NEUTRAL_INTAKE_CLASSIFIER_VERSION,
    outcome,
    reviewRequired: outcome === "UNCERTAIN_REVIEW_REQUIRED",
  };
}

describe("B2C9 Block 3B.3B async classification wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTransaction.mockImplementation(async (callback) => callback(mocks.tx));
    mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
      tenantId: "ente-1",
    });
    mocks.tx.neutralIntake.findUnique.mockResolvedValue({ id: "intake-1", enteId: "ente-1" });
    mocks.tx.neutralIntakeExtractionAttempt.findFirst.mockResolvedValue({
      id: "extraction-1",
      neutralIntakeId: "intake-1",
      policyVersion: "B2C9_EXTRACTION_POLICY_V1",
      artifactSha256: "a".repeat(64),
      completedAt: new Date("2026-09-13T10:00:00.000Z"),
      warnings: [],
      pages: evidence().pages,
    });
    mocks.tx.neutralIntakeClassificationAttempt.findFirst.mockResolvedValue(null);
    mocks.markFailed.mockResolvedValue(undefined);
  });

  it("registers the closed classification operation in the existing application registry", () => {
    expect(applicationAsyncJobRegistry.resolve(NEUTRAL_INTAKE_CLASSIFICATION_OPERATION)).not.toBeNull();
  });

  it("admits identical effective evidence deterministically and distinguishes changed evidence", () => {
    const first = normalizeAsyncJobAdmission(buildNeutralIntakeClassificationAdmission(evidence(), provenance));
    const equivalentRetry = normalizeAsyncJobAdmission(buildNeutralIntakeClassificationAdmission(
      evidence({ attemptId: "extraction-retry-2" }),
      provenance,
    ));
    const changed = normalizeAsyncJobAdmission(buildNeutralIntakeClassificationAdmission(
      evidence({ pages: [{ ...evidence().pages[0], normalizedText: `${normalizedText}\nCHANGED` }] }),
      provenance,
    ));

    expect(first.idempotencyKey).toBe(equivalentRetry.idempotencyKey);
    expect(first.requestFingerprint).toBe(equivalentRetry.requestFingerprint);
    expect(first.idempotencyKey).not.toBe(changed.idempotencyKey);
    expect(first.inputReference).toEqual({
      referenceType: "NEUTRAL_INTAKE_CLASSIFICATION",
      referenceId: "intake-1",
      referenceVersion: "V1",
      metadata: {
        evidenceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        classifierVersion: NEUTRAL_INTAKE_CLASSIFIER_VERSION,
      },
    });
    expect(JSON.stringify(first.inputReference)).not.toContain(normalizedText);
    expect(first.maxAttempts).toBe(2);
  });

  it("ensures one persisted classification job for repeated identical evidence", async () => {
    const sourceJob = {
      operation: "NEUTRAL_INTAKE_EXTRACTION_V1",
      tenantId: "ente-1",
      admissionType: "AUTHENTICATED_USER",
      initiatingUserId: "user-1",
      actorId: "user-1",
      actorEmail: "user@example.test",
      actorRole: "GIURIDICO",
      policyDecisionRef: null,
      correlationId: provenance.correlationId,
    };
    let createdJob: Record<string, unknown> | null = null;
    mocks.tx.asyncJob.findUnique
      .mockResolvedValueOnce(sourceJob)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sourceJob)
      .mockImplementationOnce(async () => createdJob);
    mocks.tx.neutralIntake.findUnique.mockResolvedValue({
      id: "intake-1",
      enteId: "ente-1",
      status: "EVIDENCE_READY",
    });
    mocks.tx.asyncJob.create.mockImplementationOnce(async ({ data }) => {
      createdJob = { id: "classification-job-1", ...data };
      return createdJob;
    });

    const input = {
      sourceJobId: "extraction-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    };
    await expect(ensureNeutralIntakeClassificationJobInTransaction(mocks.tx as never, input))
      .resolves.toMatchObject({ outcome: "CREATED" });
    await expect(ensureNeutralIntakeClassificationJobInTransaction(mocks.tx as never, input))
      .resolves.toMatchObject({ outcome: "REUSED" });
    expect(mocks.tx.asyncJob.create).toHaveBeenCalledOnce();
  });

  it.each([
    ["LEGAL_SOURCE_CANDIDATE", false],
    ["CASE_DOCUMENT", false],
    ["UNCERTAIN_REVIEW_REQUIRED", true],
  ] as const)("completes %s as bounded async success", async (outcome, reviewRequired) => {
    mocks.classify.mockResolvedValueOnce(decision(outcome));
    const result = await executeBoundClassification(parsedReference(), context());
    expect(result).toMatchObject({
      referenceType: "NEUTRAL_INTAKE_CLASSIFICATION_RESULT",
      referenceId: "classification-1",
      referenceVersion: NEUTRAL_INTAKE_CLASSIFIER_VERSION,
      metadata: { outcomeCode: outcome, evidenceHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    expect(result).not.toHaveProperty("metadata.reviewRequired");
    expect(JSON.stringify(result)).not.toMatch(/normalizedText|pageText|ocrBytes/);
    expect(mocks.classify).toHaveBeenCalledWith(mocks.tx, "intake-1");
    expect(reviewRequired).toBe(outcome === "UNCERTAIN_REVIEW_REQUIRED");
  });

  it.each([
    "LEGAL_SOURCE_CANDIDATE",
    "CASE_DOCUMENT",
    "UNCERTAIN_REVIEW_REQUIRED",
  ] as const)("persists %s through the real generic worker success boundary", async (outcome) => {
    const reference = parsedReference();
    const result = {
      referenceType: "NEUTRAL_INTAKE_CLASSIFICATION_RESULT",
      referenceId: "classification-1",
      referenceVersion: NEUTRAL_INTAKE_CLASSIFIER_VERSION,
      metadata: { outcomeCode: outcome, evidenceHash: reference.metadata.evidenceHash },
    };
    const claimed = {
      id: "classification-job-1",
      operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
      correlationId: provenance.correlationId,
      attemptCount: 1,
      leaseToken: "c".repeat(64),
      inputReference: reference,
    };
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: "RUNNING" }]);
    mocks.prisma.$executeRaw.mockResolvedValue(1);
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([claimed]);
    mocks.tx.$executeRaw.mockResolvedValue(0);
    const registry = new AsyncJobHandlerRegistry([
      createNeutralIntakeClassificationHandler({ executeBound: vi.fn(async () => result) as never }),
    ]);
    await expect(drainOneAsyncJob({
      workerId: "worker-1",
      leaseDurationMs: 60_000,
      retryDelayMs: 1_000,
      registry,
    })).resolves.toEqual({ outcome: "SUCCEEDED", jobId: "classification-job-1" });
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledOnce();
  });

  it("recovers a persisted decision after generic success finalization fails", async () => {
    const existing = decision("LEGAL_SOURCE_CANDIDATE");
    const reference = parsedReference();
    const claimed = {
      id: "classification-job-1",
      operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
      correlationId: provenance.correlationId,
      attemptCount: 1,
      leaseToken: "c".repeat(64),
      inputReference: reference,
    };
    mocks.classify.mockResolvedValueOnce(existing);
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: "RUNNING" }]);
    mocks.prisma.$executeRaw.mockRejectedValueOnce(new Error("SUCCESS_FINALIZATION_UNAVAILABLE"));
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([claimed]);
    mocks.tx.$executeRaw.mockResolvedValue(0);

    await expect(drainOneAsyncJob({
      workerId: "worker-1",
      leaseDurationMs: 60_000,
      retryDelayMs: 1_000,
      registry: new AsyncJobHandlerRegistry([createNeutralIntakeClassificationHandler()]),
    })).rejects.toThrow("SUCCESS_FINALIZATION_UNAVAILABLE");
    expect(mocks.markFailed).not.toHaveBeenCalled();

    mocks.tx.neutralIntake.findUnique.mockResolvedValueOnce({
      id: "intake-1", enteId: "ente-1", status: "EVIDENCE_READY", statusVersion: 5,
    });
    mocks.tx.neutralIntakeClassificationAttempt.findFirst.mockResolvedValueOnce(existing);
    await expect(createNeutralIntakeClassificationHandler()
      .beforeTerminalFailureInTransaction!(mocks.tx as never, {
        jobId: "classification-job-1",
        operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
        tenantId: "ente-1",
        correlationId: provenance.correlationId,
        inputReference: reference,
        attempt: 2,
        maxAttempts: 2,
        failure: { retryable: true, category: "CRASH_RECOVERY", code: "RETRY_EXHAUSTED" },
      })).resolves.toMatchObject({ outcome: "SUCCEEDED", resultReference: { referenceId: existing.id } });
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("maps pre-classification infrastructure failure to bounded retry", async () => {
    mocks.runTransaction.mockRejectedValueOnce(new Error("DATABASE_UNAVAILABLE"));
    await expect(executeBoundClassification(parsedReference(), context()))
      .rejects.toEqual(new AsyncJobExecutionError(
        "CLASSIFICATION_INFRASTRUCTURE",
        "CLASSIFICATION_INFRASTRUCTURE_FAILURE",
        true,
      ));
  });

  it("commits FAILED_CLASSIFICATION and reports genuine execution failure as terminal", async () => {
    mocks.classify.mockRejectedValueOnce(
      new NeutralIntakeClassificationExecutionError("intake-1", 4),
    );
    await expect(executeBoundClassification(parsedReference(), context()))
      .rejects.toEqual(new AsyncJobExecutionError("CLASSIFICATION", "CLASSIFICATION_EXECUTION_FAILED", false));
    expect(mocks.markFailed).toHaveBeenCalledWith(mocks.tx, "intake-1", 4);
  });

  it("fails closed before classification when current effective evidence differs from the job", async () => {
    mocks.tx.neutralIntakeExtractionAttempt.findFirst.mockResolvedValueOnce({
      ...(await mocks.tx.neutralIntakeExtractionAttempt.findFirst()),
      pages: [{ ...evidence().pages[0], normalizedText: "different evidence" }],
    });
    await expect(executeBoundClassification(parsedReference(), context()))
      .rejects.toMatchObject({ code: "CLASSIFICATION_EVIDENCE_MISMATCH", retryable: false });
    expect(mocks.classify).not.toHaveBeenCalled();
  });

  it("repeated identical execution returns the same effective persisted decision", async () => {
    const existing = decision("CASE_DOCUMENT");
    mocks.classify.mockResolvedValue(existing);
    const reference = parsedReference();
    const first = await executeBoundClassification(reference, context());
    const repeated = await executeBoundClassification(reference, context());
    expect(repeated).toEqual(first);
  });

  it("atomically establishes FAILED_CLASSIFICATION with final async failure", async () => {
    const handler = createNeutralIntakeClassificationHandler();
    const reference = parsedReference();
    mocks.tx.$queryRaw.mockResolvedValueOnce([{
      id: "classification-job-1",
      operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
      tenantId: "ente-1",
      correlationId: provenance.correlationId,
      inputReference: reference,
      attemptCount: 2,
      maxAttempts: 2,
    }]);
    mocks.tx.$executeRaw.mockResolvedValueOnce(1);
    mocks.tx.neutralIntake.findUnique
      .mockResolvedValueOnce({ id: "intake-1", enteId: "ente-1", status: "EVIDENCE_READY", statusVersion: 4 })
      .mockResolvedValueOnce({ status: "FAILED_CLASSIFICATION" });
    const resolution = await failAsyncJob({
      jobId: "classification-job-1",
      workerId: "worker-1",
      leaseToken: "c".repeat(64),
      failure: { retryable: true, category: "CLASSIFICATION_INFRASTRUCTURE", code: "CLASSIFICATION_INFRASTRUCTURE_FAILURE" },
      retryDelayMs: 1_000,
      beforeTerminalFailureInTransaction: handler.beforeTerminalFailureInTransaction,
    });
    expect(resolution).toEqual({ outcome: "TERMINAL_FAILED" });
    expect(mocks.markFailed).toHaveBeenCalledWith(mocks.tx, "intake-1", 4);
  });

  it.each([
    ["EVIDENCE_READY", "LEGAL_SOURCE_CANDIDATE"],
    ["REVIEW_REQUIRED", "UNCERTAIN_REVIEW_REQUIRED"],
  ] as const)("recovers an existing %s decision as async success", async (status, outcome) => {
    const existing = decision(outcome);
    mocks.tx.neutralIntake.findUnique.mockResolvedValueOnce({
      id: "intake-1", enteId: "ente-1", status, statusVersion: 5,
    });
    mocks.tx.neutralIntakeClassificationAttempt.findFirst.mockResolvedValueOnce(existing);
    const resolution = await createNeutralIntakeClassificationHandler()
      .beforeTerminalFailureInTransaction!(mocks.tx as never, {
        jobId: "classification-job-1",
        operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
        tenantId: "ente-1",
        correlationId: provenance.correlationId,
        inputReference: parsedReference(),
        attempt: 2,
        maxAttempts: 2,
        failure: { retryable: true, category: "CRASH_RECOVERY", code: "RETRY_EXHAUSTED" },
      });
    expect(resolution).toMatchObject({ outcome: "SUCCEEDED", resultReference: { referenceId: existing.id } });
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("does not reclassify an existing FAILED_CLASSIFICATION intake", async () => {
    mocks.tx.neutralIntake.findUnique.mockResolvedValueOnce({
      id: "intake-1", enteId: "ente-1", status: "FAILED_CLASSIFICATION", statusVersion: 5,
    });
    await expect(createNeutralIntakeClassificationHandler()
      .beforeTerminalFailureInTransaction!(mocks.tx as never, {
        jobId: "classification-job-1",
        operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
        tenantId: "ente-1",
        correlationId: provenance.correlationId,
        inputReference: parsedReference(),
        attempt: 2,
        maxAttempts: 2,
        failure: { retryable: false, category: "CLASSIFICATION", code: "CLASSIFICATION_EXECUTION_FAILED" },
      })).resolves.toEqual({ outcome: "TERMINAL_FAILED" });
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("rolls back terminal resolution when the domain failure transition fails", async () => {
    const transitionFailure = new Error("DOMAIN_TRANSITION_UNAVAILABLE");
    mocks.tx.neutralIntake.findUnique.mockResolvedValueOnce({
      id: "intake-1", enteId: "ente-1", status: "EVIDENCE_READY", statusVersion: 4,
    });
    mocks.markFailed.mockRejectedValueOnce(transitionFailure);
    await expect(createNeutralIntakeClassificationHandler()
      .beforeTerminalFailureInTransaction!(mocks.tx as never, {
        jobId: "classification-job-1",
        operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
        tenantId: "ente-1",
        correlationId: provenance.correlationId,
        inputReference: parsedReference(),
        attempt: 2,
        maxAttempts: 2,
        failure: { retryable: true, category: "CLASSIFICATION_INFRASTRUCTURE", code: "CLASSIFICATION_INFRASTRUCTURE_FAILURE" },
      })).rejects.toBe(transitionFailure);
  });

  it("does not fail newer unmatched evidence", async () => {
    mocks.tx.neutralIntake.findUnique.mockResolvedValueOnce({
      id: "intake-1", enteId: "ente-1", status: "EVIDENCE_READY", statusVersion: 6,
    });
    mocks.tx.neutralIntakeExtractionAttempt.findFirst.mockResolvedValueOnce({
      id: "extraction-2",
      neutralIntakeId: "intake-1",
      policyVersion: "B2C9_EXTRACTION_POLICY_V1",
      artifactSha256: "a".repeat(64),
      completedAt: new Date("2026-09-13T11:00:00.000Z"),
      warnings: [],
      pages: [{ ...evidence().pages[0], normalizedText: "newer different evidence" }],
    });
    await expect(createNeutralIntakeClassificationHandler()
      .beforeTerminalFailureInTransaction!(mocks.tx as never, {
        jobId: "classification-job-1",
        operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
        tenantId: "ente-1",
        correlationId: provenance.correlationId,
        inputReference: parsedReference(),
        attempt: 2,
        maxAttempts: 2,
        failure: { retryable: false, category: "CLASSIFICATION", code: "CLASSIFICATION_EVIDENCE_MISMATCH" },
      })).rejects.toMatchObject({ code: "CLASSIFICATION_TERMINAL_EVIDENCE_MISMATCH" });
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("allows stale-job terminalization only after newer evidence has a decision", async () => {
    mocks.tx.neutralIntake.findUnique.mockResolvedValueOnce({
      id: "intake-1", enteId: "ente-1", status: "REVIEW_REQUIRED", statusVersion: 7,
    });
    mocks.tx.neutralIntakeExtractionAttempt.findFirst.mockResolvedValueOnce({
      id: "extraction-2",
      neutralIntakeId: "intake-1",
      policyVersion: "B2C9_EXTRACTION_POLICY_V1",
      artifactSha256: "a".repeat(64),
      completedAt: new Date("2026-09-13T11:00:00.000Z"),
      warnings: [],
      pages: [{ ...evidence().pages[0], normalizedText: "newer classified evidence" }],
    });
    mocks.tx.neutralIntakeClassificationAttempt.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(decision("UNCERTAIN_REVIEW_REQUIRED"));
    await expect(createNeutralIntakeClassificationHandler()
      .beforeTerminalFailureInTransaction!(mocks.tx as never, {
        jobId: "classification-job-1",
        operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
        tenantId: "ente-1",
        correlationId: provenance.correlationId,
        inputReference: parsedReference(),
        attempt: 2,
        maxAttempts: 2,
        failure: { retryable: false, category: "CLASSIFICATION", code: "CLASSIFICATION_EVIDENCE_MISMATCH" },
      })).resolves.toEqual({ outcome: "TERMINAL_FAILED" });
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("contains no routing, destination persistence, or external provider invocation", () => {
    const source = readFileSync(path.join(
      process.cwd(),
      "src/server/intake/neutralIntakeClassificationJob.ts",
    ), "utf8");
    expect(source).not.toMatch(/status:\s*["']ROUTED["']/);
    expect(source).not.toMatch(/legalSource\.(?:create|update)|documento\.(?:create|update)|NormaFonte/);
    expect(source).not.toMatch(/OpenAI|AiOutbound|fascicoloOutbound|Simpliciter|official-web/);
  });
});
