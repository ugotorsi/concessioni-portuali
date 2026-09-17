import { describe, expect, it } from "vitest";

import {
  AUTHORITY_TREATMENT_VERSION,
  authorityTreatmentAssessmentIdentity,
  citationObservationIdentity,
  createAuthorityTreatmentAssessment,
  createCitationObservation,
  explainAuthorityPair,
  validateAuthorityTreatmentGraph,
  type AuthorityRecord,
  type AuthorityTreatmentAssessmentInput,
  type AuthorityTreatmentGraph,
  type CitationObservationInput,
} from "@/server/legal-reasoning/authority-treatment";
import {
  LEGAL_PROPOSITION_GRAPH_VERSION,
  type LegalPropositionGraph,
} from "@/server/legal-reasoning/proposition-graph";

const authorities: readonly AuthorityRecord[] = [
  {
    id: "authority-b",
    authority: {
      legalSourceId: "source-b",
      legalExpressionVersionId: "expression-b",
      referenceDate: "2025-05-01T00:00:00.000Z",
    },
    decisionDate: "2025-04-20",
  },
  {
    id: "authority-a",
    authority: {
      legalSourceId: "source-a",
      legalExpressionVersionId: "expression-a",
      referenceDate: "2025-05-01T00:00:00.000Z",
    },
    decisionDate: "2020-02-10",
  },
];

function observationInput(overrides: Partial<CitationObservationInput> = {}): CitationObservationInput {
  return {
    kind: "CITATION_OBSERVATION",
    relation: "CITES",
    sourceAuthorityId: "authority-b",
    targetAuthorityId: "authority-a",
    provenance: {
      evidenceSourceId: "provider-result-1",
      providerId: "provider-example",
      documentId: "document-b",
      locator: { page: 7, paragraph: "12" },
      observationMethod: "PROVIDER_REPORTED",
      evidenceHash: "sha256:citation-passage",
    },
    ...overrides,
  };
}

function assessmentInput(
  observationId: string,
  overrides: Partial<AuthorityTreatmentAssessmentInput> = {},
): AuthorityTreatmentAssessmentInput {
  return {
    kind: "AUTHORITY_TREATMENT_ASSESSMENT",
    observationId,
    sourceAuthorityId: "authority-b",
    targetAuthorityId: "authority-a",
    treatment: "NEUTRAL_CITATION",
    origin: "UNKNOWN",
    reviewState: "UNREVIEWED",
    ...overrides,
  };
}

function graph(overrides: Partial<AuthorityTreatmentGraph> = {}): AuthorityTreatmentGraph {
  const observation = createCitationObservation(observationInput());
  return {
    version: AUTHORITY_TREATMENT_VERSION,
    authorities,
    observations: [observation],
    assessments: [],
    ...overrides,
  };
}

const propositionGraph: LegalPropositionGraph = {
  graphVersion: LEGAL_PROPOSITION_GRAPH_VERSION,
  factClaims: [],
  evidenceLinks: [],
  legalIssues: [{
    kind: "LEGAL_ISSUE",
    id: "issue-1",
    question: "Which authority applies?",
    factClaimIds: [],
    legalPropositionIds: ["proposition-1"],
  }],
  legalPropositions: [{ kind: "LEGAL_PROPOSITION", id: "proposition-1", statement: "A rule." }],
  authorityRelations: [],
  applications: [{
    kind: "APPLICATION",
    id: "application-1",
    statement: "Application.",
    factClaimIds: ["fact-external"],
    legalPropositionIds: ["proposition-1"],
  }],
  counterArguments: [],
  conclusions: [],
  sourceSufficiencies: [],
};

function codes(value: AuthorityTreatmentGraph, scopeGraph = propositionGraph): string[] {
  return validateAuthorityTreatmentGraph(value, scopeGraph).map((error) => error.code);
}

describe("Block 3B.11B authority relation and treatment core", () => {
  it("represents a simple A cites B observation", () => {
    const value = graph();
    expect(validateAuthorityTreatmentGraph(value)).toEqual([]);
    expect(value.observations[0].relation).toBe("CITES");
    expect(value.observations[0]).not.toHaveProperty("assessment");
  });

  it("rejects self-citation", () => {
    const observation = createCitationObservation(observationInput({ targetAuthorityId: "authority-b" }));
    expect(codes(graph({ observations: [observation] }))).toContain("SELF_CITATION");
  });

  it("produces the same deterministic observation ID for the same bounded input", () => {
    expect(citationObservationIdentity(observationInput()))
      .toBe(citationObservationIdentity(observationInput()));
  });

  it("ignores object property insertion order when deriving identity", () => {
    const original = observationInput();
    const reordered = observationInput({
      provenance: {
        evidenceHash: original.provenance.evidenceHash,
        observationMethod: original.provenance.observationMethod,
        locator: original.provenance.locator,
        documentId: original.provenance.documentId,
        providerId: original.provenance.providerId,
        evidenceSourceId: original.provenance.evidenceSourceId,
      },
    });
    expect(citationObservationIdentity(original)).toBe(citationObservationIdentity(reordered));
  });

  it("distinguishes observations with different locators", () => {
    const first = citationObservationIdentity(observationInput());
    const second = citationObservationIdentity(observationInput({
      provenance: { ...observationInput().provenance, locator: { page: 8, paragraph: "12" } },
    }));
    expect(first).not.toBe(second);
  });

  it("does not turn a raw citation into supportive treatment", () => {
    const explanation = explainAuthorityPair(graph(), "authority-b", "authority-a");
    expect(explanation.observations).toHaveLength(1);
    expect(explanation.assessments).toEqual([]);
  });

  it.each([
    "SUPPORTIVE",
    "DISTINGUISHES",
    "ADVERSE",
    "INDETERMINATE",
    "REQUIRES_HUMAN_REVIEW",
  ] as const)("represents %s treatment without changing the observation", (treatment) => {
    const observation = graph().observations[0];
    const assessment = createAuthorityTreatmentAssessment(assessmentInput(observation.id, { treatment }));
    const value = graph({ observations: [observation], assessments: [assessment] });
    expect(validateAuthorityTreatmentGraph(value)).toEqual([]);
    expect(value.observations[0].relation).toBe("CITES");
    expect(value.assessments[0].treatment).toBe(treatment);
  });

  it("preserves multiple treatments for the same authority pair", () => {
    const observation = graph().observations[0];
    const assessments = [
      createAuthorityTreatmentAssessment(assessmentInput(observation.id, { treatment: "SUPPORTIVE" })),
      createAuthorityTreatmentAssessment(assessmentInput(observation.id, {
        treatment: "DISTINGUISHES",
        origin: "HUMAN",
      })),
    ];
    const value = graph({ observations: [observation], assessments });
    expect(validateAuthorityTreatmentGraph(value)).toEqual([]);
    expect(explainAuthorityPair(value, "authority-b", "authority-a").assessments).toHaveLength(2);
  });

  it("preserves multiple observations for the same authority pair", () => {
    const observations = [
      createCitationObservation(observationInput()),
      createCitationObservation(observationInput({
        provenance: { ...observationInput().provenance, locator: { page: 9 } },
      })),
    ];
    const value = graph({ observations });
    expect(validateAuthorityTreatmentGraph(value)).toEqual([]);
    expect(explainAuthorityPair(value, "authority-b", "authority-a").observations).toHaveLength(2);
  });

  it("retains provider provenance without provider-specific semantics", () => {
    const first = createCitationObservation(observationInput({
      provenance: { ...observationInput().provenance, providerId: "MOONLIT" },
    }));
    const second = createCitationObservation(observationInput({
      provenance: { ...observationInput().provenance, providerId: "OTHER_PROVIDER" },
    }));
    expect(first.provenance.providerId).toBe("MOONLIT");
    expect(second.provenance.providerId).toBe("OTHER_PROVIDER");
    expect(first.relation).toBe(second.relation);
  });

  it.each([
    ["legalSourceId", { legalSourceId: "" }],
    ["legalExpressionVersionId", { legalExpressionVersionId: "" }],
    ["referenceDate", { referenceDate: "" }],
  ])("requires canonical authority %s", (_label, authorityOverride) => {
    const incomplete = {
      ...authorities[0],
      authority: { ...authorities[0].authority, ...authorityOverride },
    };
    expect(codes(graph({ authorities: [incomplete, authorities[1]] })))
      .toContain("CANONICAL_AUTHORITY_REFERENCE_INCOMPLETE");
  });

  it.each([
    ["LEGAL_PROPOSITION", "DANGLING_PROPOSITION_SCOPE"],
    ["LEGAL_ISSUE", "DANGLING_ISSUE_SCOPE"],
    ["APPLICATION", "DANGLING_APPLICATION_SCOPE"],
  ] as const)("rejects dangling %s scope", (kind, code) => {
    const observation = graph().observations[0];
    const assessment = createAuthorityTreatmentAssessment(assessmentInput(observation.id, {
      scope: { kind, id: "missing" },
    }));
    expect(codes(graph({ assessments: [assessment] }))).toContain(code);
  });

  it("distinguishes the same authority pair when scoped differently", () => {
    const observation = graph().observations[0];
    const proposition = assessmentInput(observation.id, {
      scope: { kind: "LEGAL_PROPOSITION", id: "proposition-1" },
    });
    const issue = assessmentInput(observation.id, {
      scope: { kind: "LEGAL_ISSUE", id: "issue-1" },
    });
    expect(authorityTreatmentAssessmentIdentity(proposition))
      .not.toBe(authorityTreatmentAssessmentIdentity(issue));
  });

  it.each(["CONFIRMED", "REJECTED", "CONFLICTED"] as const)(
    "preserves %s review state",
    (reviewState) => {
      const observation = graph().observations[0];
      const assessment = createAuthorityTreatmentAssessment(assessmentInput(observation.id, { reviewState }));
      expect(graph({ assessments: [assessment] }).assessments[0].reviewState).toBe(reviewState);
    },
  );

  it("preserves chronology without interpreting it", () => {
    const explanation = explainAuthorityPair(graph(), "authority-b", "authority-a");
    expect(explanation.sourceAuthority?.decisionDate).toBe("2025-04-20");
    expect(explanation.targetAuthority?.decisionDate).toBe("2020-02-10");
    expect(explanation).not.toHaveProperty("laterAuthorityControls");
    expect(explanation).not.toHaveProperty("precedentialEffect");
  });

  it("preserves an optional persisted temporal assessment reference", () => {
    const temporalAuthority: AuthorityRecord = {
      ...authorities[0],
      authority: {
        ...authorities[0].authority,
        temporalAssessment: {
          id: "temporal-assessment-1",
          assessmentVersion: "LEGAL_SOURCE_TEMPORAL_V1",
          referenceDate: authorities[0].authority.referenceDate,
          temporalWindowState: "SATISFIED",
          applicabilityState: "REQUIRES_HUMAN_REVIEW",
          humanReviewRequired: true,
        },
      },
    };
    const value = graph({ authorities: [temporalAuthority, authorities[1]] });
    expect(validateAuthorityTreatmentGraph(value)).toEqual([]);
    expect(explainAuthorityPair(value, "authority-b", "authority-a")
      .sourceAuthority?.authority.temporalAssessment?.id).toBe("temporal-assessment-1");
  });

  it("contains no binding-force or numeric authority score inference", () => {
    const serialized = JSON.stringify(graph());
    expect(serialized).not.toContain("binding");
    expect(serialized).not.toContain("authorityScore");
    expect(serialized).not.toContain("providerWeight");
  });

  it("returns deterministic machine-readable explainability output", () => {
    const firstObservation = graph().observations[0];
    const secondObservation = createCitationObservation(observationInput({
      provenance: { ...observationInput().provenance, locator: { page: 10 } },
    }));
    const firstAssessment = createAuthorityTreatmentAssessment(assessmentInput(firstObservation.id, {
      treatment: "SUPPORTIVE",
      reviewState: "CONFIRMED",
      scope: { kind: "LEGAL_PROPOSITION", id: "proposition-1" },
    }));
    const secondAssessment = createAuthorityTreatmentAssessment(assessmentInput(secondObservation.id, {
      treatment: "QUALIFIES",
      reviewState: "REQUIRES_HUMAN_REVIEW",
      scope: { kind: "APPLICATION", id: "application-1" },
    }));
    const value = graph({
      observations: [secondObservation, firstObservation],
      assessments: [secondAssessment, firstAssessment],
    });
    const first = explainAuthorityPair(value, "authority-b", "authority-a");
    const second = explainAuthorityPair({
      ...value,
      observations: [...value.observations].reverse(),
      assessments: [...value.assessments].reverse(),
    }, "authority-b", "authority-a");
    expect(first).toEqual(second);
    expect(first.assessments.map((item) => item.scope)).toEqual(expect.arrayContaining([
      { kind: "LEGAL_PROPOSITION", id: "proposition-1" },
      { kind: "APPLICATION", id: "application-1" },
    ]));
  });

  it("rejects duplicate observation identity", () => {
    const observation = graph().observations[0];
    expect(codes(graph({ observations: [observation, observation] })))
      .toContain("DUPLICATE_OBSERVATION_IDENTITY");
  });

  it("rejects duplicate assessment identity", () => {
    const observation = graph().observations[0];
    const assessment = createAuthorityTreatmentAssessment(assessmentInput(observation.id));
    expect(codes(graph({ assessments: [assessment, assessment] })))
      .toContain("DUPLICATE_ASSESSMENT_IDENTITY");
  });

  it("rejects a treatment whose authority pair differs from its observation", () => {
    const observation = graph().observations[0];
    const assessment = createAuthorityTreatmentAssessment(assessmentInput(observation.id, {
      targetAuthorityId: "authority-b",
    }));
    expect(codes(graph({ assessments: [assessment] })))
      .toContain("ASSESSMENT_AUTHORITY_PAIR_MISMATCH");
  });

  it("rejects dangling observation and authority references from an assessment", () => {
    const assessment = createAuthorityTreatmentAssessment(assessmentInput("missing-observation", {
      sourceAuthorityId: "missing-authority",
    }));
    const result = codes(graph({ assessments: [assessment] }));
    expect(result).toContain("DANGLING_OBSERVATION");
    expect(result).toContain("DANGLING_AUTHORITY");
  });

  it("returns validation errors in deterministic order", () => {
    const first = createCitationObservation(observationInput({
      sourceAuthorityId: "missing-z",
      targetAuthorityId: "missing-a",
    }));
    const second = createCitationObservation(observationInput({
      sourceAuthorityId: "missing-a",
      targetAuthorityId: "missing-z",
      provenance: { ...observationInput().provenance, evidenceSourceId: "provider-result-2" },
    }));
    const forward = graph({ observations: [first, second] });
    const reverse = graph({ observations: [second, first] });
    expect(validateAuthorityTreatmentGraph(forward))
      .toEqual(validateAuthorityTreatmentGraph(reverse));
  });

  it("rejects structurally invalid observation provenance", () => {
    const observation = createCitationObservation(observationInput({
      provenance: { ...observationInput().provenance, evidenceSourceId: "", locator: { page: 0 } },
    }));
    expect(codes(graph({ observations: [observation] })))
      .toContain("INVALID_OBSERVATION_PROVENANCE");
  });
});