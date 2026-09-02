import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
  getMaterials: vi.fn(),
  getHumanReview: vi.fn(),
  getProcedimentoDetail: vi.fn(),
}));

vi.mock("@/server/queries/ai-fascicolo-trusted-review-materials", () => ({
  getAiFascicoloTrustedReviewMaterialsReadModel: queryMocks.getMaterials,
}));

vi.mock("@/server/queries/ai-fascicolo-human-review", () => ({
  getAiFascicoloHumanReviewReadModel: queryMocks.getHumanReview,
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth")>(),
  requireRole: vi.fn().mockResolvedValue("VIEWER_ADSP"),
  canManageProcedimenti: vi.fn().mockReturnValue(false),
  canRegisterProcedimentoDecision: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/procedimento-checklist", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/procedimento-checklist")>(),
  getChecklistContraddittorioItems: vi.fn().mockReturnValue([]),
  getOrigineProcedimentoLabel: vi.fn().mockReturnValue("Origine"),
  getProcedimentoChecklistGuidance: vi.fn().mockReturnValue({}),
  getStatoPreavvisoRigettoDescription: vi.fn().mockReturnValue(""),
  getStatoPreavvisoRigettoLabel: vi.fn().mockReturnValue(""),
}));

vi.mock("@/server/procedimenti/decisioni", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/procedimenti/decisioni")>(),
  getDecisionRulePreviewForTipologia: vi.fn().mockReturnValue([]),
}));

vi.mock("@/server/queries/procedimenti", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/queries/procedimenti")>(),
  PROCEDIMENTO_ESITO_ISTRUTTORIO_VALUES: [],
  getLetturaProcedimentale: vi.fn().mockReturnValue({
    avvertenza: "",
    qualificazioneProcedimentale: "",
    livelloAttenzione: "",
    passaggiIstruttoriConsigliati: "",
    riferimentiNormativiSuggeriti: "",
  }),
  getProcedimentoDetail: queryMocks.getProcedimentoDetail,
}));

vi.mock("@/server/queries/fascicolo-observations", () => ({
  getFascicoloObservations: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/server/queries/fascicolo-document-requirements", () => ({
  getFascicoloDocumentRequirementProposals: vi.fn().mockResolvedValue({ proposals: [] }),
}));

vi.mock("@/server/queries/fascicolo-document-requirement-evidence", () => ({
  getFascicoloDocumentRequirementEvidenceData: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/server/queries/checklist-evidence", () => ({
  getChecklistEvidenceData: vi.fn().mockResolvedValue({ hasCanonicalTenant: true }),
}));

vi.mock("@/server/queries/normativa", () => ({
  getNormeForProcedimento: vi.fn().mockResolvedValue([]),
}));

import {
  AiFascicoloTrustedReviewPanel,
  resolveAiFascicoloTrustedReviewSelection,
} from "@/components/procedimenti/AiFascicoloTrustedReviewPanel";
import ProcedimentoDetailPage from "@/app/procedimenti/[id]/page";
import type { AiFascicoloHumanReviewReadModelV1 } from "@/server/queries/ai-fascicolo-human-review";
import type { AiFascicoloTrustedReviewMaterialDiscoveryItemV1 } from "@/server/queries/ai-fascicolo-trusted-review-materials";

const panelSource = readFileSync(
  resolve(process.cwd(), "src/components/procedimenti/AiFascicoloTrustedReviewPanel.tsx"),
  "utf8",
);
const pageSource = readFileSync(
  resolve(process.cwd(), "src/app/procedimenti/[id]/page.tsx"),
  "utf8",
);

const materials: readonly AiFascicoloTrustedReviewMaterialDiscoveryItemV1[] = [
  {
    materialId: "material-older",
    createdAt: "2026-08-31T10:00:00.000Z",
    statementPaths: ["summary", "timeline[0]"],
  },
  {
    materialId: "material-newer",
    createdAt: "2026-09-01T10:00:00.000Z",
    statementPaths: ["signals[0]"],
  },
];

const humanReview: AiFascicoloHumanReviewReadModelV1 = {
  material: {
    id: "material-older",
    procedimentoId: "procedimento-1",
    statementPath: "summary",
    target: {
      statementPath: "summary",
      providerStatement: {
        provenance: "AI_ORIGINAL",
        content: { text: "Sintesi canonica", basisRefs: [] },
      },
      resolutionStatus: "NO_BASIS_REFS",
      evidence: [],
    },
  },
  reviewStatus: "REVIEWED",
  currentState: {
    version: 1,
    status: "COMPANY_NEEDS_VERIFICATION",
    latestEventId: "event-1",
    disposition: "COMPANY_NEEDS_VERIFICATION",
    actor: { id: "actor-1", role: "ISTRUTTORE" },
    occurredAt: "2026-09-01T12:00:00.000Z",
    reason: "Verifica professionale necessaria",
  },
  history: [{
    id: "event-1",
    sequence: 1,
    disposition: "COMPANY_NEEDS_VERIFICATION",
    actor: { id: "actor-1", role: "ISTRUTTORE" },
    occurredAt: "2026-09-01T12:00:00.000Z",
    reason: "Verifica professionale necessaria",
  }],
};

const procedimentoDetail = {
  canonicalEnteId: "ente-1",
  procedimento: {
    id: "procedimento-1",
    tipologia: "VARIAZIONE",
    stato: "IN_CORSO",
    riferimentoNormativo: null,
    dataAvvio: null,
    dataScadenzaContraddittorio: null,
    dataProvvedimentoFinale: null,
    giorniResiduiContraddittorio: null,
    giorniRitardoContraddittorio: null,
    noteIstruttorie: null,
    responsabileProcedimentoNome: null,
    responsabileProcedimentoEmail: null,
    unitaOrganizzativaResponsabile: null,
    responsabileAssegnatoAt: null,
    responsabileAssignments: [],
    decisioneConclusiva: null,
    preavvisoRigettoApplicabile: false,
    statoPreavvisoRigetto: "NON_VALUTATO",
    osservazioniPreavvisoRicevute: false,
    valutazioneOsservazioniPreavviso: null,
    checklistContraddittorioCompleta: false,
    checklistWarningLevel: "NONE",
    checklistCompletedItems: 0,
    checklistTotalItems: 0,
    checklistPercentage: 0,
    termineMemorieScadenza: null,
    origineProcedimento: "ISTANZA_PARTE",
    procedimentoUfficio: false,
    termineOsservazioniPreavviso: null,
    checklistMissingItems: [],
    motivazioneValutazione: null,
    propostaEsitoIstruttorio: null,
    noteChecklistContraddittorio: null,
    dataPreavvisoRigetto: null,
    dataOsservazioniPreavviso: null,
    motivazioneMancatoPreavviso: null,
  },
  concessione: {
    id: "concessione-1",
    numeroAtto: "ATTO-1",
    stato: "ATTIVA",
    dataRilascio: new Date("2025-01-01T00:00:00.000Z"),
    dataScadenza: new Date("2030-01-01T00:00:00.000Z"),
    tipologiaBene: "ALTRO",
    attivita: "ALTRO",
    ubicazione: null,
    canoneAnnuo: null,
    categoriaCanone: null,
  },
  concessionario: { denominazione: "Concessionario" },
  criticitaCollegata: null,
  altreCriticitaAperte: [],
  pagamentiCritici: [],
  scadenzeRilevanti: [],
  sopralluoghiRecenti: [],
  documentiPrincipali: [],
  reportCollegati: [],
};

async function executePage(searchParams: {
  materialId?: string | string[];
  statementPath?: string | string[];
} = {}) {
  return ProcedimentoDetailPage({
    params: Promise.resolve({ id: "procedimento-1" }),
    searchParams: Promise.resolve(searchParams),
  });
}

function renderPanel(options: {
  materials?: readonly AiFascicoloTrustedReviewMaterialDiscoveryItemV1[];
  materialId?: string;
  statementPath?: string;
  detail?: AiFascicoloHumanReviewReadModelV1 | null;
  readError?: boolean;
} = {}) {
  const panelMaterials = options.materials ?? materials;
  const selection = resolveAiFascicoloTrustedReviewSelection(
    panelMaterials,
    options.materialId,
    options.statementPath,
  );
  return renderToStaticMarkup(createElement(AiFascicoloTrustedReviewPanel, {
    procedimentoId: "procedimento-1",
    materials: panelMaterials,
    selection,
    humanReview: options.detail ?? null,
    readError: options.readError ?? false,
  }));
}

describe("B2C9A Trusted Review read consumer panel V1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMocks.getProcedimentoDetail.mockResolvedValue(procedimentoDetail);
    queryMocks.getMaterials.mockResolvedValue({
      procedimentoId: "procedimento-1",
      materials,
    });
  });

  it("renders the empty history without a generation control", () => {
    const html = renderPanel({ materials: [] });
    expect(html).toContain("Nessuna analisi Trusted Review disponibile");
    expect(html).not.toMatch(/Genera|button/i);
  });

  it("renders every material in supplied order without selecting the first one", () => {
    const html = renderPanel();
    expect(html.indexOf("material-older")).toBeLessThan(html.indexOf("material-newer"));
    expect(html).toContain("Selezionare un materiale");
    expect(html).not.toContain('aria-current="true"');
  });

  it("builds material links that set materialId and reset statementPath", () => {
    const html = renderPanel({ materialId: "material-older", statementPath: "summary" });
    expect(html).toContain("/procedimenti/procedimento-1?materialId=material-newer");
    expect(html).not.toContain("materialId=material-newer&amp;statementPath=");
  });

  it("renders statement paths in B2C8 order and preserves materialId in their links", () => {
    const html = renderPanel({ materialId: "material-older" });
    expect(html.indexOf(">summary<")).toBeLessThan(html.indexOf(">timeline[0]<"));
    expect(html).toContain("materialId=material-older&amp;statementPath=summary");
    expect(html).toContain("materialId=material-older&amp;statementPath=timeline%5B0%5D");
  });

  it.each([
    ["no materialId", undefined, undefined],
    ["statement without material", undefined, "summary"],
    ["foreign material", "unknown", "summary"],
    ["valid material without statement", "material-older", undefined],
    ["foreign statement", "material-older", "signals[0]"],
    ["empty material", "", "summary"],
    ["empty statement", "material-older", ""],
    ["material array", ["material-older"], "summary"],
    ["statement array", "material-older", ["summary"]],
  ] as const)("page orchestration keeps B2C3 at zero for %s", async (_label, materialId, statementPath) => {
    await executePage({
      materialId,
      statementPath,
    });
    expect(queryMocks.getMaterials).toHaveBeenCalledWith({ procedimentoId: "procedimento-1" });
    expect(queryMocks.getHumanReview).not.toHaveBeenCalled();
  });

  it("page orchestration invokes B2C3 exactly once with a validated pair", async () => {
    queryMocks.getHumanReview.mockResolvedValue(humanReview);
    await executePage({
      materialId: "material-older",
      statementPath: "summary",
    });
    expect(queryMocks.getHumanReview).toHaveBeenCalledTimes(1);
    expect(queryMocks.getHumanReview).toHaveBeenCalledWith({
      materialId: "material-older",
      statementPath: "summary",
    });
  });

  it("renders canonical statement content, current review state, and review history read-only", () => {
    const html = renderPanel({
      materialId: "material-older",
      statementPath: "summary",
      detail: humanReview,
    });
    expect(html).toContain("Sintesi canonica");
    expect(html).toContain("Ulteriore verifica richiesta");
    expect(html).toContain("Storico revisione umana");
    expect(html).toContain("Verifica professionale necessaria");
    expect(html).not.toMatch(/<form|<button|textarea|contenteditable/i);
  });

  it("sanitizes invalid selections and read failures", () => {
    const invalid = renderPanel({ materialId: "foreign", statementPath: "summary" });
    const failed = renderPanel({ materials: [], readError: true });
    expect(invalid).toContain("La selezione richiesta non appartiene allo storico disponibile");
    expect(failed).toContain("I materiali di revisione non sono disponibili in questo momento");
    expect(`${invalid}${failed}`).not.toMatch(/Prisma|stack|tenant|canonicalPayload|fingerprint/i);
  });

  it("keeps the panel on the read-only server boundary", () => {
    expect(panelSource).not.toContain('"use client"');
    expect(panelSource).not.toMatch(/@\/generated\/prisma|@\/lib\/prisma|openai|process\.env/i);
    expect(panelSource).not.toMatch(/produceAiFascicoloTrustedReviewAction|applyAiFascicoloHumanReviewAction/);
    expect(panelSource).not.toMatch(/useTransition|router\.refresh|idempotencyKey|<form|<button/i);
    expect(panelSource).not.toMatch(/loadValidatedHumanReview|getAiFascicoloHumanReviewReadModel/);
    expect(panelSource).not.toMatch(/approvazione|rigetto|conformit|non conform|decisione|accertamento|rinnovo|revoca|sanzione/i);
  });

  it("keeps page orchestration server-side and preserves existing procedimento sections", () => {
    expect(pageSource).toContain("getAiFascicoloTrustedReviewMaterialsReadModel");
    expect(pageSource).toContain('if (selection.kind === "COMPLETE")');
    expect(pageSource).toContain("getAiFascicoloHumanReviewReadModel");
    expect(pageSource).toContain("<AiFascicoloTrustedReviewPanel");
    expect(pageSource).toContain("<FascicoloObservationsPanel");
    expect(pageSource).toContain("<FascicoloDocumentRequirementScreeningTrigger");
    expect(pageSource).toContain("<FascicoloDocumentRequirementProposalsPanel");
  });
});