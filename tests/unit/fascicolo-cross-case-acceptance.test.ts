import { describe, expect, it } from "vitest";

import { bodySha256, buildActExportDocument, normalizeActDraftContent } from "@/server/fascicolo-acts/model";
import { buildActTemplateCatalog, type ActPhase } from "@/server/fascicolo-acts/templates";
import { buildLegalApplication, type LegalRuleTemporalStatus } from "@/server/fascicolo-report/legal-application";
import { renderProfessionalReportPdf, renderProfessionalReportRtf } from "@/server/fascicolo-report/professional-export";
import type { StructuredReportProceduralContext } from "@/server/fascicolo-report/structured-report";

/**
 * Cross-case acceptance matrix: the same pipeline (phase recognition -> facsimile catalog ->
 * temporal legal application -> act export) must behave coherently on materially different
 * fascicoli. All cases are fictitious; Selvara is only one shape among many.
 */

interface AcceptanceCase {
  name: string;
  procedural: Partial<StructuredReportProceduralContext>;
  issue: string;
  analysisDate: string;
  expectedPhase: ActPhase;
  expectedReviewPending: boolean;
  mustRecommend: string[];
  mustNotRecommend: string[];
  expectedRules: Record<string, LegalRuleTemporalStatus>;
  expectedConclusionStatus: "GROUNDED_ON_VERIFIED_AUTHORITIES" | "NORMATIVE_ONLY_PRELIMINARY" | "SOURCES_TO_VERIFY";
  verifiedAuthority?: boolean;
}

function procedural(overrides: Partial<StructuredReportProceduralContext>): StructuredReportProceduralContext {
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
    concessione: null,
    documentTitles: [],
    ...overrides,
  };
}

const CASES: AcceptanceCase[] = [
  {
    name: "Selvara-shaped: decadenza concluded, riesame pending",
    procedural: {
      stato: "CONCLUSO",
      dataAvvio: "2024-10-01T00:00:00.000Z",
      finalAct: { numeroAtto: "Decreto 5/2025", dataAtto: "2025-04-02T00:00:00.000Z", motivazioneSintetica: "Decadenza" },
      concessione: { numeroAtto: "17/2023", stato: "REVOCATA", dataRilascio: "2023-06-15T00:00:00.000Z" },
      documentTitles: ["Istanza di riesame in autotutela del concessionario"],
    },
    issue: "Decadenza per inadempimento degli obblighi della concessione portuale dal 10/09/2024",
    analysisDate: "2026-11-03",
    expectedPhase: "POST_DECISION",
    expectedReviewPending: true,
    mustRecommend: [],
    mustNotRecommend: ["CATALOG:COMUNICAZIONE_AVVIO", "CATALOG:PROVVEDIMENTO_FINALE"],
    expectedRules: { COD_NAV_47: "APPLICABLE", L84_ART18: "APPLICABILITY_TO_VERIFY", ART_242_2025: "APPLICABILITY_TO_VERIFY" },
    expectedConclusionStatus: "GROUNDED_ON_VERIFIED_AUTHORITIES",
    verifiedAuthority: true,
  },
  {
    name: "Porto Aurora (fictitious): abusive works, contestazione sent",
    procedural: {
      stato: "IN_CORSO",
      dataAvvio: "2026-02-01T00:00:00.000Z",
      comunicazioneAvvioInviata: true,
      contestazioneFormaleInviata: true,
      concessione: { numeroAtto: "3/2021", stato: "ATTIVA", dataRilascio: "2021-01-20T00:00:00.000Z" },
    },
    issue: "Opere abusive: manufatto prefabbricato non autorizzato rilevato il 15/01/2026",
    analysisDate: "2026-11-03",
    expectedPhase: "INSTRUCTION",
    expectedReviewPending: false,
    mustRecommend: ["CATALOG:VALUTAZIONE_CONTRODEDUZIONI"],
    mustNotRecommend: ["CATALOG:PROVVEDIMENTO_FINALE"],
    expectedRules: { COD_NAV_54: "APPLICABLE" },
    expectedConclusionStatus: "NORMATIVE_ONLY_PRELIMINARY",
  },
  {
    name: "Synthetic initial: old grant, durata e PEF",
    procedural: {
      concessione: { numeroAtto: "8/2019", stato: "ATTIVA", dataRilascio: "2019-05-10T00:00:00.000Z" },
    },
    issue: "Rilascio e durata della concessione di area portuale; verificare PEF",
    analysisDate: "2026-11-03",
    expectedPhase: "INITIAL",
    expectedReviewPending: false,
    mustRecommend: ["CATALOG:COMUNICAZIONE_AVVIO"],
    mustNotRecommend: ["CATALOG:PROVVEDIMENTO_FINALE"],
    expectedRules: {
      L84_ART18: "APPLICABLE_PREVIOUS_VERSION",
      DM_202_2022: "PROSPECTIVE_ONLY",
      ART_242_2025: "APPLICABILITY_TO_VERIFY",
    },
    expectedConclusionStatus: "NORMATIVE_ONLY_PRELIMINARY",
  },
  {
    name: "Synthetic decision-ready: controdeduzioni valutate",
    procedural: {
      stato: "IN_CORSO",
      dataAvvio: "2026-03-01T00:00:00.000Z",
      comunicazioneAvvioInviata: true,
      contestazioneFormaleInviata: true,
      memorieRicevute: true,
      controdeduzioniValutate: true,
      concessione: { numeroAtto: "11/2024", stato: "ATTIVA", dataRilascio: "2024-04-04T00:00:00.000Z" },
    },
    issue: "Decadenza per mancato pagamento del canone dal 01/01/2026",
    analysisDate: "2026-11-03",
    expectedPhase: "DECISION",
    expectedReviewPending: false,
    mustRecommend: ["CATALOG:PROVVEDIMENTO_FINALE"],
    mustNotRecommend: ["CATALOG:COMUNICAZIONE_AVVIO"],
    expectedRules: { COD_NAV_47: "APPLICABLE" },
    expectedConclusionStatus: "NORMATIVE_ONLY_PRELIMINARY",
  },
  {
    name: "Synthetic archived without review",
    procedural: {
      stato: "ARCHIVIATO",
      dataAvvio: "2025-01-10T00:00:00.000Z",
      dataProvvedimentoFinale: "2025-06-30T00:00:00.000Z",
    },
    issue: "Decadenza per inadempimento degli obblighi del titolo",
    analysisDate: "2026-11-03",
    expectedPhase: "POST_DECISION",
    expectedReviewPending: false,
    mustRecommend: [],
    mustNotRecommend: ["CATALOG:COMUNICAZIONE_AVVIO"],
    expectedRules: { COD_NAV_47: "DATE_TO_VERIFY" },
    expectedConclusionStatus: "SOURCES_TO_VERIFY",
  },
  {
    name: "Synthetic insufficient evidence: no dates, no title",
    procedural: {},
    issue: "Opere abusive sul demanio",
    analysisDate: "2026-11-03",
    expectedPhase: "INITIAL",
    expectedReviewPending: false,
    mustRecommend: [],
    mustNotRecommend: ["CATALOG:COMUNICAZIONE_AVVIO"],
    expectedRules: { COD_NAV_54: "DATE_TO_VERIFY" },
    expectedConclusionStatus: "SOURCES_TO_VERIFY",
  },
];

const templateContext = { procedimentoLabel: "Procedimento di collaudo", responsabile: null, unitaOrganizzativa: null };

describe("cross-case acceptance matrix", () => {
  it.each(CASES)("$name", async (testCase) => {
    const context = procedural(testCase.procedural);

    const catalog = buildActTemplateCatalog({ payload: { proceduralContext: context }, context: templateContext });
    expect(catalog.phase).toBe(testCase.expectedPhase);
    expect(catalog.reviewPending).toBe(testCase.expectedReviewPending);
    const recommended = catalog.recommended.map((template) => template.templateKey);
    for (const key of testCase.mustRecommend) expect(recommended).toContain(key);
    for (const key of testCase.mustNotRecommend) expect(recommended).not.toContain(key);
    if (context.concessione && catalog.phase !== "POST_DECISION") {
      expect(catalog.recommended.length + catalog.others.length).toBeGreaterThan(0);
    }
    for (const template of [...catalog.recommended, ...catalog.others]) {
      expect(template.body).toContain("nessuna firma, protocollazione, notifica o invio automatici");
    }
    if (context.concessione) {
      const avvio = [...catalog.recommended, ...catalog.others].find((template) => template.templateKey === "CATALOG:COMUNICAZIONE_AVVIO");
      if (catalog.phase === "INITIAL") expect(avvio?.body).toContain(context.concessione.numeroAtto);
      else expect(avvio).toBeUndefined();
    }

    const [application] = buildLegalApplication({
      issues: [{
        semanticKey: "issue-acceptance",
        text: testCase.issue,
        originatingItemIds: [],
        favorableAuthorities: [],
        contraryAuthorities: testCase.verifiedAuthority
          ? [{ title: "Cons. Stato, sentenza verificata di collaudo", sourceUrl: "https://example.test/s", rationale: "Proporzionalità" }]
          : [],
      }],
      knowledgeItems: [],
      analysisDate: testCase.analysisDate,
      portMatter: true,
      context: {
        stato: context.stato,
        dataAvvio: context.dataAvvio,
        dataProvvedimentoFinale: context.dataProvvedimentoFinale,
        finalAct: context.finalAct ? { numeroAtto: context.finalAct.numeroAtto, dataAtto: context.finalAct.dataAtto } : null,
        concessione: context.concessione
          ? { numeroAtto: context.concessione.numeroAtto, dataRilascio: context.concessione.dataRilascio }
          : null,
        documentTitles: context.documentTitles,
      },
    });
    for (const [ruleId, status] of Object.entries(testCase.expectedRules)) {
      expect(application.rules.find((rule) => rule.ruleId === ruleId)?.temporalStatus, ruleId).toBe(status);
    }
    expect(application.conclusionStatus).toBe(testCase.expectedConclusionStatus);
    if (testCase.expectedConclusionStatus === "SOURCES_TO_VERIFY") {
      expect(application.rules.every((rule) => !["APPLICABLE", "APPLICABLE_PREVIOUS_VERSION"].includes(rule.temporalStatus))).toBe(true);
      expect(application.conclusion).not.toContain("fondata sul solo dato normativo");
    }
    for (const rule of application.rules) {
      expect(rule.officialUrl).toMatch(/^https:\/\//);
      expect(rule.temporalReasoning.length).toBeGreaterThan(0);
    }
    expect(application.consequences.length).toBeGreaterThan(0);

    const template = catalog.recommended[0] ?? catalog.others[0];
    if (!template) {
      expect(catalog.phase === "POST_DECISION" || !context.concessione).toBe(true);
      return;
    }
    const content = normalizeActDraftContent({
      templateKey: template.templateKey,
      issueSemanticKey: template.issueSemanticKey,
      title: template.title,
      body: template.body,
      status: "BOZZA",
      assignee: "Ufficio Demanio",
      dueDate: "2026-12-15",
      progress: 10,
      dependencies: [],
      attachments: [],
      changeNote: "Prima stesura",
    }, "act_000000000000000000000001");
    const document = buildActExportDocument({
      version: {
        ...content,
        schema: "FASCICOLO_ACT_DRAFT_V1",
        procedimentoId: "P-acceptance",
        draftKey: "act_000000000000000000000001",
        version: 1,
        bodySha256: bodySha256(content.body),
        savedAt: new Date("2026-11-03T10:00:00.000Z"),
        savedBy: "rup@example.test",
        auditHash: "a".repeat(64),
      },
      procedimentoLabel: templateContext.procedimentoLabel,
      attachmentNames: new Map(),
      dependencyTitles: new Map(),
    });
    const rtf = renderProfessionalReportRtf(document).toString("utf8");
    expect(rtf.startsWith("{\\rtf1")).toBe(true);
    const pdf = await renderProfessionalReportPdf(document);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
