import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  AiFascicoloAuthoritativeEvidenceError,
  buildAiFascicoloAuthoritativeEvidenceV1,
} from "@/server/ai/fascicoloAuthoritativeEvidence";
import {
  projectAiFascicoloOutboundV1,
  type AiFascicoloOutboundProjectionResultV1,
} from "@/server/ai/fascicoloOutboundProjection";
import * as outboundProjectionModule from "@/server/ai/fascicoloOutboundProjection";

type Snapshot = Parameters<typeof projectAiFascicoloOutboundV1>[0];
type Projection = AiFascicoloOutboundProjectionResultV1;

const SOURCE_HASH = "a".repeat(64);

function snapshotFixture(): Snapshot {
  return {
    metadata: {
      schemaVersion: "ai-fascicolo-snapshot/v1",
      generatedAt: "2026-08-31T10:00:00.000Z",
      generatedByActorId: "actor-1",
      generatedByRole: "ADMIN",
      contentHashAlgorithm: "sha256",
      contentHash: SOURCE_HASH,
    },
    content: {
      identityContext: { procedimentoId: "proc-1", canonicalEnteId: "ente-1" },
      procedimento: {
        id: "proc-1",
        tipologia: "ISTRUTTORIA",
        stato: "IN_CORSO",
        origineProcedimento: "UFFICIO",
        procedimentoUfficio: "Ufficio locale",
        riferimentoNormativo: null,
        dataAvvio: "2026-01-01T00:00:00.000Z",
        dataScadenzaContraddittorio: null,
        dataProvvedimentoFinale: null,
        checklistProfile: "STANDARD",
        noteIstruttorie: null,
        responsabileProcedimentoNome: "Responsabile locale",
        unitaOrganizzativaResponsabile: "Unita locale",
        responsabileAssegnatoAt: null,
        responsibilityAssignments: [{
          id: "assignment-1",
          responsabileNome: "Responsabile locale",
          unitaOrganizzativa: "Unita locale",
          decorrenza: "2026-01-01T00:00:00.000Z",
          cessazione: null,
          motivoAssegnazione: null,
          comunicataAt: null,
          registeredByUserId: "user-1",
        }],
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
        motivazioneValutazione: null,
        propostaEsitoIstruttorio: null,
        preavvisoRigettoApplicabile: false,
        statoPreavvisoRigetto: "NON_APPLICABILE",
        dataPreavvisoRigetto: null,
        termineOsservazioniPreavviso: null,
        osservazioniPreavvisoRicevute: false,
        dataOsservazioniPreavviso: null,
        valutazioneOsservazioniPreavviso: null,
        motivazioneMancatoPreavviso: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      concessione: {
        id: "concessione-1",
        numeroAtto: "CONC-1",
        stato: "ATTIVA",
        dataRilascio: "2020-01-01T00:00:00.000Z",
        dataScadenza: "2030-01-01T00:00:00.000Z",
        tipologiaBene: "AREA",
        attivita: "PORTUALE",
        ubicazione: null,
        canoneAnnuo: "100.00",
        categoriaCanone: null,
      },
      concessionario: { id: "concessionario-1", denominazione: "Societa locale" },
      requirements: [{
        id: "requirement-1",
        status: "PROPOSTO",
        screeningFingerprint: "fingerprint-1",
        matcherAlgorithmVersion: "matcher/v1",
        sourceStableKeySnapshot: "source-1",
        sourceTitleSnapshot: "Fonte locale",
        ruleCodeSnapshot: "RULE-1",
        ruleContractVersionSnapshot: "rule/v1",
        gapKeySnapshot: "gap-1",
        gapLabelSnapshot: "Requisito locale",
        gapDescriptionSnapshot: "Descrizione locale",
        createdAt: "2026-01-02T00:00:00.000Z",
        createdByActorId: "actor-1",
        createdByRole: "ADMIN",
        reviewedAt: null,
        reviewedByActorId: null,
        reviewedByRole: null,
        reviewNote: null,
      }],
      evidence: [{
        id: "evidence-1",
        proposalId: "requirement-1",
        documentoId: "document-1",
        createdAt: "2026-01-03T00:00:00.000Z",
        createdByActorId: "actor-1",
        createdByRole: "ADMIN",
        revokedAt: null,
        revokedByActorId: null,
        revokedByRole: null,
        revocationNote: null,
      }],
      humanReviewReceipts: [{
        id: "review-1",
        evidenceId: "evidence-1",
        createdAt: "2026-01-04T00:00:00.000Z",
        reviewedByActorId: "actor-1",
        reviewedByRole: "ADMIN",
        reviewNote: null,
      }],
      checklist: {
        checklistProfile: "STANDARD",
        checklistContraddittorioCompleta: false,
        checklistCompletedItems: 2,
        checklistTotalItems: 3,
        checklistPercentage: 66.67,
        checklistMissingItems: [],
        checklistWarningLevel: "INFO",
        noteChecklistContraddittorio: null,
        evidence: [{
          id: "check-evidence-1",
          checklistItemCode: "CHECK-1",
          documentoId: "document-1",
          status: "PRESENTE",
          createdAt: "2026-01-05T00:00:00.000Z",
          createdByActorId: "actor-1",
          createdByRole: "ADMIN",
          reviewedAt: null,
          reviewedByActorId: null,
          reviewedByRole: null,
          reviewNote: null,
        }],
      },
      fascicoloObservations: [{
        id: "observation-1",
        documentoId: "document-1",
        status: "OPEN",
        ruleCode: "RULE-1",
        ruleVersion: "v1",
        detectedAt: "2026-01-06T00:00:00.000Z",
        reviewedAt: null,
        reviewNote: null,
        currentConditionDetected: true,
        text: "Osservazione locale",
        disclaimer: "Supporto interno",
      }],
      documents: [{
        id: "document-1",
        nome: "Documento locale.pdf",
        tipologia: "ALTRO",
        statoDocumento: "ATTIVO",
        dataDocumento: "2026-01-07T00:00:00.000Z",
        createdAt: "2026-01-07T00:00:00.000Z",
      }],
      criticita: { coverage: "SELECTED", items: [{
        id: "issue-1",
        tipologia: "TECNICA",
        gravita: "MEDIA",
        stato: "APERTA",
        descrizione: "Criticita locale",
        riferimentoNormativo: null,
        dataRilevazione: "2026-01-08T00:00:00.000Z",
        rilevanzaArt47: null,
        letteraArt47: null,
        rischioDecadenza: null,
      }] },
      pagamenti: { coverage: "SELECTED", items: [{
        id: "payment-1",
        annoRiferimento: 2026,
        importoDovuto: "100.00",
        importoVersato: "0.00",
        residuo: "100.00",
        stato: "APERTO",
        dataScadenza: "2026-02-01T00:00:00.000Z",
      }] },
      scadenze: { coverage: "SELECTED", items: [{
        id: "deadline-1",
        tipologia: "ISTRUTTORIA",
        stato: "APERTA",
        dataScadenza: "2026-03-01T00:00:00.000Z",
        descrizione: "Scadenza locale",
      }] },
      sopralluoghi: { coverage: "SELECTED", items: [{
        id: "inspection-1",
        data: "2026-01-09T00:00:00.000Z",
        esito: "POSITIVO",
        conformitaPlanimetrica: null,
        descrizione: null,
      }] },
      finalActContext: {
        contextOnly: true,
        id: "final-act-1",
        tipoDecisione: "ALTRO",
        numeroAtto: "ATTO-1",
        protocolloAtto: null,
        dataAtto: "2026-04-01T00:00:00.000Z",
        dataEfficacia: "2026-04-02T00:00:00.000Z",
        organoCompetente: "Organo locale",
        effettoTitolo: "NESSUNO",
        statoEffetto: "NON_APPLICATO",
        effettoApplicatoAt: null,
        statoConcessionePrecedente: "ATTIVA",
        statoConcessioneSuccessivo: "ATTIVA",
        documentoId: "document-1",
        registeredByUserId: "user-1",
        createdAt: "2026-04-01T00:00:00.000Z",
      },
    },
  } as unknown as Snapshot;
}

function projectionClone(projection: Projection): Projection {
  return {
    providerBound: structuredClone(projection.providerBound),
    localOnly: structuredClone(projection.localOnly),
  };
}

function build(snapshot = snapshotFixture(), projection = projectAiFascicoloOutboundV1(snapshot)) {
  return buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection });
}

function expectCode(operation: () => unknown, code: AiFascicoloAuthoritativeEvidenceError["code"]): void {
  expect(operation).toThrowError(AiFascicoloAuthoritativeEvidenceError);
  try {
    operation();
  } catch (error) {
    expect((error as AiFascicoloAuthoritativeEvidenceError).code).toBe(code);
    expect((error as Error).message).toBe(code);
  }
}

function assertFrozenGraph(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertFrozenGraph(child, seen);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

const EXPECTED_KINDS = [
  "CHECKLIST_EVIDENCE", "CONCESSIONARIO", "CONCESSIONE", "DEADLINE", "DOCUMENT",
  "ENTE", "EVIDENCE", "FINAL_ACT", "HUMAN_REVIEW", "INSPECTION", "ISSUE",
  "OBSERVATION", "PAYMENT", "PROCEDIMENTO", "REQUIREMENT", "RESPONSIBILITY_ASSIGNMENT",
] as const;

const EXPECTED_NON_ENTITY_PATHS = [
  "checklist.complete", "checklist.completedItems", "checklist.percentage", "checklist.totalItems",
  "criticita.coverage", "identityContext.enteAlias", "identityContext.procedimentoAlias",
  "pagamenti.coverage", "scadenze.coverage", "sopralluoghi.coverage",
] as const;

describe("B2C5 authoritative evidence production builder", () => {
  it("builds every supported entity kind and every allowlisted path from local snapshot values", () => {
    const result = build();
    expect([...new Set(result.entities.map((item) => item.kind))]).toEqual(EXPECTED_KINDS);

    const document = result.entities.find((item) =>
      item.kind === "DOCUMENT" && item.validatedFieldPath === "dataDocumento");
    expect(document).toEqual({
      kind: "DOCUMENT",
      canonicalId: "document-1",
      validatedFieldPath: "dataDocumento",
      local: { displayLabel: "Documento locale.pdf", value: "2026-01-07T00:00:00.000Z" },
    });

    const pathsByKind = Object.fromEntries(EXPECTED_KINDS.map((kind) => [
      kind,
      result.entities.filter((item) => item.kind === kind).map((item) => item.validatedFieldPath),
    ]));
    expect(pathsByKind).toMatchInlineSnapshot(`
      {
        "CHECKLIST_EVIDENCE": [
          null,
          "createdAt",
          "documentAlias",
          "reviewedAt",
        ],
        "CONCESSIONARIO": [
          null,
        ],
        "CONCESSIONE": [
          null,
          "dataRilascio",
          "dataScadenza",
        ],
        "DEADLINE": [
          null,
          "dataScadenza",
        ],
        "DOCUMENT": [
          null,
          "dataDocumento",
        ],
        "ENTE": [
          null,
        ],
        "EVIDENCE": [
          null,
          "createdAt",
          "documentAlias",
          "requirementAlias",
          "revokedAt",
        ],
        "FINAL_ACT": [
          null,
          "contextOnly",
          "dataAtto",
          "dataEfficacia",
          "documentAlias",
          "effettoApplicatoAt",
        ],
        "HUMAN_REVIEW": [
          null,
          "createdAt",
          "evidenceAlias",
        ],
        "INSPECTION": [
          null,
          "conformitaPlanimetrica",
          "data",
        ],
        "ISSUE": [
          null,
          "dataRilevazione",
          "rilevanzaArt47",
        ],
        "OBSERVATION": [
          null,
          "currentConditionDetected",
          "detectedAt",
          "documentAlias",
          "reviewedAt",
        ],
        "PAYMENT": [
          null,
          "annoRiferimento",
          "dataScadenza",
        ],
        "PROCEDIMENTO": [
          null,
          "audizioneRichiesta",
          "audizioneSvolta",
          "comunicazioneAvvioInviata",
          "contestazioneFormaleInviata",
          "controdeduzioniValutate",
          "dataAudizione",
          "dataAvvio",
          "dataComunicazioneAvvio",
          "dataContestazioneFormale",
          "dataOsservazioniPreavviso",
          "dataPreavvisoRigetto",
          "dataProvvedimentoFinale",
          "dataRicezioneMemorie",
          "dataScadenzaContraddittorio",
          "memorieRicevute",
          "osservazioniPreavvisoRicevute",
          "preavvisoRigettoApplicabile",
          "responsabileAssegnatoAt",
          "sopralluogoIstruttorioSvolto",
          "termineMemorieGiorni",
          "termineMemorieScadenza",
          "termineOsservazioniPreavviso",
        ],
        "REQUIREMENT": [
          null,
          "createdAt",
          "reviewedAt",
        ],
        "RESPONSIBILITY_ASSIGNMENT": [
          null,
          "cessazione",
          "comunicataAt",
          "decorrenza",
          "functionalRole",
          "organizationalUnit",
        ],
      }
    `);
  });

  it("builds all non-entity targets in canonical order with string, number, boolean and coverage values", () => {
    const result = build();
    expect(result.nonEntityContextId).toBe("proc-1");
    expect(result.nonEntities.map((item) => item.validatedFieldPath)).toEqual(EXPECTED_NON_ENTITY_PATHS);
    expect(result.nonEntities.find((item) => item.validatedFieldPath === "checklist.complete")?.local.value).toBe(false);
    expect(result.nonEntities.find((item) => item.validatedFieldPath === "checklist.percentage")?.local.value).toBe(66.67);
    expect(result.nonEntities.find((item) => item.validatedFieldPath === "criticita.coverage")?.local.value).toBe("SELECTED");
    expect(result.entities.find((item) => item.validatedFieldPath === "dataProvvedimentoFinale")?.local.value).toBeNull();
  });

  it("uses deterministic local labels, canonical-ID fallback, and deliberately omits fieldLabel", () => {
    const first = build();
    const second = build();
    expect(first).toEqual(second);
    expect(first.entities.find((item) => item.kind === "CONCESSIONE")?.local.displayLabel).toBe("CONC-1");
    expect(first.entities.find((item) => item.kind === "DOCUMENT")?.local.displayLabel).toBe("Documento locale.pdf");
    expect(first.entities.find((item) => item.kind === "PAYMENT")?.local.displayLabel).toBe("payment-1");
    expect(first.entities.every((item) => !("fieldLabel" in item.local))).toBe(true);
    expect(first.nonEntities.every((item) => !("fieldLabel" in item.local))).toBe(true);
  });

  it("fails closed when source hash, outbound hash, algorithm, or payload correlation differs", () => {
    const snapshot = snapshotFixture();
    const projection = projectionClone(projectAiFascicoloOutboundV1(snapshot));
    projection.localOnly.sourceSnapshotContentHash = "b".repeat(64);
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection }),
      "SNAPSHOT_PROJECTION_MISMATCH",
    );

    const different = projectionClone(projectAiFascicoloOutboundV1(snapshot));
    different.providerBound.outboundProjectionHash = "c".repeat(64);
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection: different }),
      "SNAPSHOT_PROJECTION_MISMATCH",
    );

    const algorithm = projectionClone(projectAiFascicoloOutboundV1(snapshot));
    (algorithm.providerBound as { outboundProjectionHashAlgorithm: string })
      .outboundProjectionHashAlgorithm = "sha512";
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection: algorithm }),
      "SNAPSHOT_PROJECTION_MISMATCH",
    );

    const payload = projectionClone(projectAiFascicoloOutboundV1(snapshot));
    payload.providerBound.outboundProjection.content.procedimento.dataAvvio =
      "2026-01-02T00:00:00.000Z";
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection: payload }),
      "SNAPSHOT_PROJECTION_MISMATCH",
    );

    const mapping = projectionClone(projectAiFascicoloOutboundV1(snapshot));
    const documentMapping = mapping.localOnly.localAliasMapping.find((item) => item.alias === "DOC_1")!;
    documentMapping.canonicalId = "missing-document";
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection: mapping }),
      "MISSING_CANONICAL_MAPPING",
    );
  });

  it("fails closed for missing canonical mapping without inventing an ID", () => {
    const snapshot = snapshotFixture();
    const projection = projectionClone(projectAiFascicoloOutboundV1(snapshot));
    projection.localOnly.localAliasMapping = projection.localOnly.localAliasMapping
      .filter((item) => item.alias !== "DOC_1");
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection }),
      "MISSING_CANONICAL_MAPPING",
    );
  });

  it("rejects duplicate local targets and duplicate projection identities without silent overwrite", () => {
    const snapshot = snapshotFixture();
    const projection = projectAiFascicoloOutboundV1(snapshot);
    snapshot.content.documents.push({ ...snapshot.content.documents[0] });
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection }),
      "DUPLICATE_EVIDENCE_TARGET",
    );

    const cleanSnapshot = snapshotFixture();
    const duplicateProjection = projectionClone(projectAiFascicoloOutboundV1(cleanSnapshot));
    duplicateProjection.localOnly.localAliasMapping.push({
      ...duplicateProjection.localOnly.localAliasMapping[0],
      alias: "DUPLICATE_ALIAS",
    });
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot: cleanSnapshot, projection: duplicateProjection }),
      "DUPLICATE_EVIDENCE_TARGET",
    );
  });

  it("rejects an exact duplicate projection alias without silent overwrite", () => {
    const snapshot = snapshotFixture();
    const projection = projectionClone(projectAiFascicoloOutboundV1(snapshot));
    projection.localOnly.localAliasMapping.push({
      alias: projection.localOnly.localAliasMapping[0].alias,
      kind: "DOCUMENT",
      canonicalId: "another-document",
    });
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection }),
      "DUPLICATE_EVIDENCE_TARGET",
    );
  });

  it("rejects a duplicate outbound evidence target", () => {
    const snapshot = snapshotFixture();
    const projection = projectionClone(projectAiFascicoloOutboundV1(snapshot));
    projection.providerBound.outboundProjection.content.documents.push({
      ...projection.providerBound.outboundProjection.content.documents[0],
    });
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection }),
      "DUPLICATE_EVIDENCE_TARGET",
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite local value %s with a sanitized typed error",
    (invalidNumber) => {
    const snapshot = snapshotFixture();
    const projection = projectAiFascicoloOutboundV1(snapshot);
      snapshot.content.pagamenti.items[0].annoRiferimento = invalidNumber;
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection }),
      "INVALID_LOCAL_VALUE",
    );
    },
  );

  it("copies and freezes nested array and plain-object local values without mutating input", () => {
    const snapshot = snapshotFixture();
    const projection = projectAiFascicoloOutboundV1(snapshot);
    const nestedArray = ["local", { nested: [1, true, null] }];
    const nestedObject = { source: { values: ["a", 2, false, null] } };
    (snapshot.content.procedimento as Record<string, unknown>).dataAvvio = nestedArray;
    (snapshot.content.procedimento as Record<string, unknown>).dataScadenzaContraddittorio = nestedObject;
    const before = structuredClone({ nestedArray, nestedObject });
    const reproject = vi.spyOn(outboundProjectionModule, "projectAiFascicoloOutboundV1")
      .mockReturnValue(projection);
    try {
      const result = buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection });
      const arrayValue = result.entities.find((item) =>
        item.kind === "PROCEDIMENTO" && item.validatedFieldPath === "dataAvvio")?.local.value;
      const objectValue = result.entities.find((item) =>
        item.kind === "PROCEDIMENTO"
        && item.validatedFieldPath === "dataScadenzaContraddittorio")?.local.value;
      expect(arrayValue).toEqual(before.nestedArray);
      expect(objectValue).toEqual(before.nestedObject);
      expect({ nestedArray, nestedObject }).toEqual(before);
      assertFrozenGraph(arrayValue);
      assertFrozenGraph(objectValue);
    } finally {
      reproject.mockRestore();
    }
  });

  it("does not mutate deeply frozen inputs and returns a deeply immutable result", () => {
    const snapshot = structuredClone(snapshotFixture());
    const projection = projectAiFascicoloOutboundV1(snapshot);
    const before = JSON.stringify(snapshot);
    const result = buildAiFascicoloAuthoritativeEvidenceV1({
      snapshot: deepFreeze(snapshot),
      projection: deepFreeze(projection),
    });
    expect(JSON.stringify(snapshot)).toBe(before);
    assertFrozenGraph(snapshot);
    assertFrozenGraph(projection);
    assertFrozenGraph(result);
    expect(() => {
      (result.entities[0].local as { displayLabel: string }).displayLabel = "changed";
    }).toThrow(TypeError);
  });

  it("fails a drift check when a new outbound field has no explicit local mapping", () => {
    const snapshot = snapshotFixture();
    const projection = projectionClone(projectAiFascicoloOutboundV1(snapshot));
    (projection.providerBound.outboundProjection.content.procedimento as Record<string, unknown>)
      .futureField = "future";
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection }),
      "UNSUPPORTED_EVIDENCE_FIELD",
    );
  });

  it("fails a non-entity drift check when a parent gains an unmapped scalar field", () => {
    const snapshot = snapshotFixture();
    const projection = projectionClone(projectAiFascicoloOutboundV1(snapshot));
    (projection.providerBound.outboundProjection.content.checklist as Record<string, unknown>)
      .futureScalar = true;
    expectCode(
      () => buildAiFascicoloAuthoritativeEvidenceV1({ snapshot, projection }),
      "UNSUPPORTED_EVIDENCE_FIELD",
    );
  });

  it("has no AI input, infrastructure dependency, nondeterminism, or administrative semantics", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/server/ai/fascicoloAuthoritativeEvidence.ts"),
      "utf8",
    );
    for (const forbidden of [
      "Prisma", "getCurrentUser", "requireTenantAccess", "isBackofficeRole", "audit",
      "OpenAI", "providers/openai", "openaiRuntime", "fascicoloAnalysis", "telemetry",
      "@/lib/prisma", "@/lib/auth", "tenant-auth", "fascicoloReviewPersistence",
      "fascicoloHumanReview", "Date.now", "Math.random", "randomUUID", "process.env", "fetch(",
      "node:fs", "B2C1", "B2C2", "B2C3", "B2C4",
      "APPROVE", "REJECT", "REVOKE", "RENEW", "SANCTION", "COMPLIANCE",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/from\s+["']fs["']|AiOutboundAnalysisProvider|\.analyze\s*\(/);
    expect(source).not.toMatch(/\banalysis\b|providerAnalysis|providerStatement/);
  });
});
