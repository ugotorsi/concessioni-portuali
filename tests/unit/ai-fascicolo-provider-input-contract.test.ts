import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AI_FASCICOLO_ANALYSIS_V1_SYSTEM_POLICY,
  AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_LIMITATIONS,
  AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_SYSTEM_POLICY,
  buildOutboundProviderRequest,
  providerAnalysisPayloadV1Schema,
  type AiAnalysisProviderRequestV1,
  type AiFascicoloTrustedHashContextV1,
  type AiOutboundAnalysisProviderRequestV1,
} from "@/server/ai/fascicoloAnalysis";
import type {
  AiFascicoloOutboundProjectionResultV1,
} from "@/server/ai/fascicoloOutboundProjection";

const SOURCE_HASH_SENTINEL = "SOURCE_SNAPSHOT_HASH_SENTINEL";
const CANONICAL_CONTENT_SENTINEL = "CANONICAL_SNAPSHOT_CONTENT_SENTINEL";
const CANONICAL_ID_SENTINEL = "CANONICAL_DB_ID_SENTINEL";
const LOCAL_MAPPING_SENTINEL = "LOCAL_ALIAS_MAPPING_SENTINEL";
const OUTBOUND_HASH = "b".repeat(64);

type ProviderBound = AiFascicoloOutboundProjectionResultV1["providerBound"];

function providerBoundFixture(): ProviderBound {
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
        requirements: [
          {
            alias: "REQ_1",
            createdAt: "2026-01-02T00:00:00.000Z",
            reviewedAt: null,
          },
        ],
        evidence: [],
        humanReview: [],
        checklist: {
          complete: false,
          completedItems: 0,
          totalItems: 1,
          percentage: 0,
          evidence: [],
        },
        observations: [
          {
            alias: "OBS_1",
            documentAlias: "DOC_1",
            detectedAt: "2026-01-03T00:00:00.000Z",
            reviewedAt: null,
            currentConditionDetected: true,
          },
        ],
        documents: [
          {
            alias: "DOC_1",
            dataDocumento: "2026-01-04T00:00:00.000Z",
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

describe("AI-01C2B1 outbound provider input contract", () => {
  it("builds the exact deterministic provider-visible request without local or canonical data", () => {
    const providerBound = providerBoundFixture() as ProviderBound & {
      sourceSnapshotContentHash: string;
      localAliasMapping: readonly string[];
      canonicalSnapshotContent: string;
    };
    providerBound.sourceSnapshotContentHash = SOURCE_HASH_SENTINEL;
    providerBound.localAliasMapping = [LOCAL_MAPPING_SENTINEL];
    providerBound.canonicalSnapshotContent = CANONICAL_CONTENT_SENTINEL;

    const first = buildOutboundProviderRequest(providerBound);
    const second = buildOutboundProviderRequest(providerBound);
    const serialized = JSON.stringify(first);

    expect(JSON.stringify(second)).toBe(serialized);
    expect(first).toEqual({
      systemPolicy: AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_SYSTEM_POLICY,
      outboundData: {
        schemaVersion: "ai-fascicolo-outbound/v1",
        outboundProjectionHash: OUTBOUND_HASH,
        outboundProjectionHashAlgorithm: "sha256",
        content: providerBound.outboundProjection.content,
      },
      requestedOutputContract: {
        schemaVersion: "ai-fascicolo-analysis/v1",
        outputMode: "STRUCTURED_PAYLOAD_ONLY",
        allowedSections: [
          "summary",
          "timeline",
          "recordedState",
          "signals",
          "investigativeQuestions",
          "suggestedActivities",
          "legalResearchQuestions",
        ],
        signalTypes: ["INFO", "VERIFY"],
        basisRefsMeaning: "PROVIDER_VISIBLE_OUTBOUND_ALIAS_OR_PATH_ONLY",
      },
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(serialized).toContain("ai-fascicolo-outbound/v1");
    expect(serialized).toContain(OUTBOUND_HASH);
    expect(serialized).toContain("sha256");
    expect(serialized).toContain("PROCEDIMENTO_A");
    expect(serialized).toContain("systemPolicy");
    expect(serialized).toContain("requestedOutputContract");
    expect(serialized).not.toContain(SOURCE_HASH_SENTINEL);
    expect(serialized).not.toContain(CANONICAL_CONTENT_SENTINEL);
    expect(serialized).not.toContain(CANONICAL_ID_SENTINEL);
    expect(serialized).not.toContain(LOCAL_MAPPING_SENTINEL);
    expect(first).not.toHaveProperty("snapshotData");
    expect(first.outboundData).not.toHaveProperty("contentHash");
    expect(serialized).not.toContain("snapshotData");
  });

  it("keeps source identity in a distinct server-owned trusted hash context", () => {
    const trustedContext: AiFascicoloTrustedHashContextV1 = {
      snapshotSchemaVersion: "ai-fascicolo-snapshot/v1",
      outboundSchemaVersion: "ai-fascicolo-outbound/v1",
      sourceSnapshotContentHash: SOURCE_HASH_SENTINEL,
      outboundProjectionHash: OUTBOUND_HASH,
      outboundProjectionHashAlgorithm: "sha256",
    };
    const serializedRequest = JSON.stringify(buildOutboundProviderRequest(providerBoundFixture()));

    expect(trustedContext.sourceSnapshotContentHash).toBe(SOURCE_HASH_SENTINEL);
    expect(serializedRequest).not.toContain(trustedContext.sourceSnapshotContentHash);
    expectTypeOf<AiFascicoloTrustedHashContextV1["snapshotSchemaVersion"]>()
      .toEqualTypeOf<"ai-fascicolo-snapshot/v1">();
    expectTypeOf<AiFascicoloTrustedHashContextV1["outboundSchemaVersion"]>()
      .toEqualTypeOf<"ai-fascicolo-outbound/v1">();
  });

  it("owns outbound schema and hash-algorithm metadata instead of copying conflicting extras", () => {
    const conflicting = providerBoundFixture() as unknown as ProviderBound & {
      outboundProjection: ProviderBound["outboundProjection"] & {
        sourceSnapshotContentHash: string;
      };
      outboundProjectionHashAlgorithm: "sha512";
    };
    conflicting.outboundProjection.schemaVersion = "provider-version" as "ai-fascicolo-outbound/v1";
    conflicting.outboundProjection.sourceSnapshotContentHash = SOURCE_HASH_SENTINEL;
    conflicting.outboundProjectionHashAlgorithm = "sha512";

    const request = buildOutboundProviderRequest(conflicting as unknown as ProviderBound);
    const serialized = JSON.stringify(request);

    expect(request.outboundData.schemaVersion).toBe("ai-fascicolo-outbound/v1");
    expect(request.outboundData.outboundProjectionHashAlgorithm).toBe("sha256");
    expect(request.outboundData.outboundProjectionHash).toBe(OUTBOUND_HASH);
    expect(serialized).not.toContain("provider-version");
    expect(serialized).not.toContain("sha512");
    expect(serialized).not.toContain(SOURCE_HASH_SENTINEL);
  });

  it("uses a distinct minimized-projection policy and mandatory limitations", () => {
    const policyText = AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_SYSTEM_POLICY.instructions
      .join(" ")
      .toLowerCase();
    const limitationText = AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_LIMITATIONS
      .map((limitation) => limitation.text)
      .join(" ")
      .toLowerCase();

    expect(AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_SYSTEM_POLICY).toHaveProperty(
      "outboundDataTrust",
      "UNTRUSTED_DATA",
    );
    expect(AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_SYSTEM_POLICY).not.toHaveProperty("snapshotDataTrust");
    expect(policyText).toContain("proiezione outbound minimizzata");
    expect(policyText).toContain("contenuto dei documenti");
    expect(policyText).toContain("selected");
    expect(policyText).toContain("verifica umana");
    expect(policyText).toContain("non vincolante");
    expect(policyText).toContain("ricerca giuridica");
    expect(policyText).toContain("decisioni amministrative");
    expect(policyText).toContain("effetti giuridici");
    expect(policyText).toContain("mutazioni dello stato amministrativo");
    expect(policyText).not.toContain("snapshot");

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

  it("defines basisRefs as provider-visible outbound aliases or paths using the existing grammar", () => {
    const request = buildOutboundProviderRequest(providerBoundFixture());
    const providerPayload = {
      summary: {
        text: "Synthetic summary",
        basisRefs: ["DOC_1.dataDocumento", "REQ_1", "OBS_1"],
      },
      timeline: [],
      recordedState: [],
      signals: [],
      investigativeQuestions: [],
      suggestedActivities: [],
      legalResearchQuestions: [],
    };

    expect(request.requestedOutputContract.basisRefsMeaning)
      .toBe("PROVIDER_VISIBLE_OUTBOUND_ALIAS_OR_PATH_ONLY");
    expect(request.systemPolicy.instructions.join(" ")).toContain(
      "alias o percorsi visibili nella proiezione outbound",
    );
    expect(request.systemPolicy.instructions.join(" ")).toContain(
      "Non restituire identificativi canonici o identificativi di database",
    );
    expect(providerAnalysisPayloadV1Schema.safeParse(providerPayload).success).toBe(true);
  });

  it("preserves the exported legacy snapshot contract and policy semantics", () => {
    expect(AI_FASCICOLO_ANALYSIS_V1_SYSTEM_POLICY).toHaveProperty(
      "snapshotDataTrust",
      "UNTRUSTED_DATA",
    );
    expect(AI_FASCICOLO_ANALYSIS_V1_SYSTEM_POLICY).not.toHaveProperty("outboundDataTrust");
    expectTypeOf<AiAnalysisProviderRequestV1["snapshotData"]["schemaVersion"]>()
      .toEqualTypeOf<"ai-fascicolo-snapshot/v1">();
    expectTypeOf<AiOutboundAnalysisProviderRequestV1["outboundData"]["schemaVersion"]>()
      .toEqualTypeOf<"ai-fascicolo-outbound/v1">();
  });
});
