import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  neutralIntakeExtractionAttempt: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { Prisma } from "@/generated/prisma/client";
import {
  ExtractionPersistenceConflictError,
  persistCompletedExtractionAttempt,
  persistCompletedExtractionAttemptInTransaction,
  type CompletedExtractionAttempt,
} from "@/server/intake/extraction/persistence";

function completed(outcome: "SUCCEEDED" | "FAILED" = "SUCCEEDED"): CompletedExtractionAttempt {
  const common = {
    attemptId: "attempt-logical-1",
    neutralIntakeId: "intake-1",
    policyVersion: "B2C9_EXTRACTION_POLICY_V1",
    artifactSha256: "a".repeat(64),
    declaredMimeType: "application/pdf",
    detectedMimeType: "application/pdf",
    artifactSizeBytes: 100,
    startedAt: new Date("2026-09-12T10:00:00.000Z"),
    completedAt: new Date("2026-09-12T10:00:01.000Z"),
  };
  if (outcome === "FAILED") {
    return { ...common, outcome, failureCode: "MALFORMED_PDF", failureMessage: "MALFORMED_PDF" };
  }
  return {
    ...common,
    outcome,
    result: {
      detectedMimeType: "application/pdf",
      warnings: [],
      directExtractorName: "pdfjs-dist",
      directExtractorVersion: "5.4.149",
      ocrExtractorName: null,
      ocrExtractorVersion: null,
      rasterizerName: null,
      rasterizerVersion: null,
      pages: [{
        pageNumber: 1,
        method: "DIRECT_TEXT",
        text: "testo",
        normalizedText: "testo",
        textSha256: "b".repeat(64),
        normalizedCharacterCount: 5,
        ocrConfidence: null,
        warnings: [],
      }],
    },
  };
}

function transaction(status = "RECEIVED", updateCount = 1) {
  const findUnique = vi.fn(async () => ({
    id: "intake-1",
    sha256: "a".repeat(64),
    mimeType: "application/pdf",
    sizeBytes: 100,
    status,
    statusVersion: 3,
  }));
  const create = vi.fn(async ({ data }) => ({ id: "attempt-1", ...data, pages: data.pages?.create ?? [] }));
  const findAttempt = vi.fn(async () => null);
  const updateMany = vi.fn(async () => ({ count: updateCount }));
  return {
    tx: {
      neutralIntake: { findUnique, updateMany },
      neutralIntakeExtractionAttempt: { create, findUnique: findAttempt },
    } as unknown as Prisma.TransactionClient,
    findUnique,
    create,
    findAttempt,
    updateMany,
  };
}

function persistedAttempt(input: CompletedExtractionAttempt) {
  const result = input.outcome === "SUCCEEDED" ? input.result : null;
  return {
    id: input.attemptId,
    neutralIntakeId: input.neutralIntakeId,
    policyVersion: input.policyVersion,
    outcome: input.outcome,
    artifactSha256: input.artifactSha256,
    declaredMimeType: input.declaredMimeType,
    detectedMimeType: input.detectedMimeType,
    artifactSizeBytes: input.artifactSizeBytes,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    directExtractorName: result?.directExtractorName ?? null,
    directExtractorVersion: result?.directExtractorVersion ?? null,
    ocrExtractorName: result?.ocrExtractorName ?? null,
    ocrExtractorVersion: result?.ocrExtractorVersion ?? null,
    rasterizerName: result?.rasterizerName ?? null,
    rasterizerVersion: result?.rasterizerVersion ?? null,
    failureCode: input.outcome === "FAILED" ? input.failureCode : null,
    failureMessage: input.outcome === "FAILED" ? input.failureMessage : null,
    warnings: result?.warnings ?? [],
    pages: (result?.pages ?? []).map((page) => ({
      pageNumber: page.pageNumber,
      extractionMethod: page.method,
      text: page.text,
      normalizedText: page.normalizedText,
      textSha256: page.textSha256,
      normalizedCharacterCount: page.normalizedCharacterCount,
      ocrConfidence: page.ocrConfidence,
      warnings: page.warnings,
    })),
  };
}

function knownError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: "7.8.0",
    meta,
  });
}

describe("B2C9 extraction persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("orders the Block 3B.2A migration after Block 3B.1", () => {
    const migrations = readdirSync(path.join(process.cwd(), "prisma/migrations")).sort();
    const block3b1Index = migrations.indexOf("20260912_b2c9_block3b1_neutral_intake_core");
    const block3b2aIndex = migrations.indexOf("20260912_b2c9_block3b2a_bounded_extraction_core");
    expect(block3b1Index).toBeGreaterThanOrEqual(0);
    expect(block3b2aIndex).toBeGreaterThan(block3b1Index);
  });

  it("makes completed attempts and page evidence append-only at the database boundary", () => {
    const migration = readFileSync(path.join(
      process.cwd(),
      "prisma/migrations/20260912_b2c9_block3b2a_bounded_extraction_core/migration.sql",
    ), "utf8");
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "NeutralIntakeExtractionAttempt"/);
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "NeutralIntakeExtractionPage"/);
  });

  it("creates immutable page evidence and CAS-transitions RECEIVED to EVIDENCE_READY", async () => {
    const mocks = transaction();
    await persistCompletedExtractionAttemptInTransaction(mocks.tx, completed());
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        outcome: "SUCCEEDED",
        id: "attempt-logical-1",
        pages: { create: [expect.objectContaining({ pageNumber: 1, extractionMethod: "DIRECT_TEXT" })] },
      }),
    }));
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "intake-1", status: "RECEIVED", statusVersion: 3 },
      data: { status: "EVIDENCE_READY", statusVersion: { increment: 1 } },
    });
  });

  it("reuses an identical completed logical attempt without creating or updating", async () => {
    const mocks = transaction();
    const input = completed();
    const existing = persistedAttempt(input);
    mocks.findAttempt.mockResolvedValueOnce(existing as never);
    await expect(persistCompletedExtractionAttemptInTransaction(mocks.tx, input)).resolves.toBe(existing);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("transitions a deterministic failure to FAILED_EXTRACTION", async () => {
    const mocks = transaction();
    await persistCompletedExtractionAttemptInTransaction(mocks.tx, completed("FAILED"));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        outcome: "FAILED",
        failureCode: "MALFORMED_PDF",
        pages: undefined,
      }),
    }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "FAILED_EXTRACTION", statusVersion: { increment: 1 } },
    }));
  });

  it("preserves a later intake status while appending a retry attempt", async () => {
    const mocks = transaction("REVIEW_REQUIRED");
    await persistCompletedExtractionAttemptInTransaction(mocks.tx, completed());
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("fails on a lost status CAS so the surrounding transaction can roll back", async () => {
    const mocks = transaction("RECEIVED", 0);
    await expect(persistCompletedExtractionAttemptInTransaction(mocks.tx, completed()))
      .rejects.toBeInstanceOf(ExtractionPersistenceConflictError);
  });

  it("fails closed when the immutable intake manifest changed", async () => {
    const mocks = transaction();
    mocks.findUnique.mockResolvedValueOnce({
      id: "intake-1",
      sha256: "c".repeat(64),
      mimeType: "application/pdf",
      sizeBytes: 100,
      status: "RECEIVED",
      statusVersion: 3,
    });
    await expect(persistCompletedExtractionAttemptInTransaction(mocks.tx, completed()))
      .rejects.toBeInstanceOf(ExtractionPersistenceConflictError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("retries P2034 with one stable logical attempt identity and commits one attempt", async () => {
    const input = completed();
    const firstAttempt = transaction();
    const retryAttempt = transaction();
    const committedAttempts: unknown[] = [];

    prismaMock.$transaction
      .mockImplementationOnce(async (callback) => {
        await callback(firstAttempt.tx);
        throw knownError("P2034");
      })
      .mockImplementationOnce(async (callback) => {
        const result = await callback(retryAttempt.tx);
        committedAttempts.push(retryAttempt.create.mock.calls[0][0].data);
        return result;
      });

    await persistCompletedExtractionAttempt(input);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(firstAttempt.create.mock.calls[0][0].data.id).toBe(input.attemptId);
    expect(retryAttempt.create.mock.calls[0][0].data.id).toBe(input.attemptId);
    expect(committedAttempts).toHaveLength(1);
    expect(committedAttempts[0]).toEqual(expect.objectContaining({
      id: input.attemptId,
      pages: { create: [expect.objectContaining({ pageNumber: 1 })] },
    }));
  });

  it("reconciles attempt-id P2002 through a fresh read without another mutation", async () => {
    const input = completed();
    const existing = persistedAttempt(input);
    prismaMock.$transaction.mockRejectedValueOnce(knownError("P2002", {
      modelName: "NeutralIntakeExtractionAttempt",
      target: "NeutralIntakeExtractionAttempt_pkey",
    }));
    prismaMock.neutralIntakeExtractionAttempt.findUnique.mockResolvedValueOnce(existing);

    await expect(persistCompletedExtractionAttempt(input)).resolves.toBe(existing);

    expect(prismaMock.neutralIntakeExtractionAttempt.findUnique).toHaveBeenCalledWith({
      where: { id: input.attemptId },
      include: { pages: { orderBy: { pageNumber: "asc" } } },
    });
    expect(prismaMock.neutralIntakeExtractionAttempt.create).not.toHaveBeenCalled();
    expect(prismaMock.neutralIntakeExtractionAttempt.update).not.toHaveBeenCalled();
    expect(prismaMock.neutralIntakeExtractionAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when fresh P2002 reconciliation finds conflicting immutable evidence", async () => {
    const input = completed();
    const existing = { ...persistedAttempt(input), artifactSha256: "c".repeat(64) };
    prismaMock.$transaction.mockRejectedValueOnce(knownError("P2002", {
      modelName: "NeutralIntakeExtractionAttempt",
      target: ["id"],
    }));
    prismaMock.neutralIntakeExtractionAttempt.findUnique.mockResolvedValueOnce(existing);

    await expect(persistCompletedExtractionAttempt(input))
      .rejects.toBeInstanceOf(ExtractionPersistenceConflictError);

    expect(prismaMock.neutralIntakeExtractionAttempt.findUnique).toHaveBeenCalledOnce();
    expect(prismaMock.neutralIntakeExtractionAttempt.create).not.toHaveBeenCalled();
    expect(prismaMock.neutralIntakeExtractionAttempt.update).not.toHaveBeenCalled();
    expect(prismaMock.neutralIntakeExtractionAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("keeps independent outer persistence invocations logically distinct", async () => {
    const first = completed();
    const second = { ...completed(), attemptId: "attempt-logical-2" };
    const firstTransaction = transaction("REVIEW_REQUIRED");
    const secondTransaction = transaction("REVIEW_REQUIRED");
    prismaMock.$transaction
      .mockImplementationOnce(async (callback) => callback(firstTransaction.tx))
      .mockImplementationOnce(async (callback) => callback(secondTransaction.tx));

    await persistCompletedExtractionAttempt(first);
    await persistCompletedExtractionAttempt(second);

    expect(firstTransaction.create.mock.calls[0][0].data.id).toBe("attempt-logical-1");
    expect(secondTransaction.create.mock.calls[0][0].data.id).toBe("attempt-logical-2");
    expect(firstTransaction.create.mock.calls[0][0].data.id)
      .not.toBe(secondTransaction.create.mock.calls[0][0].data.id);
  });
});