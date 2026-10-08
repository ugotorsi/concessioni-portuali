import { createHash } from "node:crypto";
import { z } from "zod";
import { adverseSearchSchema, adverseSearchReviewSchema, evaluateAdverseSearch, type AdverseSearch, type AdverseSearchReview, type AdverseSearchState } from "./adverse-search";

import {
  createAuthorityTreatmentAssessment,
  createCitationObservation,
  type AuthorityTreatmentAssessment,
  type CitationObservation,
  type CitationObservationProvenance,
} from "@/server/legal-reasoning/authority-treatment";
import type {
  AuthorityCandidate,
  LegalResearchSuggestion,
  ResearchCapability,
  ResearchGap,
  ResearchMission,
  ResearchSourceFamily,
} from "@/server/legal-research/bridge";
import { createAuthorityCandidate } from "@/server/legal-research/bridge";

export const ASSISTED_VERIFICATION_VERSION = "ASSISTED_VERIFICATION_V1" as const;

export type OfficialSourceEvidence = Readonly<{
  evidenceSourceId: string;
  authorityId: string;
  legalSourceId: string;
  legalExpressionVersionId: string;
  officialIdentifier: string;
  sourceUrl: string;
  sourceFamily?: ResearchSourceFamily;
  courtOrBody?: string;
  documentType?: string;
  providerId: string;
  accessStatus: "CONSULTABLE" | "UNAVAILABLE";
  identityVerificationStatus: "VERIFIED" | "UNVERIFIED";
  reviewerAttestation: Readonly<{
    reviewedByActorId: string;
    reviewedAt: string;
    rationale: string;
  }>;
  termsOfUse: Readonly<{
    status: "PERMITTED" | "UNKNOWN" | "PROHIBITED";
    basis: string;
    checkedAt: string;
  }>;
  fullText: Readonly<{
    available: boolean;
    contentSha256?: string;
    documentId?: string;
    fileVersionId?: string;
  }>;
}>;

export type VerifiedDocumentEvidence = Readonly<{
  evidenceSourceId: string;
  documentId: string;
  fileVersionId: string;
  contentSha256: string;
}>;

export type SubmittedDocumentEvidence = VerifiedDocumentEvidence & Readonly<{
  content: string;
}>;

export type AssistedGapResolution = Readonly<{
  gapId: string;
  evidenceSourceId: string;
  targetId: string;
}>;

export type DocumentedCitationRelation = Readonly<{
  sourceAuthorityId: string;
  targetAuthorityId: string;
  evidenceSourceId: string;
  documented: boolean;
  locator?: CitationObservationProvenance["locator"];
}>;

export type HumanAdverseReview = Readonly<{
  observationSourceAuthorityId: string;
  observationTargetAuthorityId: string;
  legalPropositionId: string;
  reviewedByActorId: string;
  reviewedAt: string;
  evidenceSourceId: string;
  rationale: string;
  decision: "ADVERSE" | "NOT_ADVERSE" | "INCONCLUSIVE";
}>;

export type HumanResearchSuggestion = Readonly<{
  kind: LegalResearchSuggestion["kind"];
  targetId?: string;
  description: string;
  rationale: string;
  originatingGapId: string;
  evidenceSourceId: string;
  reviewedByActorId: string;
  reviewedAt: string;
}>;

export type AssistedVerificationSnapshot = Readonly<{
  kind: "ASSISTED_VERIFICATION_SNAPSHOT";
  version: typeof ASSISTED_VERIFICATION_VERSION;
  missionId: string;
  sources: readonly OfficialSourceEvidence[];
  citationRelation?: DocumentedCitationRelation;
  adverseReview?: HumanAdverseReview;
  adverseSearch?: AdverseSearch;
  adverseSearchReview?: AdverseSearchReview;
  researchSuggestions?: readonly HumanResearchSuggestion[];
  gapResolutions?: readonly AssistedGapResolution[];
}>;

export type VerifiedFullTextEvidence = Readonly<{
  evidenceSourceId: string;
  authorityId: string;
  legalSourceId: string;
  legalExpressionVersionId: string;
  officialIdentifier: string;
  sourceUrl: string;
  providerId: string;
  contentSha256: string;
  termsOfUseBasis: string;
  termsCheckedAt: string;
}>;

export type DocumentedResearchSuggestion = LegalResearchSuggestion & Readonly<{
  originatingGapId: string;
  evidenceSourceIds: readonly string[];
  classification: "RESEARCH_ACTION_NOT_LEGAL_CONCLUSION";
  rationale: string;
  reviewedByActorId: string;
  reviewedAt: string;
}>;

export type AssistedVerificationResult = Readonly<{
  assistedVerificationFingerprint?: string;
  authorityCandidates: readonly AuthorityCandidate[];
  verifiedFullTexts: readonly VerifiedFullTextEvidence[];
  citationObservations: readonly CitationObservation[];
  adverseAssessments: readonly AuthorityTreatmentAssessment[];
  legalResearchSuggestions: readonly DocumentedResearchSuggestion[];
  evidenceGaps: readonly ResearchGap[];
  adverseAuthorityVerified: boolean;
  adverseSearchCompleted?: boolean;
  adverseSearchState?: AdverseSearchState;
  resolvedGaps?: readonly AssistedGapResolution[];
}>;

export type AssistedVerificationPreClaimStatus = Readonly<{
  satisfied: boolean;
  unmetRequirements: readonly string[];
}>;

const nonblank = z.string().trim().min(1);
const isoDate = nonblank.refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
});
const evidenceLocatorSchema = z.object({
  page: z.number().int().positive().optional(),
  section: nonblank.optional(),
  paragraph: nonblank.optional(),
  span: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
    .strict()
    .optional(),
}).strict();
const officialSourceSchema = z.object({
  evidenceSourceId: nonblank,
  authorityId: nonblank,
  legalSourceId: nonblank,
  legalExpressionVersionId: nonblank,
  officialIdentifier: nonblank,
  sourceUrl: z.string().url(),
  sourceFamily: z.enum([
    "ITALIAN_LEGISLATION",
    "EU_LEGISLATION",
    "CASSAZIONE",
    "CORTE_COSTITUZIONALE",
    "GIURISPRUDENZA_DI_MERITO",
    "GIUSTIZIA_AMMINISTRATIVA",
    "CJEU",
    "CNF",
    "ECHR",
    "OTHER",
  ]).optional(),
  courtOrBody: nonblank.optional(),
  documentType: nonblank.optional(),
  providerId: nonblank,
  accessStatus: z.enum(["CONSULTABLE", "UNAVAILABLE"]),
  identityVerificationStatus: z.enum(["VERIFIED", "UNVERIFIED"]),
  reviewerAttestation: z.object({
    reviewedByActorId: nonblank,
    reviewedAt: isoDate,
    rationale: nonblank,
  }).strict(),
  termsOfUse: z.object({
    status: z.enum(["PERMITTED", "UNKNOWN", "PROHIBITED"]),
    basis: z.string(),
    checkedAt: isoDate,
  }).strict(),
  fullText: z.object({
    available: z.boolean(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    documentId: nonblank.optional(),
    fileVersionId: nonblank.optional(),
  }).strict(),
}).strict();
export const assistedVerificationSnapshotSchema = z.object({
  kind: z.literal("ASSISTED_VERIFICATION_SNAPSHOT"),
  version: z.literal(ASSISTED_VERIFICATION_VERSION),
  missionId: nonblank.max(96),
  sources: z.array(officialSourceSchema),
  adverseSearch: adverseSearchSchema.optional(),
  adverseSearchReview: adverseSearchReviewSchema.optional(),
  gapResolutions: z.array(z.object({
    gapId: nonblank,
    evidenceSourceId: nonblank,
    targetId: nonblank,
  }).strict()).optional(),
  citationRelation: z.object({
    sourceAuthorityId: nonblank,
    targetAuthorityId: nonblank,
    evidenceSourceId: nonblank,
    documented: z.boolean(),
    locator: evidenceLocatorSchema.optional(),
  }).strict().optional(),
  adverseReview: z.object({
    observationSourceAuthorityId: nonblank,
    observationTargetAuthorityId: nonblank,
    legalPropositionId: nonblank,
    reviewedByActorId: nonblank,
    reviewedAt: isoDate,
    evidenceSourceId: nonblank,
    rationale: nonblank,
    decision: z.enum(["ADVERSE", "NOT_ADVERSE", "INCONCLUSIVE"]),
  }).strict().optional(),
  researchSuggestions: z.array(z.object({
    kind: z.enum([
      "MISSING_LEGAL_PROPOSITION",
      "MISSING_FACTUAL_EVIDENCE",
      "MISSING_ADMINISTRATIVE_DOCUMENT",
      "MISSING_SOURCE_FAMILY",
      "ALTERNATIVE_LEGAL_QUALIFICATION",
      "POSSIBLE_COUNTERARGUMENT",
      "HUMAN_LEGAL_JUDGMENT_QUESTION",
    ]),
    targetId: nonblank.optional(),
    description: nonblank,
    rationale: nonblank,
    originatingGapId: nonblank,
    evidenceSourceId: nonblank,
    reviewedByActorId: nonblank,
    reviewedAt: isoDate,
  }).strict()).optional(),
}).strict();

export const submittedDocumentEvidenceSchema = z.object({
  evidenceSourceId: nonblank,
  documentId: nonblank,
  fileVersionId: nonblank,
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().min(1).max(1_048_576),
}).strict();

export function parseAssistedVerificationSnapshot(value: unknown): AssistedVerificationSnapshot | null {
  const parsed = assistedVerificationSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createAssistedVerificationSnapshot(
  input: Omit<AssistedVerificationSnapshot, "kind" | "version">,
): AssistedVerificationSnapshot {
  const snapshot = parseAssistedVerificationSnapshot({
    kind: "ASSISTED_VERIFICATION_SNAPSHOT",
    version: ASSISTED_VERIFICATION_VERSION,
    ...input,
  });
  if (!snapshot) throw new Error("INVALID_ASSISTED_VERIFICATION");
  return snapshot;
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function validDate(value: string): boolean {
  const parsed = new Date(value);
  return Boolean(value.trim()) && Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function documentedSource(source: OfficialSourceEvidence): boolean {
  try {
    const url = new URL(source.sourceUrl);
    return url.protocol === "https:"
      && Boolean(source.evidenceSourceId.trim())
      && Boolean(source.authorityId.trim())
      && Boolean(source.legalSourceId.trim())
      && Boolean(source.legalExpressionVersionId.trim())
      && Boolean(source.officialIdentifier.trim())
      && Boolean(source.providerId.trim())
      && source.accessStatus === "CONSULTABLE"
      && source.identityVerificationStatus === "VERIFIED"
      && Boolean(source.reviewerAttestation.reviewedByActorId.trim())
      && validDate(source.reviewerAttestation.reviewedAt)
      && Boolean(source.reviewerAttestation.rationale.trim())
      && source.termsOfUse.status === "PERMITTED"
      && Boolean(source.termsOfUse.basis.trim())
      && validDate(source.termsOfUse.checkedAt);
  } catch {
    return false;
  }
}

function declaredFullText(source: OfficialSourceEvidence): boolean {
  return documentedSource(source)
    && source.fullText.available
    && typeof source.fullText.contentSha256 === "string"
    && /^[a-f0-9]{64}$/i.test(source.fullText.contentSha256);
}

function documentedLocator(locator: CitationObservationProvenance["locator"]): boolean {
  return Boolean(locator && (
    locator.page !== undefined
    || locator.section?.trim()
    || locator.paragraph?.trim()
    || locator.span !== undefined
  ));
}

function gap(
  mission: ResearchMission,
  kind: ResearchGap["kind"],
  targetId?: string,
): ResearchGap {
  return {
    gapId: stableId("research-gap", [mission.missionId, "assisted-verification", kind, targetId]),
    kind,
    ...(targetId ? { targetId } : {}),
  };
}

function suggestionsFromHumanReview(
  gaps: readonly ResearchGap[],
  sources: readonly OfficialSourceEvidence[],
  suggestions: readonly HumanResearchSuggestion[],
): readonly DocumentedResearchSuggestion[] {
  return suggestions.flatMap((item) => {
    const evidence = sources.find((source) => (
      source.evidenceSourceId === item.evidenceSourceId
    ));
    if (!evidence
      || !gaps.some((gap) => gap.gapId === item.originatingGapId
        && (!item.targetId || item.targetId === gap.targetId))
      || !item.description.trim()
      || !item.rationale.trim()
      || !item.reviewedByActorId.trim()
      || !validDate(item.reviewedAt)) return [];
    return {
      suggestionId: stableId("research-suggestion", item),
      kind: item.kind,
      ...(item.targetId ? { targetId: item.targetId } : {}),
      description: item.description,
      originatingGapId: item.originatingGapId,
      evidenceSourceIds: [evidence.evidenceSourceId],
      classification: "RESEARCH_ACTION_NOT_LEGAL_CONCLUSION" as const,
      rationale: item.rationale,
      reviewedByActorId: item.reviewedByActorId,
      reviewedAt: item.reviewedAt,
    };
  });
}

export function verifyResearchEvidence(input: Readonly<{
  mission: ResearchMission;
  sources: readonly OfficialSourceEvidence[];
  citationRelation?: DocumentedCitationRelation;
  adverseReview?: HumanAdverseReview;
  adverseSearch?: AdverseSearch;
  adverseSearchReview?: AdverseSearchReview;
  researchSuggestions?: readonly HumanResearchSuggestion[];
  gapResolutions?: readonly AssistedGapResolution[];
  verifiedDocuments?: readonly VerifiedDocumentEvidence[];
}>): AssistedVerificationResult {
  const verifiedFullText = (source: OfficialSourceEvidence) => declaredFullText(source)
    && (input.verifiedDocuments ?? []).some((document) => (
      document.evidenceSourceId === source.evidenceSourceId
      && document.documentId === source.fullText.documentId
      && document.fileVersionId === source.fullText.fileVersionId
      && document.contentSha256 === source.fullText.contentSha256
    ));
  const gaps = [...input.mission.knownEvidenceGaps];
  const verifiedFullTexts = input.sources.filter(verifiedFullText).map((source) => ({
    evidenceSourceId: source.evidenceSourceId,
    authorityId: source.authorityId,
    legalSourceId: source.legalSourceId,
    legalExpressionVersionId: source.legalExpressionVersionId,
    officialIdentifier: source.officialIdentifier,
    sourceUrl: source.sourceUrl,
    providerId: source.providerId,
    contentSha256: source.fullText.contentSha256!,
    termsOfUseBasis: source.termsOfUse.basis,
    termsCheckedAt: source.termsOfUse.checkedAt,
  }));
  if (input.mission.requiredOutput.fullTextRequired && verifiedFullTexts.length === 0) {
    gaps.push(gap(input.mission, "FULL_TEXT_NOT_VERIFIED"));
  }
  if (input.mission.requiredOutput.fullTextRequired) {
    for (const source of input.sources.filter((item) => item.fullText.available && !verifiedFullText(item))) {
      gaps.push(gap(input.mission, "FULL_TEXT_NOT_VERIFIED", source.evidenceSourceId));
    }
  }
  for (const family of input.mission.missingSourceFamilies) {
    if (!input.sources.some((source) => source.sourceFamily === family && verifiedFullText(source))) {
      gaps.push({ ...gap(input.mission, "INSUFFICIENT_SOURCE_FAMILY_DIVERSITY", family), sourceFamily: family });
    }
  }

  const citationObservations: CitationObservation[] = [];
  const relation = input.citationRelation;
  if (relation?.documented && documentedLocator(relation.locator)) {
    const sourceAuthority = input.sources.find((source) => (
      source.authorityId === relation.sourceAuthorityId && documentedSource(source)
    ));
    const targetAuthority = input.sources.find((source) => (
      source.authorityId === relation.targetAuthorityId && documentedSource(source)
    ));
    const evidence = input.sources.find((source) => (
      source.evidenceSourceId === relation.evidenceSourceId
      && source.authorityId === relation.sourceAuthorityId
      && verifiedFullText(source)
    ));
    if (sourceAuthority && targetAuthority && evidence
      && relation.sourceAuthorityId !== relation.targetAuthorityId) {
      citationObservations.push(createCitationObservation({
        kind: "CITATION_OBSERVATION",
        relation: "CITES",
        sourceAuthorityId: relation.sourceAuthorityId,
        targetAuthorityId: relation.targetAuthorityId,
        provenance: {
          evidenceSourceId: evidence.evidenceSourceId,
          providerId: evidence.providerId,
          documentId: evidence.officialIdentifier,
          ...(relation.locator ? { locator: relation.locator } : {}),
          observationMethod: "DOCUMENT_EXTRACTION",
          evidenceHash: evidence.fullText.contentSha256,
        },
      }));
    }
  }
  if (input.mission.requiredOutput.citationObservations && citationObservations.length === 0) {
    gaps.push(gap(input.mission, "UNRESOLVED_AUTHORITY_TREATMENT"));
  }

  const authorityCandidates: AuthorityCandidate[] = [];
  if (citationObservations.length > 0 && relation?.locator) {
    const source = input.sources.find((item) => (
      item.evidenceSourceId === relation.evidenceSourceId
      && item.authorityId === relation.sourceAuthorityId
      && verifiedFullText(item)
    ));
    if (source?.sourceFamily && source.courtOrBody?.trim() && source.documentType?.trim()) {
      authorityCandidates.push(createAuthorityCandidate({
        kind: "AUTHORITY_CANDIDATE",
        executionRecordId: stableId(
          "research-execution",
          [input.mission.missionId, "assisted-verification", source.evidenceSourceId],
        ),
        toolId: "ASSISTED_VERIFICATION",
        providerId: source.providerId,
        courtOrBody: source.courtOrBody,
        documentType: source.documentType,
        officialIdentifier: source.officialIdentifier,
        sourceUrl: source.sourceUrl,
        providerDocumentId: source.legalExpressionVersionId,
        supportDirection: "UNKNOWN",
        sourceFamily: source.sourceFamily,
        retrievalMethod: "FULL_TEXT_RETRIEVAL",
        fullTextAvailable: true,
        verificationState: "OFFICIALLY_VERIFIED",
        verifiedEvidence: {
          evidenceSourceId: source.evidenceSourceId,
          legalSourceId: source.legalSourceId,
          legalExpressionVersionId: source.legalExpressionVersionId,
          contentSha256: source.fullText.contentSha256!,
          locator: relation.locator,
          termsOfUseBasis: source.termsOfUse.basis,
          termsCheckedAt: source.termsOfUse.checkedAt,
          reviewedByActorId: source.reviewerAttestation.reviewedByActorId,
          reviewedAt: source.reviewerAttestation.reviewedAt,
          reviewRationale: source.reviewerAttestation.rationale,
        },
      }));
    }
  }
  if (input.mission.requiredOutput.authorityCandidates && authorityCandidates.length === 0) {
    gaps.push(gap(
      input.mission,
      "OFFICIAL_IDENTITY_NOT_VERIFIED",
      relation?.evidenceSourceId ?? input.sources[0]?.evidenceSourceId,
    ));
  }

  const adverseAssessments: AuthorityTreatmentAssessment[] = [];
  const adverseRequired = input.mission.executionPlan?.requiredCapabilities
    .includes("ADVERSE_AUTHORITY_DISCOVERY") ?? false;
  const review = input.adverseReview;
  const observation = review
    ? citationObservations.find((item) => (
        item.sourceAuthorityId === review.observationSourceAuthorityId
        && item.targetAuthorityId === review.observationTargetAuthorityId
        && item.provenance.evidenceSourceId === review.evidenceSourceId
      ))
    : undefined;
  if (
    review
    && observation
    && review.decision === "ADVERSE"
    && input.mission.legalPropositionIds.includes(review.legalPropositionId)
    && review.reviewedByActorId.trim()
    && review.rationale.trim()
    && validDate(review.reviewedAt)
  ) {
    adverseAssessments.push(createAuthorityTreatmentAssessment({
      kind: "AUTHORITY_TREATMENT_ASSESSMENT",
      observationId: observation.id,
      sourceAuthorityId: observation.sourceAuthorityId,
      targetAuthorityId: observation.targetAuthorityId,
      treatment: "ADVERSE",
      origin: "HUMAN",
      reviewState: "CONFIRMED",
      scope: { kind: "LEGAL_PROPOSITION", id: review.legalPropositionId },
      rationale: review.rationale,
      humanReview: {
        reviewedByActorId: review.reviewedByActorId,
        reviewedAt: review.reviewedAt,
        evidenceSourceId: review.evidenceSourceId,
        rationale: review.rationale,
      },
    }));
  }
  const adverseSearch = evaluateAdverseSearch({
    mission: input.mission,
    sources: input.sources,
    verifiedDocuments: (input.verifiedDocuments ?? []).filter(document => verifiedFullTexts.some(source => source.evidenceSourceId === document.evidenceSourceId)),
    adverseAuthorityVerified: adverseAssessments.length > 0,
    singleDecisionInconclusive: input.adverseReview?.decision === "INCONCLUSIVE",
    search: input.adverseSearch,
    review: input.adverseSearchReview,
  });
  if (adverseRequired && !adverseSearch.completed) {
    gaps.push(gap(input.mission, "NO_ADVERSE_AUTHORITY_CHECK"));
  }

  const resolvedGaps = (input.gapResolutions ?? []).filter((resolution) => {
    const pending = input.mission.knownEvidenceGaps.find((item) => item.gapId === resolution.gapId);
    const evidence = input.sources.find((source) => source.evidenceSourceId === resolution.evidenceSourceId
      && verifiedFullText(source));
    if (!pending || !evidence || (pending.targetId && pending.targetId !== resolution.targetId)
      || (pending.sourceFamily && pending.sourceFamily !== evidence.sourceFamily)) return false;
    const sourceTargets = [evidence.authorityId, evidence.evidenceSourceId, evidence.legalSourceId,
      evidence.legalExpressionVersionId, evidence.officialIdentifier, evidence.fullText.documentId];
    if (["FULL_TEXT_NOT_VERIFIED", "MISSING_DOCUMENT", "OFFICIAL_IDENTITY_NOT_VERIFIED"].includes(pending.kind)) {
      return sourceTargets.includes(resolution.targetId);
    }
    if (pending.kind === "NO_EU_CHECK") {
      return (evidence.sourceFamily === "CJEU" || evidence.sourceFamily === "EU_LEGISLATION")
        && sourceTargets.includes(resolution.targetId);
    }
    if (pending.kind === "NO_CASSATION_CHECK") {
      return evidence.sourceFamily === "CASSAZIONE" && sourceTargets.includes(resolution.targetId);
    }
    if (pending.kind === "UNRESOLVED_AUTHORITY_TREATMENT") {
      return citationObservations.some((observation) => observation.provenance.evidenceSourceId === resolution.evidenceSourceId
        && [observation.sourceAuthorityId, observation.targetAuthorityId].includes(resolution.targetId));
    }
    if (pending.kind === "NO_ADVERSE_AUTHORITY_CHECK") {
      return adverseAssessments.some((assessment) => assessment.humanReview?.evidenceSourceId === resolution.evidenceSourceId
        && assessment.scope?.id === resolution.targetId)
        || (adverseSearch.state === "COMPLETED_NO_ADVERSE_FOUND"
          && input.adverseSearch?.legalPropositionId === resolution.targetId
          && input.adverseSearch.examinedDocuments.some(document => document.evidenceSourceId === resolution.evidenceSourceId));
    }
    return false;
  });
  const resolvedIds = new Set(resolvedGaps.map((item) => item.gapId));
  const uniqueGaps = [...new Map(gaps.filter((item) => !resolvedIds.has(item.gapId)).map((item) => [item.gapId, item])).values()];
  return {
    assistedVerificationFingerprint: stableId("assisted-evidence", createAssistedVerificationSnapshot({
      missionId: input.mission.missionId,
      sources: input.sources,
      citationRelation: input.citationRelation,
      adverseReview: input.adverseReview,
      ...(input.adverseSearch ? { adverseSearch: input.adverseSearch } : {}),
      ...(input.adverseSearchReview ? { adverseSearchReview: input.adverseSearchReview } : {}),
      researchSuggestions: input.researchSuggestions,
      gapResolutions: input.gapResolutions,
    })),
    authorityCandidates,
    verifiedFullTexts,
    citationObservations,
    adverseAssessments,
    legalResearchSuggestions: suggestionsFromHumanReview(
      [...gaps, gap(input.mission, "NO_ADVERSE_AUTHORITY_CHECK"), gap(input.mission, "FULL_TEXT_NOT_VERIFIED"),
        gap(input.mission, "UNRESOLVED_AUTHORITY_TREATMENT")],
      input.sources.filter(verifiedFullText),
      input.researchSuggestions ?? [],
    ),
    evidenceGaps: uniqueGaps,
    adverseAuthorityVerified: adverseAssessments.length > 0,
    adverseSearchCompleted: adverseSearch.completed,
    adverseSearchState: adverseSearch.state,
    resolvedGaps,
  };
}

export function assistedVerificationPreClaimStatus(
  mission: ResearchMission,
  result: AssistedVerificationResult,
): AssistedVerificationPreClaimStatus {
  const unmetRequirements: string[] = [];
  if (mission.requiredOutput.authorityCandidates && result.authorityCandidates.length === 0) {
    unmetRequirements.push("AUTHORITY_CANDIDATES_MISSING");
  }
  if (mission.requiredOutput.fullTextRequired && result.verifiedFullTexts.length === 0) {
    unmetRequirements.push("FULL_TEXT_UNVERIFIED");
  }
  if (mission.requiredOutput.citationObservations && result.citationObservations.length === 0) {
    unmetRequirements.push("CITATION_OBSERVATIONS_MISSING");
  }
  if (mission.requiredOutput.legalResearchSuggestions && result.legalResearchSuggestions.length === 0) {
    unmetRequirements.push("RESEARCH_SUGGESTIONS_MISSING");
  }
  const locallySatisfiedCapabilities = new Set<ResearchCapability>();
  if (result.verifiedFullTexts.length > 0) locallySatisfiedCapabilities.add("FULL_TEXT_RETRIEVAL");
  if (result.citationObservations.length > 0) locallySatisfiedCapabilities.add("CITATION_NETWORK");
  if (result.adverseSearchCompleted ?? result.adverseAuthorityVerified) locallySatisfiedCapabilities.add("ADVERSE_AUTHORITY_DISCOVERY");
  for (const capability of mission.executionPlan?.requiredCapabilities ?? []) {
    if (!locallySatisfiedCapabilities.has(capability)) {
      unmetRequirements.push(`CAPABILITY_${capability}_MISSING`);
    }
  }
  if (result.evidenceGaps.length > 0) unmetRequirements.push("EVIDENCE_GAPS_REMAIN");
  return {
    satisfied: unmetRequirements.length === 0,
    unmetRequirements: [...new Set(unmetRequirements)],
  };
}

export const trustedAssistedEvidenceSchema = z.object({
  recordId: nonblank,
  snapshot: assistedVerificationSnapshotSchema,
  verifiedDocuments: z.array(z.object({
    evidenceSourceId: nonblank,
    documentId: nonblank,
    fileVersionId: nonblank,
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()),
}).strict();