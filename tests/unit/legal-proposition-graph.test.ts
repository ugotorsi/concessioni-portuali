import { describe, expect, it } from "vitest";

import {
  LEGAL_PROPOSITION_GRAPH_VERSION,
  traceConclusionDependencies,
  validateLegalPropositionGraph,
  type AuthorityRelation,
  type LegalPropositionGraph,
} from "@/server/legal-reasoning/proposition-graph";

function graph(overrides: Partial<LegalPropositionGraph> = {}): LegalPropositionGraph {
  return {
    graphVersion: LEGAL_PROPOSITION_GRAPH_VERSION,
    factClaims: [{ kind: "FACT_CLAIM", id: "fact-1", statement: "The operator stopped.", status: "SUPPORTED" }],
    evidenceLinks: [{
      kind: "EVIDENCE_LINK",
      id: "evidence-1",
      factClaimId: "fact-1",
      documentId: "document-1",
      documentVersionId: "document-version-1",
      locator: { page: 2, paragraph: "4" },
      extractedTextHash: "sha256:evidence",
      role: "SUPPORTS",
    }],
    legalIssues: [{
      kind: "LEGAL_ISSUE",
      id: "issue-1",
      question: "Was the stop authorized?",
      factClaimIds: ["fact-1"],
      legalPropositionIds: ["proposition-1"],
    }],
    legalPropositions: [{
      kind: "LEGAL_PROPOSITION",
      id: "proposition-1",
      statement: "The competent authority must authorize the stop.",
    }],
    authorityRelations: [authority()],
    applications: [{
      kind: "APPLICATION",
      id: "application-1",
      statement: "The authorization rule applies to the documented stop.",
      factClaimIds: ["fact-1"],
      legalPropositionIds: ["proposition-1"],
    }],
    counterArguments: [],
    conclusions: [{
      kind: "CONCLUSION",
      id: "conclusion-1",
      legalIssueId: "issue-1",
      applicationIds: ["application-1"],
      statement: "The stop was provisionally authorized.",
      state: "PROVISIONAL",
    }],
    sourceSufficiencies: [{
      kind: "SOURCE_SUFFICIENCY",
      id: "sufficiency-1",
      target: { kind: "CONCLUSION", id: "conclusion-1" },
      state: "SUFFICIENT_FOR_PROVISIONAL_REASONING",
      basis: "One reconciled official authority supports provisional reasoning.",
    }],
    ...overrides,
  };
}

function authority(overrides: Partial<AuthorityRelation> = {}): AuthorityRelation {
  return {
    kind: "AUTHORITY_SUPPORT",
    id: "authority-1",
    target: { kind: "LEGAL_PROPOSITION", id: "proposition-1" },
    authority: {
      legalSourceId: "source-1",
      legalExpressionVersionId: "expression-1",
      referenceDate: "2025-01-15T00:00:00.000Z",
      provenance: { providerId: "provider-neutral-example", canonicalEvidenceId: "canonical-1" },
    },
    ...overrides,
  } as AuthorityRelation;
}

function codes(value: LegalPropositionGraph): string[] {
  return validateLegalPropositionGraph(value).map((error) => error.code);
}

describe("Block 3B.11A legal proposition graph", () => {
  it("accepts a valid minimal graph", () => {
    expect(validateLegalPropositionGraph(graph())).toEqual([]);
  });

  it("represents a FactClaim without treating absent evidence as proof", () => {
    const value = graph({ evidenceLinks: [] });
    expect(validateLegalPropositionGraph(value)).toEqual([]);
    expect(traceConclusionDependencies(value, "conclusion-1")?.evidenceLinks).toEqual([]);
  });

  it("rejects an evidence link to a missing fact", () => {
    const value = graph({
      evidenceLinks: [{ ...graph().evidenceLinks[0], factClaimId: "missing-fact" }],
    });
    expect(codes(value)).toContain("DANGLING_REFERENCE");
  });

  it("rejects an Application without a FactClaim", () => {
    const value = graph({ applications: [{ ...graph().applications[0], factClaimIds: [] }] });
    expect(codes(value)).toContain("APPLICATION_FACT_REQUIRED");
  });

  it("rejects an Application without a LegalProposition", () => {
    const value = graph({ applications: [{ ...graph().applications[0], legalPropositionIds: [] }] });
    expect(codes(value)).toContain("APPLICATION_PROPOSITION_REQUIRED");
  });

  it("rejects a Conclusion without an Application", () => {
    const value = graph({ conclusions: [{ ...graph().conclusions[0], applicationIds: [] }] });
    expect(codes(value)).toContain("CONCLUSION_APPLICATION_REQUIRED");
  });

  it("rejects a Conclusion without a LegalIssue", () => {
    const value = graph({ conclusions: [{ ...graph().conclusions[0], legalIssueId: "" }] });
    expect(codes(value)).toContain("CONCLUSION_ISSUE_REQUIRED");
  });

  it("supports AuthoritySupport to a LegalProposition", () => {
    expect(validateLegalPropositionGraph(graph())).toEqual([]);
    expect(graph().authorityRelations[0].kind).toBe("AUTHORITY_SUPPORT");
  });

  it.each(["LEGAL_PROPOSITION", "APPLICATION", "CONCLUSION"] as const)(
    "supports AuthorityAgainst to %s",
    (kind) => {
      const targetIds = {
        LEGAL_PROPOSITION: "proposition-1",
        APPLICATION: "application-1",
        CONCLUSION: "conclusion-1",
      };
      const value = graph({ authorityRelations: [authority({
        kind: "AUTHORITY_AGAINST",
        target: { kind, id: targetIds[kind] },
      })] });
      expect(validateLegalPropositionGraph(value)).toEqual([]);
    },
  );

  it("rejects a dangling authority target", () => {
    const value = graph({
      authorityRelations: [authority({ target: { kind: "APPLICATION", id: "missing" } })],
    });
    expect(codes(value)).toContain("DANGLING_REFERENCE");
  });

  it("requires an explicit authority reference date", () => {
    const value = graph({ authorityRelations: [authority({
      authority: { ...authority().authority, referenceDate: "" },
    })] });
    expect(codes(value)).toContain("AUTHORITY_REFERENCE_DATE_REQUIRED");
  });

  it.each(["APPLICATION", "CONCLUSION"] as const)("preserves a CounterArgument to %s", (kind) => {
    const id = kind === "APPLICATION" ? "application-1" : "conclusion-1";
    const counterArgument = {
      kind: "COUNTER_ARGUMENT" as const,
      id: `counter-${kind}`,
      target: { kind, id },
      basis: "The record admits another interpretation.",
      status: "UNRESOLVED" as const,
      evidenceLinkIds: ["evidence-1"],
      authorityRelationIds: [],
    };
    const value = graph({ counterArguments: [counterArgument] });
    expect(validateLegalPropositionGraph(value)).toEqual([]);
    expect(traceConclusionDependencies(value, "conclusion-1")?.counterArguments).toContainEqual(counterArgument);
  });

  it("keeps an unresolved CounterArgument as first-class history", () => {
    const counterArgument = {
      kind: "COUNTER_ARGUMENT" as const,
      id: "counter-1",
      target: { kind: "CONCLUSION" as const, id: "conclusion-1" },
      basis: "Competence remains disputed.",
      status: "UNRESOLVED" as const,
      evidenceLinkIds: [] as const,
      authorityRelationIds: [] as const,
    };
    expect(traceConclusionDependencies(
      graph({ counterArguments: [counterArgument] }),
      "conclusion-1",
    )?.counterArguments[0].status).toBe("UNRESOLVED");
  });

  it.each(["APPLICATION", "CONCLUSION"] as const)("associates SourceSufficiency with %s", (kind) => {
    const id = kind === "APPLICATION" ? "application-1" : "conclusion-1";
    const value = graph({ sourceSufficiencies: [{
      ...graph().sourceSufficiencies[0],
      target: { kind, id },
    }] });
    expect(validateLegalPropositionGraph(value)).toEqual([]);
  });

  it("keeps authority references provider-neutral", () => {
    const first = graph({ authorityRelations: [authority({
      authority: { ...authority().authority, provenance: { providerId: "OPENGA" } },
    })] });
    const second = graph({ authorityRelations: [authority({
      authority: { ...authority().authority, provenance: { providerId: "FUTURE_PROVIDER" } },
    })] });
    expect(validateLegalPropositionGraph(first)).toEqual(validateLegalPropositionGraph(second));
  });

  it("preserves an explicit persisted temporal assessment reference without recalculation", () => {
    const temporalAssessment = {
      id: "assessment-1",
      assessmentVersion: "LEGAL_SOURCE_TEMPORAL_V1",
      referenceDate: "2025-01-15T00:00:00.000Z",
      temporalWindowState: "SATISFIED" as const,
      applicabilityState: "REQUIRES_HUMAN_REVIEW" as const,
      humanReviewRequired: true,
    };
    const value = graph({ authorityRelations: [authority({
      authority: { ...authority().authority, temporalAssessment },
    })] });
    expect(validateLegalPropositionGraph(value)).toEqual([]);
    expect(traceConclusionDependencies(value, "conclusion-1")?.temporalAssessmentReferences).toEqual([
      { authorityRelationId: "authority-1", reference: temporalAssessment },
    ]);
  });

  it("rejects a temporal assessment reference without its explicit date", () => {
    const value = graph({ authorityRelations: [authority({
      authority: {
        ...authority().authority,
        temporalAssessment: {
          id: "assessment-1",
          assessmentVersion: "LEGAL_SOURCE_TEMPORAL_V1",
          referenceDate: "",
          temporalWindowState: "INCOMPLETE",
          applicabilityState: "INDETERMINATE",
          humanReviewRequired: true,
        },
      },
    })] });
    expect(codes(value)).toContain("TEMPORAL_REFERENCE_DATE_REQUIRED");
  });

  it("returns validation errors in deterministic order", () => {
    const first = graph({
      applications: [
        { ...graph().applications[0], id: "z", factClaimIds: [], legalPropositionIds: [] },
        { ...graph().applications[0], id: "a", factClaimIds: [], legalPropositionIds: [] },
      ],
    });
    const second = graph({ applications: [...first.applications].reverse() });
    expect(validateLegalPropositionGraph(first)).toEqual(validateLegalPropositionGraph(second));
  });

  it("returns a deterministic machine-readable Conclusion dependency trace", () => {
    const value = graph({
      evidenceLinks: [
        { ...graph().evidenceLinks[0], id: "evidence-z" },
        { ...graph().evidenceLinks[0], id: "evidence-a", stableSegmentId: "segment-a" },
      ],
      authorityRelations: [
        authority({ id: "authority-z" }),
        authority({ id: "authority-a", authority: { ...authority().authority, legalSourceId: "source-2" } }),
      ],
    });
    const trace = traceConclusionDependencies(value, "conclusion-1");
    expect(trace?.evidenceLinks.map((item) => item.id)).toEqual(["evidence-a", "evidence-z"]);
    expect(trace?.authorities.map((item) => item.id)).toEqual(["authority-a", "authority-z"]);
    expect(traceConclusionDependencies(value, "missing")).toBeNull();
  });

  it("rejects duplicate relation identity", () => {
    const duplicate = {
      ...graph().evidenceLinks[0],
      id: "evidence-2",
      locator: { paragraph: "4", page: 2 },
    };
    expect(codes(graph({ evidenceLinks: [...graph().evidenceLinks, duplicate] })))
      .toContain("DUPLICATE_RELATION");
  });

  it("rejects duplicate inline relation identity", () => {
    const value = graph({ applications: [{
      ...graph().applications[0],
      factClaimIds: ["fact-1", "fact-1"],
    }] });
    expect(codes(value)).toContain("DUPLICATE_RELATION");
  });

  it("rejects an invalid CounterArgument self-reference", () => {
    const value = graph({ counterArguments: [{
      kind: "COUNTER_ARGUMENT",
      id: "counter-1",
      target: { kind: "COUNTER_ARGUMENT", id: "counter-1" },
      basis: "Self reference.",
      status: "OPEN",
      evidenceLinkIds: [],
      authorityRelationIds: [],
    }] });
    expect(codes(value)).toContain("INVALID_SELF_REFERENCE");
  });

  it("supports multiple supporting authorities", () => {
    const value = graph({ authorityRelations: [
      authority(),
      authority({ id: "authority-2", authority: { ...authority().authority, legalSourceId: "source-2" } }),
    ] });
    expect(validateLegalPropositionGraph(value)).toEqual([]);
    expect(traceConclusionDependencies(value, "conclusion-1")?.authorities).toHaveLength(2);
  });

  it("supports supporting and adverse authority simultaneously", () => {
    const value = graph({ authorityRelations: [
      authority(),
      authority({
        kind: "AUTHORITY_AGAINST",
        id: "authority-against",
        authority: { ...authority().authority, legalSourceId: "source-adverse" },
      }),
    ] });
    expect(validateLegalPropositionGraph(value)).toEqual([]);
    expect(traceConclusionDependencies(value, "conclusion-1")?.authorities.map((item) => item.kind))
      .toEqual(["AUTHORITY_SUPPORT", "AUTHORITY_AGAINST"]);
  });

  it("supports multiple Applications under one LegalIssue", () => {
    const second = { ...graph().applications[0], id: "application-2", statement: "Alternative application." };
    const value = graph({
      applications: [...graph().applications, second],
      conclusions: [{ ...graph().conclusions[0], applicationIds: ["application-1", "application-2"] }],
    });
    expect(validateLegalPropositionGraph(value)).toEqual([]);
    expect(traceConclusionDependencies(value, "conclusion-1")?.applications).toHaveLength(2);
  });

  it("supports multiple competing Conclusions for one LegalIssue", () => {
    const competing = {
      ...graph().conclusions[0],
      id: "conclusion-2",
      statement: "The stop was not authorized.",
      state: "CONTESTED" as const,
    };
    const value = graph({ conclusions: [...graph().conclusions, competing] });
    expect(validateLegalPropositionGraph(value)).toEqual([]);
    expect(value.conclusions.map((item) => item.legalIssueId)).toEqual(["issue-1", "issue-1"]);
  });
});