import { describe, expect, it, vi } from "vitest";

import {
  assessLegalSourceTemporalApplicability,
  type TemporalAssessmentInput,
} from "@/server/legal-sources/temporal";

function input(overrides: Partial<TemporalAssessmentInput> = {}): TemporalAssessmentInput {
  return {
    sourceFamilyId: "source-1",
    legalAuthorityKind: "LEGISLATION",
    sourceStatus: "CURRENT",
    expression: {
      expressionId: "expression-1",
      publicationDate: "2019-12-20T00:00:00.000Z",
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveTo: "2020-12-31T23:59:59.999Z",
      expressionStatus: "CURRENT",
      correctionMetadata: null,
      consolidationMetadata: null,
    },
    referenceDate: "2020-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function expression(
  overrides: Partial<TemporalAssessmentInput["expression"]>,
): TemporalAssessmentInput["expression"] {
  return { ...input().expression, ...overrides };
}

describe("Block 3B.9A legal-source temporal core", () => {
  it.each([
    ["exact effectiveFrom", "2020-01-01T00:00:00.000Z"],
    ["exact effectiveTo", "2020-12-31T23:59:59.999Z"],
  ])("treats the %s boundary as inside the interval", (_label, referenceDate) => {
    expect(assessLegalSourceTemporalApplicability(input({ referenceDate }))).toMatchObject({
      validityState: "VALID",
      temporalWindowState: "SATISFIED",
      applicabilityState: "REQUIRES_HUMAN_REVIEW",
      reasonCodes: expect.arrayContaining(["EFFECTIVE_INTERVAL_MATCH"]),
    });
  });

  it.each([
    ["before", "2019-12-31T23:59:59.999Z", "NOT_YET_EFFECTIVE", "BEFORE_EFFECTIVE_FROM"],
    ["after", "2021-01-01T00:00:00.000Z", "EXPIRED", "AFTER_EFFECTIVE_TO"],
  ] as const)("returns a deterministic negative %s the interval", (_label, referenceDate, validityState, reasonCode) => {
    expect(assessLegalSourceTemporalApplicability(input({ referenceDate }))).toMatchObject({
      validityState,
      applicabilityState: "NOT_APPLICABLE_ON_DATE",
      humanReviewRequired: false,
      reasonCodes: [reasonCode],
    });
  });

  it("supports an open-ended effectiveTo", () => {
    const assessment = assessLegalSourceTemporalApplicability(input({
      expression: expression({ effectiveTo: null }),
      referenceDate: "2099-01-01T00:00:00.000Z",
    }));
    expect(assessment.temporalWindowState).toBe("SATISFIED");
    expect(assessment.effectiveInterval.to).toBeNull();
  });

  it.each([
    ["CURRENT", "VALID", "REQUIRES_HUMAN_REVIEW"],
    ["CURRENT_SUBJECT_TO_REVIEW", "VALID", "REQUIRES_HUMAN_REVIEW"],
    ["IDENTITY_VERIFIED_PENDING_VALIDITY", "INDETERMINATE", "INDETERMINATE"],
    ["PENDING_VALIDITY_CHECK", "INDETERMINATE", "INDETERMINATE"],
    ["HISTORICAL", "INDETERMINATE", "REQUIRES_HUMAN_REVIEW"],
    ["SUPERSEDED", "SUPERSEDED", "REQUIRES_HUMAN_REVIEW"],
    ["CASE_SPECIFIC", "CASE_SPECIFIC", "REQUIRES_HUMAN_REVIEW"],
  ] as const)("handles %s conservatively", (sourceStatus, validityState, applicabilityState) => {
    expect(assessLegalSourceTemporalApplicability(input({ sourceStatus }))).toMatchObject({
      validityState,
      applicabilityState,
    });
  });

  it("treats draft material as unavailable on the date", () => {
    expect(assessLegalSourceTemporalApplicability(input({
      sourceStatus: "DRAFT_OR_ONGOING_PROCEDURE",
    }))).toMatchObject({
      validityState: "DRAFT",
      applicabilityState: "NOT_APPLICABLE_ON_DATE",
      reasonCodes: ["DRAFT_SOURCE"],
    });
  });

  it("never turns partial supersession into an automatic negative conclusion", () => {
    expect(assessLegalSourceTemporalApplicability(input({
      sourceStatus: "PARTIALLY_SUPERSEDED",
    }))).toMatchObject({
      validityState: "PARTIALLY_SUPERSEDED",
      applicabilityState: "REQUIRES_HUMAN_REVIEW",
      humanReviewRequired: true,
      reasonCodes: expect.arrayContaining(["SOURCE_PARTIALLY_SUPERSEDED"]),
    });
  });

  it("accepts an explicit structured resolution without claiming substantive applicability", () => {
    expect(assessLegalSourceTemporalApplicability(input({
      sourceStatus: "PARTIALLY_SUPERSEDED",
      temporalEvidence: { partialSupersessionResolved: true },
    }))).toMatchObject({
      validityState: "VALID",
      applicabilityState: "REQUIRES_HUMAN_REVIEW",
      reasonCodes: expect.arrayContaining(["PARTIAL_SUPERSESSION_RESOLVED"]),
    });
  });

  it.each([
    ["both dates missing", null, null, ["MISSING_EFFECTIVE_FROM", "MISSING_TEMPORAL_INTERVAL"]],
    ["publication does not replace effectiveFrom", null, "2025-01-01T00:00:00.000Z", ["MISSING_EFFECTIVE_FROM"]],
  ])("fails closed when %s", (_label, effectiveFrom, effectiveTo, reasonCodes) => {
    expect(assessLegalSourceTemporalApplicability(input({
      expression: expression({ effectiveFrom, effectiveTo, publicationDate: "2010-01-01T00:00:00.000Z" }),
    }))).toMatchObject({
      validityState: "TEMPORAL_DATA_INCOMPLETE",
      temporalWindowState: "INCOMPLETE",
      applicabilityState: "INDETERMINATE",
      humanReviewRequired: true,
      reasonCodes: expect.arrayContaining(reasonCodes),
    });
  });

  it.each([
    ["an explicit conflict", input({ temporalEvidence: { temporalMetadataConflict: true } })],
    ["an inverted interval", input({ expression: expression({ effectiveFrom: "2021-01-01T00:00:00Z" }) })],
    ["an invalid reference date", input({ referenceDate: "not-a-date" })],
  ])("fails closed for %s", (_label, snapshot) => {
    expect(assessLegalSourceTemporalApplicability(snapshot)).toMatchObject({
      validityState: "CONFLICTED",
      temporalWindowState: "CONFLICTED",
      applicabilityState: "REQUIRES_HUMAN_REVIEW",
      reasonCodes: expect.arrayContaining(["TEMPORAL_METADATA_CONFLICT"]),
    });
  });

  it("keeps case-law applicability for later authority reasoning", () => {
    expect(assessLegalSourceTemporalApplicability(input({
      legalAuthorityKind: "CASE_LAW",
      expression: expression({ publicationDate: "2020-01-02T00:00:00Z" }),
    }))).toMatchObject({
      temporalWindowState: "SATISFIED",
      applicabilityState: "REQUIRES_HUMAN_REVIEW",
      reasonCodes: expect.arrayContaining(["CASE_LAW_CHRONOLOGICAL_AVAILABILITY_ONLY"]),
    });
  });

  it("normalizes timezone offsets to the same instant at a boundary", () => {
    const assessment = assessLegalSourceTemporalApplicability(input({
      expression: expression({ effectiveFrom: "2020-01-01T01:00:00+01:00" }),
      referenceDate: "2019-12-31T19:00:00-05:00",
    }));
    expect(assessment.temporalWindowState).toBe("SATISFIED");
  });

  it("does not read the current system time", () => {
    const now = vi.spyOn(Date, "now");
    assessLegalSourceTemporalApplicability(input());
    expect(now).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it("has no artifact acquisition date in its bounded input or output", () => {
    const assessment = assessLegalSourceTemporalApplicability(input());
    expect(assessment).not.toHaveProperty("acquisitionDate");
    expect(input()).not.toHaveProperty("acquisitionDate");
  });
});