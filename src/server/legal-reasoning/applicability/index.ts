import { createHash } from "node:crypto";

import type { EvaluatedSourceResult } from "@/server/legal-rules/types";
import type { TemporalAssessmentResult, TemporalLegalAuthorityKind } from "@/server/legal-sources/temporal";
import {
  evaluateUsableSourceGate,
  type CitationAnchor,
  type SourceChainSnapshot,
} from "@/server/legal-research/source-chain";

export const LEGAL_APPLICABILITY_ASSESSMENT_VERSION = "LEGAL_APPLICABILITY_V1" as const;

export type LegalApplicabilityOutcome = "APPLICABLE" | "NOT_APPLICABLE" | "TO_VERIFY";
export type ApplicabilityCheckOutcome = "SATISFIED" | "NOT_SATISFIED" | "TO_VERIFY";

export type ApplicabilityFactRole =
  | "APPLICATION_SUBMITTED"
  | "PROCEEDING_STARTED"
  | "PROCEEDING_STATUS"
  | "LEGAL_RELATIONSHIP_ESTABLISHED"
  | "RELEVANT_CONDUCT"
  | "CHALLENGED_ACT_ADOPTED"
  | "DECISION_ADOPTED"
  | "OTHER";

export type ProceedingKind =
  | "ADMINISTRATIVE_ORIGINAL"
  | "ADMINISTRATIVE_OTHER"
  | "JUDICIAL_REVIEW"
  | "JUDICIAL_APPEAL"
  | "CRIMINAL"
  | "INTERNAL_INSTRUCTION"
  | "INCIDENTAL"
  | "UNKNOWN";

export type ProceedingIdentityReference = Readonly<{
  canonicalAnchorSemanticKey: string;
  kind: ProceedingKind;
  verification: "DOCUMENTED";
  evidenceLinkIds: readonly string[];
}>;

export type ApplicabilityFactReference = Readonly<{
  factClaimId: string;
  role: ApplicabilityFactRole;
  statement: string;
  occurrenceDate: string | null;
  certainty: "CERTAIN" | "UNCERTAIN";
  value?: "PENDING" | "COMPLETED" | "UNKNOWN";
  evidenceLinkIds: readonly string[];
  proceedingIdentity?: ProceedingIdentityReference | null;
}>;

export type VerifiedProvisionReference = Readonly<{
  legalSourceId: string;
  legalExpressionVersionId: string;
  provisionReference: string;
  sourceAssessment: SourceChainSnapshot;
  citationAnchors: readonly CitationAnchor[];
  provenance: Readonly<{
    providerId: string | null;
    canonicalEvidenceId: string | null;
    sourceUrl: string | null;
  }>;
}>;

export type ApplicabilityDimensionInput = Readonly<{
  outcome: ApplicabilityCheckOutcome;
  rationale: string;
  decisiveFactClaimIds: readonly string[];
}>;

export function applicabilityDimensionsFromRuleOrchestrator(input: {
  source: EvaluatedSourceResult;
  ruleMatched: boolean;
  decisiveFactClaimIds: readonly string[];
}): Readonly<{
  territorialApplicability: ApplicabilityDimensionInput;
  materialApplicability: ApplicabilityDimensionInput;
}> {
  const territorialReasons = input.source.exclusionReasons.filter((reason) =>
    reason === "AUTHORITY_MISMATCH"
    || reason === "PORT_MISMATCH"
    || reason === "PORT_AREA_MISMATCH");
  const territorialApplicability: ApplicabilityDimensionInput = territorialReasons.length > 0
    ? {
        outcome: "NOT_SATISFIED",
        rationale: `Il rule orchestrator ha escluso la fonte per territorio: ${territorialReasons.join(", ")}.`,
        decisiveFactClaimIds: [],
      }
    : {
        outcome: "SATISFIED",
        rationale: "Il rule orchestrator non ha rilevato esclusioni territoriali.",
        decisiveFactClaimIds: [],
      };
  const materialMismatch = input.source.exclusionReasons.includes("NOT_CONFORMATIVE_SUPPORT")
    || !input.ruleMatched;
  const materialApplicability: ApplicabilityDimensionInput = materialMismatch
    ? {
        outcome: "NOT_SATISFIED",
        rationale: input.source.exclusionReasons.includes("NOT_CONFORMATIVE_SUPPORT")
          ? "Il rule orchestrator ha classificato la fonte come non conformativa."
          : "Nessuna regola della fonte soddisfa i matcher materiali del caso.",
        decisiveFactClaimIds: input.decisiveFactClaimIds,
      }
    : {
        outcome: "SATISFIED",
        rationale: "La fonte e una sua regola soddisfano i matcher materiali del caso.",
        decisiveFactClaimIds: input.decisiveFactClaimIds,
      };
  return { territorialApplicability, materialApplicability };
}

export type NormRelationshipInput = Readonly<{
  outcome:
    | "CANDIDATE_IS_SPECIAL"
    | "NO_SPECIALITY_CONFLICT"
    | "CANDIDATE_DISPLACED_BY_SPECIAL_RULE"
    | "UNRESOLVED";
  rationale: string;
  competingProvision: VerifiedProvisionReference | null;
  competingTerritorialApplicability?: ApplicabilityDimensionInput;
  competingMaterialApplicability?: ApplicabilityDimensionInput;
}>;

export type TransitionalException = Readonly<{
  id: string;
  description: string;
  match: "MATCHED" | "NOT_MATCHED" | "UNCERTAIN";
  effect: "APPLY_NEW_REGIME" | "PRESERVE_PREVIOUS_REGIME" | "REQUIRE_REVIEW";
  decisiveFactClaimIds: readonly string[];
}>;

export type TransitionalDiscipline =
  | Readonly<{
      status: "VERIFIED_PRESENT";
      provision: VerifiedProvisionReference;
      effectiveFrom: string;
      effect:
        | "EXCLUDES_PENDING_PROCEEDINGS"
        | "EXPRESSLY_RETROACTIVE"
        | "PRESERVES_PREVIOUS_REGIME"
        | "PROSPECTIVE_ONLY"
        | "REQUIRES_INTERPRETATION";
      determiningFactRole: ApplicabilityFactRole;
      previousRegimeProvision: VerifiedProvisionReference | null;
      exceptions: readonly TransitionalException[];
      interpretationRationale: string;
    }>
  | Readonly<{
      status: "VERIFIED_ABSENT";
      verificationSource: VerifiedProvisionReference;
      absenceAttestation: Readonly<{
        sourceContentSha256: string;
        reviewScope: "COMPLETE_OFFICIAL_TEXT";
        examinedProvisions: readonly string[];
        examinedAnnexes: readonly string[];
        linkedActsChecked: readonly string[];
        reviewedByActorId: string;
        reviewedAt: string;
        rationale: string;
      }>;
      rationale: string;
    }>
  | Readonly<{
      status: "UNAVAILABLE" | "AMBIGUOUS";
      expectedProvisionReference: string | null;
      rationale: string;
    }>;

export type LegalApplicabilityAssessmentInput = Readonly<{
  applicationId: string;
  legalAuthorityKind: TemporalLegalAuthorityKind;
  referenceDate: string;
  candidateProvision: VerifiedProvisionReference;
  chronologicalAssessment: TemporalAssessmentResult;
  territorialApplicability: ApplicabilityDimensionInput;
  materialApplicability: ApplicabilityDimensionInput;
  factualApplicability: ApplicabilityDimensionInput;
  normRelationship: NormRelationshipInput;
  facts: readonly ApplicabilityFactReference[];
  targetProceedingIdentity?: ProceedingIdentityReference | null;
  transitionalDiscipline: TransitionalDiscipline;
}>;

export type ApplicabilityCheck = Readonly<{
  outcome: ApplicabilityCheckOutcome;
  reasonCodes: readonly string[];
  rationale: string;
  decisiveFactClaimIds: readonly string[];
  sourceIds: readonly string[];
}>;

export type LegalApplicabilityAssessment = Readonly<{
  assessmentVersion: typeof LEGAL_APPLICABILITY_ASSESSMENT_VERSION;
  assessmentFingerprint: string;
  applicationId: string;
  referenceDate: string;
  chronologicalCheck: ApplicabilityCheck;
  sourceVerificationCheck: ApplicabilityCheck;
  territorialCheck: ApplicabilityCheck;
  materialCheck: ApplicabilityCheck;
  factualCheck: ApplicabilityCheck;
  specialityCheck: ApplicabilityCheck;
  transitionalCheck: ApplicabilityCheck;
  conclusion: Readonly<{
    outcome: LegalApplicabilityOutcome;
    reasonCodes: readonly string[];
    rationale: string;
    humanReviewRequired: true;
  }>;
  decisiveFacts: readonly ApplicabilityFactReference[];
  sourcesUsed: readonly VerifiedProvisionReference[];
}>;

export class LegalApplicabilityInputError extends Error {
  constructor(readonly code:
    | "INVALID_APPLICATION_ID"
    | "INVALID_REFERENCE_DATE"
    | "TEMPORAL_REFERENCE_DATE_MISMATCH"
    | "DUPLICATE_FACT_REFERENCE"
    | "UNKNOWN_DECISIVE_FACT"
    | "INVALID_FACT_DATE"
    | "INVALID_TRANSITION_EFFECTIVE_DATE"
    | "MISSING_PREVIOUS_REGIME_SOURCE") {
    super(code);
    this.name = "LegalApplicabilityInputError";
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function provisionIdentity(provision: VerifiedProvisionReference): string {
  return `${provision.legalSourceId}:${provision.legalExpressionVersionId}:${provision.provisionReference}`;
}

function check(
  outcome: ApplicabilityCheckOutcome,
  reasonCodes: readonly string[],
  rationale: string,
  decisiveFactClaimIds: readonly string[] = [],
  sourceIds: readonly string[] = [],
): ApplicabilityCheck {
  return {
    outcome,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    rationale,
    decisiveFactClaimIds: [...new Set(decisiveFactClaimIds)].sort(),
    sourceIds: [...new Set(sourceIds)].sort(),
  };
}

function chronologicalCheck(input: LegalApplicabilityAssessmentInput): ApplicabilityCheck {
  const assessment = input.chronologicalAssessment;
  const sourceId = provisionIdentity(input.candidateProvision);
  if (assessment.applicabilityState === "NOT_APPLICABLE_ON_DATE") {
    return check(
      "NOT_SATISFIED",
      assessment.reasonCodes,
      "La fonte non e cronologicamente applicabile alla data di riferimento.",
      [],
      [sourceId],
    );
  }
  if (assessment.applicabilityState !== "APPLICABLE_ON_DATE") {
    return check(
      "TO_VERIFY",
      assessment.reasonCodes,
      "La sola verifica cronologica non consente una conclusione definitiva.",
      [],
      [sourceId],
    );
  }
  return check(
    "SATISFIED",
    assessment.reasonCodes,
    "L'intervallo di efficacia comprende la data di riferimento; gli altri livelli restano autonomi.",
    [],
    [sourceId],
  );
}

function verifiedSourceCheck(provision: VerifiedProvisionReference): ApplicabilityCheck {
  const gate = evaluateUsableSourceGate(provision.sourceAssessment);
  const sourceId = provisionIdentity(provision);
  const anchorsMatch = provision.citationAnchors.length > 0
    && canonical(provision.citationAnchors) === canonical(provision.sourceAssessment.citationAnchors);
  if (
    gate.usable
    && provision.sourceAssessment.officiality === "OFFICIAL"
    && anchorsMatch
  ) {
    return check(
      "SATISFIED",
      ["OFFICIAL_SOURCE_VERIFIED"],
      "Identita, contenuto integrale, temporalita e citazioni della fonte ufficiale sono verificati.",
      [],
      [sourceId],
    );
  }
  return check(
    "TO_VERIFY",
    [
      ...gate.blockingReasons,
      ...(provision.sourceAssessment.officiality === "OFFICIAL" ? [] : ["OFFICIAL_SOURCE_REQUIRED"]),
      ...(anchorsMatch ? [] : ["CITATION_ANCHOR_MISMATCH"]),
    ],
    "La disposizione non puo sostenere una conclusione finche la catena ufficiale non e completa e coerente.",
    [],
    [sourceId],
  );
}

function dimensionCheck(
  input: ApplicabilityDimensionInput,
  positiveCode: string,
  negativeCode: string,
  uncertainCode: string,
): ApplicabilityCheck {
  const reasonCode = input.outcome === "SATISFIED"
    ? positiveCode
    : input.outcome === "NOT_SATISFIED"
      ? negativeCode
      : uncertainCode;
  return check(input.outcome, [reasonCode], input.rationale, input.decisiveFactClaimIds);
}

function specialityCheck(input: NormRelationshipInput): ApplicabilityCheck {
  const competingSourceIds = input.competingProvision
    ? [provisionIdentity(input.competingProvision)]
    : [];
  if (input.outcome === "CANDIDATE_DISPLACED_BY_SPECIAL_RULE") {
    if (!input.competingProvision) {
      return check(
        "TO_VERIFY",
        ["COMPETING_SPECIAL_PROVISION_MISSING"],
        "La prevalenza della norma speciale non e verificabile senza la disposizione concorrente.",
        [],
      );
    }
    const sourceCheck = verifiedSourceCheck(input.competingProvision);
    const territorial = input.competingTerritorialApplicability;
    const material = input.competingMaterialApplicability;
    if (sourceCheck.outcome !== "SATISFIED"
      || territorial?.outcome !== "SATISFIED"
      || material?.outcome !== "SATISFIED") {
      return check(
        "TO_VERIFY",
        [
          "COMPETING_SPECIAL_PROVISION_NOT_VERIFIED",
          ...sourceCheck.reasonCodes,
          ...(territorial?.outcome === "SATISFIED" ? [] : ["COMPETING_SPECIAL_PROVISION_TERRITORIAL_SCOPE_UNVERIFIED"]),
          ...(material?.outcome === "SATISFIED" ? [] : ["COMPETING_SPECIAL_PROVISION_MATERIAL_SCOPE_UNVERIFIED"]),
        ],
        "La norma speciale concorrente non puo prevalere finche fonte, vigenza e pertinenza non sono verificate.",
        [],
        competingSourceIds,
      );
    }
    return check(
      "NOT_SATISFIED",
      ["CANDIDATE_DISPLACED_BY_SPECIAL_RULE"],
      input.rationale,
      [],
      competingSourceIds,
    );
  }
  if (input.outcome === "UNRESOLVED") {
    return check("TO_VERIFY", ["SPECIALITY_RELATION_UNRESOLVED"], input.rationale, [], competingSourceIds);
  }
  return check(
    "SATISFIED",
    [input.outcome],
    input.rationale,
    [],
    competingSourceIds,
  );
}

function factsByRole(
  facts: readonly ApplicabilityFactReference[],
  role: ApplicabilityFactRole,
): readonly ApplicabilityFactReference[] {
  return facts.filter((fact) => fact.role === role);
}

function uncertainFacts(facts: readonly ApplicabilityFactReference[]): boolean {
  return facts.some((fact) => fact.certainty === "UNCERTAIN" || fact.occurrenceDate === null);
}

function relativeToEffectiveDate(
  facts: readonly ApplicabilityFactReference[],
  effectiveFrom: Date,
): "BEFORE" | "ON_OR_AFTER" | "MIXED" | "UNKNOWN" {
  if (facts.length === 0 || uncertainFacts(facts)) return "UNKNOWN";
  const dates = facts.map((fact) => parseDate(fact.occurrenceDate)!);
  const before = dates.some((date) => date < effectiveFrom);
  const onOrAfter = dates.some((date) => date >= effectiveFrom);
  if (before && onOrAfter) return "MIXED";
  return before ? "BEFORE" : "ON_OR_AFTER";
}

function exceptionCheck(
  exceptions: readonly TransitionalException[],
): ApplicabilityCheck | null {
  const uncertain = exceptions.filter((item) => item.match === "UNCERTAIN");
  if (uncertain.length > 0) {
    return check(
      "TO_VERIFY",
      ["TRANSITIONAL_EXCEPTION_UNCERTAIN"],
      uncertain.map((item) => item.description).join(" "),
      uncertain.flatMap((item) => item.decisiveFactClaimIds),
    );
  }
  const matched = exceptions.filter((item) => item.match === "MATCHED");
  if (matched.some((item) => item.effect === "REQUIRE_REVIEW")) {
    return check(
      "TO_VERIFY",
      ["TRANSITIONAL_EXCEPTION_REQUIRES_REVIEW"],
      matched.map((item) => item.description).join(" "),
      matched.flatMap((item) => item.decisiveFactClaimIds),
    );
  }
  if (matched.some((item) => item.effect === "PRESERVE_PREVIOUS_REGIME")) {
    return check(
      "NOT_SATISFIED",
      ["TRANSITIONAL_EXCEPTION_PRESERVES_PREVIOUS_REGIME"],
      matched.map((item) => item.description).join(" "),
      matched.flatMap((item) => item.decisiveFactClaimIds),
    );
  }
  if (matched.some((item) => item.effect === "APPLY_NEW_REGIME")) {
    return check(
      "SATISFIED",
      ["TRANSITIONAL_EXCEPTION_APPLIES_NEW_REGIME"],
      matched.map((item) => item.description).join(" "),
      matched.flatMap((item) => item.decisiveFactClaimIds),
    );
  }
  return null;
}

function presentTransitionalCheck(
  input: LegalApplicabilityAssessmentInput,
  discipline: Extract<TransitionalDiscipline, { status: "VERIFIED_PRESENT" }>,
): ApplicabilityCheck {
  const sourceCheck = verifiedSourceCheck(discipline.provision);
  const sourceIds = [
    provisionIdentity(discipline.provision),
    ...(discipline.previousRegimeProvision ? [provisionIdentity(discipline.previousRegimeProvision)] : []),
  ];
  if (sourceCheck.outcome !== "SATISFIED") {
    return check(
      "TO_VERIFY",
      ["TRANSITIONAL_SOURCE_NOT_VERIFIED", ...sourceCheck.reasonCodes],
      "La disciplina transitoria non e utilizzabile finche la relativa fonte ufficiale non supera la verifica.",
      [],
      sourceIds,
    );
  }

  const exception = exceptionCheck(discipline.exceptions);
  if (exception) {
    return check(
      exception.outcome,
      exception.reasonCodes,
      exception.rationale,
      exception.decisiveFactClaimIds,
      sourceIds,
    );
  }

  if (discipline.effect === "REQUIRES_INTERPRETATION") {
    return check(
      "TO_VERIFY",
      ["TRANSITIONAL_PROVISION_REQUIRES_INTERPRETATION"],
      discipline.interpretationRationale,
      [],
      sourceIds,
    );
  }

  if (discipline.effect === "EXPRESSLY_RETROACTIVE") {
    return check(
      "SATISFIED",
      ["EXPRESS_RETROACTIVITY_VERIFIED"],
      discipline.interpretationRationale,
      [],
      sourceIds,
    );
  }

  const effectiveFrom = parseDate(discipline.effectiveFrom)!;
  if (discipline.effect === "EXCLUDES_PENDING_PROCEEDINGS") {
    const target = input.targetProceedingIdentity;
    if (!target || target.verification !== "DOCUMENTED" || target.evidenceLinkIds.length === 0) {
      return check(
        "TO_VERIFY",
        ["TARGET_PROCEEDING_IDENTITY_UNVERIFIED"],
        "Il procedimento oggetto della verifica transitoria non dispone di un'identita documentata.",
        [],
        sourceIds,
      );
    }
    const proceedingFacts = input.facts.filter((fact) => (
      fact.role === "PROCEEDING_STARTED" || fact.role === "PROCEEDING_STATUS"
    ));
    if (proceedingFacts.some((fact) => !fact.proceedingIdentity
      || fact.proceedingIdentity.verification !== "DOCUMENTED"
      || fact.proceedingIdentity.evidenceLinkIds.length === 0)) {
      return check(
        "TO_VERIFY",
        ["PROCEEDING_FACT_IDENTITY_UNVERIFIED"],
        "Almeno un fatto procedimentale potenzialmente rilevante non e collegato a un procedimento con identita documentata.",
        proceedingFacts.map((fact) => fact.factClaimId),
        sourceIds,
      );
    }
    const targetFacts = proceedingFacts.filter((fact) => (
      fact.proceedingIdentity?.canonicalAnchorSemanticKey === target.canonicalAnchorSemanticKey
      && fact.proceedingIdentity.kind === target.kind
    ));
    const starts = factsByRole(targetFacts, "PROCEEDING_STARTED");
    const statuses = factsByRole(targetFacts, "PROCEEDING_STATUS");
    const timing = relativeToEffectiveDate(starts, effectiveFrom);
    const decisiveIds = [...starts.map((fact) => fact.factClaimId), ...statuses.map((fact) => fact.factClaimId)];
    const datedStatuses = statuses.filter((fact) => fact.certainty === "CERTAIN" && fact.occurrenceDate !== null);
    const pendingDates = datedStatuses
      .filter((fact) => fact.value === "PENDING")
      .map((fact) => parseDate(fact.occurrenceDate)!);
    const completionDates = datedStatuses
      .filter((fact) => fact.value === "COMPLETED")
      .map((fact) => parseDate(fact.occurrenceDate)!);
    const unknownStatuses = statuses.filter((fact) => (
      fact.certainty === "UNCERTAIN"
      || fact.occurrenceDate === null
      || fact.value === "UNKNOWN"
      || fact.value === undefined
    ));
    const unknownDates = unknownStatuses
      .filter((fact) => fact.occurrenceDate !== null)
      .map((fact) => parseDate(fact.occurrenceDate)!);
    const contradictory = completionDates.some((completionDate) =>
      pendingDates.some((pendingDate) => pendingDate > completionDate));
    const completedBeforeEffectiveDate = completionDates.some((date) => date < effectiveFrom);
    const completedOnOrAfterEffectiveDate = completionDates.some((date) => date >= effectiveFrom);
    const documentedPendingOnOrAfterEffectiveDate = pendingDates.some((date) => date >= effectiveFrom);
    const latestCompletionBeforeEffectiveDate = completionDates
      .filter((date) => date < effectiveFrom)
      .sort((left, right) => right.getTime() - left.getTime())[0];
    const historicalStatusResolved = completedOnOrAfterEffectiveDate || documentedPendingOnOrAfterEffectiveDate;
    const unresolvedUnknownStatus = unknownStatuses.some((fact) => fact.occurrenceDate === null)
      || (!historicalStatusResolved && unknownDates.some((date) => (
        date <= effectiveFrom
        && (!latestCompletionBeforeEffectiveDate || date > latestCompletionBeforeEffectiveDate)
      )));
    if (timing === "UNKNOWN"
      || timing === "MIXED"
      || contradictory
      || unresolvedUnknownStatus) {
      return check(
        "TO_VERIFY",
        [contradictory
          ? "PENDING_PROCEEDING_STATUS_CONTRADICTORY"
          : unresolvedUnknownStatus
            ? "PENDING_PROCEEDING_STATUS_UNKNOWN_AT_EFFECTIVE_DATE"
            : "PENDING_PROCEEDING_STATUS_OR_DATE_UNCERTAIN"],
        "Non e possibile ricostruire con certezza lo stato del procedimento alla data di entrata in vigore.",
        decisiveIds,
        sourceIds,
      );
    }
    if (timing === "BEFORE" && !completedBeforeEffectiveDate
      && (completedOnOrAfterEffectiveDate || documentedPendingOnOrAfterEffectiveDate)) {
      return check(
        "NOT_SATISFIED",
        ["PENDING_PROCEEDING_EXCLUDED"],
        discipline.interpretationRationale,
        decisiveIds,
        sourceIds,
      );
    }
    if (timing === "BEFORE" && !completedBeforeEffectiveDate) {
      return check(
        "TO_VERIFY",
        ["PENDING_PROCEEDING_STATUS_AT_EFFECTIVE_DATE_NOT_ESTABLISHED"],
        "L'avvio e documentato, ma manca una prova certa dello stato del procedimento alla data di entrata in vigore.",
        decisiveIds,
        sourceIds,
      );
    }
    return check(
      "SATISFIED",
      ["PENDING_PROCEEDING_EXCLUSION_NOT_TRIGGERED"],
      discipline.interpretationRationale,
      decisiveIds,
      sourceIds,
    );
  }

  const determiningFacts = factsByRole(input.facts, discipline.determiningFactRole);
  const timing = relativeToEffectiveDate(determiningFacts, effectiveFrom);
  const decisiveIds = determiningFacts.map((fact) => fact.factClaimId);
  if (timing === "UNKNOWN" || timing === "MIXED") {
    return check(
      "TO_VERIFY",
      ["DETERMINING_FACT_DATE_UNCERTAIN"],
      "La data del fatto determinante non consente di applicare con certezza la disciplina transitoria.",
      decisiveIds,
      sourceIds,
    );
  }
  if (discipline.effect === "PRESERVES_PREVIOUS_REGIME" && timing === "BEFORE") {
    return check(
      "NOT_SATISFIED",
      ["PREVIOUS_REGIME_PRESERVED"],
      discipline.interpretationRationale,
      decisiveIds,
      sourceIds,
    );
  }
  if (discipline.effect === "PROSPECTIVE_ONLY" && timing === "BEFORE") {
    return check(
      "NOT_SATISFIED",
      ["PROSPECTIVE_RULE_DOES_NOT_REACH_EARLIER_FACT"],
      discipline.interpretationRationale,
      decisiveIds,
      sourceIds,
    );
  }
  return check(
    "SATISFIED",
    ["TRANSITIONAL_CONDITION_SATISFIED"],
    discipline.interpretationRationale,
    decisiveIds,
    sourceIds,
  );
}

function transitionalCheck(input: LegalApplicabilityAssessmentInput): ApplicabilityCheck {
  if (input.legalAuthorityKind === "CASE_LAW") {
    return check(
      "TO_VERIFY",
      ["LATER_CASE_LAW_NO_AUTOMATIC_RETROACTIVITY"],
      "Una pronuncia sopravvenuta non riceve automaticamente efficacia retroattiva.",
      [],
      [provisionIdentity(input.candidateProvision)],
    );
  }

  const discipline = input.transitionalDiscipline;
  if (!("verificationSource" in discipline) && discipline.status !== "VERIFIED_PRESENT") {
    return check(
      "TO_VERIFY",
      [discipline.status === "UNAVAILABLE"
        ? "TRANSITIONAL_PROVISION_UNAVAILABLE"
        : "TRANSITIONAL_PROVISION_AMBIGUOUS"],
      discipline.rationale,
    );
  }
  if (discipline.status === "VERIFIED_PRESENT") {
    return presentTransitionalCheck(input, discipline);
  }

  const sourceCheck = verifiedSourceCheck(discipline.verificationSource);
  const attestation = discipline.absenceAttestation;
  const attestationValid = attestation.reviewScope === "COMPLETE_OFFICIAL_TEXT"
    && /^[a-f0-9]{64}$/i.test(attestation.sourceContentSha256)
    && attestation.sourceContentSha256 === discipline.verificationSource.sourceAssessment.contentSha256
    && attestation.examinedProvisions.length > 0
    && attestation.reviewedByActorId.trim().length > 0
    && parseDate(attestation.reviewedAt) !== null
    && attestation.rationale.trim().length >= 20;
  if (sourceCheck.outcome !== "SATISFIED" || !attestationValid) {
    return check(
      "TO_VERIFY",
      ["TRANSITIONAL_ABSENCE_NOT_ESTABLISHED", ...sourceCheck.reasonCodes],
      "L'assenza di disciplina transitoria non e sostenuta da una verifica documentata e completa della fonte ufficiale.",
      [],
      [provisionIdentity(discipline.verificationSource)],
    );
  }
  const effectiveFrom = parseDate(input.chronologicalAssessment.effectiveInterval.from);
  const decisiveFacts = input.facts.filter((fact) =>
    input.factualApplicability.decisiveFactClaimIds.includes(fact.factClaimId));
  if (!effectiveFrom || uncertainFacts(decisiveFacts)) {
    return check(
      "TO_VERIFY",
      ["PROSPECTIVE_APPLICATION_REQUIRES_CERTAIN_DECISIVE_DATE"],
      discipline.rationale,
      decisiveFacts.map((fact) => fact.factClaimId),
      [provisionIdentity(discipline.verificationSource)],
    );
  }
  const timing = relativeToEffectiveDate(decisiveFacts, effectiveFrom);
  if (timing !== "ON_OR_AFTER") {
    return check(
      "TO_VERIFY",
      ["NO_TRANSITIONAL_RULE_FOR_EARLIER_OR_MIXED_FACTS"],
      "L'assenza verificata di una clausola transitoria non autorizza a presumere retroattivita.",
      decisiveFacts.map((fact) => fact.factClaimId),
      [provisionIdentity(discipline.verificationSource)],
    );
  }
  return check(
    "SATISFIED",
    ["NO_TRANSITIONAL_PROVISION_AND_DECISIVE_FACTS_AFTER_EFFECTIVE_DATE"],
    discipline.rationale,
    decisiveFacts.map((fact) => fact.factClaimId),
    [provisionIdentity(discipline.verificationSource)],
  );
}

function validateInput(input: LegalApplicabilityAssessmentInput): void {
  if (!input.applicationId.trim()) throw new LegalApplicabilityInputError("INVALID_APPLICATION_ID");
  if (parseDate(input.referenceDate) === null) throw new LegalApplicabilityInputError("INVALID_REFERENCE_DATE");
  if (input.referenceDate !== input.chronologicalAssessment.referenceDate) {
    throw new LegalApplicabilityInputError("TEMPORAL_REFERENCE_DATE_MISMATCH");
  }
  const factIds = input.facts.map((fact) => fact.factClaimId);
  if (new Set(factIds).size !== factIds.length) {
    throw new LegalApplicabilityInputError("DUPLICATE_FACT_REFERENCE");
  }
  if (input.facts.some((fact) => fact.occurrenceDate !== null && parseDate(fact.occurrenceDate) === null)) {
    throw new LegalApplicabilityInputError("INVALID_FACT_DATE");
  }
  const decisiveIds = [
    ...input.territorialApplicability.decisiveFactClaimIds,
    ...input.materialApplicability.decisiveFactClaimIds,
    ...input.factualApplicability.decisiveFactClaimIds,
    ...(input.transitionalDiscipline.status === "VERIFIED_PRESENT"
      ? input.transitionalDiscipline.exceptions.flatMap((item) => item.decisiveFactClaimIds)
      : []),
  ];
  if (decisiveIds.some((id) => !factIds.includes(id))) {
    throw new LegalApplicabilityInputError("UNKNOWN_DECISIVE_FACT");
  }
  if (input.transitionalDiscipline.status === "VERIFIED_PRESENT") {
    if (parseDate(input.transitionalDiscipline.effectiveFrom) === null) {
      throw new LegalApplicabilityInputError("INVALID_TRANSITION_EFFECTIVE_DATE");
    }
    if (
      input.transitionalDiscipline.effect === "PRESERVES_PREVIOUS_REGIME"
      && input.transitionalDiscipline.previousRegimeProvision === null
    ) {
      throw new LegalApplicabilityInputError("MISSING_PREVIOUS_REGIME_SOURCE");
    }
  }
}

function usedFacts(
  facts: readonly ApplicabilityFactReference[],
  checks: readonly ApplicabilityCheck[],
): readonly ApplicabilityFactReference[] {
  const ids = new Set(checks.flatMap((item) => item.decisiveFactClaimIds));
  return facts.filter((fact) => ids.has(fact.factClaimId))
    .sort((left, right) => left.factClaimId.localeCompare(right.factClaimId, "en"));
}

function usedSources(input: LegalApplicabilityAssessmentInput): readonly VerifiedProvisionReference[] {
  const candidates = [
    input.candidateProvision,
    input.normRelationship.competingProvision,
    input.transitionalDiscipline.status === "VERIFIED_PRESENT"
      ? input.transitionalDiscipline.provision
      : input.transitionalDiscipline.status === "VERIFIED_ABSENT"
        ? input.transitionalDiscipline.verificationSource
        : null,
    input.transitionalDiscipline.status === "VERIFIED_PRESENT"
      ? input.transitionalDiscipline.previousRegimeProvision
      : null,
  ].filter((item): item is VerifiedProvisionReference => item !== null);
  const byIdentity = new Map(candidates.map((item) => [provisionIdentity(item), item]));
  return [...byIdentity.values()].sort((left, right) =>
    provisionIdentity(left).localeCompare(provisionIdentity(right), "en"));
}

export function assessLegalApplicability(
  input: LegalApplicabilityAssessmentInput,
): LegalApplicabilityAssessment {
  validateInput(input);
  const checks = {
    chronologicalCheck: chronologicalCheck(input),
    sourceVerificationCheck: verifiedSourceCheck(input.candidateProvision),
    territorialCheck: dimensionCheck(
      input.territorialApplicability,
      "TERRITORIAL_SCOPE_MATCH",
      "TERRITORIAL_SCOPE_MISMATCH",
      "TERRITORIAL_SCOPE_TO_VERIFY",
    ),
    materialCheck: dimensionCheck(
      input.materialApplicability,
      "MATERIAL_SCOPE_MATCH",
      "MATERIAL_SCOPE_MISMATCH",
      "MATERIAL_SCOPE_TO_VERIFY",
    ),
    factualCheck: dimensionCheck(
      input.factualApplicability,
      "FACTUAL_CONDITIONS_MATCH",
      "FACTUAL_CONDITIONS_MISMATCH",
      "FACTUAL_CONDITIONS_TO_VERIFY",
    ),
    specialityCheck: specialityCheck(input.normRelationship),
    transitionalCheck: transitionalCheck(input),
  };
  const orderedChecks = Object.values(checks);
  const failed = orderedChecks.filter((item) => item.outcome === "NOT_SATISFIED");
  const uncertain = orderedChecks.filter((item) => item.outcome === "TO_VERIFY");
  const outcome: LegalApplicabilityOutcome = failed.length > 0
    ? "NOT_APPLICABLE"
    : uncertain.length > 0
      ? "TO_VERIFY"
      : "APPLICABLE";
  const conclusionReasonCodes = (failed.length > 0 ? failed : uncertain.length > 0 ? uncertain : orderedChecks)
    .flatMap((item) => item.reasonCodes);
  const conclusion = {
    outcome,
    reasonCodes: [...new Set(conclusionReasonCodes)].sort(),
    rationale: outcome === "APPLICABLE"
      ? "Tutti i livelli di controllo risultano soddisfatti; la conclusione resta soggetta a revisione professionale."
      : outcome === "NOT_APPLICABLE"
        ? "Almeno un controllo autonomo esclude l'applicabilita della disposizione candidata."
        : "Almeno un controllo autonomo richiede verifica professionale prima di concludere.",
    humanReviewRequired: true as const,
  };
  const assessmentWithoutFingerprint = {
    assessmentVersion: LEGAL_APPLICABILITY_ASSESSMENT_VERSION,
    applicationId: input.applicationId,
    referenceDate: input.referenceDate,
    ...checks,
    conclusion,
    decisiveFacts: usedFacts(input.facts, orderedChecks),
    sourcesUsed: usedSources(input),
  };
  return {
    ...assessmentWithoutFingerprint,
    assessmentFingerprint: fingerprint(assessmentWithoutFingerprint),
  };
}
