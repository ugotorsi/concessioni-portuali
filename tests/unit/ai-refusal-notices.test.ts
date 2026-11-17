import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LegalWorkbenchSection } from "@/app/admin/runtime/LegalWorkbenchSection";
import { ProfessionalLegalQuestionsPanel } from "@/components/procedimenti/ProfessionalLegalQuestionsPanel";

const noopAction = async () => {};

function renderWorkbench(notice: string | null): string {
  return renderToStaticMarkup(createElement(LegalWorkbenchSection, {
    procedimenti: [{ id: "proc-1", label: "Fascicolo di prova" }],
    selectedProcedimentoId: null,
    snapshot: null,
    notice,
    assignedActorId: "user-1",
    confirmReferenceDateAction: noopAction,
    recoverMissionsAction: noopAction,
    startLegalAnalysisAction: noopAction,
    configureLegalDataHunterAction: noopAction,
    synchronizeProviderCredentialKeyAction: noopAction,
  }));
}

function renderQuestionsPanel(refusalNotice: string | null): string {
  return renderToStaticMarkup(createElement(ProfessionalLegalQuestionsPanel, {
    procedimentoId: "proc-1",
    questions: [],
    canManage: true,
    defaultReferenceDate: "2026-11-12",
    documentCount: 1,
    reportCount: 0,
    refusalNotice,
  }));
}

describe("AI refusal notices stay in-page", () => {
  it("renders a mapped explanation for a known workbench refusal code", () => {
    const markup = renderWorkbench("ANALYSIS_ACTIVATION_DISABLED");
    expect(markup).toContain("Operazione non avviata");
    expect(markup).toContain("configurazione OpenAI incompleta");
  });

  it("renders a safe generic explanation for unknown workbench codes", () => {
    const markup = renderWorkbench("SOME_FUTURE_CODE");
    expect(markup).toContain("Operazione non avviata");
    expect(markup).toContain("SOME_FUTURE_CODE");
  });

  it("renders nothing without a workbench notice", () => {
    expect(renderWorkbench(null)).not.toContain("Operazione non avviata");
  });

  it("renders a mapped explanation for a research refusal", () => {
    const markup = renderQuestionsPanel("AUTOMATIC_RESEARCH_POLICY_DISABLED");
    expect(markup).toContain("Ricerca non avviata");
    expect(markup).toContain("ricerca autonoma non è abilitata");
    expect(markup).toContain("registrato nel registro di audit");
  });

  it("renders nothing without a research refusal notice", () => {
    expect(renderQuestionsPanel(null)).not.toContain("Ricerca non avviata");
  });
});
