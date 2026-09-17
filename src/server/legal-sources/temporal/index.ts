export const TEMPORAL_ASSESSMENT_VERSION = "LEGAL_SOURCE_TEMPORAL_V1" as const;

export type TemporalLegalAuthorityKind =
  | "LEGISLATION"
  | "CASE_LAW"
  | "ADMINISTRATIVE_REGULATION"
  | "ADMINISTRATIVE_ACT"
  | "AUTHORITY_PRACTICE"
  | "OTHER_LEGAL_AUTHORITY";

export type TemporalLegalSourceStatus =
  | "IDENTITY_VERIFIED_PENDING_VALIDITY"
  | "PENDING_VALIDITY_CHECK"
  | "CURRENT"
  | "CURRENT_SUBJECT_TO_REVIEW"
  | "HISTORICAL"
  | "SUPERSEDED"
  | "PARTIALLY_SUPERSEDED"
  | "DRAFT_OR_ONGOING_PROCEDURE"
  | "CASE_SPECIFIC";

export type TemporalJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly TemporalJsonValue[]
  | { readonly [key: string]: TemporalJsonValue };

export type TemporalAssessmentInput = Readonly<{
  sourceFamilyId: string;
  legalAuthorityKind: TemporalLegalAuthorityKind;
  sourceStatus: TemporalLegalSourceStatus;
  expression: Readonly<{
    expressionId: string;
    publicationDate: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    expressionStatus: string | null;
    correctionMetadata: TemporalJsonValue;
    consolidationMetadata: TemporalJsonValue;
  }>;
  referenceDate: string;
  temporalEvidence?: Readonly<{
    temporalMetadataConflict?: boolean;
    partialSupersessionResolved?: boolean;
  }>;
}>;

export type TemporalValidityState =
  | "VALID"
  | "NOT_YET_EFFECTIVE"
  | "EXPIRED"
  | "SUPERSEDED"
  | "PARTIALLY_SUPERSEDED"
  | "DRAFT"
  | "CASE_SPECIFIC"
  | "TEMPORAL_DATA_INCOMPLETE"
  | "CONFLICTED"
  | "INDETERMINATE";

export type TemporalWindowState =
  | "SATISFIED"
  | "BEFORE_EFFECTIVE_FROM"
  | "AFTER_EFFECTIVE_TO"
  | "INCOMPLETE"
  | "CONFLICTED";

export type TemporalApplicabilityState =
  | "APPLICABLE_ON_DATE"
  | "NOT_APPLICABLE_ON_DATE"
  | "INDETERMINATE"
  | "REQUIRES_HUMAN_REVIEW";

export type TemporalReasonCode =
  | "EFFECTIVE_INTERVAL_MATCH"
  | "BEFORE_EFFECTIVE_FROM"
  | "AFTER_EFFECTIVE_TO"
  | "MISSING_EFFECTIVE_FROM"
  | "MISSING_TEMPORAL_INTERVAL"
  | "SOURCE_VALIDITY_PENDING"
  | "SOURCE_MARKED_HISTORICAL"
  | "SOURCE_MARKED_SUPERSEDED"
  | "SOURCE_PARTIALLY_SUPERSEDED"
  | "PARTIAL_SUPERSESSION_RESOLVED"
  | "DRAFT_SOURCE"
  | "CASE_SPECIFIC_SOURCE"
  | "CASE_LAW_CHRONOLOGICAL_AVAILABILITY_ONLY"
  | "TEMPORAL_METADATA_CONFLICT"
  | "HUMAN_LEGAL_ASSESSMENT_REQUIRED";

export type TemporalAssessmentResult = Readonly<{
  assessmentVersion: typeof TEMPORAL_ASSESSMENT_VERSION;
  validityState: TemporalValidityState;
  temporalWindowState: TemporalWindowState;
  applicabilityState: TemporalApplicabilityState;
  reasonCodes: readonly TemporalReasonCode[];
  referenceDate: string;
  effectiveInterval: Readonly<{
    from: string | null;
    to: string | null;
  }>;
  humanReviewRequired: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}>;

type ParsedTemporalInput = Readonly<{
  referenceDate: Date;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}>;

function parseInstant(value: string | null): Date | null {
  if (value === null) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTemporalInput(input: TemporalAssessmentInput): ParsedTemporalInput | null {
  const referenceDate = parseInstant(input.referenceDate);
  const effectiveFrom = parseInstant(input.expression.effectiveFrom);
  const effectiveTo = parseInstant(input.expression.effectiveTo);
  const hasInvalidValue =
    referenceDate === null
    || (input.expression.effectiveFrom !== null && effectiveFrom === null)
    || (input.expression.effectiveTo !== null && effectiveTo === null);

  return hasInvalidValue ? null : { referenceDate, effectiveFrom, effectiveTo };
}

function result(
  input: TemporalAssessmentInput,
  validityState: TemporalValidityState,
  temporalWindowState: TemporalWindowState,
  applicabilityState: TemporalApplicabilityState,
  reasonCodes: readonly TemporalReasonCode[],
  humanReviewRequired: boolean,
  confidence: TemporalAssessmentResult["confidence"],
): TemporalAssessmentResult {
  return {
    assessmentVersion: TEMPORAL_ASSESSMENT_VERSION,
    validityState,
    temporalWindowState,
    applicabilityState,
    reasonCodes,
    referenceDate: input.referenceDate,
    effectiveInterval: {
      from: input.expression.effectiveFrom,
      to: input.expression.effectiveTo,
    },
    humanReviewRequired,
    confidence,
  };
}

export function assessLegalSourceTemporalApplicability(
  input: TemporalAssessmentInput,
): TemporalAssessmentResult {
  const parsed = parseTemporalInput(input);
  if (
    parsed === null
    || input.temporalEvidence?.temporalMetadataConflict === true
    || (parsed.effectiveFrom !== null
      && parsed.effectiveTo !== null
      && parsed.effectiveFrom > parsed.effectiveTo)
  ) {
    return result(
      input,
      "CONFLICTED",
      "CONFLICTED",
      "REQUIRES_HUMAN_REVIEW",
      ["TEMPORAL_METADATA_CONFLICT", "HUMAN_LEGAL_ASSESSMENT_REQUIRED"],
      true,
      "LOW",
    );
  }

  if (input.sourceStatus === "DRAFT_OR_ONGOING_PROCEDURE") {
    return result(input, "DRAFT", "INCOMPLETE", "NOT_APPLICABLE_ON_DATE", ["DRAFT_SOURCE"], false, "HIGH");
  }

  if (parsed.effectiveFrom === null) {
    const reasonCodes: TemporalReasonCode[] = ["MISSING_EFFECTIVE_FROM"];
    if (parsed.effectiveTo === null) {
      reasonCodes.push("MISSING_TEMPORAL_INTERVAL");
    }
    if (input.legalAuthorityKind === "CASE_LAW") {
      reasonCodes.push("CASE_LAW_CHRONOLOGICAL_AVAILABILITY_ONLY");
    }
    reasonCodes.push("HUMAN_LEGAL_ASSESSMENT_REQUIRED");
    return result(
      input,
      "TEMPORAL_DATA_INCOMPLETE",
      "INCOMPLETE",
      "INDETERMINATE",
      reasonCodes,
      true,
      "LOW",
    );
  }

  if (parsed.referenceDate < parsed.effectiveFrom) {
    return result(
      input,
      "NOT_YET_EFFECTIVE",
      "BEFORE_EFFECTIVE_FROM",
      "NOT_APPLICABLE_ON_DATE",
      ["BEFORE_EFFECTIVE_FROM"],
      false,
      "HIGH",
    );
  }

  if (parsed.effectiveTo !== null && parsed.referenceDate > parsed.effectiveTo) {
    return result(
      input,
      "EXPIRED",
      "AFTER_EFFECTIVE_TO",
      "NOT_APPLICABLE_ON_DATE",
      ["AFTER_EFFECTIVE_TO"],
      false,
      "HIGH",
    );
  }

  const matchedReasons: TemporalReasonCode[] = ["EFFECTIVE_INTERVAL_MATCH"];
  if (input.legalAuthorityKind === "CASE_LAW") {
    matchedReasons.push(
      "CASE_LAW_CHRONOLOGICAL_AVAILABILITY_ONLY",
      "HUMAN_LEGAL_ASSESSMENT_REQUIRED",
    );
    return result(input, "VALID", "SATISFIED", "REQUIRES_HUMAN_REVIEW", matchedReasons, true, "MEDIUM");
  }

  if (input.sourceStatus === "PARTIALLY_SUPERSEDED") {
    matchedReasons.push("SOURCE_PARTIALLY_SUPERSEDED");
    if (input.temporalEvidence?.partialSupersessionResolved !== true) {
      matchedReasons.push("HUMAN_LEGAL_ASSESSMENT_REQUIRED");
      return result(
        input,
        "PARTIALLY_SUPERSEDED",
        "SATISFIED",
        "REQUIRES_HUMAN_REVIEW",
        matchedReasons,
        true,
        "LOW",
      );
    }
    matchedReasons.push("PARTIAL_SUPERSESSION_RESOLVED");
  }

  if (input.sourceStatus === "SUPERSEDED") {
    matchedReasons.push("SOURCE_MARKED_SUPERSEDED", "HUMAN_LEGAL_ASSESSMENT_REQUIRED");
    return result(input, "SUPERSEDED", "SATISFIED", "REQUIRES_HUMAN_REVIEW", matchedReasons, true, "LOW");
  }

  if (input.sourceStatus === "CASE_SPECIFIC") {
    matchedReasons.push("CASE_SPECIFIC_SOURCE", "HUMAN_LEGAL_ASSESSMENT_REQUIRED");
    return result(input, "CASE_SPECIFIC", "SATISFIED", "REQUIRES_HUMAN_REVIEW", matchedReasons, true, "LOW");
  }

  if (
    input.sourceStatus === "IDENTITY_VERIFIED_PENDING_VALIDITY"
    || input.sourceStatus === "PENDING_VALIDITY_CHECK"
  ) {
    matchedReasons.push("SOURCE_VALIDITY_PENDING", "HUMAN_LEGAL_ASSESSMENT_REQUIRED");
    return result(input, "INDETERMINATE", "SATISFIED", "INDETERMINATE", matchedReasons, true, "LOW");
  }

  if (input.sourceStatus === "HISTORICAL") {
    matchedReasons.push("SOURCE_MARKED_HISTORICAL", "HUMAN_LEGAL_ASSESSMENT_REQUIRED");
    return result(input, "INDETERMINATE", "SATISFIED", "REQUIRES_HUMAN_REVIEW", matchedReasons, true, "LOW");
  }

  matchedReasons.push("HUMAN_LEGAL_ASSESSMENT_REQUIRED");
  return result(input, "VALID", "SATISFIED", "REQUIRES_HUMAN_REVIEW", matchedReasons, true, "MEDIUM");
}