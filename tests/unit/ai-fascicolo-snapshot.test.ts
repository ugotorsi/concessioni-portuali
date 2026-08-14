import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const canUseAIMock = vi.hoisted(() => vi.fn());
const canonicalProcedimentoMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const getProcedimentoDetailMock = vi.hoisted(() => vi.fn());
const getRequirementsMock = vi.hoisted(() => vi.fn());
const getEvidenceMock = vi.hoisted(() => vi.fn());
const getChecklistEvidenceMock = vi.hoisted(() => vi.fn());
const getObservationsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentUser: getCurrentUserMock,
  canUseAI: canUseAIMock,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { procedimento: { findUnique: canonicalProcedimentoMock } },
}));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/queries/procedimenti", () => ({ getProcedimentoDetail: getProcedimentoDetailMock }));
vi.mock("@/server/queries/fascicolo-document-requirements", () => ({
  getFascicoloDocumentRequirementProposals: getRequirementsMock,
}));
vi.mock("@/server/queries/fascicolo-document-requirement-evidence", () => ({
  getFascicoloDocumentRequirementEvidenceData: getEvidenceMock,
}));
vi.mock("@/server/queries/checklist-evidence", () => ({ getChecklistEvidenceData: getChecklistEvidenceMock }));
vi.mock("@/server/queries/fascicolo-observations", () => ({ getFascicoloObservations: getObservationsMock }));

import {
  AI_FASCICOLO_SNAPSHOT_CONTENT_HASH_ALGORITHM,
  AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION,
  AiFascicoloSnapshotError,
  buildAiFascicoloSnapshotV1,
} from "@/server/ai/fascicoloSnapshot";

function proposal(id: string, createdAt: string) {
  return {
    id,
    status: "VALIDATO",
    screeningFingerprint: `fingerprint-${id}`,
    matcherAlgorithmVersion: "p1-c1-v1",
    canonicalArt18Snapshot: "ART_18_L_84_1994",
    portActivityLegalTypeSnapshot: "OPERAZIONI_PORTUALI",
    sourceStableKeySnapshot: "L_84_1994",
    sourceTitleSnapshot: "Legge 28 gennaio 1994, n. 84",
    sourceRelevantProvisionsSnapshot: ["art. 16", { nestedEmail: "opaque@example.test" }],
    ruleCodeSnapshot: `RULE-${id}`,
    ruleContractVersionSnapshot: "1",
    legalRuleDefinitionSnapshot: { humanReviewRequired: true, storageKey: "opaque-storage-key" },
    gapKeySnapshot: `GAP-${id}`,
    gapLabelSnapshot: `Requisito ${id}`,
    gapDescriptionSnapshot: "Verifica istruttoria",
    matchedCriteriaSnapshot: { norma: "ART_18_L_84_1994", futureField: "opaque-future-field" },
    createdAt: new Date(createdAt),
    createdByActorId: `creator-${id}`,
    createdByEmail: "excluded.creator@example.test",
    createdByRole: "ADMIN",
    reviewedAt: new Date("2026-08-11T11:00:00.000Z"),
    reviewedByActorId: `proposal-reviewer-${id}`,
    reviewedByEmail: "excluded.proposal.reviewer@example.test",
    reviewedByRole: "GIURIDICO",
    reviewNote: "Applicabilità esaminata",
  };
}

function association(id: string, proposalId: string, createdAt: string, reviewed = true) {
  return {
    id,
    proposalId,
    documentoId: `document-${id}`,
    createdAt: new Date(createdAt),
    createdByActorId: `evidence-creator-${id}`,
    createdByEmail: "excluded.evidence.creator@example.test",
    createdByRole: "ADMIN",
    revokedAt: id.endsWith("2") ? new Date("2026-08-14T08:00:00.000Z") : null,
    revokedByActorId: id.endsWith("2") ? "revoker-actor" : null,
    revokedByEmail: id.endsWith("2") ? "excluded.revoker@example.test" : null,
    revokedByRole: id.endsWith("2") ? "GIURIDICO" : null,
    revocationNote: id.endsWith("2") ? "Associazione revocata" : null,
    review: reviewed
      ? {
          id: `review-${id}`,
          createdAt: new Date("2026-08-13T10:30:00.000Z"),
          reviewedByActorId: `reviewer-${id}`,
          reviewedByEmail: "excluded.reviewer@example.test",
          reviewedByRole: "GIURIDICO",
          reviewNote: "Esame umano registrato",
        }
      : null,
    documento: {
      id: `document-${id}`,
      nome: `Documento ${id}.pdf`,
      tipologia: "ATTO",
      statoDocumento: "ATTIVO",
      dataDocumento: null,
      createdAt: new Date("2026-08-01T08:00:00.000Z"),
    },
  };
}

function detailFixture() {
  return {
    canonicalEnteId: "ente-1",
    procedimento: {
      id: "proc-1",
      responsabileProcedimentoNome: "Responsabile Interno",
      responsabileProcedimentoEmail: "excluded.responsabile@example.test",
      unitaOrganizzativaResponsabile: "Unità istruttoria",
      responsabileAssegnatoAt: new Date("2026-08-01T09:00:00.000Z"),
      responsabileAssignments: [
        {
          id: "assignment-2",
          responsabileNome: "Secondo Responsabile",
          responsabileEmail: "excluded.assignment2@example.test",
          unitaOrganizzativa: "Unità B",
          decorrenza: new Date("2026-08-03T00:00:00.000Z"),
          cessazione: null,
          motivoAssegnazione: null,
          comunicataAt: null,
          registeredByUserId: "registrar-2",
          registeredByUserEmail: "excluded.registrar@example.test",
        },
        {
          id: "assignment-1",
          responsabileNome: "Primo Responsabile",
          responsabileEmail: "excluded.assignment1@example.test",
          unitaOrganizzativa: "Unità A",
          decorrenza: new Date("2026-08-02T00:00:00.000Z"),
          cessazione: new Date("2026-08-03T00:00:00.000Z"),
          motivoAssegnazione: "Rotazione",
          comunicataAt: new Date("2026-08-02T10:00:00.000Z"),
          registeredByUserId: "registrar-1",
          registeredByUserEmail: "excluded.registrar@example.test",
        },
      ],
      tipologia: "CHIARIMENTI",
      checklistProfile: "CORE",
      riferimentoNormativo: "Art. 18",
      dataAvvio: new Date("2026-08-01T00:00:00.000Z"),
      dataScadenzaContraddittorio: null,
      dataProvvedimentoFinale: null,
      comunicazioneAvvioInviata: true,
      dataComunicazioneAvvio: new Date("2026-08-02T00:00:00.000Z"),
      termineMemorieGiorni: 10,
      termineMemorieScadenza: new Date("2026-08-12T00:00:00.000Z"),
      memorieRicevute: false,
      dataRicezioneMemorie: null,
      audizioneRichiesta: false,
      audizioneSvolta: false,
      dataAudizione: null,
      sopralluogoIstruttorioSvolto: true,
      contestazioneFormaleInviata: false,
      dataContestazioneFormale: null,
      controdeduzioniValutate: false,
      motivazioneValutazione: "Valutazione interna\r\nDa verificare",
      propostaEsitoIstruttorio: "DA_VALUTARE",
      origineProcedimento: "UFFICIO",
      procedimentoUfficio: true,
      preavvisoRigettoApplicabile: false,
      statoPreavvisoRigetto: "NON_VALUTATO",
      dataPreavvisoRigetto: null,
      termineOsservazioniPreavviso: null,
      osservazioniPreavvisoRicevute: false,
      dataOsservazioniPreavviso: null,
      valutazioneOsservazioniPreavviso: null,
      motivazioneMancatoPreavviso: null,
      checklistContraddittorioCompleta: false,
      noteChecklistContraddittorio: "Nota checklist",
      checklistMissingItems: ["Voce B", "Voce A"],
      checklistPercentage: 50,
      checklistCompletedItems: 1,
      checklistTotalItems: 2,
      checklistWarningLevel: "warning",
      stato: "IN_CORSO",
      noteIstruttorie: "Nota istruttoria",
      giorniResiduiContraddittorio: null,
      giorniRitardoContraddittorio: null,
      createdAt: new Date("2026-07-31T00:00:00.000Z"),
      decisioneConclusiva: {
        id: "final-act-1",
        tipoDecisione: "ARCHIVIAZIONE",
        numeroAtto: "ATTO-1",
        protocolloAtto: "PROT-1",
        dataAtto: new Date("2026-08-10T00:00:00.000Z"),
        dataEfficacia: new Date("2026-08-11T00:00:00.000Z"),
        organoCompetente: "Organo competente",
        adottanteNome: "Excluded Name",
        adottanteQualifica: "Excluded Role",
        scostamentoDaIstruttoria: false,
        motivazioneScostamentoIstruttoria: null,
        motivazioneSintetica: "Excluded free text",
        effettoTitolo: "NESSUNO",
        statoConcessionePrecedente: null,
        statoConcessioneSuccessivo: null,
        statoEffetto: "NON_PREVISTO",
        effettoApplicatoAt: null,
        documentoId: "document-final",
        documentoNome: "Atto finale.pdf",
        registeredByUserId: "final-registrar",
        registeredByUserEmail: "excluded.final@example.test",
        createdAt: new Date("2026-08-10T12:00:00.000Z"),
      },
    },
    concessione: {
      id: "concession-1",
      numeroAtto: "CONC-1",
      stato: "ATTIVA",
      dataRilascio: new Date("2020-01-01T00:00:00.000Z"),
      dataScadenza: new Date("2030-01-01T00:00:00.000Z"),
      tipologiaBene: "AREA",
      attivita: "OPERAZIONI_PORTUALI",
      ubicazione: "Molo 1",
      canoneAnnuo: "1234.5",
      categoriaCanone: "ORDINARIO",
    },
    concessionario: {
      id: "operator-1",
      denominazione: "Società concessionaria",
      codiceFiscale: "EXCLUDED-CF",
      partitaIva: "EXCLUDED-PIVA",
      sedeLegale: "Excluded address",
      pec: "excluded.pec@example.test",
      email: "excluded.company@example.test",
    },
    criticitaCollegata: {
      id: "issue-2",
      tipologia: "DOCUMENTALE",
      gravita: "ALTA",
      stato: "APERTA",
      descrizione: "Criticità collegata",
      riferimentoNormativo: null,
      dataRilevazione: new Date("2026-08-05T00:00:00.000Z"),
      rilevanzaArt47: false,
      letteraArt47: null,
      rischioDecadenza: null,
    },
    altreCriticitaAperte: [{
      id: "issue-1",
      tipologia: "TECNICA",
      gravita: "MEDIA",
      stato: "IN_GESTIONE",
      descrizione: "Criticità aperta",
      dataRilevazione: new Date("2026-08-04T00:00:00.000Z"),
    }],
    pagamentiCritici: [
      { id: "payment-2", annoRiferimento: 2026, importoDovuto: "20", importoVersato: "10", residuo: "10", stato: "PARZIALE", dataScadenza: new Date("2026-08-02T00:00:00.000Z") },
      { id: "payment-1", annoRiferimento: 2025, importoDovuto: "10", importoVersato: "0", residuo: "10", stato: "SCADUTO", dataScadenza: new Date("2025-08-02T00:00:00.000Z") },
    ],
    scadenzeRilevanti: [
      { id: "deadline-2", tipologia: "ALTRO", stato: "APERTA", dataScadenza: new Date("2026-09-02T00:00:00.000Z"), descrizione: null },
      { id: "deadline-1", tipologia: "ALTRO", stato: "SCADUTA", dataScadenza: new Date("2026-09-01T00:00:00.000Z"), descrizione: "Scadenza" },
    ],
    sopralluoghiRecenti: [
      { id: "inspection-2", data: new Date("2026-08-06T00:00:00.000Z"), esito: "DA_APPROFONDIRE", operatori: "Excluded Inspector", conformitaPlanimetrica: false, descrizione: null },
      { id: "inspection-1", data: new Date("2026-08-05T00:00:00.000Z"), esito: "REGOLARE", operatori: "Excluded Inspector", conformitaPlanimetrica: true, descrizione: "Sopralluogo" },
    ],
    documentiPrincipali: [
      { id: "document-2", nome: "Documento 2.pdf", tipologia: "ATTO", statoDocumento: "ATTIVO", url: "https://secret.example/signed", dataDocumento: null, createdAt: new Date("2026-08-02T00:00:00.000Z") },
      { id: "document-1", nome: "Documento 1.pdf", tipologia: "ATTO", statoDocumento: "ATTIVO", url: "/documenti/document-1/download", dataDocumento: new Date("2026-08-01T00:00:00.000Z"), createdAt: new Date("2026-08-01T00:00:00.000Z") },
    ],
    reportCollegati: [],
  };
}

function requirementsFixture() {
  return {
    hasCanonicalTenant: true,
    proposals: [proposal("proposal-2", "2026-08-10T11:00:00.000Z"), proposal("proposal-1", "2026-08-10T10:00:00.000Z")],
  };
}

function evidenceFixture() {
  return {
    hasCanonicalTenant: true,
    associationsByProposalId: {
      "proposal-2": [association("evidence-2", "proposal-2", "2026-08-12T09:00:00.000Z")],
      "proposal-1": [association("evidence-1", "proposal-1", "2026-08-12T08:00:00.000Z")],
    },
    eligibleDocumentsByProposalId: {},
  };
}

function checklistFixture() {
  return {
    hasCanonicalTenant: true,
    evidence: [
      {
        id: "check-2",
        checklistItemCode: "B",
        status: "PROPOSTO",
        createdAt: new Date("2026-08-10T11:00:00.000Z"),
        createdByActorId: "check-creator-2",
        createdByEmail: "excluded.check@example.test",
        createdByRole: "ADMIN",
        reviewedAt: null,
        reviewedByActorId: null,
        reviewedByEmail: null,
        reviewedByRole: null,
        reviewNote: null,
        documento: { id: "document-2", nome: "Documento 2.pdf", tipologia: "ATTO" },
      },
      {
        id: "check-1",
        checklistItemCode: "A",
        status: "VALIDATO",
        createdAt: new Date("2026-08-10T10:00:00.000Z"),
        createdByActorId: "check-creator-1",
        createdByEmail: "excluded.check@example.test",
        createdByRole: "ADMIN",
        reviewedAt: new Date("2026-08-11T00:00:00.000Z"),
        reviewedByActorId: "check-reviewer-1",
        reviewedByEmail: "excluded.check.reviewer@example.test",
        reviewedByRole: "GIURIDICO",
        reviewNote: "Esame checklist",
        documento: { id: "document-1", nome: "Documento 1.pdf", tipologia: "ATTO" },
      },
    ],
    eligibleDocuments: [],
  };
}

function observationsFixture() {
  return [
    {
      id: "observation-2",
      status: "PROPOSTO",
      ruleCode: "PEC-2",
      ruleVersion: 1,
      detectedAt: new Date("2026-08-12T11:00:00.000Z"),
      reviewedAt: null,
      reviewNote: null,
      factsSnapshot: { canale: "PEC", nestedUrl: "https://opaque.example.test" },
      documento: { id: "document-2", nome: "Documento 2.pdf", pecWarningMancataRicevuta: true },
      currentConditionDetected: true,
      text: "Osservazione 2",
      disclaimer: "Verifica umana richiesta",
    },
    {
      id: "observation-1",
      status: "VALIDATO",
      ruleCode: "PEC-1",
      ruleVersion: 1,
      detectedAt: new Date("2026-08-12T10:00:00.000Z"),
      reviewedAt: new Date("2026-08-13T00:00:00.000Z"),
      reviewNote: "Esaminata",
      factsSnapshot: { canale: "PEC", arbitraryFutureField: "opaque-observation-field" },
      documento: { id: "document-1", nome: "Documento 1.pdf", pecWarningMancataRicevuta: false },
      currentConditionDetected: false,
      text: "Osservazione 1",
      disclaimer: "Verifica umana richiesta",
    },
  ];
}

function configureAllowedSources() {
  getCurrentUserMock.mockResolvedValue({ id: "actor-1", email: "excluded.actor@example.test", role: "ADMIN" });
  canUseAIMock.mockReturnValue(true);
  canonicalProcedimentoMock.mockResolvedValue({
    id: "proc-1",
    concessioneId: "concession-1",
    concessione: { enteId: "ente-1" },
  });
  getCurrentTenantContextMock.mockResolvedValue({
    userId: "actor-1",
    role: "ADMIN",
    isAdmin: true,
    tenantMemberships: [],
    defaultTenantId: null,
    accessibleTenantIds: [],
  });
  requireTenantAccessMock.mockReturnValue(undefined);
  getProcedimentoDetailMock.mockResolvedValue(detailFixture());
  getRequirementsMock.mockResolvedValue(requirementsFixture());
  getEvidenceMock.mockResolvedValue(evidenceFixture());
  getChecklistEvidenceMock.mockResolvedValue(checklistFixture());
  getObservationsMock.mockResolvedValue(observationsFixture());
}

function expectSnapshotError(error: unknown, code: string) {
  expect(error).toBeInstanceOf(AiFascicoloSnapshotError);
  expect((error as AiFascicoloSnapshotError).code).toBe(code);
}

function sourceText() {
  return readFileSync(resolve(process.cwd(), "src/server/ai/fascicoloSnapshot.ts"), "utf8");
}

const DIRECT_DB_WRITE_PATTERN = /\b(?:prisma|db|tx)(?:\.[A-Za-z_$][\w$]*)+\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
const DIRECT_DB_CONTROL_PATTERN = /\b(?:prisma|db|tx)\.(?:\$transaction|\$executeRaw|\$executeRawUnsafe)\s*\(/;

function stableSerializeForTest(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerializeForTest).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerializeForTest(record[key])}`)
    .join(",")}}`;
}

function collectPropertyNames(value: unknown, names = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") {
    return names;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPropertyNames(item, names);
    }
    return names;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    names.add(key);
    collectPropertyNames(item, names);
  }
  return names;
}

describe("AI-00B deterministic fascicolo snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    configureAllowedSources();
  });

  it("rejects an unauthenticated actor before canonical or dependent reads", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "UNAUTHENTICATED");
      return true;
    });
    expect(canonicalProcedimentoMock).not.toHaveBeenCalled();
    expect(getProcedimentoDetailMock).not.toHaveBeenCalled();
  });

  it("rejects a role outside the internal AI gate", async () => {
    canUseAIMock.mockReturnValue(false);
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "AI_ROLE_FORBIDDEN");
      return true;
    });
    expect(canonicalProcedimentoMock).not.toHaveBeenCalled();
  });

  it("fails closed when the canonical procedimento does not exist", async () => {
    canonicalProcedimentoMock.mockResolvedValue(null);
    await expect(buildAiFascicoloSnapshotV1("missing-proc")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "PROCEDIMENTO_NOT_FOUND");
      return true;
    });
    expect(requireTenantAccessMock).not.toHaveBeenCalled();
    expect(getProcedimentoDetailMock).not.toHaveBeenCalled();
  });

  it("allows an authorized internal actor and emits the V1 metadata", async () => {
    const snapshot = await buildAiFascicoloSnapshotV1("proc-1");
    expect(snapshot.metadata.schemaVersion).toBe(AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION);
    expect(snapshot.metadata.contentHashAlgorithm).toBe(AI_FASCICOLO_SNAPSHOT_CONTENT_HASH_ALGORITHM);
    expect(snapshot.metadata.generatedByActorId).toBe("actor-1");
  });

  it("resolves and enforces the canonical tenant before dependent composition", async () => {
    await buildAiFascicoloSnapshotV1("proc-1");
    expect(requireTenantAccessMock).toHaveBeenCalledWith(expect.anything(), "ente-1", {
      mode: "read",
      allowWhenEnteMissing: false,
    });
    const tenantGateOrder = requireTenantAccessMock.mock.invocationCallOrder[0];
    for (const dependent of [
      getProcedimentoDetailMock,
      getRequirementsMock,
      getEvidenceMock,
      getChecklistEvidenceMock,
      getObservationsMock,
    ]) {
      expect(dependent.mock.invocationCallOrder[0]).toBeGreaterThan(tenantGateOrder);
    }
  });

  it("fails closed for a null canonical tenant without dependent composition", async () => {
    canonicalProcedimentoMock.mockResolvedValue({ id: "proc-1", concessioneId: "concession-1", concessione: { enteId: null } });
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "SOURCE_INCONSISTENCY");
      return true;
    });
    expect(requireTenantAccessMock).not.toHaveBeenCalled();
    expect(getProcedimentoDetailMock).not.toHaveBeenCalled();
  });

  it("fails a cross-tenant request before dependent composition", async () => {
    requireTenantAccessMock.mockImplementation(() => { throw new Error("denied"); });
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "TENANT_ACCESS_DENIED");
      return true;
    });
    expect(getProcedimentoDetailMock).not.toHaveBeenCalled();
    expect(getRequirementsMock).not.toHaveBeenCalled();
  });

  it("applies the existing tenant gate to ADMIN without an AI-specific bypass", async () => {
    await buildAiFascicoloSnapshotV1("proc-1");
    expect(getCurrentTenantContextMock).toHaveBeenCalledOnce();
    expect(requireTenantAccessMock).toHaveBeenCalledOnce();
  });

  it("denies ADMIN when the existing tenant helper rejects access", async () => {
    requireTenantAccessMock.mockImplementation(() => { throw new Error("denied"); });
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "TENANT_ACCESS_DENIED");
      return true;
    });
    expect(getProcedimentoDetailMock).not.toHaveBeenCalled();
    expect(getRequirementsMock).not.toHaveBeenCalled();
  });

  it("returns no partial snapshot for source inconsistency", async () => {
    getRequirementsMock.mockResolvedValue({ hasCanonicalTenant: false, proposals: [] });
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "SOURCE_INCONSISTENCY");
      return true;
    });
  });

  it("preserves explicit null for nullable dates", async () => {
    const explicitNull = detailFixture();
    explicitNull.procedimento.dataAvvio = null;
    getProcedimentoDetailMock.mockResolvedValue(explicitNull);
    const snapshot = await buildAiFascicoloSnapshotV1("proc-1");
    expect(snapshot.content.procedimento.dataAvvio).toBeNull();
  });

  it("rejects undefined for nullable dates", async () => {
    const inconsistent = detailFixture();
    (inconsistent.procedimento as unknown as Record<string, unknown>).dataAvvio = undefined;
    getProcedimentoDetailMock.mockResolvedValue(inconsistent);
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "SOURCE_INCONSISTENCY");
      return true;
    });
  });

  it("maps an invalid date representation to SOURCE_INCONSISTENCY", async () => {
    const inconsistent = detailFixture();
    inconsistent.procedimento.dataAvvio = new Date("invalid");
    getProcedimentoDetailMock.mockResolvedValue(inconsistent);
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "SOURCE_INCONSISTENCY");
      return true;
    });
  });

  it("preserves explicit null for nullable text", async () => {
    const explicitNull = detailFixture();
    explicitNull.procedimento.noteIstruttorie = null;
    getProcedimentoDetailMock.mockResolvedValue(explicitNull);
    const snapshot = await buildAiFascicoloSnapshotV1("proc-1");
    expect(snapshot.content.procedimento.noteIstruttorie).toBeNull();
  });

  it("fails closed instead of silently omitting an undefined V1 field", async () => {
    const inconsistent = detailFixture();
    (inconsistent.procedimento as unknown as Record<string, unknown>).noteIstruttorie = undefined;
    getProcedimentoDetailMock.mockResolvedValue(inconsistent);
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "SOURCE_INCONSISTENCY");
      return true;
    });
  });

  it("accepts explicit canonical absence of the final act", async () => {
    const explicitNull = detailFixture();
    explicitNull.procedimento.decisioneConclusiva = null;
    getProcedimentoDetailMock.mockResolvedValue(explicitNull);
    const snapshot = await buildAiFascicoloSnapshotV1("proc-1");
    expect(snapshot.content.finalActContext).toBeNull();
  });

  it("rejects an unexpectedly undefined final-act container", async () => {
    const inconsistent = detailFixture();
    (inconsistent.procedimento as unknown as Record<string, unknown>).decisioneConclusiva = undefined;
    getProcedimentoDetailMock.mockResolvedValue(inconsistent);
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "SOURCE_INCONSISTENCY");
      return true;
    });
  });

  it("rejects undefined for a non-text non-date V1 field", async () => {
    const inconsistent = detailFixture();
    (inconsistent.procedimento as unknown as Record<string, unknown>).procedimentoUfficio = undefined;
    getProcedimentoDetailMock.mockResolvedValue(inconsistent);
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "SOURCE_INCONSISTENCY");
      return true;
    });
  });

  it("does not misclassify a dependent query failure as SOURCE_INCONSISTENCY", async () => {
    const dependentFailure = new Error("DEPENDENT_FAILURE");
    getEvidenceMock.mockRejectedValue(dependentFailure);
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toBe(dependentFailure);
  });

  it("produces equal content and hash for the same canonical state", async () => {
    const first = await buildAiFascicoloSnapshotV1("proc-1");
    const second = await buildAiFascicoloSnapshotV1("proc-1");
    expect(second.content).toEqual(first.content);
    expect(second.metadata.contentHash).toBe(first.metadata.contentHash);
  });

  it("excludes generated time and generating actor from the content hash", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T10:00:00.000Z"));
    const first = await buildAiFascicoloSnapshotV1("proc-1");
    getCurrentUserMock.mockResolvedValue({ id: "actor-2", email: "excluded.actor2@example.test", role: "GIURIDICO" });
    vi.setSystemTime(new Date("2026-08-14T11:00:00.000Z"));
    const second = await buildAiFascicoloSnapshotV1("proc-1");
    expect(second.metadata.generatedAt).not.toBe(first.metadata.generatedAt);
    expect(second.metadata.generatedByActorId).not.toBe(first.metadata.generatedByActorId);
    expect(second.metadata.contentHash).toBe(first.metadata.contentHash);
  });

  it("normalizes NFC-equivalent Unicode and LF-equivalent line endings", async () => {
    const composed = detailFixture();
    composed.concessionario.denominazione = "Società concessionaria";
    composed.procedimento.motivazioneValutazione = "Prima riga\r\nSeconda riga";
    getProcedimentoDetailMock.mockResolvedValue(composed);
    const first = await buildAiFascicoloSnapshotV1("proc-1");

    const decomposed = detailFixture();
    decomposed.concessionario.denominazione = "Societa\u0300 concessionaria";
    decomposed.procedimento.motivazioneValutazione = "Prima riga\nSeconda riga";
    getProcedimentoDetailMock.mockResolvedValue(decomposed);
    const second = await buildAiFascicoloSnapshotV1("proc-1");

    expect(second.content).toEqual(first.content);
    expect(second.metadata.contentHash).toBe(first.metadata.contentHash);
    expect(second.content.concessionario.denominazione).toBe("Società concessionaria");
    expect(second.content.procedimento.motivazioneValutazione).toBe("Prima riga\nSeconda riga");
  });

  it("normalizes incoming array order and null ordering deterministically", async () => {
    const first = await buildAiFascicoloSnapshotV1("proc-1");
    const reversedDetail = detailFixture();
    reversedDetail.documentiPrincipali.reverse();
    reversedDetail.pagamentiCritici.reverse();
    reversedDetail.scadenzeRilevanti.reverse();
    reversedDetail.sopralluoghiRecenti.reverse();
    reversedDetail.procedimento.responsabileAssignments.reverse();
    getProcedimentoDetailMock.mockResolvedValue(reversedDetail);
    const reversedRequirements = requirementsFixture();
    reversedRequirements.proposals.reverse();
    getRequirementsMock.mockResolvedValue(reversedRequirements);
    const reversedChecklist = checklistFixture();
    reversedChecklist.evidence.reverse();
    getChecklistEvidenceMock.mockResolvedValue(reversedChecklist);
    getObservationsMock.mockResolvedValue(observationsFixture().reverse());
    const second = await buildAiFascicoloSnapshotV1("proc-1");
    expect(second.content).toEqual(first.content);
    expect(second.metadata.contentHash).toBe(first.metadata.contentHash);
    expect(second.content.documents.map((item) => item.id)).toEqual(["document-1", "document-2"]);
  });

  it("normalizes Evidence association and receipt input order deterministically", async () => {
    const first = await buildAiFascicoloSnapshotV1("proc-1");
    const reversed = evidenceFixture();
    reversed.associationsByProposalId = Object.fromEntries(
      Object.entries(reversed.associationsByProposalId)
        .reverse()
        .map(([proposalId, items]) => [proposalId, [...items].reverse()]),
    ) as typeof reversed.associationsByProposalId;
    getEvidenceMock.mockResolvedValue(reversed);
    const second = await buildAiFascicoloSnapshotV1("proc-1");
    expect(second.content.evidence).toEqual(first.content.evidence);
    expect(second.content.humanReviewReceipts).toEqual(first.content.humanReviewReceipts);
    expect(second.content).toEqual(first.content);
    expect(second.metadata.contentHash).toBe(first.metadata.contentHash);
  });

  it("uses sha256 and changes the hash for a material content change", async () => {
    const first = await buildAiFascicoloSnapshotV1("proc-1");
    const changed = detailFixture();
    changed.procedimento.noteIstruttorie = "Materially changed";
    getProcedimentoDetailMock.mockResolvedValue(changed);
    const second = await buildAiFascicoloSnapshotV1("proc-1");
    expect(first.metadata.contentHashAlgorithm).toBe("sha256");
    expect(first.metadata.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.metadata.contentHash).not.toBe(first.metadata.contentHash);
  });

  it("hashes the exact normalized content returned to the caller", async () => {
    const snapshot = await buildAiFascicoloSnapshotV1("proc-1");
    const expectedHash = createHash("sha256")
      .update(stableSerializeForTest({
        schemaVersion: AI_FASCICOLO_SNAPSHOT_V1_SCHEMA_VERSION,
        content: snapshot.content,
      }))
      .digest("hex");
    expect(snapshot.metadata.contentHash).toBe(expectedHash);
  });

  it("rejects JavaScript numbers as monetary canonical sources", async () => {
    const floatingPointMoney = detailFixture();
    (floatingPointMoney.concessione as unknown as Record<string, unknown>).canoneAnnuo = 1234.5;
    getProcedimentoDetailMock.mockResolvedValue(floatingPointMoney);
    await expect(buildAiFascicoloSnapshotV1("proc-1")).rejects.toSatisfy((error: unknown) => {
      expectSnapshotError(error, "SOURCE_INCONSISTENCY");
      return true;
    });
  });

  it("normalizes equivalent decimal string and Decimal-like sources without floating-point conversion", async () => {
    const stringMoney = detailFixture();
    getProcedimentoDetailMock.mockResolvedValue(stringMoney);
    const first = await buildAiFascicoloSnapshotV1("proc-1");

    const decimalLikeMoney = detailFixture();
    (decimalLikeMoney.concessione as unknown as Record<string, unknown>).canoneAnnuo = { toString: () => "1234.5" };
    getProcedimentoDetailMock.mockResolvedValue(decimalLikeMoney);
    const second = await buildAiFascicoloSnapshotV1("proc-1");
    expect(second.content.concessione.canoneAnnuo).toBe("1234.5");
    expect(second.content).toEqual(first.content);
    expect(second.metadata.contentHash).toBe(first.metadata.contentHash);
  });

  it("emits minimized metadata-only documents and personal provenance", async () => {
    const snapshot = await buildAiFascicoloSnapshotV1("proc-1");
    const serialized = JSON.stringify(snapshot);
    expect(snapshot.content.documents[0]).toEqual({
      id: "document-1",
      nome: "Documento 1.pdf",
      tipologia: "ATTO",
      statoDocumento: "ATTIVO",
      dataDocumento: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    for (const excluded of [
      "excluded.",
      "EXCLUDED-CF",
      "EXCLUDED-PIVA",
      "https://secret.example/signed",
      "storageKey",
      "storagePath",
      "storageProvider",
      "storageBucket",
      "nomeStorage",
      "documentText",
      "ocrText",
      "pdfText",
      "docxText",
      "bytes",
      "credential",
      "secret",
      "opaque@example.test",
      "opaque-storage-key",
      "opaque-future-field",
      "https://opaque.example.test",
      "opaque-observation-field",
    ]) {
      expect(serialized).not.toContain(excluded);
    }
    expect(snapshot.content.concessionario).toEqual({ id: "operator-1", denominazione: "Società concessionaria" });
    expect(snapshot.content.humanReviewReceipts[0]).toHaveProperty("reviewedByActorId");
    expect(snapshot.content.humanReviewReceipts[0]).not.toHaveProperty("reviewedByEmail");
    expect(snapshot.content.requirements[0]).not.toHaveProperty("sourceRelevantProvisionsSnapshot");
    expect(snapshot.content.requirements[0]).not.toHaveProperty("legalRuleDefinitionSnapshot");
    expect(snapshot.content.requirements[0]).not.toHaveProperty("matchedCriteriaSnapshot");
    expect(snapshot.content.fascicoloObservations[0]).not.toHaveProperty("factsSnapshot");
  });

  it("marks selected collection coverage without claiming exhaustiveness", async () => {
    const snapshot = await buildAiFascicoloSnapshotV1("proc-1");
    for (const section of [
      snapshot.content.criticita,
      snapshot.content.pagamenti,
      snapshot.content.scadenze,
      snapshot.content.sopralluoghi,
    ]) {
      expect(section.coverage).toBe("SELECTED");
      expect(section).not.toHaveProperty("exhaustive");
      expect(section).not.toHaveProperty("totalCount");
    }
  });

  it("keeps empty selected collections explicitly non-exhaustive", async () => {
    const empty = detailFixture();
    empty.criticitaCollegata = null;
    empty.altreCriticitaAperte = [];
    empty.pagamentiCritici = [];
    empty.scadenzeRilevanti = [];
    empty.sopralluoghiRecenti = [];
    getProcedimentoDetailMock.mockResolvedValue(empty);
    const snapshot = await buildAiFascicoloSnapshotV1("proc-1");
    expect(snapshot.content.criticita).toEqual({ coverage: "SELECTED", items: [] });
    expect(snapshot.content.pagamenti).toEqual({ coverage: "SELECTED", items: [] });
  });

  it("keeps final-act data context-only and emits no AI legal conclusions", async () => {
    const snapshot = await buildAiFascicoloSnapshotV1("proc-1");
    expect(snapshot.content.finalActContext?.contextOnly).toBe(true);
    expect(snapshot.content.finalActContext?.organoCompetente).toBe("Organo competente");
    const propertyNames = collectPropertyNames(snapshot.content);
    for (const forbidden of [
      "approved",
      "isApproved",
      "approval",
      "approvalStatus",
      "accepted",
      "isAccepted",
      "acceptance",
      "valid",
      "isValid",
      "validity",
      "sufficient",
      "isSufficient",
      "sufficiency",
      "legalComplete",
      "legalCompleteness",
      "proceduralReady",
      "proceduralReadiness",
    ]) {
      expect(propertyNames).not.toContain(forbidden);
    }
  });

  it("preserves factual proposal, association, revocation, receipt, observation, and checklist provenance", async () => {
    const snapshot = await buildAiFascicoloSnapshotV1("proc-1");
    expect(snapshot.content.requirements[0]).toMatchObject({ createdByActorId: "creator-proposal-1", reviewedByActorId: "proposal-reviewer-proposal-1" });
    expect(snapshot.content.evidence[1]).toMatchObject({ revokedByActorId: "revoker-actor", revokedByRole: "GIURIDICO" });
    expect(snapshot.content.humanReviewReceipts[0]).toMatchObject({ evidenceId: "evidence-1", reviewedByRole: "GIURIDICO" });
    expect(snapshot.content.fascicoloObservations[0]).toMatchObject({ id: "observation-1", ruleCode: "PEC-1" });
    expect(snapshot.content.checklist.evidence[0]).toMatchObject({ id: "check-1", createdByActorId: "check-creator-1" });
  });

  it("contains no write, storage, HTTP, AI, action, audit, revalidation, or normative-query boundary", () => {
    const source = sourceText();
    expect(DIRECT_DB_WRITE_PATTERN.test("crypto.update(payload)")).toBe(false);
    expect(DIRECT_DB_WRITE_PATTERN.test("prisma.example.update({ data: value })")).toBe(true);
    expect(DIRECT_DB_WRITE_PATTERN.test("tx.example.create({ data: value })")).toBe(true);
    expect(DIRECT_DB_CONTROL_PATTERN.test("prisma.$executeRaw(query)")).toBe(true);
    expect(DIRECT_DB_WRITE_PATTERN.test(source)).toBe(false);
    expect(DIRECT_DB_CONTROL_PATTERN.test(source)).toBe(false);
    for (const forbidden of [
      "fetch(",
      "revalidatePath",
      "getNormeForProcedimento",
      "server/actions",
      "storageKey",
      "storagePath",
      "storageBucket",
      "openai",
      "anthropic",
      "simpliciter",
      "createAudit",
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
