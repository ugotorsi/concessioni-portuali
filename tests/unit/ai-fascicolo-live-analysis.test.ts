import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const buildSnapshotMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/ai/fascicoloSnapshot", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/ai/fascicoloSnapshot")>();
  return {
    ...original,
    buildAiFascicoloSnapshotV1: buildSnapshotMock,
  };
});

import {
  AiFascicoloAnalysisError,
  type AiAnalysisProvider,
  type ProviderAnalysisPayloadV1,
} from "@/server/ai/fascicoloAnalysis";
import {
  AiFascicoloLiveAnalysisError,
  AiProviderAdapterError,
  createFascicoloLiveAnalysisService as createFascicoloLiveAnalysisServiceBase,
  type AiFascicoloLiveAnalysisLogEvent,
} from "@/server/ai/fascicoloLiveAnalysis";
import { AiFascicoloSnapshotError } from "@/server/ai/fascicoloSnapshot";
import { createRealDataActivationPolicy } from "@/server/ai/realDataActivation";

const approvedActivation = createRealDataActivationPolicy({
  AI_REAL_DATA_ENABLED: "true",
  AI_REAL_DATA_APPROVAL_ID: "UNIT-TEST-APPROVAL",
  AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
});

function createFascicoloLiveAnalysisService(
  config: Omit<Parameters<typeof createFascicoloLiveAnalysisServiceBase>[0], "realDataActivation">,
) {
  return createFascicoloLiveAnalysisServiceBase({
    ...config,
    realDataActivation: approvedActivation,
  });
}

function snapshotFixture(note = "Nota tecnica") {
  return {
    content: {
      procedimento: { id: "proc-1", noteIstruttorie: note },
      documents: [],
      criticita: { coverage: "SELECTED", items: [] },
      pagamenti: { coverage: "SELECTED", items: [] },
      scadenze: { coverage: "SELECTED", items: [] },
      sopralluoghi: { coverage: "SELECTED", items: [] },
    },
    metadata: {
      schemaVersion: "ai-fascicolo-snapshot/v1",
      generatedAt: "2026-08-15T08:00:00.000Z",
      generatedByActorId: "actor-1",
      generatedByRole: "ADMIN",
      contentHashAlgorithm: "sha256",
      contentHash: "a".repeat(64),
    },
  };
}

function validProviderPayload(): ProviderAnalysisPayloadV1 {
  return {
    summary: { text: "Sintesi registrata.", basisRefs: ["procedimento.id"] },
    timeline: [],
    recordedState: [{ text: "Stato registrato.", basisRefs: ["procedimento.id"] }],
    signals: [{ type: "INFO", text: "Dato registrato.", basisRefs: ["procedimento.id"] }],
    investigativeQuestions: [],
    suggestedActivities: [],
    legalResearchQuestions: [],
  };
}

function fakeProvider(output: unknown = validProviderPayload()) {
  const analyze = vi.fn<AiAnalysisProvider["analyze"]>().mockResolvedValue(output);
  return { provider: { analyze } satisfies AiAnalysisProvider, analyze };
}

function expectLiveError(error: unknown, code: string) {
  expect(error).toBeInstanceOf(AiFascicoloLiveAnalysisError);
  expect((error as AiFascicoloLiveAnalysisError).code).toBe(code);
}

function sourceText() {
  return readFileSync(resolve(process.cwd(), "src/server/ai/fascicoloLiveAnalysis.ts"), "utf8");
}

describe("AI-01B1 provider-independent live orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildSnapshotMock.mockResolvedValue(snapshotFixture());
  });

  it("accepts only procedimentoId and builds the trusted snapshot exactly once", async () => {
    const { provider } = fakeProvider();
    const service = createFascicoloLiveAnalysisService({ provider, maxInputBytes: 100_000 });
    expect(service.analyze.length).toBe(1);
    await service.analyze("proc-1");
    expect(buildSnapshotMock).toHaveBeenCalledOnce();
    expect(buildSnapshotMock).toHaveBeenCalledWith("proc-1");
  });

  it("propagates AI-00 errors unchanged and never invokes the provider", async () => {
    const snapshotError = new AiFascicoloSnapshotError("TENANT_ACCESS_DENIED");
    buildSnapshotMock.mockRejectedValue(snapshotError);
    const { provider, analyze } = fakeProvider();
    const service = createFascicoloLiveAnalysisService({ provider, maxInputBytes: 100_000 });
    await expect(service.analyze("proc-1")).rejects.toBe(snapshotError);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("builds the snapshot once but invokes no provider when the real-data gate is closed", async () => {
    const { provider, analyze } = fakeProvider();
    const service = createFascicoloLiveAnalysisServiceBase({
      provider,
      maxInputBytes: 100_000,
      realDataActivation: createRealDataActivationPolicy({}),
    });
    await expect(service.analyze("proc-1")).rejects.toSatisfy((error: unknown) => {
      expect((error as { code?: string }).code).toBe("AI_REAL_DATA_DISABLED");
      expect((error as Error).message).toBe("AI_REAL_DATA_DISABLED");
      return true;
    });
    expect(buildSnapshotMock).toHaveBeenCalledOnce();
    expect(analyze).not.toHaveBeenCalled();
  });

  it.each([
    "UNAUTHENTICATED",
    "AI_ROLE_FORBIDDEN",
    "PROCEDIMENTO_NOT_FOUND",
    "TENANT_ACCESS_DENIED",
    "SOURCE_INCONSISTENCY",
  ] as const)("preserves AI-00 %s before the closed gate", async (code) => {
    const snapshotError = new AiFascicoloSnapshotError(code);
    buildSnapshotMock.mockRejectedValue(snapshotError);
    const { provider, analyze } = fakeProvider();
    const service = createFascicoloLiveAnalysisServiceBase({
      provider,
      maxInputBytes: 100_000,
      realDataActivation: createRealDataActivationPolicy({}),
    });
    await expect(service.analyze("proc-1")).rejects.toBe(snapshotError);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("rejects missing, zero, negative, non-integer, and non-finite byte limits", () => {
    const { provider } = fakeProvider();
    for (const maxInputBytes of [
      undefined,
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => createFascicoloLiveAnalysisService({ provider, maxInputBytes })).toThrowError(
        expect.objectContaining({ code: "AI_CONFIGURATION_ERROR" }),
      );
    }
    expect(buildSnapshotMock).not.toHaveBeenCalled();
  });

  it("accepts Number.MAX_SAFE_INTEGER as valid configuration", async () => {
    const { provider, analyze } = fakeProvider();
    const service = createFascicoloLiveAnalysisService({
      provider,
      maxInputBytes: Number.MAX_SAFE_INTEGER,
    });
    await expect(service.analyze("proc-1")).resolves.toMatchObject({ schemaVersion: "ai-fascicolo-analysis/v1" });
    expect(buildSnapshotMock).toHaveBeenCalledOnce();
    expect(analyze).toHaveBeenCalledOnce();
  });

  it("measures the actual provider request in UTF-8 bytes", async () => {
    const asciiEvents: AiFascicoloLiveAnalysisLogEvent[] = [];
    const asciiProvider = fakeProvider();
    const asciiService = createFascicoloLiveAnalysisService({
      provider: asciiProvider.provider,
      maxInputBytes: 100_000,
      logger: { log: (event) => asciiEvents.push(event) },
    });
    buildSnapshotMock.mockResolvedValue(snapshotFixture("aaaaaaaa"));
    await asciiService.analyze("proc-1");

    const unicodeEvents: AiFascicoloLiveAnalysisLogEvent[] = [];
    const unicodeProvider = fakeProvider();
    const unicodeService = createFascicoloLiveAnalysisService({
      provider: unicodeProvider.provider,
      maxInputBytes: 100_000,
      logger: { log: (event) => unicodeEvents.push(event) },
    });
    buildSnapshotMock.mockResolvedValue(snapshotFixture("àààààààà"));
    await unicodeService.analyze("proc-1");

    expect(unicodeEvents[0].inputBytes).toBeGreaterThan(asciiEvents[0].inputBytes);
  });

  it("accepts the exact byte boundary", async () => {
    const events: AiFascicoloLiveAnalysisLogEvent[] = [];
    const probe = fakeProvider();
    const probeService = createFascicoloLiveAnalysisService({
      provider: probe.provider,
      maxInputBytes: 100_000,
      logger: { log: (event) => events.push(event) },
    });
    await probeService.analyze("proc-1");
    const exactBytes = events[0].inputBytes;

    const exact = fakeProvider();
    const service = createFascicoloLiveAnalysisService({ provider: exact.provider, maxInputBytes: exactBytes });
    await expect(service.analyze("proc-1")).resolves.toMatchObject({ schemaVersion: "ai-fascicolo-analysis/v1" });
    expect(exact.analyze).toHaveBeenCalledOnce();
  });

  it("rejects boundary plus one before invoking the configured provider without truncation", async () => {
    const events: AiFascicoloLiveAnalysisLogEvent[] = [];
    const probe = fakeProvider();
    const probeService = createFascicoloLiveAnalysisService({
      provider: probe.provider,
      maxInputBytes: 100_000,
      logger: { log: (event) => events.push(event) },
    });
    await probeService.analyze("proc-1");
    const exactBytes = events[0].inputBytes;

    const blocked = fakeProvider();
    const service = createFascicoloLiveAnalysisService({
      provider: blocked.provider,
      maxInputBytes: exactBytes - 1,
    });
    await expect(service.analyze("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectLiveError(error, "AI_INPUT_TOO_LARGE");
      return true;
    });
    expect(blocked.analyze).not.toHaveBeenCalled();
    expect(buildSnapshotMock.mock.calls).toHaveLength(2);
  });

  it("invokes the provider at most once and performs no automatic retry", async () => {
    const providerFailure = new Error("PROGRAMMING_FAILURE");
    const analyze = vi.fn<AiAnalysisProvider["analyze"]>().mockRejectedValue(providerFailure);
    const service = createFascicoloLiveAnalysisService({
      provider: { analyze },
      maxInputBytes: 100_000,
    });
    await expect(service.analyze("proc-1")).rejects.toBe(providerFailure);
    expect(analyze).toHaveBeenCalledOnce();
  });

  it("flows successful and malformed output through authoritative AI-01A validation", async () => {
    const valid = fakeProvider();
    const validService = createFascicoloLiveAnalysisService({ provider: valid.provider, maxInputBytes: 100_000 });
    await expect(validService.analyze("proc-1")).resolves.toMatchObject({
      schemaVersion: "ai-fascicolo-analysis/v1",
      snapshotContentHash: "a".repeat(64),
    });

    const malformed = fakeProvider({ summary: "invalid" });
    const malformedService = createFascicoloLiveAnalysisService({ provider: malformed.provider, maxInputBytes: 100_000 });
    await expect(malformedService.analyze("proc-1")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AiFascicoloAnalysisError);
      expect((error as AiFascicoloAnalysisError).code).toBe("INVALID_PROVIDER_OUTPUT");
      return true;
    });
    expect(malformed.analyze).toHaveBeenCalledOnce();
  });

  it.each([
    ["TIMEOUT", "AI_PROVIDER_TIMEOUT"],
    ["UNAVAILABLE", "AI_PROVIDER_UNAVAILABLE"],
    ["RATE_LIMITED", "AI_PROVIDER_RATE_LIMITED"],
    ["CONFIGURATION", "AI_CONFIGURATION_ERROR"],
  ] as const)("maps normalized adapter %s failures to %s", async (category, expectedCode) => {
    const analyze = vi.fn<AiAnalysisProvider["analyze"]>().mockRejectedValue(new AiProviderAdapterError(category));
    const service = createFascicoloLiveAnalysisService({ provider: { analyze }, maxInputBytes: 100_000 });
    await expect(service.analyze("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectLiveError(error, expectedCode);
      expect(error).not.toHaveProperty("cause");
      return true;
    });
  });

  it("does not overmap unexpected provider or programming errors", async () => {
    const genericError = new Error("GENERIC_PROVIDER_INTERNAL_DETAIL");
    const analyze = vi.fn<AiAnalysisProvider["analyze"]>().mockRejectedValue(genericError);
    const service = createFascicoloLiveAnalysisService({ provider: { analyze }, maxInputBytes: 100_000 });
    await expect(service.analyze("proc-1")).rejects.toBe(genericError);
  });

  it("logs only allowlisted technical metadata when a logger is injected", async () => {
    const events: AiFascicoloLiveAnalysisLogEvent[] = [];
    const { provider } = fakeProvider();
    const service = createFascicoloLiveAnalysisService({
      provider,
      maxInputBytes: 100_000,
      providerIdentifier: "provider-safe-id",
      modelIdentifier: "model-safe-id",
      logger: { log: (event) => events.push(event) },
    });
    await service.analyze("proc-1");
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]).sort()).toEqual([
      "analysisSchemaVersion",
      "durationMs",
      "inputBytes",
      "modelIdentifier",
      "outcome",
      "providerIdentifier",
      "snapshotContentHash",
      "snapshotSchemaVersion",
    ]);
    const serialized = JSON.stringify(events);
    for (const sensitive of ["Nota tecnica", "provider request", "api key", "authorization", "document"] ) {
      expect(serialized.toLowerCase()).not.toContain(sensitive.toLowerCase());
    }
  });

  it("logs oversize failures with metrics and normalized category only", async () => {
    const events: AiFascicoloLiveAnalysisLogEvent[] = [];
    const { provider, analyze } = fakeProvider();
    const service = createFascicoloLiveAnalysisService({
      provider,
      maxInputBytes: 1,
      logger: { log: (event) => events.push(event) },
    });
    await expect(service.analyze("proc-1")).rejects.toBeInstanceOf(AiFascicoloLiveAnalysisError);
    expect(analyze).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: "ERROR", errorCategory: "AI_INPUT_TOO_LARGE" });
    expect(events[0].inputBytes).toBeGreaterThan(1);
  });

  it("keeps a successful analysis successful when the synchronous logger throws", async () => {
    const { provider, analyze } = fakeProvider();
    const logger = { log: vi.fn(() => { throw new Error("LOGGER_FAILURE"); }) };
    const service = createFascicoloLiveAnalysisService({
      provider,
      maxInputBytes: 100_000,
      logger,
    });
    await expect(service.analyze("proc-1")).resolves.toMatchObject({ schemaVersion: "ai-fascicolo-analysis/v1" });
    expect(analyze).toHaveBeenCalledOnce();
    expect(logger.log).toHaveBeenCalledOnce();
  });

  it("preserves AI_INPUT_TOO_LARGE when the error logger throws", async () => {
    const { provider, analyze } = fakeProvider();
    const logger = { log: vi.fn(() => { throw new Error("LOGGER_FAILURE"); }) };
    const service = createFascicoloLiveAnalysisService({ provider, maxInputBytes: 1, logger });
    await expect(service.analyze("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectLiveError(error, "AI_INPUT_TOO_LARGE");
      return true;
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledOnce();
  });

  it("preserves normalized provider timeout when the error logger throws", async () => {
    const analyze = vi.fn<AiAnalysisProvider["analyze"]>().mockRejectedValue(new AiProviderAdapterError("TIMEOUT"));
    const logger = { log: vi.fn(() => { throw new Error("LOGGER_FAILURE"); }) };
    const service = createFascicoloLiveAnalysisService({
      provider: { analyze },
      maxInputBytes: 100_000,
      logger,
    });
    await expect(service.analyze("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectLiveError(error, "AI_PROVIDER_TIMEOUT");
      return true;
    });
    expect(analyze).toHaveBeenCalledOnce();
    expect(logger.log).toHaveBeenCalledOnce();
  });

  it("exposes no client-supplied snapshot path or live side-effect boundary", () => {
    const source = sourceText().toLowerCase();
    expect(source).toContain("async analyze(procedimentoid: string)");
    expect(source).not.toMatch(/async analyze\([^)]*(?:snapshot|contenthash|systempolicy|limitations|provideroutput)/);
    for (const forbidden of [
      "fetch(",
      "axios",
      "openai",
      "anthropic",
      "simpliciter",
      "process.env",
      "next_public",
      "@/lib/prisma",
      "storagekey",
      "storagepath",
      "server/actions",
      "revalidatepath",
      "createaudit",
      ".create(",
      ".update(",
      ".delete(",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
