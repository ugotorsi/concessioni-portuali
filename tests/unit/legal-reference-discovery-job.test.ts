import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  runTransaction: vi.fn(),
  tx: {
    asyncJob: { findUnique: vi.fn(), create: vi.fn() },
    neutralIntake: { findUnique: vi.fn() },
    neutralIntakeExtractionAttempt: { findUnique: vi.fn(), findFirst: vi.fn() },
    legalReferenceMention: { createMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    asyncJob: { findUnique: vi.fn() },
    neutralIntake: { findUnique: vi.fn() },
  },
}));

vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: mocks.audit }));
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: mocks.runTransaction,
}));

import { applicationAsyncJobRegistry } from "@/server/async-jobs/applicationWorker";
import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import {
  buildLegalReferenceDiscoveryAdmission,
  createLegalReferenceDiscoveryHandler,
  discoverLegalReferencesInTransaction,
  ensureLegalReferenceDiscoveryJobInTransaction,
  LEGAL_REFERENCE_DISCOVERY_OPERATION,
  MAX_LEGAL_REFERENCE_MENTIONS_PER_EXTRACTION,
} from "@/server/intake/neutralIntakeLegalReferenceDiscoveryJob";
import { LEGAL_REFERENCE_DISCOVERY_VERSION } from "@/server/intake/legal-reference-discovery/parser";

const sourceJob = {
  operation: "NEUTRAL_INTAKE_EXTRACTION_V1",
  tenantId: "ente-1",
  admissionType: "AUTHENTICATED_USER" as const,
  initiatingUserId: "user-1",
  actorId: "user-1",
  actorEmail: "user@example.test",
  actorRole: "GIURIDICO",
  policyDecisionRef: null,
  correlationId: "correlation-1",
};

function intake(destination = true) {
  return {
    id: "intake-1",
    enteId: "ente-1",
    destination: destination
      ? { procedimento: { concessione: { enteId: "ente-1" } } }
      : null,
  };
}

function extractionAttempt() {
  return {
    id: "extraction-1",
    neutralIntakeId: "intake-1",
    outcome: "SUCCEEDED",
  };
}

function persistedAttempt(pageText: string) {
  return {
    ...extractionAttempt(),
    neutralIntake: intake(),
    pages: [{ id: "page-1", pageNumber: 1, normalizedText: pageText }],
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
  correlationId: "correlation-1",
};

describe("B2C10 Block 3B.6A async legal reference discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTransaction.mockImplementation(async (callback) => callback(mocks.tx));
    mocks.tx.asyncJob.findUnique.mockResolvedValue(sourceJob);
    mocks.tx.neutralIntake.findUnique.mockResolvedValue(intake());
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValue(extractionAttempt());
    mocks.tx.legalReferenceMention.createMany.mockResolvedValue({ count: 1 });
  });

  it("registers discovery on the existing application async registry", () => {
    expect(applicationAsyncJobRegistry.resolve(LEGAL_REFERENCE_DISCOVERY_OPERATION)).not.toBeNull();
  });

  it("builds one deterministic admission per intake, successful extraction, and version", () => {
    const first = normalizeAsyncJobAdmission(buildLegalReferenceDiscoveryAdmission({
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    }, provenance));
    const retry = normalizeAsyncJobAdmission(buildLegalReferenceDiscoveryAdmission({
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    }, provenance));
    const nextExtraction = normalizeAsyncJobAdmission(buildLegalReferenceDiscoveryAdmission({
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-2",
    }, provenance));

    expect(first.idempotencyKey).toBe(retry.idempotencyKey);
    expect(first.requestFingerprint).toBe(retry.requestFingerprint);
    expect(first.idempotencyKey).not.toBe(nextExtraction.idempotencyKey);
    expect(first.inputReference).toEqual({
      referenceType: "LEGAL_REFERENCE_DISCOVERY",
      referenceId: "intake-1",
      referenceVersion: "V1",
      metadata: {
        discoveryVersion: LEGAL_REFERENCE_DISCOVERY_VERSION,
        extractionAttemptId: "extraction-1",
      },
    });
    expect(first.maxAttempts).toBe(2);
  });

  it("does not admit an intake without an authoritative Fascicolo destination", async () => {
    mocks.tx.neutralIntake.findUnique.mockResolvedValueOnce(intake(false));

    await expect(ensureLegalReferenceDiscoveryJobInTransaction(mocks.tx as never, {
      sourceJobId: "extraction-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    })).resolves.toEqual({ outcome: "NOT_ELIGIBLE", job: null });
    expect(mocks.tx.asyncJob.create).not.toHaveBeenCalled();
  });

  it("derives tenant authority from the source job, intake, and destination hierarchy", async () => {
    mocks.tx.neutralIntake.findUnique.mockResolvedValueOnce({
      ...intake(),
      destination: { procedimento: { concessione: { enteId: "ente-2" } } },
    });

    await expect(ensureLegalReferenceDiscoveryJobInTransaction(mocks.tx as never, {
      sourceJobId: "extraction-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    })).rejects.toMatchObject({ code: "DISCOVERY_ADMISSION_AUTHORITY_MISMATCH", retryable: false });
    expect(mocks.tx.asyncJob.create).not.toHaveBeenCalled();
  });

  it("reuses the generic admission result on an identical retry", async () => {
    let createdJob: Record<string, unknown> | null = null;
    mocks.tx.asyncJob.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === "extraction-job-1") return sourceJob;
      if (where.idempotencyKey) return createdJob;
      return null;
    });
    mocks.tx.asyncJob.create.mockImplementationOnce(async ({ data }) => {
      createdJob = { id: "discovery-job-1", ...data };
      return createdJob;
    });
    const input = {
      sourceJobId: "extraction-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    };

    await expect(ensureLegalReferenceDiscoveryJobInTransaction(mocks.tx as never, input))
      .resolves.toMatchObject({ outcome: "CREATED" });
    await expect(ensureLegalReferenceDiscoveryJobInTransaction(mocks.tx as never, input))
      .resolves.toMatchObject({ outcome: "REUSED" });
    expect(mocks.tx.asyncJob.create).toHaveBeenCalledOnce();
  });

  it("treats a zero-reference document as successful with no mention write", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValueOnce({
      operation: LEGAL_REFERENCE_DISCOVERY_OPERATION,
      tenantId: "ente-1",
    });
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValueOnce(
      persistedAttempt("Relazione tecnica senza richiami normativi espliciti."),
    );

    const result = await discoverLegalReferencesInTransaction(mocks.tx as never, {
      jobId: "discovery-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    });

    expect(result).toEqual({ mentionCount: 0 });
    expect(mocks.tx.legalReferenceMention.createMany).not.toHaveBeenCalled();
  });

  it("persists explicit occurrences without canonical source creation or linking", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_DISCOVERY_OPERATION,
      tenantId: "ente-1",
    });
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValue(
      persistedAttempt("art. 21-nonies L. 241/1990; Cass. n. 9414/2025"),
    );

    const result = await discoverLegalReferencesInTransaction(mocks.tx as never, {
      jobId: "discovery-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    });

    expect(result).toEqual({ mentionCount: 2 });
    expect(mocks.tx.legalReferenceMention.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          extractionAttemptId: "extraction-1",
          extractionPageId: "page-1",
          normalizedKey: "LEGGE:241:1990:21:nonies",
        }),
        expect.objectContaining({ kind: "CASE_LAW", actNumber: "9414", year: 2025 }),
      ]),
      skipDuplicates: true,
    });
  });

  it("uses the same occurrence identities on retry and keeps distinct references distinct", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_DISCOVERY_OPERATION,
      tenantId: "ente-1",
    });
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValue(
      persistedAttempt("art. 21-nonies L. 241/1990 e art. 21-octies L. 241/1990"),
    );
    const input = {
      jobId: "discovery-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    };

    await discoverLegalReferencesInTransaction(mocks.tx as never, input);
    await discoverLegalReferencesInTransaction(mocks.tx as never, input);

    const firstData = mocks.tx.legalReferenceMention.createMany.mock.calls[0][0].data;
    const retryData = mocks.tx.legalReferenceMention.createMany.mock.calls[1][0].data;
    expect(retryData).toEqual(firstData);
    expect(firstData.map((mention: { normalizedKey: string }) => mention.normalizedKey)).toEqual([
      "LEGGE:241:1990:21:nonies",
      "LEGGE:241:1990:21:octies",
    ]);
    expect(mocks.tx.legalReferenceMention.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
    }));
  });

  it("accepts exactly the per-extraction mention ceiling", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_DISCOVERY_OPERATION,
      tenantId: "ente-1",
    });
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValue(
      persistedAttempt(Array.from(
        { length: MAX_LEGAL_REFERENCE_MENTIONS_PER_EXTRACTION },
        (_, index) => `L. ${index + 1}/2026`,
      ).join("; ")),
    );

    await expect(discoverLegalReferencesInTransaction(mocks.tx as never, {
      jobId: "discovery-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    })).resolves.toEqual({ mentionCount: MAX_LEGAL_REFERENCE_MENTIONS_PER_EXTRACTION });
    expect(mocks.tx.legalReferenceMention.createMany).toHaveBeenCalledOnce();
  });

  it("rejects max plus one without persisting a partial mention set", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_DISCOVERY_OPERATION,
      tenantId: "ente-1",
    });
    const attempt = persistedAttempt(Array.from(
      { length: MAX_LEGAL_REFERENCE_MENTIONS_PER_EXTRACTION },
      (_, index) => `L. ${index + 1}/2026`,
    ).join("; "));
    attempt.pages.push({ id: "page-2", pageNumber: 2, normalizedText: "L. 3000/2026" });
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValue(attempt);

    await expect(discoverLegalReferencesInTransaction(mocks.tx as never, {
      jobId: "discovery-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    })).rejects.toMatchObject({
      code: "LEGAL_REFERENCE_DISCOVERY_LIMIT_EXCEEDED",
      retryable: false,
    });
    expect(mocks.tx.legalReferenceMention.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong operation", { job: { operation: "OTHER_OPERATION", tenantId: "ente-1" } }],
    ["unsuccessful extraction", { attempt: { outcome: "FAILED" } }],
    ["missing destination", { intake: intake(false) }],
    ["attempt/intake mismatch", { attempt: { neutralIntakeId: "intake-2" } }],
  ])("rejects execution with %s without mention persistence", async (_case, override) => {
    const job = {
      operation: LEGAL_REFERENCE_DISCOVERY_OPERATION,
      tenantId: "ente-1",
      ...override.job,
    };
    const attempt = {
      ...persistedAttempt("L. 241/1990"),
      ...override.attempt,
      neutralIntake: override.intake ?? intake(),
    };
    mocks.tx.asyncJob.findUnique.mockResolvedValue(job);
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValue(attempt);

    await expect(discoverLegalReferencesInTransaction(mocks.tx as never, {
      jobId: "discovery-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    })).rejects.toMatchObject({
      code: "DISCOVERY_EXECUTION_AUTHORITY_MISMATCH",
      retryable: false,
    });
    expect(mocks.tx.legalReferenceMention.createMany).not.toHaveBeenCalled();
  });

  it("returns a bounded successful result through the handler", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_DISCOVERY_OPERATION,
      tenantId: "ente-1",
    });
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValue(
      persistedAttempt("D.Lgs. 36/2023"),
    );
    const admission = buildLegalReferenceDiscoveryAdmission({
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    }, provenance);
    const handler = createLegalReferenceDiscoveryHandler();

    await expect(handler.execute(handler.parseInput(admission.inputReference), {
      jobId: "discovery-job-1",
      correlationId: "correlation-1",
      attempt: 1,
      isCancellationRequested: vi.fn(async () => false),
      heartbeat: vi.fn(async () => undefined),
    })).resolves.toEqual({
      referenceType: "LEGAL_REFERENCE_DISCOVERY_RESULT",
      referenceId: "intake-1",
      referenceVersion: LEGAL_REFERENCE_DISCOVERY_VERSION,
      metadata: { mentionCount: 1 },
    });
  });

  it("contains no AI, provider, external network, or canonical source mutation path", () => {
    const sources = [
      "src/server/intake/legal-reference-discovery/parser.ts",
      "src/server/intake/neutralIntakeLegalReferenceDiscoveryJob.ts",
    ].map((path) => readFileSync(resolve(path), "utf8")).join("\n");

    expect(sources).not.toMatch(/openai|anthropic|fetch\(|https?:\/\/|provider api|remote ocr|embedding/i);
    expect(sources).not.toMatch(/legalSource\.(create|update|upsert)|legalSourceCandidateResolution/i);
  });
});