import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createProposalMock = vi.hoisted(() => vi.fn());
const reviewProposalMock = vi.hoisted(() => vi.fn());
const matcherMock = vi.hoisted(() => vi.fn());
const genericResolverMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/server/actions/fascicolo-document-requirements", () => ({
  createFascicoloDocumentRequirementProposal: createProposalMock,
  reviewFascicoloDocumentRequirementProposalAction: reviewProposalMock,
}));
vi.mock("@/server/fascicolo-document-requirements/matcher", () => ({
  evaluateP1C1DocumentRequirement: matcherMock,
}));
vi.mock("@/server/legal-rules/orchestrator", () => ({
  resolveApplicableLegalRules: genericResolverMock,
}));

import { FascicoloDocumentRequirementScreeningTrigger } from "@/components/procedimenti/FascicoloDocumentRequirementScreeningTrigger";

function componentSource() {
  return readFileSync(
    resolve(process.cwd(), "src/components/procedimenti/FascicoloDocumentRequirementScreeningTrigger.tsx"),
    "utf8",
  );
}

function pageSource() {
  return readFileSync(resolve(process.cwd(), "src/app/procedimenti/[id]/page.tsx"), "utf8");
}

function reviewPanelSource() {
  return readFileSync(
    resolve(process.cwd(), "src/components/procedimenti/FascicoloDocumentRequirementProposalsPanel.tsx"),
    "utf8",
  );
}

function renderTrigger({
  canRun = true,
  hasCanonicalTenant = true,
  screeningDone = false,
}: {
  canRun?: boolean;
  hasCanonicalTenant?: boolean;
  screeningDone?: boolean;
} = {}) {
  return renderToStaticMarkup(createElement(FascicoloDocumentRequirementScreeningTrigger, {
    procedimentoId: "procedimento-1",
    canRun,
    hasCanonicalTenant,
    screeningDone,
  }));
}

describe("P1-NEXT-01 explicit requirement screening trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. renders the trigger for an authorized presentation with canonical tenant", () => {
    expect(renderTrigger()).toContain("Esegui screening istruttorio");
  });

  it("2. renders no trigger for an unauthorized presentation", () => {
    expect(renderTrigger({ canRun: false })).toBe("");
  });

  it("3. renders no trigger without a canonical tenant", () => {
    expect(renderTrigger({ hasCanonicalTenant: false })).toBe("");
  });

  it("4. uses the required neutral button label", () => {
    expect(renderTrigger()).toContain("Esegui screening istruttorio");
  });

  it("5. displays the human-review boundary wording", () => {
    expect(renderTrigger()).toContain(
      "Lo screening utilizza i dati canonici registrati per generare eventuali proposte istruttorie da sottoporre a revisione umana.",
    );
  });

  it("6. uses a form bound to an inline server action", () => {
    const source = componentSource();
    expect(renderTrigger()).toContain("<form");
    expect(source).toContain('"use server";');
    expect(source).toContain("<form action={screeningAction}>");
  });

  it("7. binds procedimentoId server-side without an editable form input", () => {
    const source = componentSource();
    expect(source).toContain("runScreening.bind(null, procedimentoId)");
    expect(source).not.toContain('name="procedimentoId"');
    expect(renderTrigger()).not.toContain('name="procedimentoId"');
  });

  it("8. submits no tenant field", () => {
    const html = renderTrigger();
    expect(html).not.toContain('name="tenant"');
    expect(html).not.toContain('name="enteId"');
  });

  it("9. submits no legal, matcher, catalog, fingerprint, status, or actor facts", () => {
    const html = renderTrigger();
    for (const field of [
      "concessioneId",
      "normaRiferimento",
      "portActivityLegalType",
      "legalSource",
      "legalRule",
      "documentGap",
      "screeningFingerprint",
      "matcherResult",
      "proposalStatus",
      "createdBy",
      "reviewedBy",
    ]) {
      expect(html).not.toContain(`name="${field}"`);
    }
  });

  it("10. delegates the wrapper to the frozen create action", () => {
    const source = componentSource();
    expect(source).toContain("await createFascicoloDocumentRequirementProposal({ procedimentoId });");
    expect(source.match(/createFascicoloDocumentRequirementProposal\(/g)).toHaveLength(1);
  });

  it("11. does not invoke proposal creation during render", () => {
    renderTrigger();
    expect(createProposalMock).not.toHaveBeenCalled();
  });

  it("12. does not invoke the matcher from the UI", () => {
    renderTrigger();
    expect(matcherMock).not.toHaveBeenCalled();
    expect(componentSource()).not.toContain("evaluateP1C1DocumentRequirement");
  });

  it("13. does not invoke the generic resolver from the UI", () => {
    renderTrigger();
    expect(genericResolverMock).not.toHaveBeenCalled();
    expect(componentSource()).not.toContain("resolveApplicableLegalRules");
  });

  it("14. does not query the legal catalog from the UI", () => {
    const source = componentSource();
    expect(source).not.toContain("prisma.");
    expect(source).not.toContain("legalSource");
    expect(source).not.toContain("legalRule");
    expect(source).not.toContain("documentGap");
  });

  it("15. does not invoke automatic review", () => {
    renderTrigger();
    expect(reviewProposalMock).not.toHaveBeenCalled();
    expect(componentSource()).not.toContain("reviewFascicoloDocumentRequirementProposalAction");
  });

  it("16. accepts only the exact screening=done marker", () => {
    const source = pageSource();
    expect(source).toContain('const screeningDone = screening === "done";');
    expect(source.match(/screening\s*===/g)).toHaveLength(1);
  });

  it("17. renders only neutral success wording", () => {
    const html = renderTrigger({ screeningDone: true });
    expect(html).toContain("Screening eseguito. Eventuali proposte generate richiedono revisione umana.");
    expect(html).not.toContain("È stata creata una proposta");
  });

  it("18. makes no forbidden legal or procedural conclusion", () => {
    const html = renderTrigger({ screeningDone: true }).toLowerCase();
    for (const claim of [
      "titolo esistente",
      "titolo assente",
      "autorizzazione valida",
      "autorizzazione non valida",
      "documentazione completa",
      "procedimento regolare",
      "istanza ammissibile",
      "concessione concedibile",
    ]) {
      expect(html).not.toContain(claim);
    }
  });

  it("19. leaves the existing proposal query and review panel behavior unchanged", () => {
    const page = pageSource();
    const panel = reviewPanelSource();
    expect(page.match(/await getFascicoloDocumentRequirementProposals\(/g)).toHaveLength(1);
    expect(panel).toContain("reviewFascicoloDocumentRequirementProposalAction");
    expect(panel).toContain("VALIDA APPLICABILITÀ");
    expect(panel).toContain("RIFIUTA PROPOSTA");
  });

  it("20. places observations, trigger, proposals, and checklist in order", () => {
    const source = pageSource();
    const observationsIndex = source.indexOf("<FascicoloObservationsPanel");
    const triggerIndex = source.indexOf("<FascicoloDocumentRequirementScreeningTrigger");
    const proposalsIndex = source.indexOf("<FascicoloDocumentRequirementProposalsPanel");
    const checklistIndex = source.indexOf("<CardTitle>2. Checklist contraddittorio</CardTitle>");
    expect(observationsIndex).toBeGreaterThan(-1);
    expect(triggerIndex).toBeGreaterThan(observationsIndex);
    expect(proposalsIndex).toBeGreaterThan(triggerIndex);
    expect(checklistIndex).toBeGreaterThan(proposalsIndex);
  });

  it("21. encodes no created, no-match, existing, or eligibility outcome in the URL", () => {
    const source = componentSource();
    expect(source).toContain("?screening=done");
    for (const outcome of ["screening=created", "screening=no-match", "screening=existing", "screening=eligible"] ) {
      expect(source).not.toContain(outcome);
    }
  });
});