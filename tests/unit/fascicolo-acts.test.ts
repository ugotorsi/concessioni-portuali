import { describe, expect, it } from "vitest";

import {
  buildActExportDocument,
  bodySha256,
  changedActDraftFields,
  normalizeActDraftContent,
  projectActDrafts,
  type ActDraftContent,
  type ActDraftVersion,
} from "@/server/fascicolo-acts/model";
import { buildActTemplateCatalog, detectActPhase, findActTemplate } from "@/server/fascicolo-acts/templates";
import type { StructuredReportProceduralContext } from "@/server/fascicolo-report/structured-report";

function context(overrides: Partial<StructuredReportProceduralContext> = {}): StructuredReportProceduralContext {
  return {
    stato: "DA_AVVIARE",
    tipologia: "ALTRO",
    origineProcedimento: "UFFICIO",
    dataAvvio: null,
    dataProvvedimentoFinale: null,
    comunicazioneAvvioInviata: false,
    contestazioneFormaleInviata: false,
    memorieRicevute: false,
    audizioneSvolta: false,
    controdeduzioniValutate: false,
    checklistContraddittorioCompleta: false,
    finalAct: null,
    concessione: { numeroAtto: "17/2023", stato: "ATTIVA", dataRilascio: "2023-03-01" },
    documentTitles: [],
    ...overrides,
  };
}

const templateContext = { procedimentoLabel: "Procedimento P-1", responsabile: "Dott.ssa Rossi", unitaOrganizzativa: "Ufficio Demanio" };

function content(overrides: Partial<ActDraftContent> = {}): ActDraftContent {
  return {
    templateKey: "CATALOG:COMUNICAZIONE_AVVIO",
    issueSemanticKey: null,
    title: "Comunicazione di avvio",
    body: "Testo",
    status: "BOZZA",
    assignee: null,
    dueDate: null,
    progress: 0,
    dependencies: [],
    attachments: [],
    changeNote: null,
    ...overrides,
  };
}

function version(draftKey: string, versionNumber: number, overrides: Partial<ActDraftContent> = {}): ActDraftVersion {
  const value = content(overrides);
  return {
    ...value,
    schema: "FASCICOLO_ACT_DRAFT_V1",
    procedimentoId: "P-1",
    draftKey,
    version: versionNumber,
    bodySha256: bodySha256(value.body),
    savedAt: new Date(Date.UTC(2026, 10, versionNumber)),
    savedBy: "rup@example.test",
    auditHash: "h".repeat(64),
  };
}

describe("fascicolo act templates", () => {
  it("detects the administrative phase from the procedural context", () => {
    expect(detectActPhase({ proceduralContext: context() }).phase).toBe("INITIAL");
    expect(detectActPhase({ proceduralContext: context({ contestazioneFormaleInviata: true }) }).phase).toBe("INSTRUCTION");
    expect(detectActPhase({ proceduralContext: context({ controdeduzioniValutate: true }) }).phase).toBe("DECISION");
    const concluded = detectActPhase({
      proceduralContext: context({ stato: "CONCLUSO", documentTitles: ["Istanza di riesame"] }),
    });
    expect(concluded).toMatchObject({ phase: "POST_DECISION", reviewPending: true, documentaryAhead: false });
    expect(detectActPhase(null).phase).toBe("INITIAL");
  });

  it("infers a later phase from evidenced documents when authoritative metadata is stale", () => {
    const knowledge = (text: string, evidence = true) => ({
      id: text, kind: "LEGAL_ACT" as const, semanticKey: text, contentFingerprint: text, normalizedText: text,
      payload: {}, confidence: 0.9, status: "AI_PROPOSED" as const, reviewVersion: 1,
      evidence: evidence
        ? [{ basisRef: "DOCUMENT_1.PAGE_2", documentoId: "d", documentFileVersionId: null, pageNumber: 2, textSha256: "x" }]
        : [],
    });
    const framework = (legalActs: ReturnType<typeof knowledge>[]) => ({
      partyRoles: [], facts: [], timeline: [], legalActs, measures: [], contradictions: [],
    });

    const stale = detectActPhase({
      proceduralContext: context(),
      documentedFramework: framework([
        knowledge("Decreto n. 5/2025 di decadenza dalla concessione n. 17/2023"),
        knowledge("Istanza di riesame presentata dal concessionario"),
      ]),
    });
    expect(stale).toMatchObject({ phase: "POST_DECISION", authoritativePhase: "INITIAL", documentaryAhead: true, reviewPending: true });
    expect(stale.documentarySignals).toContain("Decreto n. 5/2025 di decadenza dalla concessione n. 17/2023");

    expect(detectActPhase({
      proceduralContext: context(),
      documentedFramework: framework([knowledge("Proposta di provvedimento di decadenza da sottoporre al dirigente")]),
    })).toMatchObject({ phase: "INITIAL", documentaryAhead: false });
    expect(detectActPhase({
      proceduralContext: context(),
      documentedFramework: framework([knowledge("Decreto di decadenza n. 5/2025", false)]),
    })).toMatchObject({ phase: "INITIAL", documentaryAhead: false });
    expect(detectActPhase({
      proceduralContext: context(),
      documentedFramework: framework([knowledge("Contestazione degli addebiti con termine per deduzioni di 30 giorni")]),
    })).toMatchObject({ phase: "INSTRUCTION", documentaryAhead: true });
    expect(detectActPhase({
      proceduralContext: context({ stato: "CONCLUSO" }),
      documentedFramework: framework([knowledge("Contestazione degli addebiti")]),
    })).toMatchObject({ phase: "POST_DECISION", documentaryAhead: false });
  });

  it("recommends phase-specific facsimiles and fills only verified placeholders", () => {
    const catalog = buildActTemplateCatalog({ payload: { proceduralContext: context() }, context: templateContext });
    const keys = catalog.recommended.map((template) => template.templateKey);
    expect(keys).toContain("CATALOG:COMUNICAZIONE_AVVIO");
    expect(keys).not.toContain("CATALOG:PROVVEDIMENTO_FINALE");
    expect(catalog.others.map((template) => template.templateKey)).toContain("CATALOG:PROVVEDIMENTO_FINALE");
    const avvio = findActTemplate(catalog, "CATALOG:COMUNICAZIONE_AVVIO");
    expect(avvio?.body).toContain("concessione demaniale n. 17/2023");
    expect(avvio?.body).toContain("Responsabile del procedimento: Dott.ssa Rossi");
    expect(avvio?.body).toContain("[CONCESSIONARIO]");
    expect(avvio?.body).toContain("nessuna firma, protocollazione, notifica o invio automatici");
  });

  it("includes report plan drafts for concluded proceedings", () => {
    const catalog = buildActTemplateCatalog({
      payload: {
        proceduralContext: context({
          stato: "CONCLUSO",
          finalAct: { numeroAtto: "12", dataAtto: "2025-04-02", motivazioneSintetica: "Decadenza" },
        }),
        operationalPlans: [{
          issueSemanticKey: "issue-1",
          issueText: "Decadenza",
          sourceDocumentRefs: [],
          outstandingEvidence: [],
          legalSourceStatus: "LEGAL_RESEARCH_REQUIRED",
          professionalStatus: "PRELIMINARY_NOT_APPROVED",
          recommendedNextStep: "",
          alternatives: [],
          deadlineReview: "",
          steps: [{
            title: "1. Istruire l'istanza di riesame",
            action: "",
            office: "",
            requiredDocuments: [],
            completionGate: "",
            draftTitle: "Riscontro motivato all'istanza di riesame",
            draftTemplate: "Oggetto: istanza di riesame relativa a [TITOLO/ATTO].",
          }],
        }],
      },
      context: templateContext,
    });
    expect(catalog.phase).toBe("POST_DECISION");
    const plan = catalog.recommended[0];
    expect(plan.source).toBe("REPORT_PLAN");
    expect(plan.issueSemanticKey).toBe("issue-1");
    expect(plan.body).toBe("Oggetto: istanza di riesame relativa a provvedimento n. 12 del 2025-04-02.");
  });
});

describe("fascicolo act versioning", () => {
  it("normalizes content and rejects invalid dates", () => {
    const normalized = normalizeActDraftContent(content({
      status: "APPROVATA_INTERNAMENTE",
      progress: 40,
      dependencies: ["b", "a", "a", "self"],
      attachments: ["d2", "d1", "d2"],
      assignee: "",
    }), "self");
    expect(normalized).toMatchObject({ progress: 100, dependencies: ["a", "b"], attachments: ["d1", "d2"], assignee: null });
    expect(() => normalizeActDraftContent(content({ dueDate: "2026-02-30" }), null)).toThrow();
    expect(() => normalizeActDraftContent(content({ progress: 120 }), null)).toThrow();
  });

  it("projects append-only history with open dependencies", () => {
    const drafts = projectActDrafts([
      version("a", 1),
      version("a", 2, { body: "Testo rivisto", status: "IN_REVISIONE", progress: 50 }),
      version("b", 1, { title: "Provvedimento", dependencies: ["a"], dueDate: "2026-12-01" }),
      version("a", 2, { body: "duplicate replay" }),
    ]);
    expect(drafts.map((draft) => draft.draftKey)).toEqual(["b", "a"]);
    const draftA = drafts.find((draft) => draft.draftKey === "a");
    expect(draftA?.current.version).toBe(2);
    expect(draftA?.history.map((item) => item.version)).toEqual([2, 1]);
    expect(drafts.find((draft) => draft.draftKey === "b")?.openDependencies).toEqual(["a"]);
    expect(changedActDraftFields(draftA!.history[1], draftA!.history[0])).toEqual(["testo", "stato", "avanzamento"]);
    expect(changedActDraftFields(null, draftA!.history[1])).toEqual(["prima versione"]);

    const resolved = projectActDrafts([
      version("a", 1, { status: "APPROVATA_INTERNAMENTE" }),
      version("b", 1, { dependencies: ["a"] }),
    ]);
    expect(resolved.find((draft) => draft.draftKey === "b")?.openDependencies).toEqual([]);
  });

  it("builds a professional export with management details", () => {
    const document = buildActExportDocument({
      version: version("a", 3, {
        body: "Primo paragrafo.\n\nSecondo paragrafo.",
        assignee: "Ufficio Demanio",
        dueDate: "2026-12-01",
        attachments: ["doc-1", "doc-x"],
        dependencies: ["b"],
      }),
      procedimentoLabel: "Procedimento P-1",
      attachmentNames: new Map([["doc-1", "Verbale di sopralluogo.pdf"]]),
      dependencyTitles: new Map([["b", "Comunicazione di avvio"]]),
    });
    expect(document.sections[0].paragraphs).toEqual(["Primo paragrafo.", "Secondo paragrafo."]);
    const management = document.sections[1].paragraphs.join(" ");
    expect(management).toContain("versione 3");
    expect(management).toContain("Assegnatario: Ufficio Demanio.");
    expect(management).toContain("01/12/2026");
    expect(management).toContain("Allegati: Verbale di sopralluogo.pdf; documento non più disponibile.");
    expect(management).toContain("Atti presupposti: Comunicazione di avvio.");
    expect(document.subtitle).toContain("non firmato, non protocollato e non inviato");
  });
});
