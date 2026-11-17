import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const buildSnapshotMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/ai/fascicoloSnapshot", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/ai/fascicoloSnapshot")>();
  return {
    ...original,
    buildAiFascicoloSnapshotV1: buildSnapshotMock,
  };
});

import {
  AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_LIMITATIONS,
  type AiOutboundAnalysisProvider,
  type AiOutboundAnalysisProviderRequestV1,
} from "@/server/ai/fascicoloAnalysis";
import {
  AiFascicoloLiveAnalysisError,
  AiProviderAdapterError,
  createFascicoloLiveAnalysisService as createFascicoloLiveAnalysisServiceBase,
  type AiFascicoloLiveAnalysisLogEvent,
} from "@/server/ai/fascicoloLiveAnalysis";
import { AiFascicoloOutboundProjectionError } from "@/server/ai/fascicoloOutboundProjection";
import { buildAiFascicoloSnapshotV1 } from "@/server/ai/fascicoloSnapshot";
import { createRealDataActivationPolicy } from "@/server/ai/realDataActivation";

type Snapshot = Awaited<ReturnType<typeof buildAiFascicoloSnapshotV1>>;

const CANONICAL_CONTENT_SENTINEL = "CANONICAL_CONTENT_SENTINEL";
const CANONICAL_DB_ID_SENTINEL = "CANONICAL_DB_ID_SENTINEL";
const PROVIDER_PAYLOAD_SENTINEL = "PROVIDER_PAYLOAD_SENTINEL";

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

function snapshotFixture(): Snapshot {
  return {
    metadata: {
      schemaVersion: "ai-fascicolo-snapshot/v1",
      generatedAt: "2026-08-17T00:00:00.000Z",
      generatedByActorId: "actor-1",
      generatedByRole: "ADMIN",
      contentHashAlgorithm: "sha256",
      contentHash: "a".repeat(64),
    },
    content: {
      identityContext: {
        procedimentoId: "proc-1",
        canonicalEnteId: "ente-1",
        canonicalContent: CANONICAL_CONTENT_SENTINEL,
      },
      procedimento: {
        id: "proc-1",
        dataAvvio: "2026-01-01T00:00:00.000Z",
        dataScadenzaContraddittorio: null,
        dataProvvedimentoFinale: null,
        responsabileAssegnatoAt: null,
        comunicazioneAvvioInviata: true,
        dataComunicazioneAvvio: null,
        termineMemorieGiorni: 30,
        termineMemorieScadenza: null,
        memorieRicevute: false,
        dataRicezioneMemorie: null,
        audizioneRichiesta: false,
        audizioneSvolta: false,
        dataAudizione: null,
        sopralluogoIstruttorioSvolto: false,
        contestazioneFormaleInviata: false,
        dataContestazioneFormale: null,
        controdeduzioniValutate: false,
        preavvisoRigettoApplicabile: false,
        dataPreavvisoRigetto: null,
        termineOsservazioniPreavviso: null,
        osservazioniPreavvisoRicevute: false,
        dataOsservazioniPreavviso: null,
        responsibilityAssignments: [],
      },
      concessione: {
        id: "concessione-1",
        dataRilascio: "2020-01-01T00:00:00.000Z",
        dataScadenza: "2030-01-01T00:00:00.000Z",
      },
      concessionario: { id: "concessionario-1" },
      requirements: [],
      evidence: [],
      humanReviewReceipts: [],
      checklist: {
        checklistContraddittorioCompleta: false,
        checklistCompletedItems: 0,
        checklistTotalItems: 1,
        checklistPercentage: 0,
        evidence: [],
      },
      fascicoloObservations: [],
      documents: [{
        id: "document-1",
        dataDocumento: "2026-01-02T00:00:00.000Z",
        canonicalDbId: CANONICAL_DB_ID_SENTINEL,
      }],
      criticita: { coverage: "SELECTED", items: [] },
      pagamenti: { coverage: "SELECTED", items: [] },
      scadenze: { coverage: "SELECTED", items: [] },
      sopralluoghi: { coverage: "SELECTED", items: [] },
      finalActContext: null,
    },
  } as unknown as Snapshot;
}

function providerPayload(basisRef = "DOC_1.dataDocumento") {
  return {
    summary: { text: PROVIDER_PAYLOAD_SENTINEL, basisRefs: [basisRef] },
    timeline: [],
    recordedState: [],
    signals: [],
    investigativeQuestions: [],
    suggestedActivities: [],
    legalResearchQuestions: [],
  };
}

function fakeProvider(output: unknown = providerPayload()) {
  const analyze = vi.fn<AiOutboundAnalysisProvider["analyze"]>().mockResolvedValue(output);
  return { provider: { analyze } satisfies AiOutboundAnalysisProvider, analyze };
}

async function expectLiveError(operation: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await operation();
    throw new Error("Expected live analysis failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AiFascicoloLiveAnalysisError);
    expect((error as AiFascicoloLiveAnalysisError).code).toBe(code);
  }
}

describe("AI-01C2B2C1 B1 outbound wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildSnapshotMock.mockResolvedValue(snapshotFixture());
  });

  it("runs the unavoidable real security pipeline and returns grounded output", async () => {
    const { provider, analyze } = fakeProvider();
    const result = await createFascicoloLiveAnalysisService({
      provider,
      maxInputBytes: 100_000,
    }).analyze("proc-1");

    expect(buildSnapshotMock).toHaveBeenCalledOnce();
    expect(buildSnapshotMock).toHaveBeenCalledWith("proc-1");
    expect(analyze).toHaveBeenCalledOnce();
    expect(result.analysis.summary.basisRefs).toEqual(["DOC_1.dataDocumento"]);
    expect(result.resolvedBasisRefs).toEqual([expect.objectContaining({
      statementPath: "summary",
      providerRef: "DOC_1.dataDocumento",
      kind: "DOCUMENT",
      canonicalId: "document-1",
    })]);
  });

  it("ignores legacy semantic dependency extra properties at runtime", async () => {
    const malicious = {
      buildSnapshot: vi.fn(),
      assertActivation: vi.fn(),
      projectOutbound: vi.fn(),
      analyzeOutbound: vi.fn(),
    };
    const { provider, analyze } = fakeProvider();
    const config = {
      provider,
      maxInputBytes: 100_000,
      realDataActivation: approvedActivation,
      dependencies: malicious,
    } as unknown as Parameters<typeof createFascicoloLiveAnalysisServiceBase>[0];

    const result = await createFascicoloLiveAnalysisServiceBase(config).analyze("proc-1");

    expect(analyze).toHaveBeenCalledOnce();
    expect(result.resolvedBasisRefs).toHaveLength(1);
    for (const hook of Object.values(malicious)) {
      expect(hook).not.toHaveBeenCalled();
    }
  });

  it("does not expose semantic dependencies in the factory type", () => {
    expectTypeOf<Parameters<typeof createFascicoloLiveAnalysisServiceBase>[0]>()
      .not.toHaveProperty("dependencies");
  });

  it("stops at the real closed C1 gate before provider execution", async () => {
    const { provider, analyze } = fakeProvider();
    const service = createFascicoloLiveAnalysisServiceBase({
      provider,
      maxInputBytes: 100_000,
      realDataActivation: createRealDataActivationPolicy({}),
    });

    await expect(service.analyze("proc-1")).rejects.toMatchObject({ code: "AI_REAL_DATA_DISABLED" });
    expect(buildSnapshotMock).toHaveBeenCalledOnce();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("uses the real projector and stops malformed snapshots before provider execution", async () => {
    buildSnapshotMock.mockResolvedValue({
      metadata: { schemaVersion: "ai-fascicolo-snapshot/v1", contentHash: "a".repeat(64) },
      content: {},
    });
    const { provider, analyze } = fakeProvider();

    await expect(createFascicoloLiveAnalysisService({
      provider,
      maxInputBytes: 100_000,
    }).analyze("proc-1")).rejects.toBeInstanceOf(AiFascicoloOutboundProjectionError);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("keeps canonical, registry, source, and resolution data out of provider and telemetry", async () => {
    let capturedRequest: AiOutboundAnalysisProviderRequestV1 | undefined;
    const events: AiFascicoloLiveAnalysisLogEvent[] = [];
    const service = createFascicoloLiveAnalysisService({
      provider: {
        async analyze(request) {
          capturedRequest = request;
          return providerPayload();
        },
      },
      maxInputBytes: 100_000,
      logger: { log: (event) => events.push(event) },
      providerIdentifier: "synthetic-provider",
      modelIdentifier: "synthetic-model",
    });

    const result = await service.analyze("proc-1");
    const serializedRequest = JSON.stringify(capturedRequest);
    const serializedEvents = JSON.stringify(events);

    expect(capturedRequest).toHaveProperty("outboundData");
    expect(capturedRequest).not.toHaveProperty("snapshotData");
    for (const forbidden of [
      "basisRefRegistry",
      "resolvedBasisRefs",
      "canonicalId",
      "localAliasMapping",
      CANONICAL_CONTENT_SENTINEL,
      CANONICAL_DB_ID_SENTINEL,
      "a".repeat(64),
    ]) {
      expect(serializedRequest).not.toContain(forbidden);
    }
    expect(result.resolvedBasisRefs[0].canonicalId).toBe("document-1");
    expect(result.limitations).toEqual(AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_LIMITATIONS);
    expect(events).toHaveLength(1);
    for (const forbidden of [
      "document-1",
      CANONICAL_CONTENT_SENTINEL,
      CANONICAL_DB_ID_SENTINEL,
      PROVIDER_PAYLOAD_SENTINEL,
      "DOC_1.dataDocumento",
    ]) {
      expect(serializedEvents).not.toContain(forbidden);
    }
  });

  it("allows exact request bytes and rejects max plus one before provider delegation", async () => {
    const probe = fakeProvider();
    const probeEvents: AiFascicoloLiveAnalysisLogEvent[] = [];
    await createFascicoloLiveAnalysisService({
      provider: probe.provider,
      maxInputBytes: 100_000,
      logger: { log: (event) => probeEvents.push(event) },
    }).analyze("proc-1");
    const exactBytes = probeEvents[0].inputBytes;

    const exact = fakeProvider();
    await createFascicoloLiveAnalysisService({
      provider: exact.provider,
      maxInputBytes: exactBytes,
    }).analyze("proc-1");
    expect(exact.analyze).toHaveBeenCalledOnce();
    const exactRequest = exact.analyze.mock.calls[0][0];
    expect(Buffer.byteLength(JSON.stringify(exactRequest), "utf8")).toBe(exactBytes);

    const blocked = fakeProvider();
    await expectLiveError(
      () => createFascicoloLiveAnalysisService({
        provider: blocked.provider,
        maxInputBytes: exactBytes - 1,
      }).analyze("proc-1"),
      "AI_INPUT_TOO_LARGE",
    );
    expect(blocked.analyze).not.toHaveBeenCalled();
  });

  it.each([
    ["UNAVAILABLE", "AI_PROVIDER_UNAVAILABLE"],
    ["TIMEOUT", "AI_PROVIDER_TIMEOUT"],
    ["RATE_LIMITED", "AI_PROVIDER_RATE_LIMITED"],
    ["CONFIGURATION", "AI_CONFIGURATION_ERROR"],
  ] as const)("normalizes outbound adapter %s without retry", async (category, expectedCode) => {
    const analyze = vi.fn<AiOutboundAnalysisProvider["analyze"]>()
      .mockRejectedValue(new AiProviderAdapterError(category));

    await expectLiveError(
      () => createFascicoloLiveAnalysisService({
        provider: { analyze },
        maxInputBytes: 100_000,
      }).analyze("proc-1"),
      expectedCode,
    );
    expect(analyze).toHaveBeenCalledOnce();
  });

  it("preserves generic provider errors without retry", async () => {
    const providerError = new Error("GENERIC_PROVIDER_ERROR_SENTINEL");
    const analyze = vi.fn<AiOutboundAnalysisProvider["analyze"]>().mockRejectedValue(providerError);

    await expect(createFascicoloLiveAnalysisService({
      provider: { analyze },
      maxInputBytes: 100_000,
    }).analyze("proc-1")).rejects.toBe(providerError);
    expect(analyze).toHaveBeenCalledOnce();
  });
});
