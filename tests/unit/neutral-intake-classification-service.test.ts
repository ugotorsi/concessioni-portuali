import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import {
  classifyNeutralIntakeInTransaction,
  NeutralIntakeClassificationConflictError,
  NeutralIntakeClassificationExecutionError,
  markClassificationExecutionFailedInTransaction,
} from "@/server/intake/classification/service";
import {
  buildNeutralIntakeClassificationProjection,
  hashNeutralIntakeClassificationEvidence,
} from "@/server/intake/classification/projection";

const text = "REGOLAMENTO GENERALE DEL PORTO\nDISPOSIZIONI GENERALI\nARTICOLO 1 Oggetto\nARTICOLO 2 Ambito\nARTICOLO 3 Obblighi\nENTRATA IN VIGORE dalla pubblicazione.";

function transaction(options: { status?: string; existing?: unknown; updateCount?: number } = {}) {
  const intake = {
    id: "intake-1",
    status: options.status ?? "EVIDENCE_READY",
    statusVersion: 4,
    extractionAttempts: [{
      id: "extraction-1",
      policyVersion: "B2C9_EXTRACTION_POLICY_V1",
      artifactSha256: "a".repeat(64),
      warnings: [],
      pages: [{
        pageNumber: 1,
        normalizedText: text,
        textSha256: "b".repeat(64),
        normalizedCharacterCount: text.length,
        ocrConfidence: null,
        warnings: [],
      }],
    }],
  };
  const findIntake = vi.fn(async () => intake);
  const findClassification = vi.fn(async () => options.existing ?? null);
  const create = vi.fn(async ({ data }) => ({ id: "classification-1", ...data }));
  const updateMany = vi.fn(async () => ({ count: options.updateCount ?? 1 }));
  return {
    tx: {
      neutralIntake: { findUnique: findIntake, updateMany },
      neutralIntakeClassificationAttempt: { findUnique: findClassification, create },
    } as unknown as Prisma.TransactionClient,
    create,
    findClassification,
    updateMany,
  };
}

describe("NeutralIntake classification persistence", () => {
  it("persists bounded structured evidence without extracted text and retains EVIDENCE_READY", async () => {
    const mocks = transaction();
    await classifyNeutralIntakeInTransaction(mocks.tx, "intake-1");
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      neutralIntakeId: "intake-1",
      extractionAttemptId: "extraction-1",
      classifierVersion: "neutral-intake-classifier/v1",
      outcome: "LEGAL_SOURCE_CANDIDATE",
      reviewRequired: false,
    });
    expect(JSON.stringify(data)).not.toContain(text);
    expect(data.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "intake-1", status: "EVIDENCE_READY", statusVersion: 4 },
      data: { status: "EVIDENCE_READY", statusVersion: { increment: 1 } },
    });
  });

  it("reuses the same evidence and classifier decision without another write", async () => {
    const existing = { id: "classification-existing", outcome: "LEGAL_SOURCE_CANDIDATE" };
    const mocks = transaction({ existing });
    await expect(classifyNeutralIntakeInTransaction(mocks.tx, "intake-1")).resolves.toBe(existing);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("moves uncertain evidence to REVIEW_REQUIRED and never writes ROUTED", async () => {
    const mocks = transaction();
    const uncertain = vi.fn(() => ({
      outcome: "UNCERTAIN_REVIEW_REQUIRED" as const,
      confidence: "INSUFFICIENT" as const,
      reasonCodes: ["INSUFFICIENT_EVIDENCE" as const],
      evidenceMarkers: ["INSUFFICIENT_EVIDENCE" as const],
      reviewRequired: true,
    }));
    await classifyNeutralIntakeInTransaction(mocks.tx, "intake-1", { classify: uncertain });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "REVIEW_REQUIRED", statusVersion: { increment: 1 } },
    }));
    expect(JSON.stringify(mocks.updateMany.mock.calls)).not.toContain("ROUTED");
  });

  it("maps classifier execution failure to the existing FAILED_CLASSIFICATION lifecycle", async () => {
    const classification = transaction();
    await expect(classifyNeutralIntakeInTransaction(classification.tx, "intake-1", {
      classify: () => { throw new Error("classifier defect"); },
    })).rejects.toBeInstanceOf(NeutralIntakeClassificationExecutionError);
    expect(classification.create).not.toHaveBeenCalled();

    const failure = transaction();
    await markClassificationExecutionFailedInTransaction(failure.tx, "intake-1", 4);
    expect(failure.updateMany).toHaveBeenCalledWith({
      where: { id: "intake-1", status: "EVIDENCE_READY", statusVersion: 4 },
      data: { status: "FAILED_CLASSIFICATION", statusVersion: { increment: 1 } },
    });
  });

  it("bounds projected text and hashes every effective classifier input", () => {
    const page = {
      pageNumber: 1,
      normalizedText: "A".repeat(10_000),
      textSha256: "b".repeat(64),
      normalizedCharacterCount: 10_000,
      ocrConfidence: null,
      warnings: [],
    };
    const evidence = {
      attemptId: "extraction-1",
      policyVersion: "B2C9_EXTRACTION_POLICY_V1",
      artifactSha256: "a".repeat(64),
      warnings: [],
      pages: [page],
    };
    const projected = buildNeutralIntakeClassificationProjection(evidence);
    expect(projected.beginningText).toHaveLength(4_000);
    expect(projected.endingText).toHaveLength(2_000);
    const evidenceHash = hashNeutralIntakeClassificationEvidence(evidence);
    expect(evidenceHash).toBe(hashNeutralIntakeClassificationEvidence(evidence));
    expect(evidenceHash).not.toBe(
      hashNeutralIntakeClassificationEvidence({
        ...evidence,
        pages: [{ ...page, normalizedText: "B".repeat(10_000) }],
      }),
    );
    expect(evidenceHash).toBe(
      hashNeutralIntakeClassificationEvidence({ ...evidence, attemptId: "identical-retry" }),
    );
    expect(evidenceHash).not.toBe(
      hashNeutralIntakeClassificationEvidence({
        ...evidence,
        pages: [{ ...page, warnings: ["QUALITY_INSUFFICIENT"] }],
      }),
    );
    expect(evidenceHash).not.toBe(hashNeutralIntakeClassificationEvidence({
      ...evidence,
      pages: [{ ...page, ocrConfidence: 40 }],
    }));
    expect(evidenceHash).not.toBe(hashNeutralIntakeClassificationEvidence({
      ...evidence,
      pages: [{ ...page, normalizedCharacterCount: 9_999 }],
    }));
    expect(evidenceHash).not.toBe(hashNeutralIntakeClassificationEvidence({
      ...evidence,
      warnings: ["INCOMPLETE_EXTRACTION"],
    }));
    expect(evidenceHash).not.toBe(hashNeutralIntakeClassificationEvidence({
      ...evidence,
      pages: [{ ...page, pageNumber: 2 }],
    }));
    expect(evidenceHash).not.toBe(hashNeutralIntakeClassificationEvidence({
      ...evidence,
      pages: [page, { ...page, pageNumber: 2, normalizedText: "second page" }],
    }));
  });

  it("rejects non-evidence-ready intake state and rolls back a lost CAS", async () => {
    const ineligible = transaction({ status: "ROUTED" });
    await expect(classifyNeutralIntakeInTransaction(ineligible.tx, "intake-1"))
      .rejects.toBeInstanceOf(NeutralIntakeClassificationConflictError);
    expect(ineligible.create).not.toHaveBeenCalled();

    const raced = transaction({ updateCount: 0 });
    await expect(classifyNeutralIntakeInTransaction(raced.tx, "intake-1"))
      .rejects.toBeInstanceOf(NeutralIntakeClassificationConflictError);
  });

  it("keeps classification persistence immutable at the database boundary", () => {
    const migration = readFileSync(path.join(
      process.cwd(),
      "prisma/migrations/20260913_b2c9_block3b3a_local_classification_core/migration.sql",
    ), "utf8");
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "NeutralIntakeClassificationAttempt"/);
    expect(migration).toMatch(/FOREIGN KEY \("extractionAttemptId", "neutralIntakeId"\)/);
    expect(migration).toMatch(/ON DELETE RESTRICT/);
  });

  it("contains no provider, AI, handoff, destination-object, or ROUTED write", () => {
    const source = readFileSync(path.join(process.cwd(), "src/server/intake/classification/service.ts"), "utf8");
    expect(source).not.toMatch(/OpenAI|AiOutbound|fascicoloOutbound|Simpliciter|official-web/);
    expect(source).not.toMatch(/legalSource\.(?:create|update)|documento\.(?:create|update)|NormaFonte/);
    expect(source).not.toMatch(/status:\s*["']ROUTED["']/);
  });
});