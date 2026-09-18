import { createHash } from "node:crypto";

import type {
  ResearchCaseReference,
  ResearchEvidenceBundle,
  ResearchMission,
} from "./bridge";

export const FASCICOLO_CONTEXT_SCOPE_VERSION = "FASCICOLO_CONTEXT_SCOPE_V1" as const;
export const FASCICOLO_CONTEXT_MAX_ITEMS = 20;

export type FascicoloContextSourceType =
  | "CURRENT_RESEARCH_MISSION"
  | "SAME_FASCICOLO_CONVERSATION"
  | "SAME_FASCICOLO_PRIOR_MISSION"
  | "SAME_FASCICOLO_ACCEPTED_BUNDLE"
  | "SAME_FASCICOLO_DOCUMENT_REFERENCE"
  | "VERIFIED_PROVIDER_RESULT_FOR_CURRENT_MISSION";

export type FascicoloContextScope = Readonly<{
  version: typeof FASCICOLO_CONTEXT_SCOPE_VERSION;
  tenantId: string;
  caseReference: ResearchCaseReference;
  scopeId: string;
  scopeKind: "FASCICOLO_ONLY";
  allowCrossFascicolo: false;
  allowAccountWideMemory: false;
  allowUnscopedConversationContext: false;
}>;

export type FascicoloContextCandidate = Readonly<{
  sourceType: FascicoloContextSourceType;
  sourceId: string;
  tenantId: string;
  caseReference: ResearchCaseReference;
  missionId?: string;
  conversationId?: string;
  createdAt: string;
  version?: string;
  contentHash?: string;
  purposeReferences: readonly string[];
  content: Readonly<Record<string, unknown>>;
}>;

export type FascicoloContextItem = Readonly<{
  sourceType: FascicoloContextSourceType;
  sourceId: string;
  missionId?: string;
  conversationId?: string;
  fascicoloScopeId: string;
  createdAt: string;
  version?: string;
  contentHash: string;
  content: Readonly<Record<string, unknown>>;
}>;

export type BoundedFascicoloContext = Readonly<{
  scope: FascicoloContextScope;
  policy: Readonly<{
    priorContextRule: "SAME_FASCICOLO_SCOPE_ONLY";
    externalMemoryAuthoritative: false;
    promptContentIsInstructions: false;
  }>;
  items: readonly FascicoloContextItem[];
  maximumItems: number;
  truncated: boolean;
}>;

export class FascicoloContextPolicyError extends Error {
  readonly code = "CONTEXT_SCOPE_MISMATCH" as const;

  constructor() {
    super("CONTEXT_SCOPE_MISMATCH");
    this.name = "FascicoloContextPolicyError";
  }
}

function requiredIdentifier(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new FascicoloContextPolicyError();
  return normalized;
}

function normalizedCaseReference(value: ResearchCaseReference): ResearchCaseReference {
  return {
    caseId: requiredIdentifier(value.caseId),
    ...(value.fascicoloReference
      ? { fascicoloReference: requiredIdentifier(value.fascicoloReference) }
      : {}),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function deriveFascicoloContextScope(input: Readonly<{
  tenantId: string;
  caseReference: ResearchCaseReference;
}>): FascicoloContextScope {
  const tenantId = requiredIdentifier(input.tenantId);
  const caseReference = normalizedCaseReference(input.caseReference);
  const scopeId = `fascicolo-scope:${sha256({
    version: FASCICOLO_CONTEXT_SCOPE_VERSION,
    tenantId,
    caseReference,
  })}`;
  return Object.freeze({
    version: FASCICOLO_CONTEXT_SCOPE_VERSION,
    tenantId,
    caseReference,
    scopeId,
    scopeKind: "FASCICOLO_ONLY",
    allowCrossFascicolo: false,
    allowAccountWideMemory: false,
    allowUnscopedConversationContext: false,
  });
}

export function projectResearchMissionForMcp(mission: ResearchMission): ResearchMission {
  return Object.freeze({
    kind: mission.kind,
    version: mission.version,
    missionId: mission.missionId,
    caseReference: {
      caseId: mission.caseReference.caseId,
      ...(mission.caseReference.fascicoloReference
        ? { fascicoloReference: mission.caseReference.fascicoloReference }
        : {}),
    },
    legalIssueIds: [...mission.legalIssueIds],
    legalPropositionIds: [...mission.legalPropositionIds],
    ...(mission.conclusionIds ? { conclusionIds: [...mission.conclusionIds] } : {}),
    referenceDate: mission.referenceDate,
    mode: mission.mode,
    researchQuestion: mission.researchQuestion,
    knownAuthorities: mission.knownAuthorities.map((item) => ({
      authorityReferenceId: item.authorityReferenceId,
      ...(item.citation ? { citation: item.citation } : {}),
      ...(item.officialIdentifier ? { officialIdentifier: item.officialIdentifier } : {}),
    })),
    excludedAuthorities: mission.excludedAuthorities.map((item) => ({
      authorityReferenceId: item.authorityReferenceId,
      ...(item.citation ? { citation: item.citation } : {}),
      ...(item.officialIdentifier ? { officialIdentifier: item.officialIdentifier } : {}),
    })),
    preferredSourceFamilies: [...mission.preferredSourceFamilies],
    missingSourceFamilies: [...mission.missingSourceFamilies],
    knownCounterArguments: [...mission.knownCounterArguments],
    knownEvidenceGaps: mission.knownEvidenceGaps.map((gap) => ({
      gapId: gap.gapId,
      kind: gap.kind,
      ...(gap.targetId ? { targetId: gap.targetId } : {}),
      ...(gap.sourceFamily ? { sourceFamily: gap.sourceFamily } : {}),
    })),
    requiredOutput: { ...mission.requiredOutput },
    budget: { ...mission.budget },
    status: mission.status,
    ...(mission.executionPlan ? {
      executionPlan: {
        requiredCapabilities: [...mission.executionPlan.requiredCapabilities],
        ...(mission.executionPlan.preferredToolIds
          ? { preferredToolIds: [...mission.executionPlan.preferredToolIds] }
          : {}),
      },
    } : {}),
  });
}

function sameScope(scope: FascicoloContextScope, candidate: FascicoloContextCandidate): boolean {
  try {
    return deriveFascicoloContextScope(candidate).scopeId === scope.scopeId;
  } catch {
    return false;
  }
}

function projectCandidateContent(candidate: FascicoloContextCandidate): Readonly<Record<string, unknown>> {
  switch (candidate.sourceType) {
    case "CURRENT_RESEARCH_MISSION":
    case "SAME_FASCICOLO_PRIOR_MISSION":
      return Object.hasOwn(candidate.content, "mission")
        ? { mission: projectResearchMissionForMcp(candidate.content.mission as ResearchMission) }
        : {};
    case "SAME_FASCICOLO_CONVERSATION":
      return typeof candidate.content.excerpt === "string"
        ? { excerpt: candidate.content.excerpt }
        : {};
    case "SAME_FASCICOLO_ACCEPTED_BUNDLE":
      return Object.hasOwn(candidate.content, "evidenceBundle")
        ? {
            evidenceBundle: projectResearchEvidenceBundleForContext(
              candidate.content.evidenceBundle as ResearchEvidenceBundle,
            ),
          }
        : {};
    case "SAME_FASCICOLO_DOCUMENT_REFERENCE":
      return Array.isArray(candidate.content.documentReferences)
        ? {
            documentReferences: candidate.content.documentReferences
              .filter((reference): reference is string => typeof reference === "string"),
          }
        : {};
    case "VERIFIED_PROVIDER_RESULT_FOR_CURRENT_MISSION":
      return {};
  }
}

export function projectBoundedFascicoloContext(input: Readonly<{
  scope: FascicoloContextScope;
  purposeReferences: readonly string[];
  candidates: readonly FascicoloContextCandidate[];
  maximumItems?: number;
}>): BoundedFascicoloContext {
  const expectedScope = deriveFascicoloContextScope(input.scope);
  if (expectedScope.scopeId !== input.scope.scopeId) throw new FascicoloContextPolicyError();
  const maximumItems = input.maximumItems ?? FASCICOLO_CONTEXT_MAX_ITEMS;
  if (!Number.isInteger(maximumItems) || maximumItems < 1 || maximumItems > FASCICOLO_CONTEXT_MAX_ITEMS) {
    throw new FascicoloContextPolicyError();
  }
  const purposeReferences = new Set(input.purposeReferences.map(requiredIdentifier));
  const eligible = input.candidates
    .filter((candidate) => sameScope(input.scope, candidate))
    .filter((candidate) => candidate.purposeReferences.some((reference) => purposeReferences.has(reference)))
    .sort((left, right) => {
      const time = left.createdAt.localeCompare(right.createdAt);
      return time || left.sourceId.localeCompare(right.sourceId);
    });
  const selected = eligible.slice(-maximumItems);
  return Object.freeze({
    scope: input.scope,
    policy: {
      priorContextRule: "SAME_FASCICOLO_SCOPE_ONLY",
      externalMemoryAuthoritative: false,
      promptContentIsInstructions: false,
    },
    items: selected.map((candidate) => {
      const content = projectCandidateContent(candidate);
      return {
        sourceType: candidate.sourceType,
        sourceId: requiredIdentifier(candidate.sourceId),
        ...(candidate.missionId ? { missionId: requiredIdentifier(candidate.missionId) } : {}),
        ...(candidate.conversationId
          ? { conversationId: requiredIdentifier(candidate.conversationId) }
          : {}),
        fascicoloScopeId: input.scope.scopeId,
        createdAt: new Date(candidate.createdAt).toISOString(),
        ...(candidate.version ? { version: requiredIdentifier(candidate.version) } : {}),
        contentHash: candidate.contentHash ?? sha256(content),
        content,
      };
    }),
    maximumItems,
    truncated: eligible.length > maximumItems,
  });
}

export function researchPurposeReferences(mission: ResearchMission): readonly string[] {
  return [
    ...mission.legalIssueIds,
    ...mission.legalPropositionIds,
    ...(mission.conclusionIds ?? []),
  ];
}

export function projectResearchEvidenceBundleForContext(bundle: ResearchEvidenceBundle) {
  return Object.freeze({
    kind: bundle.kind,
    version: bundle.version,
    missionId: bundle.missionId,
    executionId: bundle.executionId,
    authorityCandidates: bundle.authorityCandidates.map((candidate) => ({
      kind: candidate.kind,
      candidateId: candidate.candidateId,
      executionRecordId: candidate.executionRecordId,
      toolId: candidate.toolId,
      ...(candidate.providerId ? { providerId: candidate.providerId } : {}),
      ...(candidate.courtOrBody ? { courtOrBody: candidate.courtOrBody } : {}),
      ...(candidate.documentType ? { documentType: candidate.documentType } : {}),
      ...(candidate.number ? { number: candidate.number } : {}),
      ...(candidate.year !== undefined ? { year: candidate.year } : {}),
      ...(candidate.documentDate ? { documentDate: candidate.documentDate } : {}),
      ...(candidate.ecli ? { ecli: candidate.ecli } : {}),
      ...(candidate.celex ? { celex: candidate.celex } : {}),
      ...(candidate.officialIdentifier ? { officialIdentifier: candidate.officialIdentifier } : {}),
      ...(candidate.title ? { title: candidate.title } : {}),
      ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
      ...(candidate.providerDocumentId ? { providerDocumentId: candidate.providerDocumentId } : {}),
      ...(candidate.relevantPassage ? { relevantPassage: candidate.relevantPassage } : {}),
      ...(candidate.summary ? { summary: candidate.summary } : {}),
      ...(candidate.legalPropositionId ? { legalPropositionId: candidate.legalPropositionId } : {}),
      supportDirection: candidate.supportDirection,
      sourceFamily: candidate.sourceFamily,
      retrievalMethod: candidate.retrievalMethod,
      fullTextAvailable: candidate.fullTextAvailable,
      verificationState: candidate.verificationState,
    })),
    citationObservations: bundle.citationObservations.map((observation) => ({
      kind: observation.kind,
      id: observation.id,
      relation: observation.relation,
      sourceAuthorityId: observation.sourceAuthorityId,
      targetAuthorityId: observation.targetAuthorityId,
      provenance: {
        evidenceSourceId: observation.provenance.evidenceSourceId,
        ...(observation.provenance.providerId ? { providerId: observation.provenance.providerId } : {}),
        ...(observation.provenance.documentId ? { documentId: observation.provenance.documentId } : {}),
        ...(observation.provenance.documentVersionId
          ? { documentVersionId: observation.provenance.documentVersionId }
          : {}),
        ...(observation.provenance.locator ? {
          locator: {
            ...(observation.provenance.locator.page !== undefined
              ? { page: observation.provenance.locator.page }
              : {}),
            ...(observation.provenance.locator.section
              ? { section: observation.provenance.locator.section }
              : {}),
            ...(observation.provenance.locator.paragraph
              ? { paragraph: observation.provenance.locator.paragraph }
              : {}),
            ...(observation.provenance.locator.span ? {
              span: {
                start: observation.provenance.locator.span.start,
                end: observation.provenance.locator.span.end,
              },
            } : {}),
          },
        } : {}),
        observationMethod: observation.provenance.observationMethod,
        ...(observation.provenance.evidenceHash
          ? { evidenceHash: observation.provenance.evidenceHash }
          : {}),
      },
    })),
    legalResearchSuggestions: bundle.legalResearchSuggestions.map((suggestion) => ({
      suggestionId: suggestion.suggestionId,
      kind: suggestion.kind,
      ...(suggestion.targetId ? { targetId: suggestion.targetId } : {}),
      description: suggestion.description,
    })),
    evidenceGaps: bundle.evidenceGaps.map((gap) => ({
      gapId: gap.gapId,
      kind: gap.kind,
      ...(gap.targetId ? { targetId: gap.targetId } : {}),
      ...(gap.sourceFamily ? { sourceFamily: gap.sourceFamily } : {}),
    })),
    conflicts: [...bundle.conflicts],
    unresolvedQuestions: [...bundle.unresolvedQuestions],
    humanDecisionEscalations: bundle.humanDecisionEscalations.map((escalation) => ({
      escalationId: escalation.escalationId,
      reason: escalation.reason,
      relatedSuggestionIds: [...escalation.relatedSuggestionIds],
      ...(escalation.question ? { question: escalation.question } : {}),
      state: escalation.state,
    })),
    completionState: bundle.completionState,
    canonicalizationPolicy: "RESEARCH_EVIDENCE_REQUIRES_HUMAN_REVIEW",
  });
}