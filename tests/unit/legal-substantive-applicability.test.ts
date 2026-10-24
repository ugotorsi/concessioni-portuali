import { describe, expect, it } from "vitest";

import {
  applicabilityDimensionsFromRuleOrchestrator,
  assessLegalApplicability,
  type ApplicabilityFactReference,
  type LegalApplicabilityAssessmentInput,
  type ProceedingIdentityReference,
  type TransitionalDiscipline,
  type VerifiedProvisionReference,
} from "@/server/legal-reasoning/applicability";
import {
  LEGAL_PROPOSITION_GRAPH_VERSION,
  validateLegalPropositionGraph,
  type LegalPropositionGraph,
} from "@/server/legal-reasoning/proposition-graph";
import {
  assessLegalSourceTemporalApplicability,
  type TemporalLegalAuthorityKind,
} from "@/server/legal-sources/temporal";

const REFERENCE_DATE = "2026-03-01T00:00:00.000Z";
const EFFECTIVE_FROM = "2026-01-01T00:00:00.000Z";

function proceedingIdentity(
  canonicalAnchorSemanticKey: string,
  kind: ProceedingIdentityReference["kind"] = "ADMINISTRATIVE_ORIGINAL",
): ProceedingIdentityReference {
  return {
    canonicalAnchorSemanticKey,
    kind,
    verification: "DOCUMENTED",
    evidenceLinkIds: [`evidence-${canonicalAnchorSemanticKey}`],
  };
}

function source(
  id = "new-law",
  provisionReference = "art. 10",
): VerifiedProvisionReference {
  const citationAnchors = [{ section: provisionReference }];
  return {
    legalSourceId: id,
    legalExpressionVersionId: `${id}-v1`,
    provisionReference,
    sourceAssessment: {
      resultId: `${id}-result`,
      tenantId: "tenant-1",
      caseId: "case-1",
      missionId: "mission-1",
      researchQuestionSemanticKey: "q".repeat(64),
      missionFingerprint: "m".repeat(64),
      referenceDate: "2026-03-01",
      referenceDateBasis: { type: "PROCEEDING_STARTED" },
      verificationVersion: "SOURCE_CHAIN_V1",
      sourceIdentityKey: `${id}:official`,
      contentSha256: "a".repeat(64),
      retrievalState: "RESOLVED",
      textState: "FULL_TEXT",
      identityState: "VERIFIED",
      contentState: "VERIFIED",
      temporalState: "APPLICABLE",
      adverseState: "COMPLETED",
      officiality: "OFFICIAL",
      citationAnchors,
      manualReviewRequired: false,
      manualReviewReason: null,
      currentMission: true,
    },
    citationAnchors,
    provenance: {
      providerId: "official-provider",
      canonicalEvidenceId: `${id}-evidence`,
      sourceUrl: `https://official.example/${id}`,
    },
  };
}

function fact(
  factClaimId: string,
  role: ApplicabilityFactReference["role"],
  occurrenceDate: string | null,
  overrides: Partial<ApplicabilityFactReference> = {},
): ApplicabilityFactReference {
  return {
    factClaimId,
    role,
    statement: factClaimId,
    occurrenceDate,
    certainty: "CERTAIN",
    evidenceLinkIds: [`evidence-${factClaimId}`],
    proceedingIdentity: role === "PROCEEDING_STARTED" || role === "PROCEEDING_STATUS"
      ? proceedingIdentity("proceeding-a")
      : null,
    ...overrides,
  };
}

function facts(): readonly ApplicabilityFactReference[] {
  return [
    fact("fact-application-2024", "APPLICATION_SUBMITTED", "2024-05-10"),
    fact("fact-proceeding-2025", "PROCEEDING_STARTED", "2025-02-15"),
    fact("fact-proceeding-pending", "PROCEEDING_STATUS", "2026-01-01", { value: "PENDING" }),
    fact("fact-relationship-2024", "LEGAL_RELATIONSHIP_ESTABLISHED", "2024-06-01"),
    fact("fact-conduct-2026", "RELEVANT_CONDUCT", "2026-02-10"),
  ];
}

function temporal(kind: TemporalLegalAuthorityKind = "LEGISLATION") {
  return assessLegalSourceTemporalApplicability({
    sourceFamilyId: "new-law",
    legalAuthorityKind: kind,
    sourceStatus: "CURRENT",
    expression: {
      expressionId: "new-law-v1",
      publicationDate: "2025-12-15T00:00:00.000Z",
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      expressionStatus: "CURRENT",
      correctionMetadata: null,
      consolidationMetadata: null,
    },
    referenceDate: REFERENCE_DATE,
    temporalEvidence: { authoritativeAsOfDate: true },
  });
}

function noTransitionalProvision(): TransitionalDiscipline {
  return {
    status: "VERIFIED_ABSENT",
    verificationSource: source(),
    absenceAttestation: {
      sourceContentSha256: "a".repeat(64),
      reviewScope: "COMPLETE_OFFICIAL_TEXT",
      examinedProvisions: ["articoli 1-30"],
      examinedAnnexes: ["allegato A"],
      linkedActsChecked: ["atto di coordinamento 1/2026"],
      reviewedByActorId: "legal-reviewer-1",
      reviewedAt: "2026-03-02T10:00:00.000Z",
      rationale: "Il revisore ha esaminato integralmente il testo ufficiale, gli allegati e gli atti collegati.",
    },
    rationale: "Il testo ufficiale integrale non contiene una disciplina transitoria.",
  };
}

function input(
  overrides: Partial<LegalApplicabilityAssessmentInput> = {},
): LegalApplicabilityAssessmentInput {
  return {
    applicationId: "application-1",
    legalAuthorityKind: "LEGISLATION",
    referenceDate: REFERENCE_DATE,
    candidateProvision: source(),
    chronologicalAssessment: temporal(),
    territorialApplicability: {
      outcome: "SATISFIED",
      rationale: "La fonte nazionale copre il territorio.",
      decisiveFactClaimIds: [],
    },
    materialApplicability: {
      outcome: "SATISFIED",
      rationale: "La regola riguarda questa tipologia concessoria.",
      decisiveFactClaimIds: ["fact-conduct-2026"],
    },
    factualApplicability: {
      outcome: "SATISFIED",
      rationale: "Il fatto documentato integra la fattispecie.",
      decisiveFactClaimIds: ["fact-conduct-2026"],
    },
    normRelationship: {
      outcome: "NO_SPECIALITY_CONFLICT",
      rationale: "Non risultano norme speciali confliggenti.",
      competingProvision: null,
    },
    facts: facts(),
    targetProceedingIdentity: proceedingIdentity("proceeding-a"),
    transitionalDiscipline: noTransitionalProvision(),
    ...overrides,
  };
}

describe("legal substantive and transitional applicability", () => {
  it("A. applies a new law without transitional rules only to certain decisive facts after effectiveness", () => {
    const assessment = assessLegalApplicability(input());

    expect(assessment.chronologicalCheck.outcome).toBe("SATISFIED");
    expect(assessment.transitionalCheck).toMatchObject({
      outcome: "SATISFIED",
      reasonCodes: ["NO_TRANSITIONAL_PROVISION_AND_DECISIVE_FACTS_AFTER_EFFECTIVE_DATE"],
      decisiveFactClaimIds: ["fact-conduct-2026"],
    });
    expect(assessment.conclusion).toMatchObject({
      outcome: "APPLICABLE",
      humanReviewRequired: true,
    });
    expect(assessment.sourcesUsed).toHaveLength(1);
  });

  it("B. excludes a proceeding that was already pending under a verified transitional clause", () => {
    const assessment = assessLegalApplicability(input({
      transitionalDiscipline: {
        status: "VERIFIED_PRESENT",
        provision: source("new-law", "art. 20, comma 2"),
        effectiveFrom: EFFECTIVE_FROM,
        effect: "EXCLUDES_PENDING_PROCEEDINGS",
        determiningFactRole: "PROCEEDING_STARTED",
        previousRegimeProvision: null,
        exceptions: [],
        interpretationRationale: "La disposizione esclude i procedimenti pendenti.",
      },
    }));

    expect(assessment.chronologicalCheck.outcome).toBe("SATISFIED");
    expect(assessment.transitionalCheck).toMatchObject({
      outcome: "NOT_SATISFIED",
      reasonCodes: ["PENDING_PROCEEDING_EXCLUDED"],
      decisiveFactClaimIds: ["fact-proceeding-2025", "fact-proceeding-pending"],
    });
    expect(assessment.conclusion.outcome).toBe("NOT_APPLICABLE");
  });

  it("C. recognizes express retroactivity only from a verified official provision", () => {
    const assessment = assessLegalApplicability(input({
      factualApplicability: {
        outcome: "SATISFIED",
        rationale: "L'istanza del 2024 e il fatto determinante.",
        decisiveFactClaimIds: ["fact-application-2024"],
      },
      transitionalDiscipline: {
        status: "VERIFIED_PRESENT",
        provision: source("new-law", "art. 21"),
        effectiveFrom: EFFECTIVE_FROM,
        effect: "EXPRESSLY_RETROACTIVE",
        determiningFactRole: "APPLICATION_SUBMITTED",
        previousRegimeProvision: null,
        exceptions: [],
        interpretationRationale: "La disposizione dichiara espressamente la propria retroattivita.",
      },
    }));

    expect(assessment.transitionalCheck).toMatchObject({
      outcome: "SATISFIED",
      reasonCodes: ["EXPRESS_RETROACTIVITY_VERIFIED"],
    });
    expect(assessment.conclusion.outcome).toBe("APPLICABLE");
    expect(assessment.sourcesUsed[0]?.citationAnchors.length).toBeGreaterThan(0);
  });

  it("D. preserves the previous regime for relationships established before effectiveness", () => {
    const previousRegime = source("previous-law", "art. 8");
    const assessment = assessLegalApplicability(input({
      factualApplicability: {
        outcome: "SATISFIED",
        rationale: "Il rapporto concessorio e documentato.",
        decisiveFactClaimIds: ["fact-relationship-2024"],
      },
      transitionalDiscipline: {
        status: "VERIFIED_PRESENT",
        provision: source("new-law", "art. 22"),
        effectiveFrom: EFFECTIVE_FROM,
        effect: "PRESERVES_PREVIOUS_REGIME",
        determiningFactRole: "LEGAL_RELATIONSHIP_ESTABLISHED",
        previousRegimeProvision: previousRegime,
        exceptions: [],
        interpretationRationale: "I rapporti gia costituiti restano regolati dalla disciplina previgente.",
      },
    }));

    expect(assessment.transitionalCheck).toMatchObject({
      outcome: "NOT_SATISFIED",
      reasonCodes: ["PREVIOUS_REGIME_PRESERVED"],
      decisiveFactClaimIds: ["fact-relationship-2024"],
    });
    expect(assessment.sourcesUsed.map((item) => item.legalSourceId)).toContain("previous-law");
    expect(assessment.conclusion.outcome).toBe("NOT_APPLICABLE");
  });

  it("E. records that a verified special rule governs instead of the general discipline", () => {
    const general = source("general-law", "art. 1");
    const assessment = assessLegalApplicability(input({
      normRelationship: {
        outcome: "CANDIDATE_IS_SPECIAL",
        rationale: "La disciplina portuale speciale prevale sulla regola generale nel perimetro verificato.",
        competingProvision: general,
      },
    }));

    expect(assessment.specialityCheck).toMatchObject({
      outcome: "SATISFIED",
      reasonCodes: ["CANDIDATE_IS_SPECIAL"],
    });
    expect(assessment.sourcesUsed.map((item) => item.legalSourceId)).toContain("general-law");
    expect(assessment.conclusion.outcome).toBe("APPLICABLE");
  });

  it("F. requires review when the transitional clause cannot be retrieved", () => {
    const assessment = assessLegalApplicability(input({
      transitionalDiscipline: {
        status: "UNAVAILABLE",
        expectedProvisionReference: "art. 20",
        rationale: "La disposizione transitoria non e stata reperita in fonte ufficiale.",
      },
    }));

    expect(assessment.transitionalCheck).toMatchObject({
      outcome: "TO_VERIFY",
      reasonCodes: ["TRANSITIONAL_PROVISION_UNAVAILABLE"],
    });
    expect(assessment.conclusion.outcome).toBe("TO_VERIFY");
  });

  it("G. requires review when the proceeding start date is uncertain", () => {
    const uncertainFacts = facts().map((item) => item.factClaimId === "fact-proceeding-2025"
      ? { ...item, occurrenceDate: null, certainty: "UNCERTAIN" as const }
      : item);
    const assessment = assessLegalApplicability(input({
      facts: uncertainFacts,
      transitionalDiscipline: {
        status: "VERIFIED_PRESENT",
        provision: source("new-law", "art. 20, comma 2"),
        effectiveFrom: EFFECTIVE_FROM,
        effect: "EXCLUDES_PENDING_PROCEEDINGS",
        determiningFactRole: "PROCEEDING_STARTED",
        previousRegimeProvision: null,
        exceptions: [],
        interpretationRationale: "La disposizione esclude i procedimenti pendenti.",
      },
    }));

    expect(assessment.transitionalCheck).toMatchObject({
      outcome: "TO_VERIFY",
      reasonCodes: ["PENDING_PROCEEDING_STATUS_OR_DATE_UNCERTAIN"],
    });
    expect(assessment.conclusion.outcome).toBe("TO_VERIFY");
  });

  it("keeps the proceeding pending at effectiveness when it completed later", () => {
      const assessment = assessLegalApplicability(input({
        facts: [
          ...facts().filter((item) => item.role !== "PROCEEDING_STARTED" && item.role !== "PROCEEDING_STATUS"),
          fact("start", "PROCEEDING_STARTED", "2025-02-15"),
          fact("completion", "PROCEEDING_STATUS", "2026-02-10", { value: "COMPLETED" }),
        ],
        transitionalDiscipline: {
          status: "VERIFIED_PRESENT",
          provision: source("new-law", "art. 20"),
          effectiveFrom: EFFECTIVE_FROM,
          effect: "EXCLUDES_PENDING_PROCEEDINGS",
          determiningFactRole: "PROCEEDING_STARTED",
          previousRegimeProvision: null,
          exceptions: [],
          interpretationRationale: "La disposizione esclude i procedimenti pendenti.",
        },
      }));

      expect(assessment.transitionalCheck).toMatchObject({
        outcome: "NOT_SATISFIED",
        reasonCodes: ["PENDING_PROCEEDING_EXCLUDED"],
      });
    });

    it("does not treat a proceeding completed before effectiveness as pending", () => {
      const assessment = assessLegalApplicability(input({
        facts: [
          ...facts().filter((item) => item.role !== "PROCEEDING_STARTED" && item.role !== "PROCEEDING_STATUS"),
          fact("start", "PROCEEDING_STARTED", "2025-02-15"),
          fact("completion", "PROCEEDING_STATUS", "2025-12-10", { value: "COMPLETED" }),
        ],
        transitionalDiscipline: {
          status: "VERIFIED_PRESENT",
          provision: source("new-law", "art. 20"),
          effectiveFrom: EFFECTIVE_FROM,
          effect: "EXCLUDES_PENDING_PROCEEDINGS",
          determiningFactRole: "PROCEEDING_STARTED",
          previousRegimeProvision: null,
          exceptions: [],
          interpretationRationale: "La disposizione esclude i procedimenti pendenti.",
        },
      }));

      expect(assessment.transitionalCheck.outcome).toBe("SATISFIED");
    });

    it.each([
      ["uncertain completion date", [
        fact("start", "PROCEEDING_STARTED", "2025-02-15"),
        fact("completion", "PROCEEDING_STATUS", null, { value: "COMPLETED", certainty: "UNCERTAIN" }),
      ], "PENDING_PROCEEDING_STATUS_UNKNOWN_AT_EFFECTIVE_DATE"],
      ["contradictory historical status", [
        fact("start", "PROCEEDING_STARTED", "2025-02-15"),
        fact("completion", "PROCEEDING_STATUS", "2025-12-10", { value: "COMPLETED" }),
        fact("pending", "PROCEEDING_STATUS", "2026-01-10", { value: "PENDING" }),
      ], "PENDING_PROCEEDING_STATUS_CONTRADICTORY"],
    ] as const)("returns TO_VERIFY for %s", (_name, historicalFacts, reasonCode) => {
      const assessment = assessLegalApplicability(input({
        facts: [
          ...facts().filter((item) => item.role !== "PROCEEDING_STARTED" && item.role !== "PROCEEDING_STATUS"),
          ...historicalFacts,
        ],
        transitionalDiscipline: {
          status: "VERIFIED_PRESENT",
          provision: source("new-law", "art. 20"),
          effectiveFrom: EFFECTIVE_FROM,
          effect: "EXCLUDES_PENDING_PROCEEDINGS",
          determiningFactRole: "PROCEEDING_STARTED",
          previousRegimeProvision: null,
          exceptions: [],
          interpretationRationale: "La disposizione esclude i procedimenti pendenti.",
        },
      }));
      expect(assessment.transitionalCheck).toMatchObject({ outcome: "TO_VERIFY", reasonCodes: [reasonCode] });
    });

    it.each([
      ["UNKNOWN at effectiveness", [
        fact("completion", "PROCEEDING_STATUS", "2025-12-10", { value: "COMPLETED" }),
        fact("unknown", "PROCEEDING_STATUS", "2026-01-01", { value: "UNKNOWN" }),
      ]],
      ["dated UNKNOWN before effectiveness after the last known completion", [
        fact("completion", "PROCEEDING_STATUS", "2025-11-10", { value: "COMPLETED" }),
        fact("unknown", "PROCEEDING_STATUS", "2025-12-15", { value: "UNKNOWN" }),
      ]],
      ["undated UNKNOWN", [
        fact("completion", "PROCEEDING_STATUS", "2025-12-10", { value: "COMPLETED" }),
        fact("unknown", "PROCEEDING_STATUS", null, { value: "UNKNOWN" }),
      ]],
    ] as const)("returns TO_VERIFY for %s", (_name, statusFacts) => {
      const assessment = assessLegalApplicability(input({
        facts: [
          ...facts().filter((item) => item.role !== "PROCEEDING_STATUS"),
          ...statusFacts,
        ],
        transitionalDiscipline: {
          status: "VERIFIED_PRESENT",
          provision: source("new-law", "art. 20"),
          effectiveFrom: EFFECTIVE_FROM,
          effect: "EXCLUDES_PENDING_PROCEEDINGS",
          determiningFactRole: "PROCEEDING_STARTED",
          previousRegimeProvision: null,
          exceptions: [],
          interpretationRationale: "La disposizione esclude i procedimenti pendenti.",
        },
      }));
      expect(assessment.transitionalCheck).toMatchObject({
        outcome: "TO_VERIFY",
        reasonCodes: ["PENDING_PROCEEDING_STATUS_UNKNOWN_AT_EFFECTIVE_DATE"],
      });
    });

    it.each([
      ["UNKNOWN after effectiveness is not decisive", [
        fact("completion", "PROCEEDING_STATUS", "2025-12-10", { value: "COMPLETED" }),
        fact("unknown", "PROCEEDING_STATUS", "2026-02-15", { value: "UNKNOWN" }),
      ], "SATISFIED"],
      ["later documented completion resolves an earlier UNKNOWN", [
        fact("unknown", "PROCEEDING_STATUS", "2025-11-10", { value: "UNKNOWN" }),
        fact("completion", "PROCEEDING_STATUS", "2025-12-10", { value: "COMPLETED" }),
      ], "SATISFIED"],
      ["completion after effectiveness resolves UNKNOWN as historically pending", [
        fact("unknown", "PROCEEDING_STATUS", "2026-01-01", { value: "UNKNOWN" }),
        fact("completion", "PROCEEDING_STATUS", "2026-02-10", { value: "COMPLETED" }),
      ], "NOT_SATISFIED"],
    ] as const)("uses resolving evidence when %s", (_name, statusFacts, outcome) => {
      const assessment = assessLegalApplicability(input({
        facts: [
          ...facts().filter((item) => item.role !== "PROCEEDING_STATUS"),
          ...statusFacts,
        ],
        transitionalDiscipline: {
          status: "VERIFIED_PRESENT",
          provision: source("new-law", "art. 20"),
          effectiveFrom: EFFECTIVE_FROM,
          effect: "EXCLUDES_PENDING_PROCEEDINGS",
          determiningFactRole: "PROCEEDING_STARTED",
          previousRegimeProvision: null,
          exceptions: [],
          interpretationRationale: "La disposizione esclude i procedimenti pendenti.",
        },
      }));
      expect(assessment.transitionalCheck.outcome).toBe(outcome);
    });

    it("requires a fully verified and applicable competing special provision", () => {
      const verifiedDimensions = {
        outcome: "SATISFIED" as const,
        rationale: "Pertinenza verificata.",
        decisiveFactClaimIds: [],
      };
      const verified = assessLegalApplicability(input({
        normRelationship: {
          outcome: "CANDIDATE_DISPLACED_BY_SPECIAL_RULE",
          rationale: "La norma speciale prevale nella fattispecie verificata.",
          competingProvision: source("special-law", "art. 4"),
          competingTerritorialApplicability: verifiedDimensions,
          competingMaterialApplicability: verifiedDimensions,
        },
      }));
      expect(verified.specialityCheck.outcome).toBe("NOT_SATISFIED");

      const unverified = assessLegalApplicability(input({
        normRelationship: {
          outcome: "CANDIDATE_DISPLACED_BY_SPECIAL_RULE",
          rationale: "La norma speciale potrebbe prevalere.",
          competingProvision: {
            ...source("special-law", "art. 4"),
            sourceAssessment: {
              ...source("special-law", "art. 4").sourceAssessment,
              officiality: "NON_OFFICIAL",
            },
          },
          competingTerritorialApplicability: verifiedDimensions,
          competingMaterialApplicability: verifiedDimensions,
        },
      }));
      expect(unverified.specialityCheck).toMatchObject({
        outcome: "TO_VERIFY",
        reasonCodes: expect.arrayContaining(["COMPETING_SPECIAL_PROVISION_NOT_VERIFIED", "OFFICIAL_SOURCE_REQUIRED"]),
      });
    });

    it.each([
      ["incomplete source", { textState: "PARTIAL_TEXT" as const, temporalState: "APPLICABLE" as const }],
      ["not effective source", { textState: "FULL_TEXT" as const, temporalState: "NOT_APPLICABLE" as const }],
    ])("requires review for a %s used as a competing special provision", (_name, sourceState) => {
      const competing = source("special-law", "art. 4");
      const dimensions = {
        outcome: "SATISFIED" as const,
        rationale: "Pertinenza verificata.",
        decisiveFactClaimIds: [],
      };
      const assessment = assessLegalApplicability(input({
        normRelationship: {
          outcome: "CANDIDATE_DISPLACED_BY_SPECIAL_RULE",
          rationale: "La norma speciale potrebbe prevalere.",
          competingProvision: {
            ...competing,
            sourceAssessment: { ...competing.sourceAssessment, ...sourceState },
          },
          competingTerritorialApplicability: dimensions,
          competingMaterialApplicability: dimensions,
        },
      }));
      expect(assessment.specialityCheck.outcome).toBe("TO_VERIFY");
    });

    it("requires review when territorial, material, or speciality relevance is unresolved", () => {
      const assessment = assessLegalApplicability(input({
        normRelationship: {
          outcome: "CANDIDATE_DISPLACED_BY_SPECIAL_RULE",
          rationale: "Il rapporto di specialita e controverso.",
          competingProvision: source("special-law", "art. 4"),
          competingTerritorialApplicability: {
            outcome: "NOT_SATISFIED",
            rationale: "Territorio non pertinente.",
            decisiveFactClaimIds: [],
          },
          competingMaterialApplicability: {
            outcome: "TO_VERIFY",
            rationale: "Materia da verificare.",
            decisiveFactClaimIds: [],
          },
        },
      }));
      expect(assessment.specialityCheck).toMatchObject({
        outcome: "TO_VERIFY",
        reasonCodes: expect.arrayContaining([
          "COMPETING_SPECIAL_PROVISION_TERRITORIAL_SCOPE_UNVERIFIED",
          "COMPETING_SPECIAL_PROVISION_MATERIAL_SCOPE_UNVERIFIED",
        ]),
      });
  });

  it("H. never gives automatic retroactive effect to later case law", () => {
    const assessment = assessLegalApplicability(input({
      legalAuthorityKind: "CASE_LAW",
      chronologicalAssessment: temporal("CASE_LAW"),
    }));

    expect(assessment.chronologicalCheck.outcome).toBe("TO_VERIFY");
    expect(assessment.transitionalCheck).toMatchObject({
      outcome: "TO_VERIFY",
      reasonCodes: ["LATER_CASE_LAW_NO_AUTOMATIC_RETROACTIVITY"],
    });
    expect(assessment.conclusion.outcome).toBe("TO_VERIFY");
  });

  it("I. rejects a currently effective source that does not govern the concession type", () => {
    const dimensions = applicabilityDimensionsFromRuleOrchestrator({
      source: {
        id: "new-law",
        stableKey: "NEW-LAW",
        title: "Legge vigente",
        documentType: "LEGGE",
        legalRank: "NATIONAL",
        territorialScope: "NATIONAL",
        sourceNumber: "1",
        sourceDate: "2026-01-01T00:00:00.000Z",
        issuingBody: "Stato",
        status: "CURRENT",
        role: "NORMATIVE",
        confidence: "HIGH",
        humanReviewRequired: true,
        isConformative: true,
        isExtractable: true,
        relativePath: null,
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
        applicable: true,
        exclusionReasons: [],
      },
      ruleMatched: false,
      decisiveFactClaimIds: ["fact-conduct-2026"],
    });
    const assessment = assessLegalApplicability(input({
      ...dimensions,
    }));

    expect(assessment.chronologicalCheck.outcome).toBe("SATISFIED");
    expect(assessment.materialCheck).toMatchObject({
      outcome: "NOT_SATISFIED",
      reasonCodes: ["MATERIAL_SCOPE_MISMATCH"],
    });
    expect(assessment.conclusion.outcome).toBe("NOT_APPLICABLE");
  });

  it("fails closed when official source verification is incomplete", () => {
    const unverified = source();
    const assessment = assessLegalApplicability(input({
      candidateProvision: {
        ...unverified,
        sourceAssessment: {
          ...unverified.sourceAssessment,
          contentState: "INCOMPLETE",
        },
      },
    }));

    expect(assessment.sourceVerificationCheck.outcome).toBe("TO_VERIFY");
    expect(assessment.conclusion.outcome).toBe("TO_VERIFY");
  });

  it("does not infer absence of transitional provisions from a verified source alone", () => {
    const discipline = noTransitionalProvision();
    if (discipline.status !== "VERIFIED_ABSENT") throw new Error("Expected verified absence.");
    const assessment = assessLegalApplicability(input({
      transitionalDiscipline: {
        ...discipline,
        absenceAttestation: {
          ...discipline.absenceAttestation,
          sourceContentSha256: "b".repeat(64),
        },
      },
    }));

    expect(assessment.transitionalCheck.outcome).toBe("TO_VERIFY");
    expect(assessment.transitionalCheck.reasonCodes).toContain("TRANSITIONAL_ABSENCE_NOT_ESTABLISHED");
    expect(assessment.conclusion.outcome).toBe("TO_VERIFY");
  });

  it("is deterministic and can be attached to the matching proposition-graph application", () => {
    const assessment = assessLegalApplicability(input());
    expect(assessLegalApplicability(input()).assessmentFingerprint)
      .toBe(assessment.assessmentFingerprint);

    const graph: LegalPropositionGraph = {
      graphVersion: LEGAL_PROPOSITION_GRAPH_VERSION,
      factClaims: assessment.decisiveFacts.map((item) => ({
        kind: "FACT_CLAIM",
        id: item.factClaimId,
        statement: item.statement,
        status: item.certainty === "CERTAIN" ? "SUPPORTED" : "UNRESOLVED",
        ...(item.occurrenceDate ? { occurrenceDate: item.occurrenceDate } : {}),
      })),
      evidenceLinks: [],
      legalIssues: [{
        kind: "LEGAL_ISSUE",
        id: "issue-1",
        question: "Quale disciplina si applica?",
        factClaimIds: assessment.decisiveFacts.map((item) => item.factClaimId),
        legalPropositionIds: ["proposition-1"],
      }],
      legalPropositions: [{
        kind: "LEGAL_PROPOSITION",
        id: "proposition-1",
        statement: "La disciplina speciale si applica se tutti i livelli sono soddisfatti.",
      }],
      authorityRelations: [],
      applications: [{
        kind: "APPLICATION",
        id: "application-1",
        statement: assessment.conclusion.rationale,
        factClaimIds: assessment.decisiveFacts.map((item) => item.factClaimId),
        legalPropositionIds: ["proposition-1"],
        applicabilityAssessment: assessment,
      }],
      counterArguments: [],
      conclusions: [],
      sourceSufficiencies: [],
    };

    expect(validateLegalPropositionGraph(graph)).toEqual([]);
    expect(validateLegalPropositionGraph({
      ...graph,
      applications: [{
        ...graph.applications[0],
        id: "different-application",
      }],
    }).map((error) => error.code)).toContain("APPLICATION_ASSESSMENT_ID_MISMATCH");
  });

  it("keeps A unresolved when only proceeding B has a documented pending status", () => {
    const assessment = assessLegalApplicability(input({
      facts: [
        fact("application-a", "APPLICATION_SUBMITTED", "2024-05-10", {
          statement: "Istanza relativa al procedimento amministrativo A.",
        }),
        fact("start-a", "PROCEEDING_STARTED", "2025-02-15", {
          statement: "Il procedimento amministrativo A è stato avviato.",
        }),
        fact("pending-b", "PROCEEDING_STATUS", "2026-01-01", {
          statement: "Il procedimento amministrativo B è ancora pendente.",
          value: "PENDING",
          proceedingIdentity: proceedingIdentity("proceeding-b"),
        }),
        fact("appeal-a", "OTHER", "2026-01-10", {
          statement: "Il ricorso relativo al procedimento A è pendente.",
        }),
        fact("criminal-linked", "OTHER", "2026-01-15", {
          statement: "Il procedimento penale collegato è pendente.",
        }),
      ],
      materialApplicability: {
        outcome: "SATISFIED",
        rationale: "La disposizione riguarda la materia esaminata.",
        decisiveFactClaimIds: ["application-a"],
      },
      factualApplicability: {
        outcome: "SATISFIED",
        rationale: "Tutti i fatti appartengono alla stessa questione giuridica.",
        decisiveFactClaimIds: ["application-a", "start-a", "pending-b", "appeal-a", "criminal-linked"],
      },
      transitionalDiscipline: {
        status: "VERIFIED_PRESENT",
        provision: source("new-law", "art. 20"),
        effectiveFrom: EFFECTIVE_FROM,
        effect: "EXCLUDES_PENDING_PROCEEDINGS",
        determiningFactRole: "PROCEEDING_STARTED",
        previousRegimeProvision: null,
        exceptions: [],
        interpretationRationale: "La disposizione esclude i procedimenti pendenti.",
      },
    }));

    expect(assessment.transitionalCheck.outcome).toBe("TO_VERIFY");
    expect(assessment.conclusion.outcome).toBe("TO_VERIFY");
  });

  it("does not equate identical declared keys supported by different proceeding evidence", () => {
    const assessment = assessLegalApplicability(input({
      targetProceedingIdentity: {
        ...proceedingIdentity("canonical-anchor-b"),
        evidenceLinkIds: ["document-b:1:target"],
      },
      facts: [
        ...facts().filter((item) => item.role !== "PROCEEDING_STARTED" && item.role !== "PROCEEDING_STATUS"),
        fact("start-a", "PROCEEDING_STARTED", "2025-02-15", {
          proceedingIdentity: {
            ...proceedingIdentity("canonical-anchor-a"),
            evidenceLinkIds: ["document-a:1:start"],
          },
        }),
        fact("pending-a", "PROCEEDING_STATUS", "2026-01-10", {
          value: "PENDING",
          proceedingIdentity: {
            ...proceedingIdentity("canonical-anchor-a"),
            evidenceLinkIds: ["document-a:1:status"],
          },
        }),
      ],
      transitionalDiscipline: {
        status: "VERIFIED_PRESENT",
        provision: source("new-law", "art. 20"),
        effectiveFrom: EFFECTIVE_FROM,
        effect: "EXCLUDES_PENDING_PROCEEDINGS",
        determiningFactRole: "PROCEEDING_STARTED",
        previousRegimeProvision: null,
        exceptions: [],
        interpretationRationale: "La disposizione esclude i procedimenti pendenti.",
      },
    }));
    expect(assessment.transitionalCheck.outcome).toBe("TO_VERIFY");
    expect(assessment.conclusion.outcome).toBe("TO_VERIFY");
  });

  it.each([
    ["missing target identity", {
      targetProceedingIdentity: null,
    }, "TARGET_PROCEEDING_IDENTITY_UNVERIFIED"],
    ["undocumented target identity", {
      targetProceedingIdentity: {
        ...proceedingIdentity("proceeding-a"),
        evidenceLinkIds: [],
      },
    }, "TARGET_PROCEEDING_IDENTITY_UNVERIFIED"],
    ["legacy facts without identity", {
      facts: facts().map((item) => (
        item.role === "PROCEEDING_STARTED" || item.role === "PROCEEDING_STATUS"
          ? { ...item, proceedingIdentity: null }
          : item
      )),
    }, "PROCEEDING_FACT_IDENTITY_UNVERIFIED"],
  ] as const)("returns TO_VERIFY for %s", (_name, overrides, reasonCode) => {
    const assessment = assessLegalApplicability(input({
      ...overrides,
      transitionalDiscipline: {
        status: "VERIFIED_PRESENT",
        provision: source("new-law", "art. 20"),
        effectiveFrom: EFFECTIVE_FROM,
        effect: "EXCLUDES_PENDING_PROCEEDINGS",
        determiningFactRole: "PROCEEDING_STARTED",
        previousRegimeProvision: null,
        exceptions: [],
        interpretationRationale: "La disposizione esclude i procedimenti pendenti.",
      },
    }));
    expect(assessment.transitionalCheck).toMatchObject({
      outcome: "TO_VERIFY",
      reasonCodes: [reasonCode],
    });
  });

  it("does not merge administrative, judicial, criminal or internal proceeding timelines", () => {
    const assessment = assessLegalApplicability(input({
      facts: [
        ...facts().filter((item) => item.role !== "PROCEEDING_STARTED" && item.role !== "PROCEEDING_STATUS"),
        fact("start-a", "PROCEEDING_STARTED", "2025-02-15"),
        fact("completion-a", "PROCEEDING_STATUS", "2025-12-10", { value: "COMPLETED" }),
        fact("pending-appeal", "PROCEEDING_STATUS", "2026-01-10", {
          value: "PENDING",
          proceedingIdentity: proceedingIdentity("appeal-a", "JUDICIAL_APPEAL"),
        }),
        fact("pending-criminal", "PROCEEDING_STATUS", "2026-01-15", {
          value: "PENDING",
          proceedingIdentity: proceedingIdentity("criminal-a", "CRIMINAL"),
        }),
        fact("pending-instruction", "PROCEEDING_STATUS", "2026-01-20", {
          value: "PENDING",
          proceedingIdentity: proceedingIdentity("instruction-a", "INTERNAL_INSTRUCTION"),
        }),
      ],
      transitionalDiscipline: {
        status: "VERIFIED_PRESENT",
        provision: source("new-law", "art. 20"),
        effectiveFrom: EFFECTIVE_FROM,
        effect: "EXCLUDES_PENDING_PROCEEDINGS",
        determiningFactRole: "PROCEEDING_STARTED",
        previousRegimeProvision: null,
        exceptions: [],
        interpretationRationale: "La disposizione esclude i procedimenti pendenti.",
      },
    }));
    expect(assessment.transitionalCheck).toMatchObject({
      outcome: "SATISFIED",
      reasonCodes: ["PENDING_PROCEEDING_EXCLUSION_NOT_TRIGGERED"],
    });
  });
});
