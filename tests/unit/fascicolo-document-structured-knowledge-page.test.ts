import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");
const triggerSource = readFileSync(
  "src/components/procedimenti/FascicoloDocumentStructuredKnowledgeTrigger.tsx",
  "utf8",
);

describe("fascicolo document structured knowledge page integration", () => {
  it("keeps the existing empty-state analysis while adding current knowledge consultation", () => {
    expect(pageSource).toContain("<FascicoloAnalysis");
    expect(pageSource).toContain("<FascicoloAutomaticWorkflowPanel model={automaticWorkflow} />");
    expect(pageSource).toContain("<FascicoloDocumentStructuredKnowledgeTrigger");
    expect(pageSource).toContain("automaticWorkflow?.knowledge");
    expect(pageSource).toContain("Revisione corrente della conoscenza strutturata disponibile.");
  });

  it("does not render an unusable trigger when authorization, corpus, or E2E policy is missing", () => {
    expect(triggerSource).toContain("!canRun");
    expect(triggerSource).toContain("corpus.availableDocumentCount === 0");
    expect(triggerSource).toContain("isFascicoloDocumentStructuredKnowledgeAvailable");
    expect(triggerSource).toContain("return null");
  });

  it("marks a partial corpus and posts only the procedimento identifier", () => {
    expect(triggerSource).toContain('corpus.availability === "PARTIAL"');
    expect(triggerSource).toContain("Il risultato resterà esplicitamente parziale.");
    expect(triggerSource).toContain('name="procedimentoId"');
    expect(triggerSource).not.toContain('name="tenantId"');
  });
});
