import { describe, expect, it } from "vitest";

import { mergeFascicoloAnalysisQuestions } from "@/components/procedimenti/fascicolo-analysis-questions";

describe("fascicolo analysis question merge", () => {
  it("merges Knowledge and workflow projections only when their stable semantic key matches", () => {
    const questions = mergeFascicoloAnalysisQuestions([{
      id: "knowledge-question",
      semanticKey: "question-decadenza",
      title: "Quali presupposti regolano la decadenza?",
      description: "Quesito estratto dalla Knowledge.",
      knowledgeStatus: "Ricerca da pianificare",
      evidence: ["Documento A"],
    }, {
      id: "workflow-question",
      semanticKey: "question-decadenza",
      title: "Quali presupposti regolano la decadenza?",
      operationalStatuses: ["Completata"],
      evidence: ["Fonte B"],
    }]);

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      id: "knowledge-question",
      description: "Quesito estratto dalla Knowledge.",
      knowledgeStatus: "Ricerca da pianificare",
      operationalStatuses: ["Completata"],
      evidence: ["Documento A", "Fonte B"],
    });
  });

  it("preserves every operational state instead of presenting an incomplete mission as completed", () => {
    const questions = mergeFascicoloAnalysisQuestions([{
      id: "knowledge-question",
      semanticKey: "question-decadenza",
      title: "Quali presupposti regolano la decadenza?",
      knowledgeStatus: "Ricerca da pianificare",
    }, {
      id: "workflow-completed",
      semanticKey: "question-decadenza",
      title: "Quali presupposti regolano la decadenza?",
      operationalStatuses: ["Completata"],
    }, {
      id: "workflow-deferred",
      semanticKey: "question-decadenza",
      title: "Quali presupposti regolano la decadenza?",
      operationalStatuses: ["Differita"],
    }]);

    expect(questions[0]).toMatchObject({
      knowledgeStatus: "Ricerca da pianificare",
      operationalStatuses: ["Completata", "Differita"],
    });
  });

  it("preserves similarly worded but semantically distinct legal questions", () => {
    const questions = mergeFascicoloAnalysisQuestions([{
      id: "question-decadenza",
      semanticKey: "semantic-decadenza",
      title: "Quali presupposti si applicano al provvedimento?",
    }, {
      id: "question-ripristino",
      semanticKey: "semantic-ripristino",
      title: "Quali presupposti si applicano al provvedimento?",
    }, {
      id: "question-archiviazione",
      title: "Quali presupposti si applicano al provvedimento?",
    }]);

    expect(questions).toHaveLength(3);
    expect(questions.map((question) => question.id)).toEqual([
      "question-decadenza",
      "question-ripristino",
      "question-archiviazione",
    ]);
  });
});
