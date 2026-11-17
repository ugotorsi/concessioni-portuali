import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { FascicoloActsWorkspace } from "@/components/procedimenti/FascicoloActsWorkspace";
import { bodySha256, projectActDrafts, type ActDraftVersion } from "@/server/fascicolo-acts/model";
import type { ActTemplateCatalog } from "@/server/fascicolo-acts/templates";
import { stableActivityKey, type ActivitySpec } from "@/server/fascicolo-operational-activities/model";

const procedimentoId = "procedure-a";
const activityKey = stableActivityKey(procedimentoId, "issue-a", "CHECK");
const spec: ActivitySpec = {
  activityKey, issueSemanticKey: "issue-a", issueText: "Problematica documentale",
  activityCode: "CHECK", title: "Verifica degli atti", action: "Esaminare gli atti.",
  office: "Ufficio competente", requiredDocuments: [], completionGate: "Riscontro verificato",
  necessity: "REQUIRED", legalSummary: "Conclusione preliminare.", legalSourceStatus: "LEGAL_RESEARCH_REQUIRED",
  alternatives: [], documents: [{ templateKey: "PLAN:CURRENT", title: "Atto", legacyTemplateKeys: ["PLAN:Atto"] }],
  fingerprint: "a".repeat(64),
};
const catalog: ActTemplateCatalog = {
  phase: "INITIAL", authoritativePhase: "INITIAL", reviewPending: false,
  documentaryAhead: false, documentarySignals: [],
  recommended: [{
    templateKey: "PLAN:CURRENT", title: "Atto", legalBasis: "Da verificare", phases: ["INITIAL"],
    body: "Testo del modello", source: "REPORT_PLAN", issueSemanticKey: "issue-a",
    issueText: spec.issueText, activityTitle: spec.title, legacyTemplateKeys: ["PLAN:Atto"],
  }],
  others: [{
    templateKey: "CATALOG:OTHER", title: "Modello separato", legalBasis: "Da verificare", phases: ["INITIAL"],
    body: "Testo del modello separato", source: "CATALOG", issueSemanticKey: null,
  }],
};

function draft(templateKey: string): ActDraftVersion {
  return {
    schema: "FASCICOLO_ACT_DRAFT_V1", procedimentoId, draftKey: "act_0123456789abcdef01234567",
    version: 1, templateKey, issueSemanticKey: "issue-a", title: "Atto", body: "Bozza di prova",
    bodySha256: bodySha256("Bozza di prova"), status: "BOZZA", assignee: null, dueDate: null, progress: 0,
    dependencies: [], attachments: [], changeNote: null, savedAt: new Date("2026-11-03T10:00:00Z"),
    savedBy: "operator@example.test", auditHash: "a".repeat(64),
  };
}

function render(templateKey: string): string {
  return renderToStaticMarkup(createElement(FascicoloActsWorkspace, {
    procedimentoId, catalog, drafts: projectActDrafts([draft(templateKey)]), canManage: true,
    attachmentOptions: [], activitySpecs: [spec], activities: [],
  }));
}

describe("act archive", () => {
  it("keeps editing and export in the archive and returns to the uniquely identified activity", () => {
    const html = render("PLAN:CURRENT");
    expect(html).toContain("Modifica e versiona");
    expect(html).toContain("Cronologia delle versioni");
    expect(html).toContain("format=pdf");
    expect(html).toContain("format=rtf");
    expect(html).toContain(`activity=${activityKey}`);
    expect(html).toContain("Torna all&#x27;attività");
    expect(html).not.toContain("Modelli suggeriti per la fase");
    expect(html).not.toContain("Modello separato");
    expect(html).not.toContain("Apri o crea bozza");
  });

  it("does not infer an activity link for an unassociated legacy draft", () => {
    const html = render("PLAN:Atto");
    expect(html).toContain("Cronologia delle versioni");
    expect(html).not.toContain("Torna all&#x27;attività");
    expect(html).not.toContain(`activity=${activityKey}`);
  });
});
