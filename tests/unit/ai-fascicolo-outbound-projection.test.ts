import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AI_FASCICOLO_OUTBOUND_V1_SCHEMA_VERSION,
  AiFascicoloOutboundProjectionError,
  projectAiFascicoloOutboundV1,
} from "@/server/ai/fascicoloOutboundProjection";

type Snapshot = Parameters<typeof projectAiFascicoloOutboundV1>[0];

const PERSON_NAME_SENTINEL = "PERSON_NAME_SENTINEL";
const ACTOR_ID_SENTINEL = "ACTOR_ID_SENTINEL";
const USER_ID_SENTINEL = "USER_ID_SENTINEL";
const CONCESSIONAIRE_REAL_NAME_SENTINEL = "CONCESSIONAIRE_REAL_NAME_SENTINEL";
const ENTE_REAL_NAME_SENTINEL = "ENTE_REAL_NAME_SENTINEL";
const DOCUMENT_FILENAME_SENTINEL = "DOCUMENT_FILENAME_SENTINEL";
const SOURCE_HASH = "a".repeat(64);

const ATTIVITA_ARBITRARY_SENTINEL = "ATTIVITA_ARBITRARY_SENTINEL";
const CATEGORIA_CANONE_ARBITRARY_SENTINEL = "CATEGORIA_CANONE_ARBITRARY_SENTINEL";

const UNPROVEN_STRING_SENTINELS = [
  "PROCEDIMENTO_TIPOLOGIA_ARBITRARY_SENTINEL",
  "PROCEDIMENTO_STATO_ARBITRARY_SENTINEL",
  "ORIGINE_PROCEDIMENTO_ARBITRARY_SENTINEL",
  "CHECKLIST_PROFILE_ARBITRARY_SENTINEL",
  "PROPOSTA_ESITO_ARBITRARY_SENTINEL",
  "STATO_PREAVVISO_ARBITRARY_SENTINEL",
  "ROLE_ARBITRARY_SENTINEL",
  "ASSIGNMENT_UNIT_ARBITRARY_SENTINEL",
  "CONCESSIONE_STATO_ARBITRARY_SENTINEL",
  "TIPOLOGIA_BENE_ARBITRARY_SENTINEL",
  ATTIVITA_ARBITRARY_SENTINEL,
  CATEGORIA_CANONE_ARBITRARY_SENTINEL,
  "REQUIREMENT_STATUS_ARBITRARY_SENTINEL",
  "RULE_CODE_ARBITRARY_SENTINEL",
  "GAP_KEY_ARBITRARY_SENTINEL",
  "CHECKLIST_WARNING_ARBITRARY_SENTINEL",
  "CHECKLIST_ITEM_CODE_ARBITRARY_SENTINEL",
  "CHECKLIST_EVIDENCE_STATUS_ARBITRARY_SENTINEL",
  "OBSERVATION_STATUS_ARBITRARY_SENTINEL",
  "OBSERVATION_RULE_ARBITRARY_SENTINEL",
  "OBSERVATION_VERSION_ARBITRARY_SENTINEL",
  "DOCUMENT_TYPE_ARBITRARY_SENTINEL",
  "DOCUMENT_STATUS_ARBITRARY_SENTINEL",
  "ISSUE_TYPE_ARBITRARY_SENTINEL",
  "ISSUE_SEVERITY_ARBITRARY_SENTINEL",
  "ISSUE_STATUS_ARBITRARY_SENTINEL",
  "ARTICLE_LETTER_ARBITRARY_SENTINEL",
  "FORFEITURE_RISK_ARBITRARY_SENTINEL",
  "PAYMENT_STATUS_ARBITRARY_SENTINEL",
  "DEADLINE_TYPE_ARBITRARY_SENTINEL",
  "DEADLINE_STATUS_ARBITRARY_SENTINEL",
  "INSPECTION_OUTCOME_ARBITRARY_SENTINEL",
  "FINAL_DECISION_TYPE_ARBITRARY_SENTINEL",
  "FINAL_TITLE_EFFECT_ARBITRARY_SENTINEL",
  "FINAL_EFFECT_STATUS_ARBITRARY_SENTINEL",
  "FINAL_PREVIOUS_TITLE_STATE_ARBITRARY_SENTINEL",
  "FINAL_NEXT_TITLE_STATE_ARBITRARY_SENTINEL",
  "INTERNAL_FINGERPRINT_SENTINEL",
  "INTERNAL_MATCHER_SENTINEL",
  "INTERNAL_STABLE_KEY_SENTINEL",
  "INTERNAL_CONTRACT_VERSION_SENTINEL",
  "RAW_MISSING_ITEM_SENTINEL",
  "FINAL_ACT_NUMBER_SENTINEL",
  "FINAL_ACT_PROTOCOL_SENTINEL",
] as const;

const FREE_TEXT_SENTINELS = [
  "NOTE_ISTRUTTORIE_SENTINEL",
  "MOTIVAZIONE_VALUTAZIONE_SENTINEL",
  "VALUTAZIONE_OSSERVAZIONI_SENTINEL",
  "MOTIVAZIONE_MANCATO_PREAVVISO_SENTINEL",
  "MOTIVO_ASSEGNAZIONE_SENTINEL",
  "REQUIREMENT_REVIEW_NOTE_SENTINEL",
  "EVIDENCE_REVOCATION_NOTE_SENTINEL",
  "HUMAN_REVIEW_NOTE_SENTINEL",
  "CHECKLIST_NOTE_SENTINEL",
  "CHECKLIST_EVIDENCE_REVIEW_NOTE_SENTINEL",
  "OBSERVATION_REVIEW_NOTE_SENTINEL",
  "OBSERVATION_TEXT_SENTINEL",
  "OBSERVATION_DISCLAIMER_SENTINEL",
  "ISSUE_DESCRIPTION_SENTINEL",
  "DEADLINE_DESCRIPTION_SENTINEL",
  "INSPECTION_DESCRIPTION_SENTINEL",
  "GAP_DESCRIPTION_SENTINEL",
  "SOURCE_TITLE_SENTINEL",
  "GAP_LABEL_SENTINEL",
  "LEGAL_REFERENCE_SENTINEL",
] as const;

function canonicalId(prefix: string, value: string): string {
  return `${prefix}-${value}`;
}

function snapshotFixture(prefix = "canonical"): Snapshot {
  const id = (value: string) => canonicalId(prefix, value);
  return {
    metadata: {
      schemaVersion: "ai-fascicolo-snapshot/v1",
      generatedAt: "2026-08-15T08:00:00.000Z",
      generatedByActorId: ACTOR_ID_SENTINEL,
      generatedByRole: "ADMIN",
      contentHashAlgorithm: "sha256",
      contentHash: SOURCE_HASH,
    },
    content: {
      identityContext: {
        procedimentoId: id("procedimento"),
        canonicalEnteId: id("ente"),
        enteDenominazione: ENTE_REAL_NAME_SENTINEL,
      },
      procedimento: {
        id: id("procedimento"),
        tipologia: "PROCEDIMENTO_TIPOLOGIA_ARBITRARY_SENTINEL",
        stato: "PROCEDIMENTO_STATO_ARBITRARY_SENTINEL",
        origineProcedimento: "ORIGINE_PROCEDIMENTO_ARBITRARY_SENTINEL",
        procedimentoUfficio: "REAL_OFFICE_SENTINEL",
        riferimentoNormativo: "LEGAL_REFERENCE_SENTINEL",
        dataAvvio: "2026-01-01T00:00:00.000Z",
        dataScadenzaContraddittorio: "2026-02-01T00:00:00.000Z",
        dataProvvedimentoFinale: null,
        checklistProfile: "CHECKLIST_PROFILE_ARBITRARY_SENTINEL",
        noteIstruttorie: "NOTE_ISTRUTTORIE_SENTINEL",
        responsabileProcedimentoNome: PERSON_NAME_SENTINEL,
        unitaOrganizzativaResponsabile: "REAL_UNIT_SENTINEL",
        responsabileAssegnatoAt: "2026-01-02T00:00:00.000Z",
        responsibilityAssignments: [
          {
            id: id("assignment-b"),
            responsabileNome: PERSON_NAME_SENTINEL,
            unitaOrganizzativa: "ASSIGNMENT_UNIT_ARBITRARY_SENTINEL",
            decorrenza: "2026-01-04T00:00:00.000Z",
            cessazione: null,
            motivoAssegnazione: "MOTIVO_ASSEGNAZIONE_SENTINEL",
            comunicataAt: "2026-01-05T00:00:00.000Z",
            registeredByUserId: USER_ID_SENTINEL,
          },
          {
            id: id("assignment-a"),
            responsabileNome: PERSON_NAME_SENTINEL,
            unitaOrganizzativa: "ASSIGNMENT_UNIT_ARBITRARY_SENTINEL",
            decorrenza: "2026-01-03T00:00:00.000Z",
            cessazione: null,
            motivoAssegnazione: "MOTIVO_ASSEGNAZIONE_SENTINEL",
            comunicataAt: null,
            registeredByUserId: USER_ID_SENTINEL,
          },
        ],
        comunicazioneAvvioInviata: true,
        dataComunicazioneAvvio: "2026-01-06T00:00:00.000Z",
        termineMemorieGiorni: 30,
        termineMemorieScadenza: "2026-02-05T00:00:00.000Z",
        memorieRicevute: true,
        dataRicezioneMemorie: "2026-01-20T00:00:00.000Z",
        audizioneRichiesta: true,
        audizioneSvolta: false,
        dataAudizione: null,
        sopralluogoIstruttorioSvolto: true,
        contestazioneFormaleInviata: true,
        dataContestazioneFormale: "2026-01-10T00:00:00.000Z",
        controdeduzioniValutate: false,
        motivazioneValutazione: "MOTIVAZIONE_VALUTAZIONE_SENTINEL",
        propostaEsitoIstruttorio: "PROPOSTA_ESITO_ARBITRARY_SENTINEL",
        preavvisoRigettoApplicabile: true,
        statoPreavvisoRigetto: "STATO_PREAVVISO_ARBITRARY_SENTINEL",
        dataPreavvisoRigetto: null,
        termineOsservazioniPreavviso: null,
        osservazioniPreavvisoRicevute: false,
        dataOsservazioniPreavviso: null,
        valutazioneOsservazioniPreavviso: "VALUTAZIONE_OSSERVAZIONI_SENTINEL",
        motivazioneMancatoPreavviso: "MOTIVAZIONE_MANCATO_PREAVVISO_SENTINEL",
        createdAt: "2025-12-31T00:00:00.000Z",
      },
      concessione: {
        id: id("concessione"),
        numeroAtto: "REAL_CONCESSION_NUMBER_SENTINEL",
        stato: "CONCESSIONE_STATO_ARBITRARY_SENTINEL",
        dataRilascio: "2020-01-01T00:00:00.000Z",
        dataScadenza: "2030-01-01T00:00:00.000Z",
        tipologiaBene: "TIPOLOGIA_BENE_ARBITRARY_SENTINEL",
        attivita: ATTIVITA_ARBITRARY_SENTINEL,
        ubicazione: "PRECISE_LOCATION_SENTINEL",
        canoneAnnuo: "999999.99",
        categoriaCanone: CATEGORIA_CANONE_ARBITRARY_SENTINEL,
      },
      concessionario: {
        id: id("concessionario"),
        denominazione: CONCESSIONAIRE_REAL_NAME_SENTINEL,
      },
      requirements: [
        {
          id: id("requirement-b"),
          status: "REQUIREMENT_STATUS_ARBITRARY_SENTINEL",
          screeningFingerprint: "INTERNAL_FINGERPRINT_SENTINEL",
          matcherAlgorithmVersion: "INTERNAL_MATCHER_SENTINEL",
          sourceStableKeySnapshot: "INTERNAL_STABLE_KEY_SENTINEL",
          sourceTitleSnapshot: "SOURCE_TITLE_SENTINEL",
          ruleCodeSnapshot: "RULE_CODE_ARBITRARY_SENTINEL",
          ruleContractVersionSnapshot: "INTERNAL_CONTRACT_VERSION_SENTINEL",
          gapKeySnapshot: "GAP_KEY_ARBITRARY_SENTINEL",
          gapLabelSnapshot: "GAP_LABEL_SENTINEL",
          gapDescriptionSnapshot: "GAP_DESCRIPTION_SENTINEL",
          createdAt: "2026-01-08T00:00:00.000Z",
          createdByActorId: ACTOR_ID_SENTINEL,
          createdByRole: "ROLE_ARBITRARY_SENTINEL",
          reviewedAt: null,
          reviewedByActorId: null,
          reviewedByRole: null,
          reviewNote: "REQUIREMENT_REVIEW_NOTE_SENTINEL",
        },
        {
          id: id("requirement-a"),
          status: "REQUIREMENT_STATUS_ARBITRARY_SENTINEL",
          screeningFingerprint: "INTERNAL_FINGERPRINT_SENTINEL",
          matcherAlgorithmVersion: "INTERNAL_MATCHER_SENTINEL",
          sourceStableKeySnapshot: "INTERNAL_STABLE_KEY_SENTINEL",
          sourceTitleSnapshot: "SOURCE_TITLE_SENTINEL",
          ruleCodeSnapshot: "RULE_CODE_ARBITRARY_SENTINEL",
          ruleContractVersionSnapshot: "INTERNAL_CONTRACT_VERSION_SENTINEL",
          gapKeySnapshot: "GAP_KEY_ARBITRARY_SENTINEL",
          gapLabelSnapshot: "GAP_LABEL_SENTINEL",
          gapDescriptionSnapshot: "GAP_DESCRIPTION_SENTINEL",
          createdAt: "2026-01-07T00:00:00.000Z",
          createdByActorId: ACTOR_ID_SENTINEL,
          createdByRole: "ROLE_ARBITRARY_SENTINEL",
          reviewedAt: "2026-01-09T00:00:00.000Z",
          reviewedByActorId: ACTOR_ID_SENTINEL,
          reviewedByRole: "ROLE_ARBITRARY_SENTINEL",
          reviewNote: "REQUIREMENT_REVIEW_NOTE_SENTINEL",
        },
      ],
      evidence: [
        {
          id: id("evidence-b"),
          proposalId: id("requirement-b"),
          documentoId: id("document-b"),
          createdAt: "2026-01-12T00:00:00.000Z",
          createdByActorId: ACTOR_ID_SENTINEL,
          createdByRole: "ROLE_ARBITRARY_SENTINEL",
          revokedAt: null,
          revokedByActorId: null,
          revokedByRole: null,
          revocationNote: "EVIDENCE_REVOCATION_NOTE_SENTINEL",
        },
        {
          id: id("evidence-a"),
          proposalId: id("requirement-a"),
          documentoId: id("document-a"),
          createdAt: "2026-01-11T00:00:00.000Z",
          createdByActorId: ACTOR_ID_SENTINEL,
          createdByRole: "ROLE_ARBITRARY_SENTINEL",
          revokedAt: null,
          revokedByActorId: null,
          revokedByRole: null,
          revocationNote: "EVIDENCE_REVOCATION_NOTE_SENTINEL",
        },
      ],
      humanReviewReceipts: [
        {
          id: id("review-b"),
          evidenceId: id("evidence-b"),
          createdAt: "2026-01-14T00:00:00.000Z",
          reviewedByActorId: ACTOR_ID_SENTINEL,
          reviewedByRole: "ROLE_ARBITRARY_SENTINEL",
          reviewNote: "HUMAN_REVIEW_NOTE_SENTINEL",
        },
        {
          id: id("review-a"),
          evidenceId: id("evidence-a"),
          createdAt: "2026-01-13T00:00:00.000Z",
          reviewedByActorId: ACTOR_ID_SENTINEL,
          reviewedByRole: "ROLE_ARBITRARY_SENTINEL",
          reviewNote: "HUMAN_REVIEW_NOTE_SENTINEL",
        },
      ],
      checklist: {
        checklistProfile: "CHECKLIST_PROFILE_ARBITRARY_SENTINEL",
        checklistContraddittorioCompleta: false,
        checklistCompletedItems: 2,
        checklistTotalItems: 3,
        checklistPercentage: 66.67,
        checklistMissingItems: ["RAW_MISSING_ITEM_SENTINEL"],
        checklistWarningLevel: "CHECKLIST_WARNING_ARBITRARY_SENTINEL",
        noteChecklistContraddittorio: "CHECKLIST_NOTE_SENTINEL",
        evidence: [
          {
            id: id("check-evidence-b"),
            checklistItemCode: "CHECKLIST_ITEM_CODE_ARBITRARY_SENTINEL",
            documentoId: id("document-b"),
            status: "CHECKLIST_EVIDENCE_STATUS_ARBITRARY_SENTINEL",
            createdAt: "2026-01-16T00:00:00.000Z",
            createdByActorId: ACTOR_ID_SENTINEL,
            createdByRole: "ROLE_ARBITRARY_SENTINEL",
            reviewedAt: null,
            reviewedByActorId: null,
            reviewedByRole: null,
            reviewNote: "CHECKLIST_EVIDENCE_REVIEW_NOTE_SENTINEL",
          },
          {
            id: id("check-evidence-a"),
            checklistItemCode: "CHECKLIST_ITEM_CODE_ARBITRARY_SENTINEL",
            documentoId: id("document-a"),
            status: "CHECKLIST_EVIDENCE_STATUS_ARBITRARY_SENTINEL",
            createdAt: "2026-01-15T00:00:00.000Z",
            createdByActorId: ACTOR_ID_SENTINEL,
            createdByRole: "ROLE_ARBITRARY_SENTINEL",
            reviewedAt: "2026-01-17T00:00:00.000Z",
            reviewedByActorId: ACTOR_ID_SENTINEL,
            reviewedByRole: "ROLE_ARBITRARY_SENTINEL",
            reviewNote: "CHECKLIST_EVIDENCE_REVIEW_NOTE_SENTINEL",
          },
        ],
      },
      fascicoloObservations: [
        {
          id: id("observation-b"),
          documentoId: id("document-b"),
          status: "OBSERVATION_STATUS_ARBITRARY_SENTINEL",
          ruleCode: "OBSERVATION_RULE_ARBITRARY_SENTINEL",
          ruleVersion: "OBSERVATION_VERSION_ARBITRARY_SENTINEL",
          detectedAt: "2026-01-19T00:00:00.000Z",
          reviewedAt: null,
          reviewNote: "OBSERVATION_REVIEW_NOTE_SENTINEL",
          currentConditionDetected: true,
          text: "OBSERVATION_TEXT_SENTINEL",
          disclaimer: "OBSERVATION_DISCLAIMER_SENTINEL",
        },
        {
          id: id("observation-a"),
          documentoId: id("document-a"),
          status: "OBSERVATION_STATUS_ARBITRARY_SENTINEL",
          ruleCode: "OBSERVATION_RULE_ARBITRARY_SENTINEL",
          ruleVersion: "OBSERVATION_VERSION_ARBITRARY_SENTINEL",
          detectedAt: "2026-01-18T00:00:00.000Z",
          reviewedAt: "2026-01-20T00:00:00.000Z",
          reviewNote: "OBSERVATION_REVIEW_NOTE_SENTINEL",
          currentConditionDetected: false,
          text: "OBSERVATION_TEXT_SENTINEL",
          disclaimer: "OBSERVATION_DISCLAIMER_SENTINEL",
        },
      ],
      documents: [
        {
          id: id("document-b"),
          nome: DOCUMENT_FILENAME_SENTINEL,
          tipologia: "DOCUMENT_TYPE_ARBITRARY_SENTINEL",
          statoDocumento: "DOCUMENT_STATUS_ARBITRARY_SENTINEL",
          dataDocumento: "2026-01-22T00:00:00.000Z",
          createdAt: "2026-01-23T00:00:00.000Z",
          storageKey: "STORAGE_KEY_SENTINEL",
          url: "https://storage.invalid/URL_SENTINEL",
          content: "DOCUMENT_CONTENT_SENTINEL",
          bytes: "DOCUMENT_BYTES_SENTINEL",
        },
        {
          id: id("document-a"),
          nome: DOCUMENT_FILENAME_SENTINEL,
          tipologia: "DOCUMENT_TYPE_ARBITRARY_SENTINEL",
          statoDocumento: "DOCUMENT_STATUS_ARBITRARY_SENTINEL",
          dataDocumento: "2026-01-21T00:00:00.000Z",
          createdAt: "2026-01-22T00:00:00.000Z",
        },
      ],
      criticita: {
        coverage: "SELECTED",
        items: [
          {
            id: id("issue-b"),
            tipologia: "ISSUE_TYPE_ARBITRARY_SENTINEL",
            gravita: "ISSUE_SEVERITY_ARBITRARY_SENTINEL",
            stato: "ISSUE_STATUS_ARBITRARY_SENTINEL",
            descrizione: "ISSUE_DESCRIPTION_SENTINEL",
            riferimentoNormativo: "LEGAL_REFERENCE_SENTINEL",
            dataRilevazione: "2026-01-25T00:00:00.000Z",
            rilevanzaArt47: null,
            letteraArt47: null,
            rischioDecadenza: "FORFEITURE_RISK_ARBITRARY_SENTINEL",
          },
          {
            id: id("issue-a"),
            tipologia: "ISSUE_TYPE_ARBITRARY_SENTINEL",
            gravita: "ISSUE_SEVERITY_ARBITRARY_SENTINEL",
            stato: "ISSUE_STATUS_ARBITRARY_SENTINEL",
            descrizione: "ISSUE_DESCRIPTION_SENTINEL",
            riferimentoNormativo: "LEGAL_REFERENCE_SENTINEL",
            dataRilevazione: "2026-01-24T00:00:00.000Z",
            rilevanzaArt47: true,
            letteraArt47: "ARTICLE_LETTER_ARBITRARY_SENTINEL",
            rischioDecadenza: "FORFEITURE_RISK_ARBITRARY_SENTINEL",
          },
        ],
      },
      pagamenti: {
        coverage: "SELECTED",
        items: [
          {
            id: id("payment-b"),
            annoRiferimento: 2025,
            importoDovuto: "2000.00",
            importoVersato: "1000.00",
            residuo: "1000.00",
            stato: "PAYMENT_STATUS_ARBITRARY_SENTINEL",
            dataScadenza: "2026-02-28T00:00:00.000Z",
          },
          {
            id: id("payment-a"),
            annoRiferimento: 2024,
            importoDovuto: "1000.00",
            importoVersato: "1000.00",
            residuo: "0.00",
            stato: "PAYMENT_STATUS_ARBITRARY_SENTINEL",
            dataScadenza: "2025-02-28T00:00:00.000Z",
          },
        ],
      },
      scadenze: {
        coverage: "SELECTED",
        items: [
          {
            id: id("deadline-b"),
            tipologia: "DEADLINE_TYPE_ARBITRARY_SENTINEL",
            stato: "DEADLINE_STATUS_ARBITRARY_SENTINEL",
            dataScadenza: "2026-03-02T00:00:00.000Z",
            descrizione: "DEADLINE_DESCRIPTION_SENTINEL",
          },
          {
            id: id("deadline-a"),
            tipologia: "DEADLINE_TYPE_ARBITRARY_SENTINEL",
            stato: "DEADLINE_STATUS_ARBITRARY_SENTINEL",
            dataScadenza: "2026-03-01T00:00:00.000Z",
            descrizione: "DEADLINE_DESCRIPTION_SENTINEL",
          },
        ],
      },
      sopralluoghi: {
        coverage: "SELECTED",
        items: [
          {
            id: id("inspection-b"),
            data: "2026-02-02T00:00:00.000Z",
            esito: "INSPECTION_OUTCOME_ARBITRARY_SENTINEL",
            conformitaPlanimetrica: null,
            descrizione: "INSPECTION_DESCRIPTION_SENTINEL",
          },
          {
            id: id("inspection-a"),
            data: "2026-02-01T00:00:00.000Z",
            esito: "INSPECTION_OUTCOME_ARBITRARY_SENTINEL",
            conformitaPlanimetrica: true,
            descrizione: "INSPECTION_DESCRIPTION_SENTINEL",
          },
        ],
      },
      finalActContext: {
        contextOnly: true,
        id: id("final-act"),
        tipoDecisione: "FINAL_DECISION_TYPE_ARBITRARY_SENTINEL",
        numeroAtto: "FINAL_ACT_NUMBER_SENTINEL",
        protocolloAtto: "FINAL_ACT_PROTOCOL_SENTINEL",
        dataAtto: "2026-04-01T00:00:00.000Z",
        dataEfficacia: "2026-04-02T00:00:00.000Z",
        organoCompetente: "REAL_AUTHORITY_SENTINEL",
        effettoTitolo: "FINAL_TITLE_EFFECT_ARBITRARY_SENTINEL",
        statoEffetto: "FINAL_EFFECT_STATUS_ARBITRARY_SENTINEL",
        effettoApplicatoAt: "2026-04-03T00:00:00.000Z",
        statoConcessionePrecedente: "FINAL_PREVIOUS_TITLE_STATE_ARBITRARY_SENTINEL",
        statoConcessioneSuccessivo: "FINAL_NEXT_TITLE_STATE_ARBITRARY_SENTINEL",
        documentoId: id("document-a"),
        registeredByUserId: USER_ID_SENTINEL,
        createdAt: "2026-04-04T00:00:00.000Z",
      },
    },
  } as unknown as Snapshot;
}

function reverseCollections(snapshot: Snapshot): Snapshot {
  const copy = structuredClone(snapshot) as Snapshot;
  copy.content.procedimento.responsibilityAssignments.reverse();
  copy.content.requirements.reverse();
  copy.content.evidence.reverse();
  copy.content.humanReviewReceipts.reverse();
  copy.content.checklist.evidence.reverse();
  copy.content.fascicoloObservations.reverse();
  copy.content.documents.reverse();
  copy.content.criticita.items.reverse();
  copy.content.pagamenti.items.reverse();
  copy.content.scadenze.items.reverse();
  copy.content.sopralluoghi.items.reverse();
  return copy;
}

function expectProjectionError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Expected projection failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AiFascicoloOutboundProjectionError);
    expect((error as AiFascicoloOutboundProjectionError).code).toBe(code);
    expect((error as Error).message).toBe(code);
    expect((error as Error).message).not.toContain(PERSON_NAME_SENTINEL);
    expect((error as Error).message).not.toContain(ACTOR_ID_SENTINEL);
  }
}

describe("AI-01C2A outbound projection contract", () => {
  it("is deterministic across calls and semantically equivalent insertion orders", () => {
    const source = snapshotFixture();
    const first = projectAiFascicoloOutboundV1(source);
    const second = projectAiFascicoloOutboundV1(source);
    const reordered = projectAiFascicoloOutboundV1(reverseCollections(source));

    expect(first.providerBound.outboundProjection).toEqual(second.providerBound.outboundProjection);
    expect(first.localOnly.localAliasMapping).toEqual(second.localOnly.localAliasMapping);
    expect(first.providerBound.outboundProjectionHash).toBe(second.providerBound.outboundProjectionHash);
    expect(reordered.providerBound).toEqual(first.providerBound);
    expect(reordered.localOnly.localAliasMapping).toEqual(first.localOnly.localAliasMapping);
  });

  it("separates canonical and outbound hashes and excludes mapping from the outbound hash", () => {
    const first = projectAiFascicoloOutboundV1(snapshotFixture("canonical"));
    const remapped = projectAiFascicoloOutboundV1(snapshotFixture("replacement"));

    expect(first.localOnly.sourceSnapshotContentHash).toBe(SOURCE_HASH);
    expect(first.providerBound.outboundProjectionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.providerBound.outboundProjectionHash).not.toBe(SOURCE_HASH);
    expect(remapped.providerBound.outboundProjection).toEqual(first.providerBound.outboundProjection);
    expect(remapped.localOnly.localAliasMapping).not.toEqual(first.localOnly.localAliasMapping);
    expect(remapped.providerBound.outboundProjectionHash).toBe(first.providerBound.outboundProjectionHash);
    expect(JSON.stringify(first)).not.toContain("canonical-");
  });

  it("keeps personal data, real identities, filenames, stable IDs, and free text out of provider-bound JSON", () => {
    const result = projectAiFascicoloOutboundV1(snapshotFixture());
    const outboundJson = JSON.stringify(result.providerBound.outboundProjection);
    for (const sentinel of [
      PERSON_NAME_SENTINEL,
      ACTOR_ID_SENTINEL,
      USER_ID_SENTINEL,
      CONCESSIONAIRE_REAL_NAME_SENTINEL,
      ENTE_REAL_NAME_SENTINEL,
      DOCUMENT_FILENAME_SENTINEL,
      "canonical-",
      "REAL_CONCESSION_NUMBER_SENTINEL",
      "REAL_OFFICE_SENTINEL",
      "REAL_UNIT_SENTINEL",
      "PRECISE_LOCATION_SENTINEL",
      "REAL_AUTHORITY_SENTINEL",
      "999999.99",
      "2000.00",
      ...FREE_TEXT_SENTINELS,
      ...UNPROVEN_STRING_SENTINELS,
    ]) {
      expect(outboundJson).not.toContain(sentinel);
    }
  });

  it("preserves safe document metadata and relational aliases without original IDs", () => {
    const result = projectAiFascicoloOutboundV1(snapshotFixture());
    const projection = result.providerBound.outboundProjection;
    expect(projection.schemaVersion).toBe(AI_FASCICOLO_OUTBOUND_V1_SCHEMA_VERSION);
    expect(projection.content.documents).toEqual([
      {
        alias: "DOC_1",
        dataDocumento: "2026-01-21T00:00:00.000Z",
      },
      {
        alias: "DOC_2",
        dataDocumento: "2026-01-22T00:00:00.000Z",
      },
    ]);
    expect(projection.content.evidence[0]).toMatchObject({
      alias: "EVID_1",
      requirementAlias: "REQ_1",
      documentAlias: "DOC_1",
    });
    const documentJson = JSON.stringify(projection.content.documents);
    for (const forbidden of [
      DOCUMENT_FILENAME_SENTINEL,
      "canonical-document",
      "createdAt",
      "storage",
      "URL_SENTINEL",
      "DOCUMENT_CONTENT_SENTINEL",
      "DOCUMENT_BYTES_SENTINEL",
    ]) {
      expect(documentJson).not.toContain(forbidden);
    }
  });

  it("uses a separate non-enumerable local mapping with only aliases, kinds, and canonical IDs", () => {
    const result = projectAiFascicoloOutboundV1(snapshotFixture());
    const documentMapping = result.localOnly.localAliasMapping.find((entry) => entry.alias === "DOC_1");
    expect(documentMapping).toEqual({
      alias: "DOC_1",
      kind: "DOCUMENT",
      canonicalId: "canonical-document-a",
    });
    expect(Object.keys(result)).toEqual(["providerBound"]);
    expect(JSON.stringify(result)).not.toContain("localAliasMapping");
    const mappingJson = JSON.stringify(result.localOnly.localAliasMapping);
    for (const forbidden of [PERSON_NAME_SENTINEL, DOCUMENT_FILENAME_SENTINEL, ...FREE_TEXT_SENTINELS]) {
      expect(mappingJson).not.toContain(forbidden);
    }
  });

  it("excludes activity, fee category, and every other unproven source-derived string", () => {
    const outboundJson = JSON.stringify(
      projectAiFascicoloOutboundV1(snapshotFixture()).providerBound.outboundProjection,
    );
    expect(outboundJson).not.toContain(ATTIVITA_ARBITRARY_SENTINEL);
    expect(outboundJson).not.toContain(CATEGORIA_CANONE_ARBITRARY_SENTINEL);
    for (const sentinel of UNPROVEN_STRING_SENTINELS) {
      expect(outboundJson).not.toContain(sentinel);
    }
  });

  it("does not copy unknown future source fields", () => {
    const source = snapshotFixture() as Snapshot & {
      content: Snapshot["content"] & {
        procedimento: Snapshot["content"]["procedimento"] & { __futureSensitiveField: string };
      };
    };
    source.content.procedimento.__futureSensitiveField = "DO_NOT_LEAK";
    expect(JSON.stringify(projectAiFascicoloOutboundV1(source).providerBound.outboundProjection))
      .not.toContain("DO_NOT_LEAK");
  });

  it("fails closed for duplicate canonical IDs without returning a partial projection", () => {
    const source = snapshotFixture();
    source.content.documents[1].id = source.content.documents[0].id;
    expectProjectionError(
      () => projectAiFascicoloOutboundV1(source),
      "OUTBOUND_PROJECTION_INCONSISTENCY",
    );
  });

  it("fails closed for unresolved relationship references", () => {
    const source = snapshotFixture();
    source.content.evidence[0].documentoId = "unknown-document-id";
    expectProjectionError(
      () => projectAiFascicoloOutboundV1(source),
      "OUTBOUND_PROJECTION_INCONSISTENCY",
    );
  });

  it("fails closed with a sanitized error for an oversized controlled field", () => {
    const source = snapshotFixture();
    source.content.procedimento.dataAvvio = "X".repeat(65);
    expectProjectionError(
      () => projectAiFascicoloOutboundV1(source),
      "OUTBOUND_FIELD_TOO_LARGE",
    );
  });

  it("fails closed with a sanitized error for forbidden undefined source values", () => {
    const source = snapshotFixture();
    (source.content.procedimento as { dataAvvio?: string | null }).dataAvvio = undefined;
    expectProjectionError(
      () => projectAiFascicoloOutboundV1(source),
      "INVALID_SOURCE_SNAPSHOT",
    );
  });

  it.each([
    ["missing required nested object", (source: Snapshot) => {
      delete (source.content as { identityContext?: unknown }).identityContext;
    }],
    ["null nested object", (source: Snapshot) => {
      (source.content as { procedimento: unknown }).procedimento = null;
    }],
    ["collection containing null", (source: Snapshot) => {
      (source.content.documents as unknown[])[0] = null;
    }],
    ["collection containing malformed object", (source: Snapshot) => {
      (source.content.requirements as unknown[])[0] = { id: "malformed-requirement" };
    }],
    ["wrong primitive type", (source: Snapshot) => {
      (source.content.procedimento as { comunicazioneAvvioInviata: unknown }).comunicazioneAvvioInviata = "true";
    }],
    ["undefined required nested value", (source: Snapshot) => {
      (source.content.concessione as { dataRilascio?: string }).dataRilascio = undefined;
    }],
  ] as const)("normalizes %s to a stable sanitized projection error", (_name, corrupt) => {
    const source = snapshotFixture();
    corrupt(source);
    expectProjectionError(
      () => projectAiFascicoloOutboundV1(source),
      "INVALID_SOURCE_SNAPSHOT",
    );
  });

  it("has no runtime dependency on the DB-bound snapshot module or any wiring boundary", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/ai/fascicoloOutboundProjection.ts"), "utf8");
    expect(source).toContain('import type { buildAiFascicoloSnapshotV1 } from "@/server/ai/fascicoloSnapshot"');
    for (const forbidden of [
      "fascicoloLiveAnalysis",
      "fascicoloAnalysis",
      "providers/openai",
      "openaiRuntime",
      "@/lib/prisma",
      "@/lib/auth",
      "tenant-auth",
      "storage",
      "fetch(",
      "process.env",
      "console.",
      "revalidate",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/\{\s*\.\.\.snapshot(?:\.content)?/);
  });
});
