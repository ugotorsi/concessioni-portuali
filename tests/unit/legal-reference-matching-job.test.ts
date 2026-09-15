import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  runTransaction: vi.fn(),
  tx: {
    asyncJob: { findUnique: vi.fn(), create: vi.fn() },
    neutralIntakeExtractionAttempt: { findUnique: vi.fn() },
    legalSource: { findMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    legalReferenceMatch: { createMany: vi.fn() },
    legalSourceCandidateResolution: { create: vi.fn() },
  },
}));

vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: mocks.audit }));
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: mocks.runTransaction,
}));

import { applicationAsyncJobRegistry } from "@/server/async-jobs/applicationWorker";
import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import {
  LEGAL_REFERENCE_IDENTITY_NAMESPACE,
  buildLegalReferenceMatchingAdmission,
  ensureLegalReferenceMatchingJobInTransaction,
  LEGAL_REFERENCE_MATCHING_OPERATION,
  MAX_LOCAL_LEGAL_SOURCES_PER_MATCHING_JOB,
  matchLegalReferencesInTransaction,
} from "@/server/intake/neutralIntakeLegalReferenceMatchingJob";
import { LEGAL_REFERENCE_MATCHING_VERSION } from "@/server/intake/legal-reference-matching/matcher";

const provenance = {
  tenantId: "ente-1",
  admissionType: "AUTHORIZED_SYSTEM" as const,
  initiatingUserId: null,
  actorId: "worker-1",
  actorEmail: null,
  actorRole: "SYSTEM",
  policyDecisionRef: "LOCAL_DISCOVERY_V1",
  correlationId: "correlation-1",
};

function sourceJob() {
  return { operation: "LEGAL_REFERENCE_DISCOVERY_V1", ...provenance };
}

function attempt(mentions: Array<Record<string, unknown>> = []) {
  return {
    id: "extraction-1",
    neutralIntakeId: "intake-1",
    outcome: "SUCCEEDED",
    neutralIntake: {
      id: "intake-1",
      enteId: "ente-1",
      destination: { procedimento: { concessione: { enteId: "ente-1" } } },
    },
    legalReferenceMentions: mentions,
  };
}

function legislationMention(matches: Array<{ id: string }> = []) {
  return {
    id: "mention-1",
    kind: "LEGISLATION",
    normalizedKey: "LEGGE:241:1990:21",
    authorityHint: null,
    actType: "LEGGE",
    actNumber: "241",
    year: 1990,
    chamberSection: null,
    matches,
  };
}

describe("B2C11 Block 3B.6B async local catalog matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTransaction.mockImplementation(async (callback) => callback(mocks.tx));
    mocks.tx.asyncJob.findUnique.mockResolvedValue(sourceJob());
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValue(attempt());
    mocks.tx.legalSource.findMany.mockResolvedValue([]);
    mocks.tx.legalReferenceMatch.createMany.mockResolvedValue({ count: 1 });
  });

  it("registers matching on the existing application async registry", () => {
    expect(applicationAsyncJobRegistry.resolve(LEGAL_REFERENCE_MATCHING_OPERATION)).not.toBeNull();
  });

  it("builds one deterministic versioned admission for repeat requests", () => {
    const input = { neutralIntakeId: "intake-1", extractionAttemptId: "extraction-1" };
    const first = normalizeAsyncJobAdmission(buildLegalReferenceMatchingAdmission(input, provenance));
    const retry = normalizeAsyncJobAdmission(buildLegalReferenceMatchingAdmission(input, provenance));
    expect(first.idempotencyKey).toBe(retry.idempotencyKey);
    expect(first.inputReference).toMatchObject({
      referenceType: "LEGAL_REFERENCE_MATCHING",
      metadata: { matchingVersion: LEGAL_REFERENCE_MATCHING_VERSION },
    });
  });

  it("reuses generic admission idempotency", async () => {
    let createdJob: Record<string, unknown> | null = null;
    mocks.tx.asyncJob.findUnique.mockImplementation(async ({ where }) => {
      if (where.id) return sourceJob();
      if (where.idempotencyKey) return createdJob;
      return null;
    });
    mocks.tx.asyncJob.create.mockImplementationOnce(async ({ data }) => {
      createdJob = { id: "matching-job-1", ...data };
      return createdJob;
    });
    const input = { sourceJobId: "discovery-job-1", neutralIntakeId: "intake-1", extractionAttemptId: "extraction-1" };
    await expect(ensureLegalReferenceMatchingJobInTransaction(mocks.tx as never, input))
      .resolves.toMatchObject({ outcome: "CREATED" });
    await expect(ensureLegalReferenceMatchingJobInTransaction(mocks.tx as never, input))
      .resolves.toMatchObject({ outcome: "REUSED" });
    expect(mocks.tx.asyncJob.create).toHaveBeenCalledOnce();
  });

  it("treats zero mentions as a successful no-op", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValue({ operation: LEGAL_REFERENCE_MATCHING_OPERATION, tenantId: "ente-1" });
    await expect(matchLegalReferencesInTransaction(mocks.tx as never, {
      jobId: "matching-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    })).resolves.toEqual({ mentionCount: 0, persistedCount: 0 });
    expect(mocks.tx.legalSource.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceMatch.createMany).not.toHaveBeenCalled();
  });

  it("uses only tenant-visible or global sources and persists a bounded machine result", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValue({ operation: LEGAL_REFERENCE_MATCHING_OPERATION, tenantId: "ente-1" });
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValue(attempt([legislationMention()]));
    mocks.tx.legalSource.findMany.mockResolvedValue([{
      id: "source-1",
      enteId: null,
      sourceType: "LEGGE",
      legalAuthorityKind: "LEGISLATION",
      issuingBody: "PARLAMENTO",
      sourceNumber: "241",
      sourceDate: new Date("1990-01-01T00:00:00.000Z"),
      identityNamespace: null,
      identityScopeKind: null,
      identityScopeKey: null,
      canonicalKey: null,
      identityAssertions: [],
    }]);

    await matchLegalReferencesInTransaction(mocks.tx as never, {
      jobId: "matching-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    });

    expect(mocks.tx.legalSource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([{ OR: [{ enteId: "ente-1" }, { enteId: null }] }]),
      }),
      select: expect.objectContaining({
        enteId: true,
        identityNamespace: true,
        identityScopeKind: true,
        identityScopeKey: true,
        identityAssertions: {
          select: expect.objectContaining({ identifierScheme: true }),
        },
      }),
    }));
    expect(mocks.tx.legalReferenceMatch.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        mentionId: "mention-1",
        matchingVersion: LEGAL_REFERENCE_MATCHING_VERSION,
        status: "MATCHED",
        legalSourceId: "source-1",
      })],
      skipDuplicates: true,
    });
    expect(mocks.tx.legalSource.create).not.toHaveBeenCalled();
    expect(mocks.tx.legalSource.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.legalSourceCandidateResolution.create).not.toHaveBeenCalled();
  });

  it("persists no match when a canonical collision has an incompatible namespace", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValue({ operation: LEGAL_REFERENCE_MATCHING_OPERATION, tenantId: "ente-1" });
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValue(attempt([{
      ...legislationMention(),
      actType: "DECRETO_LEGISLATIVO",
      actNumber: "36",
      year: 2023,
    }]));
    mocks.tx.legalSource.findMany.mockResolvedValue([{
      id: "source-1",
      enteId: null,
      sourceType: "DECRETO",
      legalAuthorityKind: "LEGISLATION",
      issuingBody: null,
      sourceNumber: null,
      sourceDate: null,
      identityNamespace: `${LEGAL_REFERENCE_IDENTITY_NAMESPACE}_OTHER`,
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: "DECRETO_LEGISLATIVO:36:2023",
      identityAssertions: [],
    }]);

    await matchLegalReferencesInTransaction(mocks.tx as never, {
      jobId: "matching-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    });

    expect(mocks.tx.legalReferenceMatch.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ status: "NO_MATCH", legalSourceId: null })],
      skipDuplicates: true,
    });
  });

  it("does not recompute or duplicate a persisted matching-version result", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValue({ operation: LEGAL_REFERENCE_MATCHING_OPERATION, tenantId: "ente-1" });
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValue(
      attempt([legislationMention([{ id: "existing-match" }])]),
    );
    await expect(matchLegalReferencesInTransaction(mocks.tx as never, {
      jobId: "matching-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    })).resolves.toEqual({ mentionCount: 1, persistedCount: 0 });
    expect(mocks.tx.legalSource.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceMatch.createMany).not.toHaveBeenCalled();
  });

  it("fails closed before persistence when the local catalog exceeds the matching bound", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValue({ operation: LEGAL_REFERENCE_MATCHING_OPERATION, tenantId: "ente-1" });
    mocks.tx.neutralIntakeExtractionAttempt.findUnique.mockResolvedValue(attempt([legislationMention()]));
    mocks.tx.legalSource.findMany.mockResolvedValue(
      Array.from({ length: MAX_LOCAL_LEGAL_SOURCES_PER_MATCHING_JOB + 1 }, (_, index) => ({ id: `source-${index}` })),
    );

    await expect(matchLegalReferencesInTransaction(mocks.tx as never, {
      jobId: "matching-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    })).rejects.toMatchObject({ code: "MATCHING_CATALOG_LIMIT_EXCEEDED", retryable: false });
    expect(mocks.tx.legalReferenceMatch.createMany).not.toHaveBeenCalled();
  });

  it("fails closed when the job tenant and authoritative Fascicolo tenant differ", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValue({ operation: LEGAL_REFERENCE_MATCHING_OPERATION, tenantId: "ente-2" });
    await expect(matchLegalReferencesInTransaction(mocks.tx as never, {
      jobId: "matching-job-1",
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
    })).rejects.toMatchObject({ code: "MATCHING_EXECUTION_AUTHORITY_MISMATCH", retryable: false });
    expect(mocks.tx.legalSource.findMany).not.toHaveBeenCalled();
  });

  it("contains no external, parser, source mutation, or human-resolution execution path", () => {
    const sources = [
      "src/server/intake/legal-reference-matching/matcher.ts",
      "src/server/intake/neutralIntakeLegalReferenceMatchingJob.ts",
    ].map((path) => readFileSync(resolve(path), "utf8")).join("\n");

    expect(sources).not.toMatch(/openai|anthropic|fetch\(|https?:\/\/|embedding|ocr|discoverItalianLegalReferences/i);
    expect(sources).not.toMatch(/legalSource\.(create|upsert)|legalSourceCandidateResolution\.(create|upsert)/i);
  });
});