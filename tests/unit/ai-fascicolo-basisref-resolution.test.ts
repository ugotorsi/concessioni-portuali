import { describe, expect, it } from "vitest";

import {
  AiFascicoloBasisRefResolutionError,
  buildAiFascicoloBasisRefRegistryV1,
  resolveAiFascicoloBasisRefV1,
  resolveAiFascicoloStatementBasisRefsV1,
} from "@/server/ai/fascicoloBasisRefResolution";
import type {
  AiFascicoloOutboundAliasKind,
  AiFascicoloOutboundProjectionResultV1,
} from "@/server/ai/fascicoloOutboundProjection";

type ProviderBound = AiFascicoloOutboundProjectionResultV1["providerBound"];
type LocalAliasMapping = AiFascicoloOutboundProjectionResultV1["localOnly"]["localAliasMapping"];

const OUTBOUND_HASH = "b".repeat(64);
const SOURCE_HASH_SENTINEL = "SOURCE_HASH_SENTINEL_NOT_A_REGISTRY_INPUT";
const CANONICAL_ID_SENTINEL = "CANONICAL_ID_SENTINEL";

interface Fixture {
  readonly providerBound: ProviderBound;
  readonly localAliasMapping: LocalAliasMapping;
}

function mapping(
  alias: string,
  kind: AiFascicoloOutboundAliasKind,
): LocalAliasMapping[number] {
  return {
    alias,
    kind,
    canonicalId: `${CANONICAL_ID_SENTINEL}:${alias}`,
  };
}

function representativeFixture(includeFinalAct = true): Fixture {
  const providerBound: ProviderBound = {
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
          responsibilityAssignments: [{
            alias: "ASSIGNMENT_1",
            functionalRole: "RESPONSABILE_PROCEDIMENTO",
            organizationalUnit: "UNIT_A",
            decorrenza: "2026-01-02T00:00:00.000Z",
            cessazione: null,
            comunicataAt: null,
          }],
        },
        concessione: {
          alias: "TITOLO_A",
          dataRilascio: "2020-01-01T00:00:00.000Z",
          dataScadenza: "2030-01-01T00:00:00.000Z",
        },
        concessionario: {
          alias: "CONCESSIONARIO_A",
        },
        requirements: [{
          alias: "REQ_1",
          createdAt: "2026-01-03T00:00:00.000Z",
          reviewedAt: null,
        }],
        evidence: [{
          alias: "EVID_1",
          requirementAlias: "REQ_1",
          documentAlias: "DOC_1",
          createdAt: "2026-01-04T00:00:00.000Z",
          revokedAt: null,
        }],
        humanReview: [{
          alias: "REVIEW_1",
          evidenceAlias: "EVID_1",
          createdAt: "2026-01-05T00:00:00.000Z",
        }],
        checklist: {
          complete: false,
          completedItems: 1,
          totalItems: 2,
          percentage: 50,
          evidence: [{
            alias: "CHECK_EVID_1",
            documentAlias: "DOC_1",
            createdAt: "2026-01-06T00:00:00.000Z",
            reviewedAt: null,
          }],
        },
        observations: [{
          alias: "OBS_1",
          documentAlias: "DOC_1",
          detectedAt: "2026-01-07T00:00:00.000Z",
          reviewedAt: null,
          currentConditionDetected: true,
        }],
        documents: [{
          alias: "DOC_1",
          dataDocumento: "2026-01-08T00:00:00.000Z",
        }],
        criticita: {
          coverage: "SELECTED",
          items: [{
            alias: "ISSUE_1",
            dataRilevazione: "2026-01-09T00:00:00.000Z",
            rilevanzaArt47: null,
          }],
        },
        pagamenti: {
          coverage: "SELECTED",
          items: [{
            alias: "PAYMENT_1",
            annoRiferimento: 2026,
            dataScadenza: "2026-01-10T00:00:00.000Z",
          }],
        },
        scadenze: {
          coverage: "SELECTED",
          items: [{
            alias: "DEADLINE_1",
            dataScadenza: "2026-01-11T00:00:00.000Z",
          }],
        },
        sopralluoghi: {
          coverage: "SELECTED",
          items: [{
            alias: "INSPECTION_1",
            data: "2026-01-12T00:00:00.000Z",
            conformitaPlanimetrica: null,
          }],
        },
        finalActContext: includeFinalAct
          ? {
              alias: "FINAL_ACT_A",
              contextOnly: true,
              dataAtto: "2026-01-13T00:00:00.000Z",
              dataEfficacia: "2026-01-14T00:00:00.000Z",
              effettoApplicatoAt: null,
              documentAlias: "DOC_1",
            }
          : null,
      },
    },
    outboundProjectionHash: OUTBOUND_HASH,
    outboundProjectionHashAlgorithm: "sha256",
  };

  const localAliasMapping: LocalAliasMapping = [
    mapping("PROCEDIMENTO_A", "PROCEDIMENTO"),
    mapping("ENTE_A", "ENTE"),
    mapping("TITOLO_A", "CONCESSIONE"),
    mapping("CONCESSIONARIO_A", "CONCESSIONARIO"),
    mapping("ASSIGNMENT_1", "RESPONSIBILITY_ASSIGNMENT"),
    mapping("REQ_1", "REQUIREMENT"),
    mapping("EVID_1", "EVIDENCE"),
    mapping("REVIEW_1", "HUMAN_REVIEW"),
    mapping("CHECK_EVID_1", "CHECKLIST_EVIDENCE"),
    mapping("OBS_1", "OBSERVATION"),
    mapping("DOC_1", "DOCUMENT"),
    mapping("ISSUE_1", "ISSUE"),
    mapping("PAYMENT_1", "PAYMENT"),
    mapping("DEADLINE_1", "DEADLINE"),
    mapping("INSPECTION_1", "INSPECTION"),
    ...(includeFinalAct ? [mapping("FINAL_ACT_A", "FINAL_ACT")] : []),
  ];

  return { providerBound, localAliasMapping };
}

function buildRegistry(fixture = representativeFixture()) {
  return buildAiFascicoloBasisRefRegistryV1(fixture);
}

function expectGroundingError(operation: () => unknown): void {
  try {
    operation();
    throw new Error("Expected grounding failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AiFascicoloBasisRefResolutionError);
    expect((error as AiFascicoloBasisRefResolutionError).code).toBe("BASISREF_NOT_GROUNDED");
    expect((error as Error).message).toBe("BASISREF_NOT_GROUNDED");
    expect((error as Error).message).not.toContain(CANONICAL_ID_SENTINEL);
  }
}

describe("AI-01C2B3A pure basisRef registry and resolution", () => {
  it.each([
    ["PROCEDIMENTO_A", "PROCEDIMENTO", null],
    ["PROCEDIMENTO_A.dataAvvio", "PROCEDIMENTO", "dataAvvio"],
    ["ENTE_A", "ENTE", null],
    ["TITOLO_A.dataScadenza", "CONCESSIONE", "dataScadenza"],
    ["CONCESSIONARIO_A", "CONCESSIONARIO", null],
    ["ASSIGNMENT_1.decorrenza", "RESPONSIBILITY_ASSIGNMENT", "decorrenza"],
    ["REQ_1.createdAt", "REQUIREMENT", "createdAt"],
    ["EVID_1.documentAlias", "EVIDENCE", "documentAlias"],
    ["REVIEW_1.evidenceAlias", "HUMAN_REVIEW", "evidenceAlias"],
    ["CHECK_EVID_1.documentAlias", "CHECKLIST_EVIDENCE", "documentAlias"],
    ["OBS_1.currentConditionDetected", "OBSERVATION", "currentConditionDetected"],
    ["DOC_1.dataDocumento", "DOCUMENT", "dataDocumento"],
    ["ISSUE_1.rilevanzaArt47", "ISSUE", "rilevanzaArt47"],
    ["PAYMENT_1.annoRiferimento", "PAYMENT", "annoRiferimento"],
    ["DEADLINE_1.dataScadenza", "DEADLINE", "dataScadenza"],
    ["INSPECTION_1.conformitaPlanimetrica", "INSPECTION", "conformitaPlanimetrica"],
    ["FINAL_ACT_A.documentAlias", "FINAL_ACT", "documentAlias"],
  ] as const)("resolves emitted entity ref %s", (providerRef, kind, fieldPath) => {
    const resolved = resolveAiFascicoloBasisRefV1(buildRegistry(), providerRef);

    expect(resolved).toEqual({
      providerRef,
      referenceType: "ENTITY",
      alias: providerRef.split(".")[0],
      kind,
      validatedFieldPath: fieldPath,
      canonicalId: `${CANONICAL_ID_SENTINEL}:${providerRef.split(".")[0]}`,
    });
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it.each([
    "identityContext.procedimentoAlias",
    "identityContext.enteAlias",
    "checklist.complete",
    "checklist.completedItems",
    "checklist.totalItems",
    "checklist.percentage",
    "criticita.coverage",
    "pagamenti.coverage",
    "scadenze.coverage",
    "sopralluoghi.coverage",
  ])("resolves explicit non-entity ref %s without canonical identity", (providerRef) => {
    expect(resolveAiFascicoloBasisRefV1(buildRegistry(), providerRef)).toEqual({
      providerRef,
      referenceType: "NON_ENTITY",
      alias: null,
      kind: null,
      validatedFieldPath: providerRef,
      canonicalId: null,
    });
  });

  it.each(["DOC_999", "DOC_999.dataDocumento"])("rejects unknown alias %s", (providerRef) => {
    expectGroundingError(() => resolveAiFascicoloBasisRefV1(buildRegistry(), providerRef));
  });

  it.each([
    "DOC_1.fakeField",
    "DOC_1.filename",
    "DOC_1.alias",
  ])("rejects unknown, excluded, or technical self field %s", (providerRef) => {
    expectGroundingError(() => resolveAiFascicoloBasisRefV1(buildRegistry(), providerRef));
  });

  it("allows a bare emitted alias while rejecting an absent conditional alias", () => {
    const registry = buildRegistry(representativeFixture(false));

    expect(resolveAiFascicoloBasisRefV1(registry, "DOC_1").canonicalId)
      .toBe(`${CANONICAL_ID_SENTINEL}:DOC_1`);
    expectGroundingError(() => resolveAiFascicoloBasisRefV1(registry, "FINAL_ACT_A"));
    expectGroundingError(() => resolveAiFascicoloBasisRefV1(registry, "FINAL_ACT_A.dataAtto"));
  });

  it("registers only fields present in the actual projection instance", () => {
    const fixture = representativeFixture();
    delete (fixture.providerBound.outboundProjection.content.documents[0] as { dataDocumento?: string | null })
      .dataDocumento;
    const registry = buildRegistry(fixture);

    expect(resolveAiFascicoloBasisRefV1(registry, "DOC_1").alias).toBe("DOC_1");
    expectGroundingError(() => resolveAiFascicoloBasisRefV1(registry, "DOC_1.dataDocumento"));
  });

  it("fails closed for missing, wrong-kind, duplicate, and extra local mappings", () => {
    const missing = representativeFixture();
    expectGroundingError(() => buildAiFascicoloBasisRefRegistryV1({
      providerBound: missing.providerBound,
      localAliasMapping: missing.localAliasMapping.filter((item) => item.alias !== "DOC_1"),
    }));

    const wrongKind = representativeFixture();
    expectGroundingError(() => buildAiFascicoloBasisRefRegistryV1({
      providerBound: wrongKind.providerBound,
      localAliasMapping: wrongKind.localAliasMapping.map((item) => item.alias === "DOC_1"
        ? { ...item, kind: "REQUIREMENT" }
        : item),
    }));

    const duplicate = representativeFixture();
    expectGroundingError(() => buildAiFascicoloBasisRefRegistryV1({
      providerBound: duplicate.providerBound,
      localAliasMapping: [...duplicate.localAliasMapping, mapping("DOC_1", "DOCUMENT")],
    }));

    const extra = representativeFixture();
    expectGroundingError(() => buildAiFascicoloBasisRefRegistryV1({
      providerBound: extra.providerBound,
      localAliasMapping: [...extra.localAliasMapping, mapping("DOC_999", "DOCUMENT")],
    }));
  });

  it.each([
    "DOC_1.__proto__",
    "DOC_1.prototype",
    "DOC_1.constructor",
    "prototype.DOC_1",
  ])("rejects dangerous segment in %s", (providerRef) => {
    expectGroundingError(() => resolveAiFascicoloBasisRefV1(buildRegistry(), providerRef));
  });

  it.each([
    "doc_1",
    "Doc_1",
    "DOC_01",
    "DOC_1.DataDocumento",
    "DΟC_1",
    "DOC_1.0",
  ])("rejects non-exact variant %s without normalization", (providerRef) => {
    expectGroundingError(() => resolveAiFascicoloBasisRefV1(buildRegistry(), providerRef));
  });

  it("rejects duplicate refs within one statement and permits the same ref in separate calls", () => {
    const registry = buildRegistry();
    const providerRef = "DOC_1.dataDocumento";

    expectGroundingError(() => resolveAiFascicoloStatementBasisRefsV1(
      registry,
      [providerRef, providerRef],
    ));
    expect(resolveAiFascicoloStatementBasisRefsV1(registry, [providerRef])).toHaveLength(1);
    expect(resolveAiFascicoloStatementBasisRefsV1(registry, [providerRef])).toHaveLength(1);
  });

  it("fails the entire statement when one ref is invalid", () => {
    expectGroundingError(() => resolveAiFascicoloStatementBasisRefsV1(buildRegistry(), [
      "DOC_1.dataDocumento",
      "DOC_999.dataDocumento",
    ]));
  });

  it("preserves statement order, freezes output, and resolves 32 valid refs", () => {
    const registry = buildRegistry();
    const providerRefs = [
      "DOC_1.dataDocumento",
      "REQ_1.createdAt",
      "OBS_1.detectedAt",
      "PROCEDIMENTO_A.dataAvvio",
      "TITOLO_A.dataRilascio",
      "ASSIGNMENT_1.decorrenza",
      "EVID_1.documentAlias",
      "REVIEW_1.createdAt",
      "CHECK_EVID_1.createdAt",
      "ISSUE_1.dataRilevazione",
      "PAYMENT_1.annoRiferimento",
      "DEADLINE_1.dataScadenza",
      "INSPECTION_1.data",
      "FINAL_ACT_A.dataAtto",
      "identityContext.procedimentoAlias",
      "identityContext.enteAlias",
      "checklist.complete",
      "checklist.completedItems",
      "checklist.totalItems",
      "checklist.percentage",
      "criticita.coverage",
      "pagamenti.coverage",
      "scadenze.coverage",
      "sopralluoghi.coverage",
      "PROCEDIMENTO_A.memorieRicevute",
      "PROCEDIMENTO_A.audizioneRichiesta",
      "PROCEDIMENTO_A.audizioneSvolta",
      "PROCEDIMENTO_A.sopralluogoIstruttorioSvolto",
      "PROCEDIMENTO_A.contestazioneFormaleInviata",
      "PROCEDIMENTO_A.controdeduzioniValutate",
      "PROCEDIMENTO_A.preavvisoRigettoApplicabile",
      "PROCEDIMENTO_A.osservazioniPreavvisoRicevute",
    ];

    const resolved = resolveAiFascicoloStatementBasisRefsV1(registry, providerRefs);

    expect(resolved.map((item) => item.providerRef)).toEqual(providerRefs);
    expect(resolved).toHaveLength(32);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it("does not expose canonical IDs or mappings through registry serialization or spread", () => {
    const registry = buildRegistry();
    const serialized = JSON.stringify(registry);
    const spread = { ...registry };

    expect(serialized).toContain(OUTBOUND_HASH);
    expect(serialized).not.toContain(CANONICAL_ID_SENTINEL);
    expect(JSON.stringify(spread)).not.toContain(CANONICAL_ID_SENTINEL);
    expect(Object.keys(registry).sort()).toEqual([
      "outboundProjectionHash",
      "outboundProjectionHashAlgorithm",
      "outboundSchemaVersion",
    ]);
    expect(resolveAiFascicoloBasisRefV1(registry, "DOC_1").canonicalId)
      .toBe(`${CANONICAL_ID_SENTINEL}:DOC_1`);
  });

  it("binds only outbound metadata and never introduces source hash", () => {
    const registry = buildRegistry();

    expect(registry).toEqual({
      outboundProjectionHash: OUTBOUND_HASH,
      outboundProjectionHashAlgorithm: "sha256",
      outboundSchemaVersion: "ai-fascicolo-outbound/v1",
    });
    expect(JSON.stringify(registry)).not.toContain(SOURCE_HASH_SENTINEL);
  });

  it("does not mutate inputs and produces deterministic resolution", () => {
    const fixture = representativeFixture();
    const providerBoundBefore = JSON.stringify(fixture.providerBound);
    const mappingBefore = JSON.stringify(fixture.localAliasMapping);
    const providerRefs = ["REQ_1.reviewedAt", "DOC_1.dataDocumento", "checklist.complete"];
    const providerRefsBefore = [...providerRefs];

    const first = resolveAiFascicoloStatementBasisRefsV1(buildRegistry(fixture), providerRefs);
    const second = resolveAiFascicoloStatementBasisRefsV1(buildRegistry(fixture), providerRefs);

    expect(first).toEqual(second);
    expect(JSON.stringify(fixture.providerBound)).toBe(providerBoundBefore);
    expect(JSON.stringify(fixture.localAliasMapping)).toBe(mappingBefore);
    expect(providerRefs).toEqual(providerRefsBefore);
    expect(Object.isFrozen(first[0])).toBe(true);
  });

  it("rejects a fabricated registry without leaking input", () => {
    const fabricated = {
      outboundProjectionHash: OUTBOUND_HASH,
      outboundProjectionHashAlgorithm: "sha256",
      outboundSchemaVersion: "ai-fascicolo-outbound/v1",
    } as unknown as ReturnType<typeof buildAiFascicoloBasisRefRegistryV1>;

    expectGroundingError(() => resolveAiFascicoloBasisRefV1(fabricated, "DOC_1"));
  });
});
