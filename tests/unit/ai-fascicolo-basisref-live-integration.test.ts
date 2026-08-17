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
  analyzeFascicoloOutboundV1,
  buildOutboundProviderRequest,
  type AiFascicoloOutboundProviderBoundV1,
  type AiFascicoloTrustedHashContextV1,
  type AiOutboundAnalysisProvider,
  type AiOutboundAnalysisProviderRequestV1,
  type ProviderAnalysisPayloadV1,
} from "@/server/ai/fascicoloAnalysis";
import {
  AiFascicoloBasisRefResolutionError,
  buildAiFascicoloBasisRefRegistryV1,
  type AiFascicoloBasisRefRegistryV1,
} from "@/server/ai/fascicoloBasisRefResolution";
import {
  AiFascicoloLiveAnalysisError,
  AiProviderAdapterError,
  createFascicoloLiveAnalysisService,
  type AiFascicoloLiveAnalysisLogEvent,
} from "@/server/ai/fascicoloLiveAnalysis";
import {
  AiFascicoloOutboundProjectionError,
  type AiFascicoloOutboundProjectionResultV1,
} from "@/server/ai/fascicoloOutboundProjection";
import type { buildAiFascicoloSnapshotV1 } from "@/server/ai/fascicoloSnapshot";
import { createRealDataActivationPolicy } from "@/server/ai/realDataActivation";

type Snapshot = Awaited<ReturnType<typeof buildAiFascicoloSnapshotV1>>;
type Projection = AiFascicoloOutboundProjectionResultV1;
type LocalAliasMapping = Projection["localOnly"]["localAliasMapping"];

const OUTBOUND_HASH = "b".repeat(64);
const ALTERNATE_HASH = "c".repeat(64);
const SOURCE_HASH_SENTINEL = "SOURCE_HASH_SENTINEL_LOCAL_ONLY";
const CANONICAL_ID_SENTINEL = "CANONICAL_ID_SENTINEL";
const LOCAL_MAPPING_SENTINEL = "LOCAL_MAPPING_SENTINEL";
const approvedActivation = createRealDataActivationPolicy({
  AI_REAL_DATA_ENABLED: "true",
  AI_REAL_DATA_APPROVAL_ID: "UNIT-TEST-APPROVAL",
  AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
});

function providerBoundFixture(
  outboundProjectionHash = OUTBOUND_HASH,
): AiFascicoloOutboundProviderBoundV1 {
  return {
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
        documents: [{
          alias: "DOC_1",
          dataDocumento: "2026-01-02T00:00:00.000Z",
        }],
        criticita: { coverage: "SELECTED", items: [] },
        pagamenti: { coverage: "SELECTED", items: [] },
        scadenze: { coverage: "SELECTED", items: [] },
        sopralluoghi: { coverage: "SELECTED", items: [] },
        finalActContext: null,
      },
    },
    outboundProjectionHash,
    outboundProjectionHashAlgorithm: "sha256",
  };
}

function localAliasMappingFixture(): LocalAliasMapping {
  return [
    { alias: "PROCEDIMENTO_A", kind: "PROCEDIMENTO", canonicalId: `${CANONICAL_ID_SENTINEL}:PROCEDIMENTO` },
    { alias: "ENTE_A", kind: "ENTE", canonicalId: `${CANONICAL_ID_SENTINEL}:ENTE` },
    { alias: "TITOLO_A", kind: "CONCESSIONE", canonicalId: `${CANONICAL_ID_SENTINEL}:TITOLO` },
    { alias: "CONCESSIONARIO_A", kind: "CONCESSIONARIO", canonicalId: `${CANONICAL_ID_SENTINEL}:CONCESSIONARIO` },
    { alias: "DOC_1", kind: "DOCUMENT", canonicalId: `${CANONICAL_ID_SENTINEL}:${LOCAL_MAPPING_SENTINEL}:DOC_1` },
  ];
}

function registryFixture(providerBound = providerBoundFixture()): AiFascicoloBasisRefRegistryV1 {
  return buildAiFascicoloBasisRefRegistryV1({
    providerBound,
    localAliasMapping: localAliasMappingFixture(),
  });
}

function trustedContextFixture(
  providerBound = providerBoundFixture(),
): AiFascicoloTrustedHashContextV1 {
  return {
    snapshotSchemaVersion: "ai-fascicolo-snapshot/v1",
    outboundSchemaVersion: providerBound.outboundProjection.schemaVersion,
    sourceSnapshotContentHash: SOURCE_HASH_SENTINEL,
    outboundProjectionHash: providerBound.outboundProjectionHash,
    outboundProjectionHashAlgorithm: providerBound.outboundProjectionHashAlgorithm,
  };
}

function allSectionsPayload(): ProviderAnalysisPayloadV1 {
  return {
    summary: { text: "Summary", basisRefs: ["DOC_1.dataDocumento"] },
    timeline: [{
      recordedAt: "2026-01-02T00:00:00.000Z",
      text: "Timeline",
      basisRefs: ["PROCEDIMENTO_A.dataAvvio"],
    }],
    recordedState: [{ text: "State", basisRefs: ["checklist.complete"] }],
    signals: [{ type: "INFO", text: "Signal", basisRefs: ["TITOLO_A.dataRilascio"] }],
    investigativeQuestions: [{ text: "Question", basisRefs: ["DOC_1"] }],
    suggestedActivities: [{ text: "Activity", basisRefs: ["identityContext.enteAlias"] }],
    legalResearchQuestions: [{ text: "Research", basisRefs: ["criticita.coverage"] }],
  };
}

function providerFor(output: unknown) {
  let calls = 0;
  let capturedRequest: AiOutboundAnalysisProviderRequestV1 | undefined;
  const provider: AiOutboundAnalysisProvider = {
    async analyze(request) {
      calls += 1;
      capturedRequest = request;
      return output;
    },
  };
  return {
    provider,
    get calls() { return calls; },
    get capturedRequest() { return capturedRequest; },
  };
}

async function expectGroundingError(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
    throw new Error("Expected grounding failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AiFascicoloBasisRefResolutionError);
    expect((error as AiFascicoloBasisRefResolutionError).code).toBe("BASISREF_NOT_GROUNDED");
    expect((error as Error).message).toBe("BASISREF_NOT_GROUNDED");
    expect((error as Error).message).not.toContain(CANONICAL_ID_SENTINEL);
  }
}

function analyzeWith(output: unknown, input?: {
  providerBound?: AiFascicoloOutboundProviderBoundV1;
  trustedHashContext?: AiFascicoloTrustedHashContextV1;
  basisRefRegistry?: AiFascicoloBasisRefRegistryV1;
}) {
  const providerBound = input?.providerBound ?? providerBoundFixture();
  const fake = providerFor(output);
  return {
    fake,
    operation: () => analyzeFascicoloOutboundV1({
      providerBound,
      trustedHashContext: input?.trustedHashContext ?? trustedContextFixture(providerBound),
      basisRefRegistry: input?.basisRefRegistry ?? registryFixture(providerBound),
      provider: fake.provider,
    }),
  };
}

function projectionFixture(): Projection {
  const providerBound = providerBoundFixture();
  return {
    providerBound,
    localOnly: {
      sourceSnapshotContentHash: SOURCE_HASH_SENTINEL,
      localAliasMapping: localAliasMappingFixture(),
    },
  };
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
      identityContext: { procedimentoId: "proc-1", canonicalEnteId: "ente-1" },
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
      documents: [{ id: "document-1", dataDocumento: "2026-01-02T00:00:00.000Z" }],
      criticita: { coverage: "SELECTED", items: [] },
      pagamenti: { coverage: "SELECTED", items: [] },
      scadenze: { coverage: "SELECTED", items: [] },
      sopralluoghi: { coverage: "SELECTED", items: [] },
      finalActContext: null,
    },
  } as unknown as Snapshot;
}

describe("AI-01C2B3B1 outbound basisRef grounding integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildSnapshotMock.mockResolvedValue(snapshotFixture());
  });

  it("grounds all seven sections in deterministic order and retains provider refs", async () => {
    const payload = allSectionsPayload();
    const { fake, operation } = analyzeWith(payload);

    const result = await operation();

    expect(fake.calls).toBe(1);
    expect(result.analysis).toEqual(payload);
    expect(result.analysis.summary.basisRefs).toEqual(["DOC_1.dataDocumento"]);
    expect(result.resolvedBasisRefs.map((item) => [item.statementPath, item.providerRef])).toEqual([
      ["summary", "DOC_1.dataDocumento"],
      ["timeline[0]", "PROCEDIMENTO_A.dataAvvio"],
      ["recordedState[0]", "checklist.complete"],
      ["signals[0]", "TITOLO_A.dataRilascio"],
      ["investigativeQuestions[0]", "DOC_1"],
      ["suggestedActivities[0]", "identityContext.enteAlias"],
      ["legalResearchQuestions[0]", "criticita.coverage"],
    ]);
    expect(result.resolvedBasisRefs[0]).toMatchObject({
      referenceType: "ENTITY",
      alias: "DOC_1",
      kind: "DOCUMENT",
      validatedFieldPath: "dataDocumento",
      canonicalId: `${CANONICAL_ID_SENTINEL}:${LOCAL_MAPPING_SENTINEL}:DOC_1`,
    });
    expect(result.resolvedBasisRefs[2]).toMatchObject({
      referenceType: "NON_ENTITY",
      canonicalId: null,
    });
    expect(Object.isFrozen(result.resolvedBasisRefs)).toBe(true);
    for (const resolved of result.resolvedBasisRefs) {
      expect(Object.isFrozen(resolved)).toBe(true);
    }
  });

  it("preserves optional statements with zero refs without fabricating resolved entries", async () => {
    const payload: ProviderAnalysisPayloadV1 = {
      summary: { text: "Summary", basisRefs: ["DOC_1"] },
      timeline: [],
      recordedState: [],
      signals: [],
      investigativeQuestions: [{ text: "Question", basisRefs: [] }],
      suggestedActivities: [{ text: "Activity", basisRefs: [] }],
      legalResearchQuestions: [{ text: "Research", basisRefs: [] }],
    };

    const result = await analyzeWith(payload).operation();

    expect(result.analysis).toEqual(payload);
    expect(result.resolvedBasisRefs).toHaveLength(1);
    expect(result.resolvedBasisRefs[0].statementPath).toBe("summary");
  });

  it.each([
    ["unknown alias", "DOC_999.dataDocumento"],
    ["excluded path", "DOC_1.filename"],
    ["dangerous path", "DOC_1.constructor"],
  ])("fails the whole analysis for %s after exactly one provider call", async (_name, providerRef) => {
    const payload = allSectionsPayload();
    payload.summary.basisRefs = [providerRef];
    const { fake, operation } = analyzeWith(payload);

    await expectGroundingError(operation);
    expect(fake.calls).toBe(1);
  });

  it("rejects a duplicate within one statement and allows the same ref in separate statements", async () => {
    const duplicate = allSectionsPayload();
    duplicate.summary.basisRefs = ["DOC_1", "DOC_1"];
    const rejected = analyzeWith(duplicate);

    await expectGroundingError(rejected.operation);
    expect(rejected.fake.calls).toBe(1);

    const repeatedAcrossStatements = allSectionsPayload();
    repeatedAcrossStatements.summary.basisRefs = ["DOC_1"];
    repeatedAcrossStatements.recordedState = [{ text: "State", basisRefs: ["DOC_1"] }];
    repeatedAcrossStatements.investigativeQuestions = [];
    const result = await analyzeWith(repeatedAcrossStatements).operation();
    expect(result.resolvedBasisRefs.filter((item) => item.providerRef === "DOC_1")).toHaveLength(2);
  });

  it("rejects hash, schema, and algorithm registry binding mismatches before provider invocation", async () => {
    const originalProviderBound = providerBoundFixture();
    const originalRegistry = registryFixture(originalProviderBound);

    const hashProviderBound = providerBoundFixture(ALTERNATE_HASH);
    const hashCase = analyzeWith(allSectionsPayload(), {
      providerBound: hashProviderBound,
      trustedHashContext: trustedContextFixture(hashProviderBound),
      basisRefRegistry: originalRegistry,
    });
    await expectGroundingError(hashCase.operation);
    expect(hashCase.fake.calls).toBe(0);

    const schemaRegistryProviderBound = providerBoundFixture();
    (schemaRegistryProviderBound.outboundProjection as { schemaVersion: string }).schemaVersion = "outbound-mismatch";
    const schemaRegistry = registryFixture(schemaRegistryProviderBound);
    const schemaCase = analyzeWith(allSectionsPayload(), {
      basisRefRegistry: schemaRegistry,
    });
    await expectGroundingError(schemaCase.operation);
    expect(schemaCase.fake.calls).toBe(0);

    const algorithmRegistryProviderBound = providerBoundFixture() as AiFascicoloOutboundProviderBoundV1 & {
      outboundProjectionHashAlgorithm: string;
    };
    algorithmRegistryProviderBound.outboundProjectionHashAlgorithm = "sha512";
    const algorithmRegistry = registryFixture(
      algorithmRegistryProviderBound as AiFascicoloOutboundProviderBoundV1,
    );
    const algorithmCase = analyzeWith(allSectionsPayload(), {
      basisRefRegistry: algorithmRegistry,
    });
    await expectGroundingError(algorithmCase.operation);
    expect(algorithmCase.fake.calls).toBe(0);
  });

  it("rejects a forged registry before provider invocation with a sanitized error", async () => {
    const forged = {
      outboundProjectionHash: OUTBOUND_HASH,
      outboundProjectionHashAlgorithm: "sha256",
      outboundSchemaVersion: "ai-fascicolo-outbound/v1",
    } as unknown as AiFascicoloBasisRefRegistryV1;
    const { fake, operation } = analyzeWith(allSectionsPayload(), { basisRefRegistry: forged });

    await expectGroundingError(operation);
    expect(fake.calls).toBe(0);
  });

  it("keeps registry, mapping, source hash, canonical IDs, and resolved refs out of the provider request", async () => {
    const expectedRequest = buildOutboundProviderRequest(providerBoundFixture());
    const { fake, operation } = analyzeWith(allSectionsPayload());

    const result = await operation();
    const serializedRequest = JSON.stringify(fake.capturedRequest);

    expect(fake.capturedRequest).toEqual(expectedRequest);
    expect(Buffer.byteLength(serializedRequest, "utf8"))
      .toBe(Buffer.byteLength(JSON.stringify(expectedRequest), "utf8"));
    for (const forbidden of [
      "basisRefRegistry",
      "resolvedBasisRefs",
      "localAliasMapping",
      SOURCE_HASH_SENTINEL,
      CANONICAL_ID_SENTINEL,
      LOCAL_MAPPING_SENTINEL,
    ]) {
      expect(serializedRequest).not.toContain(forbidden);
    }
    expect(JSON.stringify(result.resolvedBasisRefs)).toContain(CANONICAL_ID_SENTINEL);
  });

  it("rejects malformed provider output before grounding", async () => {
    const { fake, operation } = analyzeWith({ summary: "invalid" });

    await expect(operation()).rejects.toMatchObject({ code: "INVALID_PROVIDER_OUTPUT" });
    expect(fake.calls).toBe(1);
  });

  it("propagates grounding errors unchanged through B1 without telemetry leakage or retry", async () => {
    let providerCalls = 0;
    let capturedRequest: AiOutboundAnalysisProviderRequestV1 | undefined;
    const events: AiFascicoloLiveAnalysisLogEvent[] = [];
    const invalidPayload = allSectionsPayload();
    invalidPayload.summary.basisRefs = ["DOC_999.dataDocumento"];
    const service = createFascicoloLiveAnalysisService({
      provider: {
        async analyze(request) {
          providerCalls += 1;
          capturedRequest = request;
          return invalidPayload;
        },
      },
      maxInputBytes: 100_000,
      logger: { log: (event) => events.push(event) },
      realDataActivation: approvedActivation,
    });

    await expectGroundingError(() => service.analyze("synthetic-procedimento"));
    expect(providerCalls).toBe(1);
    expect(events).toEqual([]);
    expect(JSON.stringify(capturedRequest)).not.toContain(CANONICAL_ID_SENTINEL);
  });

  it("preserves representative adapter normalization through B1", async () => {
    let providerCalls = 0;
    const service = createFascicoloLiveAnalysisService({
      provider: {
        async analyze() {
          providerCalls += 1;
          throw new AiProviderAdapterError("TIMEOUT");
        },
      },
      maxInputBytes: 100_000,
      realDataActivation: approvedActivation,
    });

    await expect(service.analyze("synthetic-procedimento")).rejects.toMatchObject({
      code: "AI_PROVIDER_TIMEOUT",
    });
    expect(providerCalls).toBe(1);
  });

  it("keeps registry construction after C1 and projection", async () => {
    let providerCalls = 0;
    const c1Service = createFascicoloLiveAnalysisService({
      provider: { async analyze() { providerCalls += 1; return allSectionsPayload(); } },
      maxInputBytes: 100_000,
      realDataActivation: createRealDataActivationPolicy({}),
    });
    await expect(c1Service.analyze("synthetic-procedimento")).rejects.toMatchObject({
      code: "AI_REAL_DATA_DISABLED",
    });
    expect(providerCalls).toBe(0);

    buildSnapshotMock.mockResolvedValue({
      metadata: { schemaVersion: "ai-fascicolo-snapshot/v1", contentHash: "a".repeat(64) },
      content: {},
    });
    const projectionService = createFascicoloLiveAnalysisService({
      provider: { async analyze() { providerCalls += 1; return allSectionsPayload(); } },
      maxInputBytes: 100_000,
      realDataActivation: approvedActivation,
    });
    await expect(projectionService.analyze("synthetic-procedimento")).rejects.toBeInstanceOf(
      AiFascicoloOutboundProjectionError,
    );
    expect(providerCalls).toBe(0);
  });
});
