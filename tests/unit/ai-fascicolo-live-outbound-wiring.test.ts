import { describe, expect, it } from "vitest";

import {
  AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_LIMITATIONS,
  buildOutboundProviderRequest,
  type AiFascicoloOutboundAnalysisV1,
  type AiOutboundAnalysisProvider,
  type AiOutboundAnalysisProviderRequestV1,
} from "@/server/ai/fascicoloAnalysis";
import {
  AiFascicoloLiveAnalysisError,
  AiProviderAdapterError,
  createFascicoloLiveAnalysisService,
  type AiFascicoloLiveAnalysisLogEvent,
} from "@/server/ai/fascicoloLiveAnalysis";
import {
  AiFascicoloOutboundProjectionError,
  projectAiFascicoloOutboundV1,
} from "@/server/ai/fascicoloOutboundProjection";
import { buildAiFascicoloSnapshotV1 } from "@/server/ai/fascicoloSnapshot";

type Snapshot = Awaited<ReturnType<typeof buildAiFascicoloSnapshotV1>>;
type Projection = ReturnType<typeof projectAiFascicoloOutboundV1>;

const SOURCE_HASH_SENTINEL = "SOURCE_HASH_SENTINEL_LOCAL_ONLY";
const LOCAL_MAPPING_SENTINEL = "LOCAL_MAPPING_SENTINEL";
const CANONICAL_CONTENT_SENTINEL = "CANONICAL_CONTENT_SENTINEL";
const CANONICAL_DB_ID_SENTINEL = "CANONICAL_DB_ID_SENTINEL";
const PROVIDER_PAYLOAD_SENTINEL = "PROVIDER_PAYLOAD_SENTINEL";
const OUTBOUND_HASH = "b".repeat(64);

function snapshotFixture(): Snapshot {
  return {
    metadata: {
      schemaVersion: "ai-fascicolo-snapshot/v1",
      contentHash: SOURCE_HASH_SENTINEL,
    },
    content: {
      canonicalContent: CANONICAL_CONTENT_SENTINEL,
      canonicalDbId: CANONICAL_DB_ID_SENTINEL,
    },
  } as unknown as Snapshot;
}

function projectionFixture(): Projection {
  return {
    providerBound: {
      outboundProjection: {
        schemaVersion: "ai-fascicolo-outbound/v1",
        content: {
          identityContext: {
            procedimentoAlias: "PROCEDIMENTO_A",
            enteAlias: "ENTE_A",
          },
          procedimento: {
            alias: "PROCEDIMENTO_A",
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
            alias: "TITOLO_A",
            dataRilascio: "2020-01-01T00:00:00.000Z",
            dataScadenza: "2030-01-01T00:00:00.000Z",
          },
          concessionario: {
            alias: "CONCESSIONARIO_A",
          },
          requirements: [],
          evidence: [],
          humanReview: [],
          checklist: {
            complete: false,
            completedItems: 0,
            totalItems: 1,
            percentage: 0,
            evidence: [],
          },
          observations: [],
          documents: [
            {
              alias: "DOC_1",
              dataDocumento: "2026-01-02T00:00:00.000Z",
            },
          ],
          criticita: {
            coverage: "SELECTED",
            items: [],
          },
          pagamenti: {
            coverage: "SELECTED",
            items: [],
          },
          scadenze: {
            coverage: "SELECTED",
            items: [],
          },
          sopralluoghi: {
            coverage: "SELECTED",
            items: [],
          },
          finalActContext: null,
        },
      },
      outboundProjectionHash: OUTBOUND_HASH,
      outboundProjectionHashAlgorithm: "sha256",
    },
    localOnly: {
      sourceSnapshotContentHash: SOURCE_HASH_SENTINEL,
      localAliasMapping: [
        {
          alias: "DOC_1",
          kind: "DOCUMENT",
          canonicalId: `${LOCAL_MAPPING_SENTINEL}:${CANONICAL_DB_ID_SENTINEL}`,
        },
      ],
    },
  };
}

function providerPayload(basisRef = "DOC_1.dataDocumento") {
  return {
    summary: {
      text: PROVIDER_PAYLOAD_SENTINEL,
      basisRefs: [basisRef],
    },
    timeline: [],
    recordedState: [],
    signals: [],
    investigativeQuestions: [],
    suggestedActivities: [],
    legalResearchQuestions: [],
  };
}

function trustedResultFixture(): AiFascicoloOutboundAnalysisV1 {
  return {
    analysisSchemaVersion: "ai-fascicolo-analysis/v1",
    snapshotSchemaVersion: "ai-fascicolo-snapshot/v1",
    outboundSchemaVersion: "ai-fascicolo-outbound/v1",
    sourceSnapshotContentHash: SOURCE_HASH_SENTINEL,
    outboundProjectionHash: OUTBOUND_HASH,
    outboundProjectionHashAlgorithm: "sha256",
    generatedAt: "2026-08-16T00:00:00.000Z",
    analysis: providerPayload(),
    limitations: AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_LIMITATIONS,
  };
}

function exactOutboundRequestBytes(): number {
  return Buffer.byteLength(
    JSON.stringify(buildOutboundProviderRequest(projectionFixture().providerBound)),
    "utf8",
  );
}

function baseDependencies() {
  return {
    buildSnapshot: async () => snapshotFixture(),
    assertActivation: () => undefined,
    projectOutbound: () => projectionFixture(),
  };
}

async function expectLiveError(
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation();
    throw new Error("Expected live analysis failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AiFascicoloLiveAnalysisError);
    expect((error as AiFascicoloLiveAnalysisError).code).toBe(code);
    expect((error as Error).message).toBe(code);
  }
}

describe("AI-01C2B2C1 B1 outbound wiring", () => {
  it("runs snapshot, activation, projection, outbound analysis, and provider in exact order", async () => {
    const calls: string[] = [];
    let snapshotCalls = 0;
    let activationCalls = 0;
    let projectionCalls = 0;
    let analysisCalls = 0;
    let providerCalls = 0;
    const provider: AiOutboundAnalysisProvider = {
      async analyze() {
        providerCalls += 1;
        calls.push("provider");
        return providerPayload();
      },
    };
    const service = createFascicoloLiveAnalysisService({
      provider,
      maxInputBytes: 100_000,
      dependencies: {
        buildSnapshot: async () => {
          snapshotCalls += 1;
          calls.push("snapshot");
          return snapshotFixture();
        },
        assertActivation: () => {
          activationCalls += 1;
          calls.push("activation");
        },
        projectOutbound: () => {
          projectionCalls += 1;
          calls.push("projection");
          return projectionFixture();
        },
        analyzeOutbound: async (input) => {
          analysisCalls += 1;
          calls.push("analysis");
          await input.provider.analyze(buildOutboundProviderRequest(input.providerBound));
          return trustedResultFixture();
        },
      },
    });

    await service.analyze("synthetic-procedimento");

    expect(calls).toEqual(["snapshot", "activation", "projection", "analysis", "provider"]);
    expect(snapshotCalls).toBe(1);
    expect(activationCalls).toBe(1);
    expect(projectionCalls).toBe(1);
    expect(analysisCalls).toBe(1);
    expect(providerCalls).toBe(1);
  });

  it("stops at C1 failure before projection or provider", async () => {
    const activationError = new Error("AI_REAL_DATA_DISABLED");
    let snapshotCalls = 0;
    let activationCalls = 0;
    let projectionCalls = 0;
    let providerCalls = 0;
    const service = createFascicoloLiveAnalysisService({
      provider: {
        async analyze() {
          providerCalls += 1;
          return providerPayload();
        },
      },
      maxInputBytes: 100_000,
      dependencies: {
        buildSnapshot: async () => {
          snapshotCalls += 1;
          return snapshotFixture();
        },
        assertActivation: () => {
          activationCalls += 1;
          throw activationError;
        },
        projectOutbound: () => {
          projectionCalls += 1;
          return projectionFixture();
        },
      },
    });

    await expect(service.analyze("synthetic-procedimento")).rejects.toBe(activationError);
    expect(snapshotCalls).toBe(1);
    expect(activationCalls).toBe(1);
    expect(projectionCalls).toBe(0);
    expect(providerCalls).toBe(0);
  });

  it("preserves projection errors and never calls the provider", async () => {
    const projectionError = new AiFascicoloOutboundProjectionError("INVALID_SOURCE_SNAPSHOT");
    let projectionCalls = 0;
    let providerCalls = 0;
    const service = createFascicoloLiveAnalysisService({
      provider: {
        async analyze() {
          providerCalls += 1;
          return providerPayload();
        },
      },
      maxInputBytes: 100_000,
      dependencies: {
        buildSnapshot: async () => snapshotFixture(),
        assertActivation: () => undefined,
        projectOutbound: () => {
          projectionCalls += 1;
          throw projectionError;
        },
      },
    });

    await expect(service.analyze("synthetic-procedimento")).rejects.toBe(projectionError);
    expect(projectionCalls).toBe(1);
    expect(providerCalls).toBe(0);
  });

  it("uses the real outbound analyzer and keeps canonical, source, and mapping data out of provider and telemetry", async () => {
    let providerCalls = 0;
    let capturedRequest: AiOutboundAnalysisProviderRequestV1 | undefined;
    const events: AiFascicoloLiveAnalysisLogEvent[] = [];
    const service = createFascicoloLiveAnalysisService({
      provider: {
        async analyze(request) {
          providerCalls += 1;
          capturedRequest = request;
          return providerPayload("DOC_999.stato");
        },
      },
      maxInputBytes: 100_000,
      logger: { log: (event) => events.push(event) },
      providerIdentifier: "synthetic-provider",
      modelIdentifier: "synthetic-model",
      dependencies: baseDependencies(),
    });

    const result = await service.analyze("synthetic-procedimento");
    const serializedRequest = JSON.stringify(capturedRequest);
    const serializedResult = JSON.stringify(result);
    const serializedEvents = JSON.stringify(events);

    expect(providerCalls).toBe(1);
    expect(capturedRequest).toHaveProperty("outboundData");
    expect(capturedRequest).not.toHaveProperty("snapshotData");
    expect(serializedRequest).toContain(OUTBOUND_HASH);
    expect(serializedRequest).toContain("sha256");
    expect(serializedRequest).toContain("PROVIDER_VISIBLE_OUTBOUND_ALIAS_OR_PATH_ONLY");
    for (const forbidden of [
      SOURCE_HASH_SENTINEL,
      LOCAL_MAPPING_SENTINEL,
      CANONICAL_CONTENT_SENTINEL,
      CANONICAL_DB_ID_SENTINEL,
      "localAliasMapping",
      "localOnly",
    ]) {
      expect(serializedRequest).not.toContain(forbidden);
    }
    expect(result.sourceSnapshotContentHash).toBe(SOURCE_HASH_SENTINEL);
    expect(result.outboundProjectionHash).toBe(OUTBOUND_HASH);
    expect(result.limitations).toEqual(AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_LIMITATIONS);
    expect(result.analysis.summary.basisRefs).toEqual(["DOC_999.stato"]);
    expect(serializedResult).not.toContain(LOCAL_MAPPING_SENTINEL);
    expect(result).not.toHaveProperty("localAliasMapping");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: "SUCCESS",
      snapshotSchemaVersion: "ai-fascicolo-snapshot/v1",
      outboundSchemaVersion: "ai-fascicolo-outbound/v1",
      outboundProjectionHash: OUTBOUND_HASH,
      analysisSchemaVersion: "ai-fascicolo-analysis/v1",
      providerIdentifier: "synthetic-provider",
      modelIdentifier: "synthetic-model",
    });
    expect(events[0]).not.toHaveProperty("snapshotContentHash");
    for (const forbidden of [
      SOURCE_HASH_SENTINEL,
      LOCAL_MAPPING_SENTINEL,
      CANONICAL_CONTENT_SENTINEL,
      CANONICAL_DB_ID_SENTINEL,
      PROVIDER_PAYLOAD_SENTINEL,
    ]) {
      expect(serializedEvents).not.toContain(forbidden);
    }
  });

  it("allows a request whose exact serialized bytes equal maxInputBytes", async () => {
    const exactBytes = exactOutboundRequestBytes();
    let providerCalls = 0;
    let capturedRequest: AiOutboundAnalysisProviderRequestV1 | undefined;
    const service = createFascicoloLiveAnalysisService({
      provider: {
        async analyze(request) {
          providerCalls += 1;
          capturedRequest = request;
          return providerPayload();
        },
      },
      maxInputBytes: exactBytes,
      dependencies: baseDependencies(),
    });

    await service.analyze("synthetic-procedimento");

    expect(providerCalls).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(capturedRequest), "utf8")).toBe(exactBytes);
  });

  it("rejects max plus one before provider delegation without truncation and logs only safe metadata", async () => {
    const exactBytes = exactOutboundRequestBytes();
    let providerCalls = 0;
    const events: AiFascicoloLiveAnalysisLogEvent[] = [];
    const service = createFascicoloLiveAnalysisService({
      provider: {
        async analyze() {
          providerCalls += 1;
          return providerPayload();
        },
      },
      maxInputBytes: exactBytes - 1,
      logger: { log: (event) => events.push(event) },
      dependencies: baseDependencies(),
    });

    await expectLiveError(
      () => service.analyze("synthetic-procedimento"),
      "AI_INPUT_TOO_LARGE",
    );

    expect(providerCalls).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: "ERROR",
      errorCategory: "AI_INPUT_TOO_LARGE",
      inputBytes: exactBytes,
      outboundProjectionHash: OUTBOUND_HASH,
    });
    expect(JSON.stringify(events)).not.toContain(SOURCE_HASH_SENTINEL);
    expect(JSON.stringify(events)).not.toContain(LOCAL_MAPPING_SENTINEL);
    expect(JSON.stringify(events)).not.toContain(CANONICAL_CONTENT_SENTINEL);
    expect(JSON.stringify(events)).not.toContain(PROVIDER_PAYLOAD_SENTINEL);
  });

  it.each([
    ["UNAVAILABLE", "AI_PROVIDER_UNAVAILABLE"],
    ["TIMEOUT", "AI_PROVIDER_TIMEOUT"],
    ["RATE_LIMITED", "AI_PROVIDER_RATE_LIMITED"],
    ["CONFIGURATION", "AI_CONFIGURATION_ERROR"],
  ] as const)("normalizes outbound adapter %s without retry", async (category, expectedCode) => {
    let providerCalls = 0;
    const service = createFascicoloLiveAnalysisService({
      provider: {
        async analyze() {
          providerCalls += 1;
          throw new AiProviderAdapterError(category);
        },
      },
      maxInputBytes: 100_000,
      dependencies: baseDependencies(),
    });

    await expectLiveError(
      () => service.analyze("synthetic-procedimento"),
      expectedCode,
    );
    expect(providerCalls).toBe(1);
  });

  it("preserves generic provider errors without retry or projection remapping", async () => {
    const providerError = new Error("GENERIC_PROVIDER_ERROR_SENTINEL");
    let providerCalls = 0;
    const service = createFascicoloLiveAnalysisService({
      provider: {
        async analyze() {
          providerCalls += 1;
          throw providerError;
        },
      },
      maxInputBytes: 100_000,
      dependencies: baseDependencies(),
    });

    await expect(service.analyze("synthetic-procedimento")).rejects.toBe(providerError);
    expect(providerCalls).toBe(1);
  });
});
