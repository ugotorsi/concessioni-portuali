import { createHash } from "node:crypto";

import type {
  CanonicalAuthorityReference,
  EvidenceLocator,
  LegalPropositionGraph,
} from "@/server/legal-reasoning/proposition-graph";

export const AUTHORITY_TREATMENT_VERSION = "AUTHORITY_TREATMENT_V1" as const;

export type AuthorityRecord = Readonly<{
  id: string;
  authority: CanonicalAuthorityReference;
  decisionDate?: string;
}>;

export type CitationObservationMethod =
  | "HUMAN_OBSERVATION"
  | "DOCUMENT_EXTRACTION"
  | "DETERMINISTIC_RULE"
  | "PROVIDER_REPORTED"
  | "UNKNOWN";

export type CitationObservationProvenance = Readonly<{
  evidenceSourceId: string;
  providerId?: string;
  documentId?: string;
  documentVersionId?: string;
  locator?: EvidenceLocator;
  observationMethod: CitationObservationMethod;
  evidenceHash?: string;
}>;

export type CitationObservation = Readonly<{
  kind: "CITATION_OBSERVATION";
  id: string;
  relation: "CITES";
  sourceAuthorityId: string;
  targetAuthorityId: string;
  provenance: CitationObservationProvenance;
}>;

export type CitationObservationInput = Omit<CitationObservation, "id">;

export type AuthorityTreatment =
  | "NEUTRAL_CITATION"
  | "SUPPORTIVE"
  | "RELIES_ON"
  | "APPLIES_OR_FOLLOWS"
  | "DISTINGUISHES"
  | "QUALIFIES"
  | "CRITICIZES"
  | "DEPARTS_FROM"
  | "ADVERSE"
  | "SUPERSEDING_EFFECT_POSSIBLE"
  | "INDETERMINATE"
  | "REQUIRES_HUMAN_REVIEW";

export type TreatmentAssessmentOrigin =
  | "HUMAN"
  | "DETERMINISTIC_RULE"
  | "MODEL_ASSISTED"
  | "PROVIDER_ASSERTED"
  | "UNKNOWN";

export type TreatmentReviewState =
  | "UNREVIEWED"
  | "CONFIRMED"
  | "REJECTED"
  | "CONFLICTED"
  | "REQUIRES_HUMAN_REVIEW";

export type TreatmentScope = Readonly<{
  kind: "LEGAL_PROPOSITION" | "LEGAL_ISSUE" | "APPLICATION";
  id: string;
}>;

export type AuthorityTreatmentAssessment = Readonly<{
  kind: "AUTHORITY_TREATMENT_ASSESSMENT";
  id: string;
  observationId: string;
  sourceAuthorityId: string;
  targetAuthorityId: string;
  treatment: AuthorityTreatment;
  origin: TreatmentAssessmentOrigin;
  reviewState: TreatmentReviewState;
  scope?: TreatmentScope;
  rationale?: string;
}>;

export type AuthorityTreatmentAssessmentInput = Omit<AuthorityTreatmentAssessment, "id">;

export type AuthorityTreatmentGraph = Readonly<{
  version: typeof AUTHORITY_TREATMENT_VERSION;
  authorities: readonly AuthorityRecord[];
  observations: readonly CitationObservation[];
  assessments: readonly AuthorityTreatmentAssessment[];
}>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function deterministicIdentity(prefix: string, value: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
  return `${prefix}:${digest}`;
}

export function citationObservationIdentity(input: CitationObservationInput): string {
  return deterministicIdentity("citation-observation", input);
}

export function authorityTreatmentAssessmentIdentity(
  input: AuthorityTreatmentAssessmentInput,
): string {
  return deterministicIdentity("authority-treatment", input);
}

export function createCitationObservation(
  input: CitationObservationInput,
): CitationObservation {
  return { ...input, id: citationObservationIdentity(input) };
}

export function createAuthorityTreatmentAssessment(
  input: AuthorityTreatmentAssessmentInput,
): AuthorityTreatmentAssessment {
  return { ...input, id: authorityTreatmentAssessmentIdentity(input) };
}

export type AuthorityTreatmentValidationErrorCode =
  | "ASSESSMENT_AUTHORITY_PAIR_MISMATCH"
  | "CANONICAL_AUTHORITY_REFERENCE_INCOMPLETE"
  | "DANGLING_APPLICATION_SCOPE"
  | "DANGLING_AUTHORITY"
  | "DANGLING_ISSUE_SCOPE"
  | "DANGLING_OBSERVATION"
  | "DANGLING_PROPOSITION_SCOPE"
  | "DUPLICATE_ASSESSMENT_IDENTITY"
  | "DUPLICATE_AUTHORITY_ID"
  | "DUPLICATE_OBSERVATION_IDENTITY"
  | "IDENTITY_MISMATCH"
  | "INVALID_OBSERVATION_PROVENANCE"
  | "SELF_CITATION"
  | "SCOPE_GRAPH_REQUIRED"
  | "TEMPORAL_REFERENCE_DATE_MISMATCH";

export type AuthorityTreatmentValidationError = Readonly<{
  code: AuthorityTreatmentValidationErrorCode;
  entityKind: "AUTHORITY" | CitationObservation["kind"] | AuthorityTreatmentAssessment["kind"];
  entityId: string;
  path: string;
  referencedId?: string;
}>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validLocator(locator: EvidenceLocator | undefined): boolean {
  if (!locator) return true;
  if (locator.page !== undefined && (!Number.isInteger(locator.page) || locator.page < 1)) return false;
  if (locator.span !== undefined) {
    if (!Number.isInteger(locator.span.start) || !Number.isInteger(locator.span.end)) return false;
    if (locator.span.start < 0 || locator.span.end < locator.span.start) return false;
  }
  return true;
}

function observationInput(observation: CitationObservation): CitationObservationInput {
  return {
    kind: observation.kind,
    relation: observation.relation,
    sourceAuthorityId: observation.sourceAuthorityId,
    targetAuthorityId: observation.targetAuthorityId,
    provenance: observation.provenance,
  };
}

function assessmentInput(
  assessment: AuthorityTreatmentAssessment,
): AuthorityTreatmentAssessmentInput {
  return {
    kind: assessment.kind,
    observationId: assessment.observationId,
    sourceAuthorityId: assessment.sourceAuthorityId,
    targetAuthorityId: assessment.targetAuthorityId,
    treatment: assessment.treatment,
    origin: assessment.origin,
    reviewState: assessment.reviewState,
    ...(assessment.scope ? { scope: assessment.scope } : {}),
    ...(assessment.rationale !== undefined ? { rationale: assessment.rationale } : {}),
  };
}

function scopeExists(scope: TreatmentScope, graph: LegalPropositionGraph): boolean {
  switch (scope.kind) {
    case "LEGAL_PROPOSITION": return graph.legalPropositions.some((item) => item.id === scope.id);
    case "LEGAL_ISSUE": return graph.legalIssues.some((item) => item.id === scope.id);
    case "APPLICATION": return graph.applications.some((item) => item.id === scope.id);
  }
}

function scopeErrorCode(scope: TreatmentScope): AuthorityTreatmentValidationErrorCode {
  switch (scope.kind) {
    case "LEGAL_PROPOSITION": return "DANGLING_PROPOSITION_SCOPE";
    case "LEGAL_ISSUE": return "DANGLING_ISSUE_SCOPE";
    case "APPLICATION": return "DANGLING_APPLICATION_SCOPE";
  }
}

export function validateAuthorityTreatmentGraph(
  graph: AuthorityTreatmentGraph,
  propositionGraph?: LegalPropositionGraph,
): readonly AuthorityTreatmentValidationError[] {
  const errors: AuthorityTreatmentValidationError[] = [];
  const authorityIds = new Set<string>();
  for (const record of graph.authorities) {
    if (authorityIds.has(record.id)) {
      errors.push({
        code: "DUPLICATE_AUTHORITY_ID",
        entityKind: "AUTHORITY",
        entityId: record.id,
        path: "id",
      });
    }
    authorityIds.add(record.id);
    if (
      !record.id.trim()
      || !record.authority.legalSourceId.trim()
      || !record.authority.legalExpressionVersionId.trim()
      || !record.authority.referenceDate.trim()
    ) {
      errors.push({
        code: "CANONICAL_AUTHORITY_REFERENCE_INCOMPLETE",
        entityKind: "AUTHORITY",
        entityId: record.id,
        path: "authority",
      });
    }
    const temporal = record.authority.temporalAssessment;
    if (temporal && temporal.referenceDate !== record.authority.referenceDate) {
      errors.push({
        code: "TEMPORAL_REFERENCE_DATE_MISMATCH",
        entityKind: "AUTHORITY",
        entityId: record.id,
        path: "authority.temporalAssessment.referenceDate",
      });
    }
  }

  const observationsById = new Map<string, CitationObservation>();
  const observationIdentities = new Map<string, string>();
  for (const observation of graph.observations) {
    const expectedId = citationObservationIdentity(observationInput(observation));
    if (observation.id !== expectedId) {
      errors.push({
        code: "IDENTITY_MISMATCH",
        entityKind: observation.kind,
        entityId: observation.id,
        path: "id",
      });
    }
    const priorObservation = observationIdentities.get(expectedId);
    if (priorObservation !== undefined) {
      errors.push({
        code: "DUPLICATE_OBSERVATION_IDENTITY",
        entityKind: observation.kind,
        entityId: observation.id,
        path: "identity",
        referencedId: priorObservation,
      });
    } else {
      observationIdentities.set(expectedId, observation.id);
    }
    observationsById.set(observation.id, observation);
    if (!authorityIds.has(observation.sourceAuthorityId)) {
      errors.push({
        code: "DANGLING_AUTHORITY",
        entityKind: observation.kind,
        entityId: observation.id,
        path: "sourceAuthorityId",
        referencedId: observation.sourceAuthorityId,
      });
    }
    if (!authorityIds.has(observation.targetAuthorityId)) {
      errors.push({
        code: "DANGLING_AUTHORITY",
        entityKind: observation.kind,
        entityId: observation.id,
        path: "targetAuthorityId",
        referencedId: observation.targetAuthorityId,
      });
    }
    if (observation.sourceAuthorityId === observation.targetAuthorityId) {
      errors.push({
        code: "SELF_CITATION",
        entityKind: observation.kind,
        entityId: observation.id,
        path: "targetAuthorityId",
      });
    }
    if (!observation.provenance.evidenceSourceId.trim() || !validLocator(observation.provenance.locator)) {
      errors.push({
        code: "INVALID_OBSERVATION_PROVENANCE",
        entityKind: observation.kind,
        entityId: observation.id,
        path: "provenance",
      });
    }
  }

  const assessmentIdentities = new Map<string, string>();
  for (const assessment of graph.assessments) {
    const expectedId = authorityTreatmentAssessmentIdentity(assessmentInput(assessment));
    if (assessment.id !== expectedId) {
      errors.push({
        code: "IDENTITY_MISMATCH",
        entityKind: assessment.kind,
        entityId: assessment.id,
        path: "id",
      });
    }
    const priorAssessment = assessmentIdentities.get(expectedId);
    if (priorAssessment !== undefined) {
      errors.push({
        code: "DUPLICATE_ASSESSMENT_IDENTITY",
        entityKind: assessment.kind,
        entityId: assessment.id,
        path: "identity",
        referencedId: priorAssessment,
      });
    } else {
      assessmentIdentities.set(expectedId, assessment.id);
    }
    if (!authorityIds.has(assessment.sourceAuthorityId)) {
      errors.push({
        code: "DANGLING_AUTHORITY",
        entityKind: assessment.kind,
        entityId: assessment.id,
        path: "sourceAuthorityId",
        referencedId: assessment.sourceAuthorityId,
      });
    }
    if (!authorityIds.has(assessment.targetAuthorityId)) {
      errors.push({
        code: "DANGLING_AUTHORITY",
        entityKind: assessment.kind,
        entityId: assessment.id,
        path: "targetAuthorityId",
        referencedId: assessment.targetAuthorityId,
      });
    }
    const observation = observationsById.get(assessment.observationId);
    if (!observation) {
      errors.push({
        code: "DANGLING_OBSERVATION",
        entityKind: assessment.kind,
        entityId: assessment.id,
        path: "observationId",
        referencedId: assessment.observationId,
      });
    } else if (
      observation.sourceAuthorityId !== assessment.sourceAuthorityId
      || observation.targetAuthorityId !== assessment.targetAuthorityId
    ) {
      errors.push({
        code: "ASSESSMENT_AUTHORITY_PAIR_MISMATCH",
        entityKind: assessment.kind,
        entityId: assessment.id,
        path: "sourceAuthorityId,targetAuthorityId",
      });
    }
    if (assessment.scope) {
      if (!propositionGraph) {
        errors.push({
          code: "SCOPE_GRAPH_REQUIRED",
          entityKind: assessment.kind,
          entityId: assessment.id,
          path: "scope",
          referencedId: assessment.scope.id,
        });
      } else if (!scopeExists(assessment.scope, propositionGraph)) {
        errors.push({
          code: scopeErrorCode(assessment.scope),
          entityKind: assessment.kind,
          entityId: assessment.id,
          path: "scope",
          referencedId: assessment.scope.id,
        });
      }
    }
  }

  return errors.sort((left, right) => compareText(
    `${left.entityKind}\u0000${left.entityId}\u0000${left.code}\u0000${left.path}\u0000${left.referencedId ?? ""}`,
    `${right.entityKind}\u0000${right.entityId}\u0000${right.code}\u0000${right.path}\u0000${right.referencedId ?? ""}`,
  ));
}

export type AuthorityPairExplanation = Readonly<{
  sourceAuthority: AuthorityRecord | null;
  targetAuthority: AuthorityRecord | null;
  observations: readonly CitationObservation[];
  assessments: readonly AuthorityTreatmentAssessment[];
}>;

export function explainAuthorityPair(
  graph: AuthorityTreatmentGraph,
  sourceAuthorityId: string,
  targetAuthorityId: string,
): AuthorityPairExplanation {
  return {
    sourceAuthority: graph.authorities.find((item) => item.id === sourceAuthorityId) ?? null,
    targetAuthority: graph.authorities.find((item) => item.id === targetAuthorityId) ?? null,
    observations: graph.observations
      .filter((item) => (
        item.sourceAuthorityId === sourceAuthorityId
        && item.targetAuthorityId === targetAuthorityId
      ))
      .sort((left, right) => compareText(left.id, right.id)),
    assessments: graph.assessments
      .filter((item) => (
        item.sourceAuthorityId === sourceAuthorityId
        && item.targetAuthorityId === targetAuthorityId
      ))
      .sort((left, right) => compareText(left.id, right.id)),
  };
}