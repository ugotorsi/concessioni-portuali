import { describe, expect, it } from "vitest";

import { legalAnalysisContributionSchema } from "../../src/server/legal-research/legal-synthesis";

const ref = "verified-source-1";
const fact = "documented-fact-1";
const arg = {
  text: "L'argomento si fonda sulla fonte verificata e sui fatti documentati del fascicolo.",
  sourceCandidateIds: [ref],
  factBasisRefs: [fact],
};
const sample = () => ({
  version: "LEGAL_ANALYSIS_CONTRIBUTION_V1" as const,
  contributionId: "selvara-legal-analysis-1",
  legalIssueSemanticKey: "a".repeat(64),
  researchQuestionSemanticKey: "b".repeat(64),
  issueStatement: "Verificare la disciplina applicabile all'utilizzo dell'area concessa da parte di un terzo.",
  ruleApplications: [{
    title: "Applicazione del regime concessorio",
    rule: "La regola va verificata nel suo testo ufficiale alla data dell'evento.",
    sourceCandidateIds: [ref],
    relevantFacts: "Il fascicolo documenta la concessione e un utilizzo da parte del terzo.",
    factBasisRefs: [fact],
    application: "La riconducibilita del caso alla norma deve essere motivata sulle prove.",
    outcome: "La valutazione resta subordinata alle circostanze accertate.",
  }],
  supportingArguments: [arg],
  contraryArguments: [] as (typeof arg)[],
  evidenceAssessment: {
    strengths: [arg],
    weaknesses: [arg],
    missingEvidence: ["Manca la data certa del contratto con il terzo."],
  },
  reasonedConclusion: {
    text: "La conclusione e condizionata alla verifica delle fonti e degli atti contrattuali.",
    confidence: "LOW" as const,
    decisiveSourceCandidateIds: [ref],
    decisiveFactBasisRefs: [fact],
    conditions: ["Verificare il contratto originale."],
  },
  strategies: [{
    title: "Acquisizione documentale",
    rationale: "Acquisire il contratto e verificare la situazione concessoria originaria.",
    sourceCandidateIds: [ref],
    factBasisRefs: [fact],
    risks: ["La ricostruzione dipende da documenti attualmente mancanti."],
  }],
  uncertainties: [],
});

describe("legal analysis adverse authority evidence", () => {
  it("rejects an empty contrary argument list without documented adverse search", () => {
    expect(legalAnalysisContributionSchema.safeParse(sample()).success).toBe(false);
  });
  it("accepts no adverse authority when an actual search is documented", () => {
    const payload = {
      ...sample(),
      noContraryAuthorityFinding: {
        searches: [{
          executionRecordId: "moonlit-adverse-search-1",
          examinedCandidateIds: [],
          outcome: "NO_RELEVANT_ADVERSE_AUTHORITY",
          notes: "Nessun risultato pertinente dopo verifica delle fonti restituite.",
        }],
        reasonedFinding: "Non sono stati rinvenuti precedenti contrari pertinenti nelle ricerche registrate.",
      },
    };
    expect(legalAnalysisContributionSchema.safeParse(payload).success).toBe(true);
  });
  it("preserves ordinary contrary argument contributions", () => {
    expect(legalAnalysisContributionSchema.safeParse({
      ...sample(),
      contraryArguments: [arg],
    }).success).toBe(true);
  });
  it("rejects contradictory claims of contrary authority and its absence", () => {
    const payload = {
      ...sample(),
      contraryArguments: [arg],
      noContraryAuthorityFinding: {
        searches: [{
          executionRecordId: "moonlit-adverse-search-1",
          examinedCandidateIds: [],
          outcome: "NO_RELEVANT_ADVERSE_AUTHORITY",
          notes: "La ricerca non ha trovato fonti pertinenti di segno opposto.",
        }],
        reasonedFinding: "Non esistono precedenti contrari pertinenti tra i risultati verificati.",
      },
    };
    expect(legalAnalysisContributionSchema.safeParse(payload).success).toBe(false);
  });
  it("requires examined candidates for non-empty adverse-search outcomes", () => {
    const payload = {
      ...sample(),
      noContraryAuthorityFinding: {
        searches: [{
          executionRecordId: "moonlit-adverse-search-1",
          examinedCandidateIds: [],
          outcome: "ONLY_UNVERIFIABLE_RESULTS" as const,
          notes: "I risultati restituiti non consentono una verifica sulla fonte ufficiale.",
        }],
        reasonedFinding: "Non sono disponibili precedenti contrari utilizzabili.",
      },
    };
    expect(legalAnalysisContributionSchema.safeParse(payload).success).toBe(false);
  });
});
