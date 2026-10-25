import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    activityLog: { findMany: vi.fn() },
    asyncJob: { findUnique: vi.fn() },
  },
  createAuditLogInTransaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: vi.fn((callback: (tx: typeof harness.tx) => unknown) => callback(harness.tx)) },
}));
vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: harness.createAuditLogInTransaction,
}));
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: vi.fn(
    (callback: (tx: typeof harness.tx) => unknown) => callback(harness.tx),
  ),
}));

import {
  beginDocumentAnalysisActivation,
  completeDocumentAnalysisActivation,
  DocumentAnalysisActivationTargetError,
  reconcileDocumentAnalysisActivation,
} from "@/server/async-jobs/documentAnalysisActivationPersistence";

const target = {
  applicationJobId: "analysis-job-1",
  tenantId: "tenant-1",
  procedimentoId: "procedure-1",
};

function eligibleJob(overrides: Record<string, unknown> = {}) {
  return {
    id: target.applicationJobId,
    operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
    tenantId: target.tenantId,
    procedimentoId: target.procedimentoId,
    inputReference: {
      referenceType: "FASCICOLO_DOCUMENT_CORPUS",
      referenceId: "corpus-1",
      metadata: { procedimentoId: target.procedimentoId },
    },
    admissionType: "AUTHENTICATED_USER",
    initiatingUserId: "user-1",
    actorId: "user-1",
    actorEmail: "user@example.test",
    actorRole: "TECNICO",
    policyDecisionRef: null,
    status: "QUEUED",
    attemptCount: 0,
    maxAttempts: 3,
    availableAt: new Date(0),
    dependsOnJobId: null,
    databaseNow: new Date("2026-10-25T08:00:00.000Z"),
    ...overrides,
  };
}

function activationLog(
  state: "REQUESTING" | "CONFIRMED" | "REMOTE_UNKNOWN" | "FAILED_VERIFIED",
  overrides: Record<string, unknown> = {},
) {
  return {
    azione: `DOCUMENT_ANALYSIS_ACTIVATION_${state}`,
    metadata: {
      activationSequence: 1,
      activationAttemptId: "a".repeat(32),
      renderJobId: state === "CONFIRMED" ? "job-render123" : null,
      failureCode: null,
      ...overrides,
    },
  };
}

describe("document analysis activation persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.tx.$queryRaw.mockResolvedValue([eligibleJob()]);
    harness.tx.activityLog.findMany.mockResolvedValue([]);
    harness.createAuditLogInTransaction.mockResolvedValue({ id: "audit-1" });
  });

  it("atomically reserves an eligible exact job under a row lock", async () => {
    await expect(beginDocumentAnalysisActivation(target)).resolves.toMatchObject({
      outcome: "RESERVED",
      snapshot: { state: "REQUESTING" },
    });

    const query = harness.tx.$queryRaw.mock.calls[0]?.[0] as { strings: readonly string[] };
    expect(query.strings.join(" ")).toContain('WHERE "id" =');
    expect(query.strings.join(" ")).toContain("FOR UPDATE");
    expect(harness.createAuditLogInTransaction).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        azione: "DOCUMENT_ANALYSIS_ACTIVATION_REQUESTING",
        entitaId: target.applicationJobId,
      }),
    );
  });

  it("returns an existing persistent reservation without creating another", async () => {
    harness.tx.activityLog.findMany.mockResolvedValue([activationLog("REQUESTING")]);

    await expect(beginDocumentAnalysisActivation(target)).resolves.toEqual({
      outcome: "EXISTING",
      snapshot: {
        state: "REQUESTING",
        activationAttemptId: "a".repeat(32),
        renderJobId: null,
        failureCode: null,
      },
    });
    expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
  });

  it.each(["RUNNING", "SUCCEEDED", "TERMINAL_FAILED"] as const)(
    "does not reserve a %s job",
    async (status) => {
      harness.tx.$queryRaw.mockResolvedValue([eligibleJob({ status })]);
      await expect(beginDocumentAnalysisActivation(target)).rejects.toMatchObject({
        code: "TARGET_NOT_ELIGIBLE",
      });
      expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
    },
  );

  it("rejects operation, procedimento, tenant, and authority mismatches", async () => {
    for (const overrides of [
      { operation: "DOCUMENT_EXTRACTION_V1" },
      { procedimentoId: "procedure-other" },
      { tenantId: "tenant-other" },
      { actorId: "user-other" },
    ]) {
      vi.clearAllMocks();
      harness.tx.$queryRaw.mockResolvedValue([eligibleJob(overrides)]);
      harness.tx.activityLog.findMany.mockResolvedValue([]);
      await expect(beginDocumentAnalysisActivation(target))
        .rejects.toBeInstanceOf(DocumentAnalysisActivationTargetError);
      expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
    }
  });

  it("records confirmed, remote-unknown, and controlled reconciliation states", async () => {
    harness.tx.activityLog.findMany.mockResolvedValue([activationLog("REQUESTING")]);
    await expect(completeDocumentAnalysisActivation({
      target,
      activationAttemptId: "a".repeat(32),
      state: "CONFIRMED",
      renderJobId: "job-render123",
    })).resolves.toMatchObject({ state: "CONFIRMED", renderJobId: "job-render123" });

    harness.tx.activityLog.findMany.mockResolvedValue([activationLog("REMOTE_UNKNOWN")]);
    await expect(reconcileDocumentAnalysisActivation({
      target,
      state: "FAILED_VERIFIED",
      failureCode: "RECONCILED_NO_REMOTE_JOB",
    })).resolves.toMatchObject({ state: "FAILED_VERIFIED" });

    expect(harness.createAuditLogInTransaction).toHaveBeenNthCalledWith(
      1,
      harness.tx,
      expect.objectContaining({ azione: "DOCUMENT_ANALYSIS_ACTIVATION_CONFIRMED" }),
    );
    expect(harness.createAuditLogInTransaction).toHaveBeenNthCalledWith(
      2,
      harness.tx,
      expect.objectContaining({
        azione: "DOCUMENT_ANALYSIS_ACTIVATION_FAILED_VERIFIED",
        metadata: expect.objectContaining({ reconciled: true }),
      }),
    );
  });
});
