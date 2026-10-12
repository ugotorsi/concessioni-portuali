import type {
  TemporalApplicabilityState,
  TemporalWindowState,
} from "@/server/legal-sources/temporal";

export const LEGAL_PROPOSITION_GRAPH_VERSION = "LEGAL_PROPOSITION_GRAPH_V1" as const;

export type FactClaimStatus =
  | "ASSERTED"
  | "SUPPORTED"
  | "CONTESTED"
  | "DISPUTED"
  | "UNRESOLVED";

export type FactClaim = Readonly<{
  kind: "FACT_CLAIM";
  id: string;
  statement: string;
  status: FactClaimStatus;
  occurrenceDate?: string;
}>;

export type EvidenceRole = "SUPPORTS" | "CONTRADICTS" | "CONTEXTUALIZES";

export type EvidenceLocator = Readonly<{
  page?: number;
  section?: string;
  paragraph?: string;
  span?: Readonly<{ start: number; end: number }>;
}>;

export type EvidenceLink = Readonly<{
  kind: "EVIDENCE_LINK";
  id: string;
  factClaimId: string;
  documentId: string;
  documentVersionId?: string;
  artifactId?: string;
  locator?: EvidenceLocator;
  extractedTextHash?: string;
  stableSegmentId?: string;
  role: EvidenceRole;
}>;

export type LegalIssue = Readonly<{
  kind: "LEGAL_ISSUE";
  id: string;
  question: string;
  factClaimIds: readonly string[];
  legalPropositionIds: readonly string[];
}>;

export type LegalProposition = Readonly<{
  kind: "LEGAL_PROPOSITION";
  id: string;
  statement: string;
}>;

export type Application = Readonly<{
  kind: "APPLICATION";
  id: string;
  statement: string;
  factClaimIds: readonly string[];
  legalPropositionIds: readonly string[];
}>;

export type AuthorityTargetKind =
  | "LEGAL_PROPOSITION"
  | "APPLICATION"
  | "COUNTER_ARGUMENT"
  | "CONCLUSION";

export type AuthorityTarget = Readonly<{
  kind: AuthorityTargetKind;
  id: string;
}>;

export type PersistedTemporalAssessmentReference = Readonly<{
  id: string;
  assessmentVersion: string;
  referenceDate: string;
  temporalWindowState: TemporalWindowState;
  applicabilityState: TemporalApplicabilityState;
  humanReviewRequired: boolean;
}>;

export type CanonicalAuthorityReference = Readonly<{
  legalSourceId: string;
  legalExpressionVersionId: string;
  referenceDate: string;
  temporalAssessment?: PersistedTemporalAssessmentReference;
  provenance?: Readonly<{
    providerId?: string;
    canonicalEvidenceId?: string;
  }>;
}>;

type AuthorityRelationBase = Readonly<{
  id: string;
  target: AuthorityTarget;
  authority: CanonicalAuthorityReference;
}>;

export type AuthoritySupport = AuthorityRelationBase & Readonly<{
  kind: "AUTHORITY_SUPPORT";
}>;

export type AuthorityAgainst = AuthorityRelationBase & Readonly<{
  kind: "AUTHORITY_AGAINST";
}>;

export type AuthorityRelation = AuthoritySupport | AuthorityAgainst;

export type CounterArgumentTargetKind =
  | "FACT_CLAIM"
  | "LEGAL_PROPOSITION"
  | "AUTHORITY_SUPPORT"
  | "APPLICATION"
  | "COUNTER_ARGUMENT"
  | "CONCLUSION";

export type CounterArgumentStatus =
  | "OPEN"
  | "ANSWERED"
  | "PARTIALLY_ANSWERED"
  | "UNRESOLVED";

export type CounterArgument = Readonly<{
  kind: "COUNTER_ARGUMENT";
  id: string;
  target: Readonly<{ kind: CounterArgumentTargetKind; id: string }>;
  basis: string;
  status: CounterArgumentStatus;
  evidenceLinkIds: readonly string[];
  authorityRelationIds: readonly string[];
}>;

export type ConclusionState =
  | "PROVISIONAL"
  | "SUPPORTED"
  | "CONTESTED"
  | "INSUFFICIENT_SUPPORT"
  | "REQUIRES_HUMAN_REVIEW";

export type Conclusion = Readonly<{
  kind: "CONCLUSION";
  id: string;
  legalIssueId: string;
  applicationIds: readonly string[];
  statement: string;
  state: ConclusionState;
}>;

export type SourceSufficiencyState =
  | "INSUFFICIENT"
  | "PARTIAL"
  | "SUFFICIENT_FOR_PROVISIONAL_REASONING"
  | "CONFLICTED"
  | "REQUIRES_HUMAN_REVIEW";

export type SourceSufficiencyTargetKind =
  | "LEGAL_PROPOSITION"
  | "APPLICATION"
  | "COUNTER_ARGUMENT"
  | "CONCLUSION";

export type SourceSufficiency = Readonly<{
  kind: "SOURCE_SUFFICIENCY";
  id: string;
  target: Readonly<{ kind: SourceSufficiencyTargetKind; id: string }>;
  state: SourceSufficiencyState;
  basis: string;
}>;

export type LegalPropositionGraph = Readonly<{
  graphVersion: typeof LEGAL_PROPOSITION_GRAPH_VERSION;
  factClaims: readonly FactClaim[];
  evidenceLinks: readonly EvidenceLink[];
  legalIssues: readonly LegalIssue[];
  legalPropositions: readonly LegalProposition[];
  authorityRelations: readonly AuthorityRelation[];
  applications: readonly Application[];
  counterArguments: readonly CounterArgument[];
  conclusions: readonly Conclusion[];
  sourceSufficiencies: readonly SourceSufficiency[];
}>;

export type GraphValidationErrorCode =
  | "APPLICATION_FACT_REQUIRED"
  | "APPLICATION_PROPOSITION_REQUIRED"
  | "AUTHORITY_REFERENCE_DATE_REQUIRED"
  | "CONCLUSION_APPLICATION_REQUIRED"
  | "CONCLUSION_ISSUE_REQUIRED"
  | "DANGLING_REFERENCE"
  | "DUPLICATE_ID"
  | "DUPLICATE_RELATION"
  | "INVALID_SELF_REFERENCE"
  | "TEMPORAL_REFERENCE_DATE_MISMATCH"
  | "TEMPORAL_REFERENCE_DATE_REQUIRED";

export type GraphValidationError = Readonly<{
  code: GraphValidationErrorCode;
  entityKind: string;
  entityId: string;
  path: string;
  referencedId?: string;
}>;

type EntityKind =
  | FactClaim["kind"]
  | EvidenceLink["kind"]
  | LegalIssue["kind"]
  | LegalProposition["kind"]
  | AuthorityRelation["kind"]
  | Application["kind"]
  | CounterArgument["kind"]
  | Conclusion["kind"]
  | SourceSufficiency["kind"];

type Identified = Readonly<{ kind: EntityKind; id: string }>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function byId<T extends Readonly<{ id: string }>>(left: T, right: T): number {
  return compareText(left.id, right.id);
}

function targetExists(graph: LegalPropositionGraph, kind: string, id: string): boolean {
  switch (kind) {
    case "FACT_CLAIM": return graph.factClaims.some((item) => item.id === id);
    case "EVIDENCE_LINK": return graph.evidenceLinks.some((item) => item.id === id);
    case "LEGAL_ISSUE": return graph.legalIssues.some((item) => item.id === id);
    case "LEGAL_PROPOSITION": return graph.legalPropositions.some((item) => item.id === id);
    case "AUTHORITY_SUPPORT": return graph.authorityRelations.some((item) => item.kind === kind && item.id === id);
    case "APPLICATION": return graph.applications.some((item) => item.id === id);
    case "COUNTER_ARGUMENT": return graph.counterArguments.some((item) => item.id === id);
    case "CONCLUSION": return graph.conclusions.some((item) => item.id === id);
    default: return false;
  }
}

function relationIdentity(relation: EvidenceLink | AuthorityRelation | SourceSufficiency): string {
  if (relation.kind === "EVIDENCE_LINK") {
    return JSON.stringify([
      relation.kind,
      relation.factClaimId,
      relation.documentId,
      relation.documentVersionId ?? "",
      relation.artifactId ?? "",
      relation.locator?.page ?? null,
      relation.locator?.section ?? "",
      relation.locator?.paragraph ?? "",
      relation.locator?.span?.start ?? null,
      relation.locator?.span?.end ?? null,
      relation.extractedTextHash ?? "",
      relation.stableSegmentId ?? "",
      relation.role,
    ]);
  }
  if (relation.kind === "SOURCE_SUFFICIENCY") {
    return JSON.stringify([relation.kind, relation.target.kind, relation.target.id]);
  }
  return JSON.stringify([
    relation.kind,
    relation.target.kind,
    relation.target.id,
    relation.authority.legalSourceId,
    relation.authority.legalExpressionVersionId,
    relation.authority.referenceDate,
    relation.authority.temporalAssessment?.id ?? "",
  ]);
}

function pushDangling(
  graph: LegalPropositionGraph,
  errors: GraphValidationError[],
  entity: Identified,
  path: string,
  referencedKind: string,
  referencedId: string,
): void {
  if (!targetExists(graph, referencedKind, referencedId)) {
    errors.push({
      code: "DANGLING_REFERENCE",
      entityKind: entity.kind,
      entityId: entity.id,
      path,
      referencedId,
    });
  }
}

function pushDuplicateReferences(
  errors: GraphValidationError[],
  entity: Identified,
  path: string,
  referencedIds: readonly string[],
): void {
  const seen = new Set<string>();
  for (const referencedId of referencedIds) {
    if (seen.has(referencedId)) {
      errors.push({
        code: "DUPLICATE_RELATION",
        entityKind: entity.kind,
        entityId: entity.id,
        path,
        referencedId,
      });
    }
    seen.add(referencedId);
  }
}

export function validateLegalPropositionGraph(
  graph: LegalPropositionGraph,
): readonly GraphValidationError[] {
  const errors: GraphValidationError[] = [];
  const entities: readonly Identified[] = [
    ...graph.factClaims,
    ...graph.evidenceLinks,
    ...graph.legalIssues,
    ...graph.legalPropositions,
    ...graph.authorityRelations,
    ...graph.applications,
    ...graph.counterArguments,
    ...graph.conclusions,
    ...graph.sourceSufficiencies,
  ];
  const ids = new Map<string, number>();
  for (const entity of entities) ids.set(entity.id, (ids.get(entity.id) ?? 0) + 1);
  for (const entity of entities) {
    if ((ids.get(entity.id) ?? 0) > 1) {
      errors.push({ code: "DUPLICATE_ID", entityKind: entity.kind, entityId: entity.id, path: "id" });
    }
  }

  const edgeIdentities = new Map<string, string>();
  for (const relation of [
    ...graph.evidenceLinks,
    ...graph.authorityRelations,
    ...graph.sourceSufficiencies,
  ]) {
    const identity = relationIdentity(relation);
    const firstId = edgeIdentities.get(identity);
    if (firstId !== undefined) {
      errors.push({
        code: "DUPLICATE_RELATION",
        entityKind: relation.kind,
        entityId: relation.id,
        path: "relationIdentity",
        referencedId: firstId,
      });
    } else {
      edgeIdentities.set(identity, relation.id);
    }
  }

  for (const evidence of graph.evidenceLinks) {
    pushDangling(graph, errors, evidence, "factClaimId", "FACT_CLAIM", evidence.factClaimId);
  }
  for (const issue of graph.legalIssues) {
    pushDuplicateReferences(errors, issue, "factClaimIds", issue.factClaimIds);
    pushDuplicateReferences(errors, issue, "legalPropositionIds", issue.legalPropositionIds);
    for (const id of issue.factClaimIds) pushDangling(graph, errors, issue, "factClaimIds", "FACT_CLAIM", id);
    for (const id of issue.legalPropositionIds) {
      pushDangling(graph, errors, issue, "legalPropositionIds", "LEGAL_PROPOSITION", id);
    }
  }
  for (const application of graph.applications) {
    pushDuplicateReferences(errors, application, "factClaimIds", application.factClaimIds);
    pushDuplicateReferences(errors, application, "legalPropositionIds", application.legalPropositionIds);
    if (application.factClaimIds.length === 0) {
      errors.push({
        code: "APPLICATION_FACT_REQUIRED",
        entityKind: application.kind,
        entityId: application.id,
        path: "factClaimIds",
      });
    }
    if (application.legalPropositionIds.length === 0) {
      errors.push({
        code: "APPLICATION_PROPOSITION_REQUIRED",
        entityKind: application.kind,
        entityId: application.id,
        path: "legalPropositionIds",
      });
    }
    for (const id of application.factClaimIds) {
      pushDangling(graph, errors, application, "factClaimIds", "FACT_CLAIM", id);
    }
    for (const id of application.legalPropositionIds) {
      pushDangling(graph, errors, application, "legalPropositionIds", "LEGAL_PROPOSITION", id);
    }
  }
  for (const authority of graph.authorityRelations) {
    pushDangling(graph, errors, authority, "target", authority.target.kind, authority.target.id);
    if (!authority.authority.referenceDate.trim()) {
      errors.push({
        code: "AUTHORITY_REFERENCE_DATE_REQUIRED",
        entityKind: authority.kind,
        entityId: authority.id,
        path: "authority.referenceDate",
      });
    }
    const temporal = authority.authority.temporalAssessment;
    if (temporal && !temporal.referenceDate.trim()) {
      errors.push({
        code: "TEMPORAL_REFERENCE_DATE_REQUIRED",
        entityKind: authority.kind,
        entityId: authority.id,
        path: "authority.temporalAssessment.referenceDate",
      });
    } else if (temporal && temporal.referenceDate !== authority.authority.referenceDate) {
      errors.push({
        code: "TEMPORAL_REFERENCE_DATE_MISMATCH",
        entityKind: authority.kind,
        entityId: authority.id,
        path: "authority.temporalAssessment.referenceDate",
      });
    }
  }
  for (const counterArgument of graph.counterArguments) {
    pushDuplicateReferences(errors, counterArgument, "evidenceLinkIds", counterArgument.evidenceLinkIds);
    pushDuplicateReferences(errors, counterArgument, "authorityRelationIds", counterArgument.authorityRelationIds);
    if (counterArgument.target.kind === counterArgument.kind && counterArgument.target.id === counterArgument.id) {
      errors.push({
        code: "INVALID_SELF_REFERENCE",
        entityKind: counterArgument.kind,
        entityId: counterArgument.id,
        path: "target",
      });
    } else {
      pushDangling(
        graph,
        errors,
        counterArgument,
        "target",
        counterArgument.target.kind,
        counterArgument.target.id,
      );
    }
    for (const id of counterArgument.evidenceLinkIds) {
      pushDangling(graph, errors, counterArgument, "evidenceLinkIds", "EVIDENCE_LINK", id);
    }
    for (const id of counterArgument.authorityRelationIds) {
      const exists = graph.authorityRelations.some((relation) => relation.id === id);
      if (!exists) {
        errors.push({
          code: "DANGLING_REFERENCE",
          entityKind: counterArgument.kind,
          entityId: counterArgument.id,
          path: "authorityRelationIds",
          referencedId: id,
        });
      }
    }
  }
  for (const conclusion of graph.conclusions) {
    pushDuplicateReferences(errors, conclusion, "applicationIds", conclusion.applicationIds);
    if (!conclusion.legalIssueId) {
      errors.push({
        code: "CONCLUSION_ISSUE_REQUIRED",
        entityKind: conclusion.kind,
        entityId: conclusion.id,
        path: "legalIssueId",
      });
    } else {
      pushDangling(graph, errors, conclusion, "legalIssueId", "LEGAL_ISSUE", conclusion.legalIssueId);
    }
    if (conclusion.applicationIds.length === 0) {
      errors.push({
        code: "CONCLUSION_APPLICATION_REQUIRED",
        entityKind: conclusion.kind,
        entityId: conclusion.id,
        path: "applicationIds",
      });
    }
    for (const id of conclusion.applicationIds) {
      pushDangling(graph, errors, conclusion, "applicationIds", "APPLICATION", id);
    }
  }
  for (const sufficiency of graph.sourceSufficiencies) {
    pushDangling(graph, errors, sufficiency, "target", sufficiency.target.kind, sufficiency.target.id);
  }

  return errors.sort((left, right) => compareText(
    `${left.entityKind}\u0000${left.entityId}\u0000${left.code}\u0000${left.path}\u0000${left.referencedId ?? ""}`,
    `${right.entityKind}\u0000${right.entityId}\u0000${right.code}\u0000${right.path}\u0000${right.referencedId ?? ""}`,
  ));
}

export type ConclusionDependencyTrace = Readonly<{
  conclusion: Conclusion;
  legalIssue: LegalIssue | null;
  applications: readonly Application[];
  factClaims: readonly FactClaim[];
  evidenceLinks: readonly EvidenceLink[];
  legalPropositions: readonly LegalProposition[];
  authorities: readonly AuthorityRelation[];
  temporalAssessmentReferences: readonly Readonly<{
    authorityRelationId: string;
    reference: PersistedTemporalAssessmentReference;
  }>[];
  counterArguments: readonly CounterArgument[];
  sourceSufficiencies: readonly SourceSufficiency[];
}>;

export function traceConclusionDependencies(
  graph: LegalPropositionGraph,
  conclusionId: string,
): ConclusionDependencyTrace | null {
  const conclusion = graph.conclusions.find((item) => item.id === conclusionId);
  if (!conclusion) return null;
  const applications = graph.applications
    .filter((item) => conclusion.applicationIds.includes(item.id))
    .sort(byId);
  const factIds = new Set(applications.flatMap((item) => item.factClaimIds));
  const propositionIds = new Set(applications.flatMap((item) => item.legalPropositionIds));
  const factClaims = graph.factClaims.filter((item) => factIds.has(item.id)).sort(byId);
  const evidenceLinks = graph.evidenceLinks.filter((item) => factIds.has(item.factClaimId)).sort(byId);
  const legalPropositions = graph.legalPropositions
    .filter((item) => propositionIds.has(item.id))
    .sort(byId);
  const dependencyIds = new Set([
    conclusion.id,
    ...applications.map((item) => item.id),
    ...legalPropositions.map((item) => item.id),
  ]);
  let authorities = graph.authorityRelations
    .filter((item) => dependencyIds.has(item.target.id))
    .sort(byId);
  const authorityIds = new Set(authorities.map((item) => item.id));
  const counterArguments = graph.counterArguments.filter((item) => (
    item.target.id === conclusion.id
    || factIds.has(item.target.id)
    || propositionIds.has(item.target.id)
    || dependencyIds.has(item.target.id)
    || authorityIds.has(item.target.id)
  )).sort(byId);
  const counterArgumentIds = new Set(counterArguments.map((item) => item.id));
  const referencedAuthorityIds = new Set(counterArguments.flatMap((item) => item.authorityRelationIds));
  authorities = graph.authorityRelations.filter((item) => (
    dependencyIds.has(item.target.id)
    || counterArgumentIds.has(item.target.id)
    || referencedAuthorityIds.has(item.id)
  )).sort(byId);
  const sufficiencyTargetIds = new Set([
    conclusion.id,
    ...applications.map((item) => item.id),
    ...legalPropositions.map((item) => item.id),
    ...counterArgumentIds,
  ]);
  const sourceSufficiencies = graph.sourceSufficiencies
    .filter((item) => sufficiencyTargetIds.has(item.target.id))
    .sort(byId);
  const temporalAssessmentReferences = authorities
    .filter((item): item is AuthorityRelation & {
      authority: CanonicalAuthorityReference & { temporalAssessment: PersistedTemporalAssessmentReference };
    } => item.authority.temporalAssessment !== undefined)
    .map((item) => ({
      authorityRelationId: item.id,
      reference: item.authority.temporalAssessment,
    }));

  return {
    conclusion,
    legalIssue: graph.legalIssues.find((item) => item.id === conclusion.legalIssueId) ?? null,
    applications,
    factClaims,
    evidenceLinks,
    legalPropositions,
    authorities,
    temporalAssessmentReferences,
    counterArguments,
    sourceSufficiencies,
  };
}