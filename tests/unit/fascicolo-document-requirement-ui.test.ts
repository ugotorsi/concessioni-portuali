import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { getFascicoloDocumentRequirementEvidenceData } from "@/server/queries/fascicolo-document-requirement-evidence";
import type { getFascicoloDocumentRequirementProposals } from "@/server/queries/fascicolo-document-requirements";

const createProposalMock = vi.hoisted(() => vi.fn());
const reviewProposalMock = vi.hoisted(() => vi.fn());
const createEvidenceMock = vi.hoisted(() => vi.fn());
const reviewEvidenceMock = vi.hoisted(() => vi.fn());
const revokeEvidenceMock = vi.hoisted(() => vi.fn());
const uploadEvidenceMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const matcherMock = vi.hoisted(() => vi.fn());
const genericResolverMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("@/server/actions/fascicolo-document-requirements", () => ({
  createFascicoloDocumentRequirementProposal: createProposalMock,
  reviewFascicoloDocumentRequirementProposalAction: reviewProposalMock,
}));
vi.mock("@/server/actions/fascicolo-document-requirement-evidence", () => ({
  createFascicoloDocumentRequirementEvidence: createEvidenceMock,
  reviewFascicoloDocumentRequirementEvidence: reviewEvidenceMock,
  revokeFascicoloDocumentRequirementEvidence: revokeEvidenceMock,
}));
vi.mock("@/server/actions/fascicolo-document-requirement-upload", () => ({
  uploadFascicoloDocumentRequirementEvidence: uploadEvidenceMock,
}));
vi.mock("@/server/fascicolo-document-requirements/matcher", () => ({
  evaluateP1C1DocumentRequirement: matcherMock,
}));
vi.mock("@/server/legal-rules/orchestrator", () => ({
  resolveApplicableLegalRules: genericResolverMock,
}));

import { FascicoloDocumentRequirementProposalsPanel } from "@/components/procedimenti/FascicoloDocumentRequirementProposalsPanel";

type Proposal = Awaited<ReturnType<typeof getFascicoloDocumentRequirementProposals>>["proposals"][number];
type EvidenceData = Awaited<ReturnType<typeof getFascicoloDocumentRequirementEvidenceData>>;
type Association = EvidenceData["associationsByProposalId"][string][number];

function proposal(status: Proposal["status"] = "PROPOSTO", overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "proposal-1",
    status,
    screeningFingerprint: "a".repeat(64),
    matcherAlgorithmVersion: "p1-c1-v1",
    canonicalArt18Snapshot: "ART_18_L_84_1994",
    portActivityLegalTypeSnapshot: "OPERAZIONI_PORTUALI",
    sourceStableKeySnapshot: "L_84_1994",
    sourceTitleSnapshot: "Legge 28 gennaio 1994, n. 84",
    sourceRelevantProvisionsSnapshot: ["art. 16", "art. 18"],
    ruleCodeSnapshot: "P1C_ART18_ART16_AUTH_REQUIREMENT",
    ruleContractVersionSnapshot: "1",
    legalRuleDefinitionSnapshot: { humanReviewRequired: true },
    gapKeySnapshot: "REQ-AUTORIZZAZIONE-ART16",
    gapLabelSnapshot: "Autorizzazione per operazioni portuali ex art. 16",
    gapDescriptionSnapshot: "Verificare l'applicabilità del requisito autorizzatorio.",
    matchedCriteriaSnapshot: {
      normaRiferimento: "ART_18_L_84_1994",
      portActivityLegalType: "OPERAZIONI_PORTUALI",
    },
    createdAt: new Date("2026-08-10T10:00:00.000Z"),
    createdByActorId: "staging-preview-admin",
    createdByEmail: "creator@example.test",
    createdByRole: "ADMIN",
    reviewedAt: status === "PROPOSTO" ? null : new Date("2026-08-11T11:00:00.000Z"),
    reviewedByActorId: status === "PROPOSTO" ? null : "reviewer-actor",
    reviewedByEmail: status === "PROPOSTO" ? null : "reviewer@example.test",
    reviewedByRole: status === "PROPOSTO" ? null : "GIURIDICO",
    reviewNote: status === "RIFIUTATO" ? "Non applicabile al caso concreto" : null,
    ...overrides,
  };
}

const activeAssociation: Association = {
  id: "evidence-active",
  proposalId: "proposal-1",
  documentoId: "documento-1",
  createdAt: new Date("2026-08-12T08:00:00.000Z"),
  createdByActorId: "creator-actor",
  createdByEmail: "creator@example.test",
  createdByRole: "ADMIN",
  revokedAt: null,
  revokedByActorId: null,
  revokedByEmail: null,
  revokedByRole: null,
  revocationNote: null,
  review: null,
  documento: {
    id: "documento-1",
    nome: "Titolo autorizzatorio.pdf",
    tipologia: "ATTO",
    statoDocumento: "ATTIVO",
    dataDocumento: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T08:00:00.000Z"),
  },
};

const revokedAssociation: Association = {
  ...activeAssociation,
  id: "evidence-revoked",
  documentoId: "documento-2",
  revokedAt: new Date("2026-08-12T09:00:00.000Z"),
  revokedByActorId: "reviewer-actor",
  revokedByEmail: "reviewer@example.test",
  revokedByRole: "GIURIDICO",
  revocationNote: "Collegamento errato",
  documento: {
    ...activeAssociation.documento,
    id: "documento-2",
    nome: "Documento revocato.pdf",
  },
};

const evidenceReview: NonNullable<Association["review"]> = {
  id: "review-1",
  createdAt: new Date("2026-08-13T10:30:00.000Z"),
  reviewedByActorId: "reviewer-actor",
  reviewedByEmail: "reviewer@example.test",
  reviewedByRole: "GIURIDICO",
  reviewNote: "Esaminata la documentazione disponibile.",
};

const reviewedAssociation: Association = {
  ...activeAssociation,
  review: evidenceReview,
};

const revokedReviewedAssociation: Association = {
  ...revokedAssociation,
  review: evidenceReview,
};

function evidenceData(overrides: Partial<EvidenceData> = {}): EvidenceData {
  return {
    hasCanonicalTenant: true,
    associationsByProposalId: { "proposal-1": [] },
    eligibleDocumentsByProposalId: { "proposal-1": [] },
    ...overrides,
  };
}

function renderPanel({
  proposals = [proposal()],
  evidence = evidenceData(),
  canReview = true,
  hasCanonicalTenant = true,
}: {
  proposals?: Proposal[];
  evidence?: EvidenceData;
  canReview?: boolean;
  hasCanonicalTenant?: boolean;
} = {}) {
  return renderToStaticMarkup(createElement(FascicoloDocumentRequirementProposalsPanel, {
    proposals,
    evidenceData: evidence,
    canReview,
    hasCanonicalTenant,
  }));
}

function pageSource() {
  return readFileSync(resolve(process.cwd(), "src/app/procedimenti/[id]/page.tsx"), "utf8");
}

function evidenceSectionSource() {
  return readFileSync(
    resolve(process.cwd(), "src/components/procedimenti/FascicoloDocumentRequirementEvidenceSection.tsx"),
    "utf8",
  );
}

function reviewActionInputSource() {
  const source = evidenceSectionSource();
  const start = source.indexOf("await reviewFascicoloDocumentRequirementEvidence({");
  const end = source.indexOf("        });", start);
  return source.slice(start, end);
}

function uploadFormSource() {
  return readFileSync(
    resolve(process.cwd(), "src/components/procedimenti/FascicoloDocumentRequirementUploadForm.tsx"),
    "utf8",
  );
}

function uploadActionInputSource() {
  const source = uploadFormSource();
  const start = source.indexOf("await uploadFascicoloDocumentRequirementEvidence({");
  const end = source.indexOf("      });", start);
  return source.slice(start, end);
}

function formContaining(html: string, text: string) {
  return html.match(new RegExp(`<form[\\s\\S]*?${text}[\\s\\S]*?</form>`))?.[0] ?? "";
}

function humanReviewSummary(html: string) {
  return html.match(/<div[^>]*data-testid="human-review-summary"[\s\S]*?<\/div>/)?.[0] ?? "";
}

describe("P1-C1 document requirement proposal UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. renders the panel title", () => {
    expect(renderPanel()).toContain("Requisiti istruttori proposti");
  });

  it("2. identifies each record as a proposed instructional requirement", () => {
    expect(renderPanel()).toContain("Requisito istruttorio proposto");
  });

  it("3. renders the persisted requirement label snapshot", () => {
    expect(renderPanel()).toContain("Autorizzazione per operazioni portuali ex art. 16");
  });

  it("4. renders the persisted requirement description snapshot", () => {
    expect(renderPanel()).toContain("Verificare l&#x27;applicabilità del requisito autorizzatorio.");
  });

  it("5. renders the persisted normative source snapshot", () => {
    expect(renderPanel()).toContain("Legge 28 gennaio 1994, n. 84");
  });

  it("6. renders the persisted relevant provisions", () => {
    expect(renderPanel()).toContain("art. 16, art. 18");
  });

  it("7. renders canonical facts from the persisted matched criteria", () => {
    const html = renderPanel();
    expect(html).toContain("ART_18_L_84_1994");
    expect(html).toContain("OPERAZIONI_PORTUALI");
  });

  it("8. renders creation provenance", () => {
    const html = renderPanel();
    expect(html).toContain("creator@example.test");
    expect(html).toContain("ADMIN");
  });

  it("9. renders the human applicability review boundary", () => {
    expect(renderPanel()).toContain("richiede una verifica umana dell&#x27;applicabilità e della sussistenza");
  });

  it("10. states that the proposal does not establish title existence or absence", () => {
    expect(renderPanel()).toContain("Non accerta l&#x27;esistenza o l&#x27;assenza del titolo");
  });

  it("11. states that the proposal does not establish title validity, effectiveness, or sufficiency", () => {
    expect(renderPanel()).toContain("né la sua validità, efficacia o sufficienza");
  });

  it("12. states that the proposal does not determine documentation completeness", () => {
    expect(renderPanel()).toContain("non determina la completezza documentale");
  });

  it("13. states that the proposal does not determine admissibility", () => {
    expect(renderPanel()).toContain("l&#x27;ammissibilità dell&#x27;istanza");
  });

  it("14. states that the proposal does not determine grantability", () => {
    expect(renderPanel()).toContain("la concedibilità");
  });

  it("15. exposes the validate control for an authorized pending proposal with canonical tenant", () => {
    expect(renderPanel()).toContain("VALIDA APPLICABILITÀ");
  });

  it("16. exposes the reject control for an authorized pending proposal with canonical tenant", () => {
    expect(renderPanel()).toContain("RIFIUTA PROPOSTA");
  });

  it("17. hides review controls from unauthorized presentation", () => {
    const html = renderPanel({ canReview: false });
    expect(html).not.toContain("VALIDA APPLICABILITÀ");
    expect(html).not.toContain("RIFIUTA PROPOSTA");
  });

  it("18. hides review controls without a canonical tenant", () => {
    const html = renderPanel({ hasCanonicalTenant: false });
    expect(html).not.toContain("VALIDA APPLICABILITÀ");
    expect(html).not.toContain("RIFIUTA PROPOSTA");
  });

  it("19. renders VALIDATO as terminal without controls", () => {
    const html = renderPanel({ proposals: [proposal("VALIDATO")] });
    expect(html).not.toContain("VALIDA APPLICABILITÀ");
    expect(html).not.toContain("RIFIUTA PROPOSTA");
  });

  it("20. renders RIFIUTATO as terminal without controls", () => {
    const html = renderPanel({ proposals: [proposal("RIFIUTATO")] });
    expect(html).not.toContain("VALIDA APPLICABILITÀ");
    expect(html).not.toContain("RIFIUTA PROPOSTA");
  });

  it("21. describes VALIDATO only as human-confirmed applicability", () => {
    expect(renderPanel({ proposals: [proposal("VALIDATO")] })).toContain("Applicabilità confermata da revisione umana");
  });

  it("22. describes RIFIUTATO only as a proposal found not applicable", () => {
    expect(renderPanel({ proposals: [proposal("RIFIUTATO")] })).toContain("Proposta ritenuta non applicabile");
  });

  it("23. requires the non-applicability reason in the reject form", () => {
    const form = formContaining(renderPanel(), "RIFIUTA PROPOSTA");
    expect(form).toContain("Motivazione della non applicabilità");
    expect(form).toContain("required=\"\"");
  });

  it("24. keeps the validation note optional", () => {
    const form = formContaining(renderPanel(), "VALIDA APPLICABILITÀ");
    expect(form).toContain("Nota di revisione (facoltativa)");
    expect(form).not.toContain("required=\"\"");
  });

  it("25. submits only proposalId, targetStatus, and reviewNote fields", () => {
    const forms = renderPanel().match(/<form[\s\S]*?<\/form>/g) ?? [];
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(Array.from(form.matchAll(/name="([^"]+)"/g), (match) => match[1])).toEqual([
        "proposalId",
        "targetStatus",
        "reviewNote",
      ]);
    }
  });

  it("26. never labels a proposal as a missing document", () => {
    expect(renderPanel().toLowerCase()).not.toContain("documento mancante");
  });

  it("27. never claims that a title is absent", () => {
    expect(renderPanel().toLowerCase()).not.toContain("titolo assente");
  });

  it("28. never claims that an authorization is invalid", () => {
    expect(renderPanel().toLowerCase()).not.toContain("autorizzazione non valida");
  });

  it("29. never states that the application was rejected", () => {
    const html = renderPanel().toLowerCase();
    expect(html).not.toContain("istanza respinta");
    expect(html).not.toContain("istanza rifiutata");
  });

  it("30. renders review provenance for a terminal proposal", () => {
    const html = renderPanel({ proposals: [proposal("VALIDATO")] });
    expect(html).toContain("reviewer@example.test");
    expect(html).toContain("GIURIDICO");
  });

  it("31. renders the persisted review note when present", () => {
    expect(renderPanel({ proposals: [proposal("RIFIUTATO")] })).toContain("Non applicabile al caso concreto");
  });

  it("32. renders a technical actor snapshot without a persisted User dependency", () => {
    const terminal = proposal("VALIDATO", { reviewedByEmail: null, reviewedByActorId: "staging-preview-admin" });
    expect(renderPanel({ proposals: [terminal] })).toContain("staging-preview-admin");
  });

  it("33. renders a neutral empty state without claiming dossier completeness", () => {
    const html = renderPanel({ proposals: [] });
    expect(html).toContain("Nessun requisito istruttorio proposto.");
    expect(html.toLowerCase()).not.toContain("fascicolo completo");
  });

  it("34. does not invoke the matcher during render", () => {
    renderPanel();
    expect(matcherMock).not.toHaveBeenCalled();
  });

  it("35. does not invoke the generic resolver during render", () => {
    renderPanel();
    expect(genericResolverMock).not.toHaveBeenCalled();
  });

  it("36. does not automatically create or review during render", () => {
    renderPanel();
    expect(createProposalMock).not.toHaveBeenCalled();
    expect(reviewProposalMock).not.toHaveBeenCalled();
  });

  it("37. calls the P1-C1 query exactly once on the page", () => {
    expect(pageSource().match(/await getFascicoloDocumentRequirementProposals\(/g)).toHaveLength(1);
  });

  it("38. derives panel review permission from canManageProcedimenti", () => {
    const source = pageSource();
    expect(source).toContain("const canReview = canManageProcedimenti(role);");
    expect(source).toContain("canReview={canReview}");
  });

  it("39. requires the page canonical tenant availability for controls", () => {
    const source = pageSource();
    expect(source).toContain("const hasCanonicalTenant = Boolean(detail.canonicalEnteId);");
    expect(source).toContain("hasCanonicalTenant={hasCanonicalTenant}");
  });

  it("40. places the proposal panel between observations and checklist", () => {
    const source = pageSource();
    const observationsIndex = source.indexOf("<FascicoloObservationsPanel");
    const proposalsIndex = source.indexOf("<FascicoloDocumentRequirementProposalsPanel");
    const checklistIndex = source.indexOf("<CardTitle>2. Checklist contraddittorio</CardTitle>");
    expect(observationsIndex).toBeGreaterThan(-1);
    expect(proposalsIndex).toBeGreaterThan(observationsIndex);
    expect(checklistIndex).toBeGreaterThan(proposalsIndex);
  });

  it("41. imports the evidence query on the procedimento page", () => {
    expect(pageSource()).toContain("getFascicoloDocumentRequirementEvidenceData");
  });

  it("42. calls the evidence query exactly once per page render", () => {
    expect(pageSource().match(/await getFascicoloDocumentRequirementEvidenceData\(/g)).toHaveLength(1);
  });

  it("43. passes the evidence dataset to the proposal panel", () => {
    expect(pageSource()).toContain("evidenceData={fascicoloDocumentRequirementEvidence}");
  });

  it("44. renders the evidence section for a VALIDATO proposal", () => {
    expect(renderPanel({ proposals: [proposal("VALIDATO")] })).toContain("Evidenze documentali associate");
  });

  it("45. does not render the evidence section for a PROPOSTO proposal", () => {
    expect(renderPanel({ proposals: [proposal("PROPOSTO")] })).not.toContain("Evidenze documentali associate");
  });

  it("46. does not render the evidence section for a RIFIUTATO proposal", () => {
    expect(renderPanel({ proposals: [proposal("RIFIUTATO")] })).not.toContain("Evidenze documentali associate");
  });

  it("47. renders persisted active evidence facts", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [activeAssociation] } }),
    });
    expect(html).toContain("Titolo autorizzatorio.pdf");
    expect(html).toContain("creator@example.test");
    expect(html).toContain("ADMIN");
  });

  it("48. renders revoked evidence in a separate history", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [revokedAssociation] } }),
    });
    expect(html).toContain("Storico associazioni revocate");
    expect(html).toContain("Documento revocato.pdf");
    expect(html).toContain("Collegamento errato");
    expect(html).not.toContain("Revoca associazione");
  });

  it("49. offers only backend-returned eligible documents", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({
        eligibleDocumentsByProposalId: {
          "proposal-1": [{
            id: "documento-3",
            nome: "Documento candidato.pdf",
            tipologia: "ATTO",
            dataDocumento: null,
            createdAt: new Date("2026-08-02T08:00:00.000Z"),
          }],
        },
      }),
    });
    expect(html).toContain("name=\"documentoId\"");
    expect(html).toContain("Documento candidato.pdf");
    expect(html).toContain("Associa documento");
  });

  it("50. calls create with proposalId and documentoId only", () => {
    const source = evidenceSectionSource();
    expect(source).toContain("createFascicoloDocumentRequirementEvidence({ proposalId, documentoId })");
    expect(source).not.toMatch(/createFascicoloDocumentRequirementEvidence\(\{[^}]+(?:enteId|procedimentoId|tenant|status|ruleCode|gapKey)/s);
  });

  it("51. requires a bounded revocation note", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [activeAssociation] } }),
    });
    const form = formContaining(html, "Revoca associazione");
    expect(form).toContain("name=\"revocationNote\"");
    expect(form).toContain("required=\"\"");
    expect(form).toContain("maxLength=\"2000\"");
  });

  it("52. calls revoke with evidenceId and revocationNote only", () => {
    const source = evidenceSectionSource();
    expect(source).toContain("revokeFascicoloDocumentRequirementEvidence({ evidenceId, revocationNote })");
    expect(source).not.toMatch(/revokeFascicoloDocumentRequirementEvidence\(\{[^}]+(?:enteId|procedimentoId|tenant|status|ruleCode|gapKey)/s);
  });

  it("53. keeps unauthorized evidence display read-only", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      canReview: false,
      evidence: evidenceData({
        associationsByProposalId: { "proposal-1": [activeAssociation, revokedAssociation] },
        eligibleDocumentsByProposalId: {
          "proposal-1": [{
            id: "documento-3",
            nome: "Documento candidato.pdf",
            tipologia: "ATTO",
            dataDocumento: null,
            createdAt: new Date("2026-08-02T08:00:00.000Z"),
          }],
        },
      }),
    });
    expect(html).toContain("Titolo autorizzatorio.pdf");
    expect(html).toContain("Storico associazioni revocate");
    expect(html).not.toContain("Associa documento");
    expect(html).not.toContain("Revoca associazione");
    expect(html).not.toContain("name=\"revocationNote\"");
  });

  it("54. reuses the existing document download route", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [activeAssociation] } }),
    });
    expect(html).toContain("/documenti/documento-1/download");
  });

  it("55. reuses the proposal-bound upload action instead of the general upload action", () => {
    const source = evidenceSectionSource();
    expect(source).not.toContain("createDocumentoUploadAction");
    expect(uploadFormSource()).toContain("uploadFascicoloDocumentRequirementEvidence");
  });

  it("56. uses the compact human-boundary copy without forbidden conclusions", () => {
    const html = renderPanel({ proposals: [proposal("VALIDATO")] }).toLowerCase();
    expect(html).toContain("collegamento istruttorio");
    for (const claim of [
      "requisito soddisfatto",
      "documentazione completa",
      "documento valido",
      "documento sufficiente",
      "titolo verificato",
      "autorizzazione valida",
      "esito positivo",
    ]) {
      expect(html).not.toContain(claim);
    }
  });

  it("57. keeps the UI free of backend, schema, storage, and legal-rule authority", () => {
    const source = `${evidenceSectionSource()}\n${uploadFormSource()}`;
    for (const forbidden of ["@/lib/prisma", "enteId", "procedimentoId", "storageKey", "ruleCode", "gapKey"] ) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("58. exposes upload only for an authorized VALIDATO proposal", () => {
    const html = renderPanel({ proposals: [proposal("VALIDATO")], canReview: true });
    expect(html).toContain("Carica e associa documento");
    expect(html).toContain("type=\"file\"");
  });

  it("59. exposes no upload control for PROPOSTO or RIFIUTATO proposals", () => {
    expect(renderPanel({ proposals: [proposal("PROPOSTO")] })).not.toContain("Carica e associa documento");
    expect(renderPanel({ proposals: [proposal("RIFIUTATO")] })).not.toContain("Carica e associa documento");
  });

  it("60. keeps upload unavailable in read-only presentation", () => {
    const html = renderPanel({ proposals: [proposal("VALIDATO")], canReview: false });
    expect(html).not.toContain("Carica e associa documento");
    expect(html).not.toContain("type=\"file\"");
  });

  it("61. renders only the permitted upload form fields", () => {
    const html = renderPanel({ proposals: [proposal("VALIDATO")] });
    const form = formContaining(html, "Carica e associa documento");
    expect(Array.from(form.matchAll(/name="([^"]+)"/g), (match) => match[1])).toEqual([
      "file",
      "tipologia",
      "nome",
      "descrizione",
      "dataDocumento",
    ]);
    expect(form).toContain("type=\"file\"");
    expect(form).toContain("required=\"\"");
  });

  it("62. submits proposalId, operationId, file, and permitted metadata only", () => {
    const input = uploadActionInputSource();
    for (const field of ["proposalId", "operationId", "file", "tipologia", "nome", "descrizione", "dataDocumento"]) {
      expect(input).toContain(field);
    }
    for (const forbidden of ["enteId", "tenant", "procedimentoId", "concessioneId", "status", "source", "rule", "gap", "eligibility", "outcome"]) {
      expect(input).not.toContain(forbidden);
    }
  });

  it("63. generates an opaque operation ID with the browser cryptographic UUID primitive", () => {
    const source = uploadFormSource();
    expect(source).toContain("crypto.randomUUID()");
    expect(source).not.toMatch(/randomUUID\([^)]*(?:proposalId|file|tipologia)/);
  });

  it("64. keeps one operation ID stable for the active submission attempt", () => {
    const source = uploadFormSource();
    expect(source).toContain("const operationIdRef = useRef<string | null>(null)");
    expect(source).toContain("const operationId = operationIdRef.current ?? crypto.randomUUID();");
    expect(source).toContain("operationIdRef.current = operationId;");
    expect(source).toContain("onChange={startNewFileAttempt}");
    expect(source).toMatch(/function startNewFileAttempt\(\)[\s\S]*if \(!submittingRef\.current\)[\s\S]*operationIdRef\.current = null;/);
  });

  it("65. prevents duplicate submission and disables controls while pending", () => {
    const source = uploadFormSource();
    expect(source).toContain("if (submittingRef.current)");
    expect(source).toContain("submittingRef.current = true;");
    expect(source).toContain("disabled={isSubmitting}");
    expect(source).toContain("Caricamento...");
  });

  it("66. resets form and operation state after success", () => {
    const source = uploadFormSource();
    expect(source).toContain("form.reset();");
    expect(source).toContain("operationIdRef.current = null;");
  });

  it("67. refreshes authoritative evidence data after success", () => {
    expect(uploadFormSource()).toContain("router.refresh();");
  });

  it("68. uses legally neutral accessible success microcopy", () => {
    const source = uploadFormSource();
    expect(source).toContain("Documento caricato e associato.");
    expect(source).toContain("role=\"status\"");
    for (const claim of ["requisito soddisfatto", "titolo verificato", "autorizzazione valida", "conformità accertata"]) {
      expect(source.toLowerCase()).not.toContain(claim);
    }
  });

  it("69. sanitizes upload failure without exposing storage details", () => {
    const source = uploadFormSource();
    expect(source).toContain("Caricamento non completato. Verificare i dati e riprovare.");
    expect(source).toContain("role=\"alert\"");
    for (const forbidden of ["storageKey", "bucket", "endpoint", "S3", "R2", "DATABASE_URL", "error.message"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("70. preserves separate upload-new and associate-existing choices", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({
        eligibleDocumentsByProposalId: {
          "proposal-1": [{
            id: "documento-3",
            nome: "Documento candidato.pdf",
            tipologia: "ATTO",
            dataDocumento: null,
            createdAt: new Date("2026-08-02T08:00:00.000Z"),
          }],
        },
      }),
    });
    expect(html).toContain("Carica e associa documento");
    expect(html).toContain("Associa un documento esistente");
    expect(html).toContain("Associa documento");
  });

  it("71. preserves revocation, download, and revoked-history UI", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [activeAssociation, revokedAssociation] } }),
    });
    expect(html).toContain("Revoca associazione");
    expect(html).toContain("/documenti/documento-1/download");
    expect(html).toContain("Storico associazioni revocate");
    expect(html).toContain("Documento revocato.pdf");
  });

  it("72. introduces no automatic legal conclusion in the upload affordance", () => {
    const html = renderPanel({ proposals: [proposal("VALIDATO")] }).toLowerCase();
    for (const claim of [
      "requisito soddisfatto",
      "titolo verificato",
      "autorizzazione valida",
      "autorizzazione mancante",
      "conformità accertata",
      "esito del procedimento",
    ]) {
      expect(html).not.toContain(claim);
    }
  });

  it("73. shows the review control for active unreviewed evidence to an authorized user", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [activeAssociation] } }),
    });
    expect(html).toContain("Esame umano");
    expect(html).toContain("Registra esame");
  });

  it("74. shows the immutable receipt without another form for reviewed active evidence", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [reviewedAssociation] } }),
    });
    expect(html).toContain("Esame registrato");
    expect(html).toContain("reviewer@example.test");
    expect(html).toContain("GIURIDICO");
    expect(html).toContain("Data esame");
    expect(html).toContain("Esaminata la documentazione disponibile.");
    expect(html).not.toContain("Registra esame");
  });

  it("75. keeps a reviewed receipt as historical provenance after revocation", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [revokedReviewedAssociation] } }),
    });
    expect(html).toContain("Storico associazioni revocate");
    expect(html).toContain("Ricevuta storica dell&#x27;esame umano svolto prima della revoca dell&#x27;evidenza.");
    expect(html).toContain("Esame registrato");
    expect(html).not.toContain("Registra esame");
  });

  it("76. offers no review mutation for revoked unreviewed evidence", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [revokedAssociation] } }),
    });
    expect(html).toContain("Documento revocato.pdf");
    expect(html).not.toContain("Registra esame");
    expect(html).not.toContain("name=\"reviewNote\"");
  });

  it("77. offers no review mutation to an unauthorized user", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      canReview: false,
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [activeAssociation] } }),
    });
    expect(html).toContain("Titolo autorizzatorio.pdf");
    expect(html).not.toContain("Registra esame");
    expect(html).not.toContain("name=\"reviewNote\"");
  });

  it("78. supports an optional review note bounded to 2000 characters", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [activeAssociation] } }),
    });
    const form = formContaining(html, "Registra esame");
    expect(form).toContain("Nota sull&#x27;esame (facoltativa)");
    expect(form).toContain("name=\"reviewNote\"");
    expect(form).toContain("maxLength=\"2000\"");
    expect(form).not.toContain("required=\"\"");
  });

  it("79. submits only evidenceId and the optional review note", () => {
    const input = reviewActionInputSource();
    expect(input).toContain("evidenceId");
    expect(input).toContain("reviewNote");
    for (const forbidden of ["enteId", "tenant", "procedimentoId", "concessioneId", "proposalId", "documentoId"]) {
      expect(input).not.toContain(forbidden);
    }
  });

  it("80. guards duplicate review submission and disables the pending control", () => {
    const source = evidenceSectionSource();
    expect(source).toContain("if (reviewSubmittingRef.current)");
    expect(source).toContain("reviewSubmittingRef.current = true;");
    expect(source).toContain("reviewSubmittingRef.current = false;");
    expect(source).toContain("disabled={pendingAction === `review:${association.id}`}");
    expect(source).toContain("Registrazione...");
  });

  it("81. refreshes canonical receipt data with neutral success and error messages", () => {
    const source = evidenceSectionSource();
    expect(source).toContain("router.refresh();");
    expect(source).toContain("Dati dell\\u0027esame aggiornati.");
    expect(source).toContain("Esame non registrato. Verificare i dati e riprovare.");
    expect(source).toContain("role=\"status\"");
    expect(source).toContain("role=\"alert\"");
  });

  it("82. preserves upload, association, revocation, download, and history alongside review UI", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [activeAssociation, revokedAssociation] } }),
    });
    for (const preserved of [
      "Carica e associa documento",
      "Associa un documento esistente",
      "Revoca associazione",
      "/documenti/documento-1/download",
      "Storico associazioni revocate",
    ]) {
      expect(html).toContain(preserved);
    }
  });

  it("83. gives the evidence receipt no approval, validity, sufficiency, or outcome meaning", () => {
    const source = evidenceSectionSource().toLowerCase();
    for (const forbidden of [
      "approva",
      "accetta",
      "rifiuta",
      "conferma validità",
      "documento valido",
      "documento sufficiente",
      "esito positivo",
      "esito del procedimento",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("84. reports the neutral empty state when there is no active evidence", () => {
    const html = renderPanel({ proposals: [proposal("VALIDATO")] });
    expect(humanReviewSummary(html)).toContain("Nessuna evidenza attiva associata.");
  });

  it("85. reports zero receipts for two unreviewed active evidence records", () => {
    const secondActiveAssociation: Association = {
      ...activeAssociation,
      id: "evidence-active-2",
      documentoId: "documento-active-2",
      documento: { ...activeAssociation.documento, id: "documento-active-2", nome: "Secondo documento.pdf" },
    };
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [activeAssociation, secondActiveAssociation] } }),
    });
    expect(humanReviewSummary(html)).toContain("Ricevuta presente per 0 di 2 evidenze attive.");
  });

  it("86. reports one receipt for two active evidence records", () => {
    const secondActiveAssociation: Association = {
      ...activeAssociation,
      id: "evidence-active-2",
      documentoId: "documento-active-2",
      documento: { ...activeAssociation.documento, id: "documento-active-2", nome: "Secondo documento.pdf" },
    };
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [reviewedAssociation, secondActiveAssociation] } }),
    });
    expect(humanReviewSummary(html)).toContain("Ricevuta presente per 1 di 2 evidenze attive.");
  });

  it("87. reports two receipts for two active evidence records without completion wording", () => {
    const secondReviewedAssociation: Association = {
      ...reviewedAssociation,
      id: "evidence-reviewed-2",
      documentoId: "documento-reviewed-2",
      documento: { ...activeAssociation.documento, id: "documento-reviewed-2", nome: "Secondo documento.pdf" },
      review: { ...evidenceReview, id: "review-2" },
    };
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [reviewedAssociation, secondReviewedAssociation] } }),
    });
    expect(humanReviewSummary(html)).toContain("Ricevuta presente per 2 di 2 evidenze attive.");
  });

  it("88. excludes revoked unreviewed evidence from the numerator and denominator", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [activeAssociation, revokedAssociation] } }),
    });
    expect(humanReviewSummary(html)).toContain("Ricevuta presente per 0 di 1 evidenze attive.");
  });

  it("89. excludes reviewed revoked evidence from the numerator and denominator", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [activeAssociation, revokedReviewedAssociation] } }),
    });
    expect(humanReviewSummary(html)).toContain("Ricevuta presente per 0 di 1 evidenze attive.");
    expect(html).toContain("Ricevuta storica dell&#x27;esame umano svolto prima della revoca dell&#x27;evidenza.");
  });

  it("90. keeps the summary free of completion and legal-outcome wording", () => {
    const summary = humanReviewSummary(renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [reviewedAssociation] } }),
    })).toLowerCase();
    for (const forbidden of [
      "tutte esaminate",
      "esame completato",
      "completo",
      "completato",
      "soddisfatto",
      "pronto",
      "conforme",
      "valido",
      "sufficiente",
      "approvato",
      "checklist",
      "esito",
    ]) {
      expect(summary).not.toContain(forbidden);
    }
  });

  it("91. preserves detailed review and existing evidence controls alongside the summary", () => {
    const html = renderPanel({
      proposals: [proposal("VALIDATO")],
      evidence: evidenceData({ associationsByProposalId: { "proposal-1": [reviewedAssociation, activeAssociation, revokedReviewedAssociation] } }),
    });
    for (const preserved of [
      "Esame registrato",
      "Registra esame",
      "Carica e associa documento",
      "Associa un documento esistente",
      "Revoca associazione",
      "/documenti/documento-1/download",
      "Storico associazioni revocate",
      "Ricevuta storica",
    ]) {
      expect(html).toContain(preserved);
    }
  });
});