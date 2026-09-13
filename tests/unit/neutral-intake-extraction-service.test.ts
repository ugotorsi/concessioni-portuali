import { describe, expect, it, vi } from "vitest";

import { ExtractionFailure } from "@/server/intake/extraction/errors";
import type { CompletedExtractionAttempt } from "@/server/intake/extraction/persistence";
import type { TechnicalExtractionResult } from "@/server/intake/extraction/types";
import { extractNeutralIntake, type ExtractNeutralIntakeDependencies } from "@/server/intake/extractNeutralIntake";

const body = Buffer.from("%PDF-mocked");
const intake = {
  id: "intake-1",
  storageProvider: "local",
  storageBucket: null,
  storageKey: "intake/sha256/hash",
  sha256: "a".repeat(64),
  mimeType: "application/pdf",
  sizeBytes: body.length,
};

const result: TechnicalExtractionResult = {
  detectedMimeType: "application/pdf",
  pages: [{
    pageNumber: 1,
    method: "DIRECT_TEXT",
    text: "testo",
    normalizedText: "testo",
    normalizedCharacterCount: 5,
    textSha256: "b".repeat(64),
    ocrConfidence: null,
    warnings: [],
  }],
  warnings: [],
  directExtractorName: "pdfjs-dist",
  directExtractorVersion: "5.4.149",
  ocrExtractorName: null,
  ocrExtractorVersion: null,
  rasterizerName: null,
  rasterizerVersion: null,
};

function dependencies(): ExtractNeutralIntakeDependencies {
  return {
    loadIntake: vi.fn(async () => intake),
    readBounded: vi.fn(async () => ({ disposition: "FOUND" as const, body })),
    extract: vi.fn(async () => result),
    persist: vi.fn(async (attempt) => ({ id: "attempt-1", outcome: attempt.outcome })),
    createAttemptId: vi.fn(() => "logical-attempt-1"),
    now: vi.fn()
      .mockReturnValueOnce(new Date("2026-09-12T10:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-09-12T10:00:01.000Z")),
  };
}

describe("B2C9 NeutralIntake extraction service", () => {
  it("uses the existing provider locator through the bounded storage boundary", async () => {
    const deps = dependencies();
    await expect(extractNeutralIntake("intake-1", deps)).resolves.toMatchObject({ outcome: "SUCCEEDED" });
    expect(deps.readBounded).toHaveBeenCalledWith({
      storageProvider: "local",
      storageBucket: null,
      storageKey: intake.storageKey,
      maxBytes: 25 * 1024 * 1024,
    });
    expect(deps.persist).toHaveBeenCalledOnce();
    expect((deps.persist as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      outcome: "SUCCEEDED",
      neutralIntakeId: "intake-1",
      policyVersion: "B2C9_EXTRACTION_POLICY_V1",
      attemptId: "logical-attempt-1",
    });
  });

  it("creates one logical identity per deliberate service invocation", async () => {
    const deps = dependencies();
    const createAttemptId = vi.fn()
      .mockReturnValueOnce("logical-attempt-1")
      .mockReturnValueOnce("logical-attempt-2");
    deps.createAttemptId = createAttemptId;
    await extractNeutralIntake("intake-1", deps);
    await extractNeutralIntake("intake-1", deps);
    expect((deps.persist as ReturnType<typeof vi.fn>).mock.calls.map(([attempt]) => attempt.attemptId))
      .toEqual(["logical-attempt-1", "logical-attempt-2"]);
  });

  it("classifies unknown extractor failures in the extraction domain", async () => {
    const deps = dependencies();
    deps.extract = vi.fn(async () => { throw new Error("unexpected parser defect"); });
    await expect(extractNeutralIntake("intake-1", deps)).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "INTERNAL_EXTRACTION_FAILURE",
    });
  });

  it("persists one bounded deterministic failure without invoking the extractor", async () => {
    const deps = dependencies();
    deps.readBounded = vi.fn(async () => {
      throw new ExtractionFailure("ARTIFACT_TOO_LARGE");
    });
    await expect(extractNeutralIntake("intake-1", deps)).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "ARTIFACT_TOO_LARGE",
    });
    expect(deps.extract).not.toHaveBeenCalled();
    expect(deps.persist).toHaveBeenCalledOnce();
  });

  it("rejects oversized intake metadata before reading storage", async () => {
    const deps = dependencies();
    deps.loadIntake = vi.fn(async () => ({ ...intake, sizeBytes: 25 * 1024 * 1024 + 1 }));
    await expect(extractNeutralIntake("intake-1", deps)).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "ARTIFACT_TOO_LARGE",
    });
    expect(deps.readBounded).not.toHaveBeenCalled();
    expect(deps.extract).not.toHaveBeenCalled();
    expect(deps.persist).toHaveBeenCalledOnce();
  });

  it("persists one deterministic failure when the stored artifact is missing", async () => {
    const deps = dependencies();
    deps.readBounded = vi.fn(async () => ({ disposition: "MISSING" as const }));
    await expect(extractNeutralIntake("intake-1", deps)).resolves.toMatchObject({
      outcome: "FAILED",
      failureCode: "STORAGE_READ_FAILURE",
    });
    expect(deps.extract).not.toHaveBeenCalled();
    expect(deps.persist).toHaveBeenCalledOnce();
  });

  it("does not reinterpret a persistence failure as an extraction failure", async () => {
    const deps = dependencies();
    deps.persist = vi.fn(async (_attempt: CompletedExtractionAttempt) => {
      throw new Error("database unavailable");
    });
    await expect(extractNeutralIntake("intake-1", deps)).rejects.toThrow("database unavailable");
    expect(deps.persist).toHaveBeenCalledOnce();
  });
});
