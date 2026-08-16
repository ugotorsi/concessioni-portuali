import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_LIMITATIONS,
  AiFascicoloAnalysisError,
  analyzeFascicoloOutboundV1,
  analyzeFascicoloSnapshotV1,
  buildOutboundProviderRequest,
  type AiAnalysisProvider,
  type AiFascicoloOutboundProviderBoundV1,
  type AiFascicoloTrustedHashContextV1,
  type AiOutboundAnalysisProvider,
  type AiOutboundAnalysisProviderRequestV1,
} from "@/server/ai/fascicoloAnalysis";

const SOURCE_HASH_SENTINEL = "SOURCE_HASH_SENTINEL_LOCAL_ONLY";
const CANONICAL_CONTENT_SENTINEL = "CANONICAL_CONTENT_SENTINEL";
const CANONICAL_DB_ID_SENTINEL = "CANONICAL_DB_ID_SENTINEL";
const LOCAL_ALIAS_MAPPING_SENTINEL = "LOCAL_ALIAS_MAPPING_SENTINEL";
const OUTBOUND_HASH = "b".repeat(64);

function providerBoundFixture(): AiFascicoloOutboundProviderBoundV1 {
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
  };
}

function trustedHashContextFixture(): AiFascicoloTrustedHashContextV1 {
  return {
    snapshotSchemaVersion: "ai-fascicolo-snapshot/v1",
    outboundSchemaVersion: "ai-fascicolo-outbound/v1",
    sourceSnapshotContentHash: SOURCE_HASH_SENTINEL,
    outboundProjectionHash: OUTBOUND_HASH,
    outboundProjectionHashAlgorithm: "sha256",
  };
}

function validProviderPayload(basisRef = "DOC_1.dataDocumento") {
  return {
    summary: {
      text: "Synthetic summary",
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

async function expectAnalysisError(
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation();
    throw new Error("Expected analysis failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AiFascicoloAnalysisError);
    expect((error as AiFascicoloAnalysisError).code).toBe(code);
    expect((error as Error).message).toBe(code);
    expect((error as Error).message).not.toContain(SOURCE_HASH_SENTINEL);
    expect((error as Error).message).not.toContain(OUTBOUND_HASH);
  }
}

describe("AI-01C2B2A outbound analysis execution contract", () => {
  it("calls the injected provider once with the exact C2B1 request and builds trusted metadata", async () => {
    const providerBound = providerBoundFixture() as AiFascicoloOutboundProviderBoundV1 & {
      canonicalSnapshotContent: string;
      canonicalDbId: string;
      localAliasMapping: readonly string[];
    };
    providerBound.canonicalSnapshotContent = CANONICAL_CONTENT_SENTINEL;
    providerBound.canonicalDbId = CANONICAL_DB_ID_SENTINEL;
    providerBound.localAliasMapping = [LOCAL_ALIAS_MAPPING_SENTINEL];
    const expectedRequest = buildOutboundProviderRequest(providerBound);
    let calls = 0;
    let capturedRequest: AiOutboundAnalysisProviderRequestV1 | undefined;
    const provider: AiOutboundAnalysisProvider = {
      async analyze(request) {
        calls += 1;
        capturedRequest = request;
        return validProviderPayload();
      },
    };

    const result = await analyzeFascicoloOutboundV1({
      providerBound,
      trustedHashContext: trustedHashContextFixture(),
      provider,
    });
    const serializedRequest = JSON.stringify(capturedRequest);

    expect(calls).toBe(1);
    expect(capturedRequest).toEqual(expectedRequest);
    expect(serializedRequest).toContain("ai-fascicolo-outbound/v1");
    expect(serializedRequest).toContain(OUTBOUND_HASH);
    expect(serializedRequest).toContain("sha256");
    expect(serializedRequest).not.toContain(SOURCE_HASH_SENTINEL);
    expect(serializedRequest).not.toContain(CANONICAL_CONTENT_SENTINEL);
    expect(serializedRequest).not.toContain(CANONICAL_DB_ID_SENTINEL);
    expect(serializedRequest).not.toContain(LOCAL_ALIAS_MAPPING_SENTINEL);
    expect(result).toMatchObject({
      analysisSchemaVersion: "ai-fascicolo-analysis/v1",
      snapshotSchemaVersion: "ai-fascicolo-snapshot/v1",
      outboundSchemaVersion: "ai-fascicolo-outbound/v1",
      sourceSnapshotContentHash: SOURCE_HASH_SENTINEL,
      outboundProjectionHash: OUTBOUND_HASH,
      outboundProjectionHashAlgorithm: "sha256",
      analysis: validProviderPayload(),
      limitations: AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_LIMITATIONS,
    });
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(result.generatedAt))).toBe(false);
    expect(JSON.stringify(result)).toContain(SOURCE_HASH_SENTINEL);
    expect(result).not.toHaveProperty("localAliasMapping");
  });

  it.each([
    ["outbound schema", (context: AiFascicoloTrustedHashContextV1) => {
      (context as { outboundSchemaVersion: string }).outboundSchemaVersion = "outbound-version-mismatch";
    }],
    ["outbound hash", (context: AiFascicoloTrustedHashContextV1) => {
      (context as { outboundProjectionHash: string }).outboundProjectionHash = "hash-mismatch";
    }],
    ["hash algorithm", (context: AiFascicoloTrustedHashContextV1) => {
      (context as { outboundProjectionHashAlgorithm: string }).outboundProjectionHashAlgorithm = "sha512";
    }],
  ] as const)("rejects a trusted %s mismatch before provider invocation", async (_name, corrupt) => {
    const context = trustedHashContextFixture();
    corrupt(context);
    let calls = 0;
    const provider: AiOutboundAnalysisProvider = {
      async analyze() {
        calls += 1;
        return validProviderPayload();
      },
    };

    await expectAnalysisError(
      () => analyzeFascicoloOutboundV1({
        providerBound: providerBoundFixture(),
        trustedHashContext: context,
        provider,
      }),
      "OUTBOUND_TRUSTED_METADATA_MISMATCH",
    );
    expect(calls).toBe(0);
  });

  it("rejects provider attempts to add trusted metadata", async () => {
    let calls = 0;
    const provider: AiOutboundAnalysisProvider = {
      async analyze() {
        calls += 1;
        return {
          ...validProviderPayload(),
          analysisSchemaVersion: "provider-analysis-version",
          sourceSnapshotContentHash: "provider-source-hash",
          outboundProjectionHash: "provider-outbound-hash",
          generatedAt: "provider-generated-at",
          limitations: [{ code: "PROVIDER_LIMITATION", text: "Provider controlled" }],
        };
      },
    };

    await expectAnalysisError(
      () => analyzeFascicoloOutboundV1({
        providerBound: providerBoundFixture(),
        trustedHashContext: trustedHashContextFixture(),
        provider,
      }),
      "INVALID_PROVIDER_OUTPUT",
    );
    expect(calls).toBe(1);
  });

  it("returns the stable sanitized error for malformed provider output", async () => {
    let calls = 0;
    const provider: AiOutboundAnalysisProvider = {
      async analyze() {
        calls += 1;
        return { raw: "RAW_PROVIDER_RESPONSE_SENTINEL" };
      },
    };

    await expectAnalysisError(
      () => analyzeFascicoloOutboundV1({
        providerBound: providerBoundFixture(),
        trustedHashContext: trustedHashContextFixture(),
        provider,
      }),
      "INVALID_PROVIDER_OUTPUT",
    );
    expect(calls).toBe(1);
  });

  it("propagates provider failures without retry or reinterpretation", async () => {
    const providerFailure = new Error("GENERIC_PROVIDER_FAILURE_SENTINEL");
    let calls = 0;
    const provider: AiOutboundAnalysisProvider = {
      async analyze() {
        calls += 1;
        throw providerFailure;
      },
    };

    await expect(analyzeFascicoloOutboundV1({
      providerBound: providerBoundFixture(),
      trustedHashContext: trustedHashContextFixture(),
      provider,
    })).rejects.toBe(providerFailure);
    expect(calls).toBe(1);
  });

  it("uses the exact server-owned outbound limitations", async () => {
    const provider: AiOutboundAnalysisProvider = {
      async analyze() {
        return validProviderPayload();
      },
    };

    const result = await analyzeFascicoloOutboundV1({
      providerBound: providerBoundFixture(),
      trustedHashContext: trustedHashContextFixture(),
      provider,
    });
    const limitationText = result.limitations.map((item) => item.text).join(" ").toLowerCase();

    expect(result.limitations).toEqual(AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_LIMITATIONS);
    expect(limitationText).toContain("proiezione outbound minimizzata");
    expect(limitationText).toContain("contenuto dei documenti non è stato esaminato");
    expect(limitationText).toContain("selected");
    expect(limitationText).toContain("non essere esaustive");
    expect(limitationText).toContain("verifica umana");
    expect(limitationText).toContain("non è vincolante");
    expect(limitationText).toContain("ricerca giuridica qualificata è separata");
    expect(limitationText).toContain("decisioni amministrative");
    expect(limitationText).toContain("effetti giuridici");
    expect(limitationText).toContain("non modifica");
  });

  it("accepts structurally valid unresolved basisRefs because existence validation is deferred to C2B3", async () => {
    const unresolvedBasisRef = "DOC_999.stato";
    const provider: AiOutboundAnalysisProvider = {
      async analyze() {
        return validProviderPayload(unresolvedBasisRef);
      },
    };

    const result = await analyzeFascicoloOutboundV1({
      providerBound: providerBoundFixture(),
      trustedHashContext: trustedHashContextFixture(),
      provider,
    });

    expect(result.analysis.summary.basisRefs).toEqual([unresolvedBasisRef]);
  });

  it("preserves the distinct legacy snapshot entrypoint and provider interface", () => {
    expect(typeof analyzeFascicoloSnapshotV1).toBe("function");
    expectTypeOf<AiAnalysisProvider["analyze"]>().parameter(0)
      .not.toEqualTypeOf<AiOutboundAnalysisProviderRequestV1>();
    expectTypeOf<AiOutboundAnalysisProvider["analyze"]>().parameter(0)
      .toEqualTypeOf<AiOutboundAnalysisProviderRequestV1>();
  });
});
