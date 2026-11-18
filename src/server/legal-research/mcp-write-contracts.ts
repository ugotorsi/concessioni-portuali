import { z } from "zod";

import {
  assistedVerificationSnapshotSchema,
  submittedDocumentEvidenceSchema,
} from "@/server/legal-research/assisted-verification";
import {
  createAuthorityCandidate,
  RESEARCH_BRIDGE_VERSION,
  type AuthorityCandidateInput,
  type ResearchEvidenceBundle,
} from "@/server/legal-research/bridge";
import { legalAnalysisContributionSchema } from "@/server/legal-research/legal-synthesis";

const COMPLETION_STATES = [
  "COMPLETE",
  "PARTIAL",
  "BUDGET_EXHAUSTED",
  "FAILED",
  "HUMAN_DECISION_REQUIRED",
] as const;

export const researchMissionIdSchema = z.string().min(1).max(96);
export const researchExecutionIdSchema = z.string().min(1).max(256);
export const researchClaimTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);

const sourceFamilySchema = z.enum([
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
]);
const operationTypeSchema = z.enum([
  "SEMANTIC_SEARCH",
  "KEYWORD_SEARCH",
  "EXACT_RETRIEVAL",
  "FULL_TEXT_RETRIEVAL",
  "CITATION_SEARCH",
  "CROSS_JURISDICTION_SEARCH",
  "ADVERSE_AUTHORITY_SEARCH",
]);
const researchGapKindSchema = z.enum([
  "NO_ADVERSE_AUTHORITY_CHECK",
  "NO_CASSATION_CHECK",
  "NO_EU_CHECK",
  "FULL_TEXT_NOT_VERIFIED",
  "OFFICIAL_IDENTITY_NOT_VERIFIED",
  "TEMPORAL_VALIDITY_NOT_RESOLVED",
  "OPEN_COUNTERARGUMENT",
  "INSUFFICIENT_SOURCE_FAMILY_DIVERSITY",
  "MISSING_FACT_EVIDENCE",
  "MISSING_DOCUMENT",
  "UNRESOLVED_AUTHORITY_TREATMENT",
]);
const researchToolExecutionInputSchema = z.object({
  executionRecordId: z.string().min(1).max(256)
    .describe("Unique identifier for this provider call within the bundle."),
  toolId: z.string().min(1).max(128)
    .describe("Canonical provider tool family: MOONLIT, SIMPLICITER, or LEGAL_DATA_HUNTER."),
  providerId: z.string().min(1).max(128).optional(),
  role: z.enum([
    "LEGAL_RESEARCH_STRATEGIST",
    "CITATION_AUTHORITY_INTELLIGENCE",
    "BROAD_DISCOVERY",
    "OTHER",
  ]),
  operationType: operationTypeSchema,
  researchQuery: z.string().min(1).max(16_384),
  sourceFamiliesRequested: z.array(sourceFamilySchema).max(16),
  resultIdentifiersUsed: z.array(z.string().min(1).max(2_048)).max(100)
    .describe("Provider result identifiers retained as authority candidates; use [] when none were retained."),
  resultCount: z.number().int().min(0)
    .describe("Number of results returned by this provider call; use 0 for a failed call."),
  callsConsumed: z.number().int().min(0)
    .describe("Number of provider calls represented by this execution record."),
  errorState: z.object({
    code: z.string().min(1).max(256),
    retryable: z.boolean(),
  }).strict().optional()
    .describe("Required when the provider call failed; successful calls omit this property."),
}).strict().describe("Immutable provenance for one connector call.");
const authorityCandidateInputSchema = z.object({
  candidateId: z.string().min(1).max(256).optional()
    .describe("Omit for connector submissions; NOETRA generates the canonical candidateId."),
  kind: z.literal("AUTHORITY_CANDIDATE"),
  executionRecordId: z.string().min(1).max(256)
    .describe("Must reference an executionRecordId present in researchToolExecutions."),
  toolId: z.string().min(1).max(128),
  providerId: z.string().min(1).max(128).optional(),
  courtOrBody: z.string().min(1).max(1_024).optional(),
  documentType: z.string().min(1).max(512).optional(),
  number: z.string().min(1).max(256).optional(),
  year: z.number().int().optional(),
  documentDate: z.string().optional(),
  ecli: z.string().min(1).max(512).optional(),
  celex: z.string().min(1).max(512).optional(),
  officialIdentifier: z.string().min(1).max(2_048).optional()
    .describe("One stable identity field is required across ecli, celex, officialIdentifier, providerDocumentId, or the court/document/number/year composite."),
  title: z.string().min(1).max(8_192).optional(),
  sourceUrl: z.string().min(1).max(8_192).optional(),
  providerDocumentId: z.string().min(1).max(2_048).optional()
    .describe("Provider-native stable identifier; may satisfy the candidate identity requirement."),
  providerReceivedText: z.string().max(1_048_576).optional(),
  providerDates: z.object({
    actDate: z.string().optional(),
    decisionDate: z.string().optional(),
    filingDate: z.string().optional(),
    publicationDate: z.string().optional(),
    acquisitionDate: z.string().optional(),
    normativeVersionDate: z.string().optional(),
  }).strict().optional(),
  exactReferenceMatch: z.boolean().optional(),
  relevantPassage: z.string().max(262_144).optional(),
  summary: z.string().max(262_144).optional(),
  legalPropositionId: z.string().min(1).max(256).optional(),
  supportDirection: z.enum(["SUPPORT", "AGAINST", "QUALIFIES", "UNKNOWN"]),
  sourceFamily: sourceFamilySchema,
  retrievalMethod: operationTypeSchema,
  fullTextAvailable: z.boolean(),
  verificationState: z.enum([
    "OFFICIAL_VERIFICATION_REQUIRED",
    "OFFICIAL_VERIFICATION_PENDING",
    "OFFICIAL_VERIFICATION_FAILED",
    "OFFICIALLY_VERIFIED",
  ]),
  verifiedEvidence: z.unknown().optional()
    .describe("Supply only with OFFICIALLY_VERIFIED and the complete assisted-verification evidence shape."),
}).strict().describe("A source actually returned by a recorded provider execution; do not invent unavailable fields.");
const researchGapInputSchema = z.object({
  gapId: z.string().min(1).max(256)
    .describe("Unique stable identifier for this unresolved evidence gap within the bundle."),
  kind: researchGapKindSchema,
  targetId: z.string().min(1).max(256).optional()
    .describe("Optional related identifier. Omit when the canonical candidateId is not yet known."),
  sourceFamily: sourceFamilySchema.optional(),
}).strict().describe("A remaining research or verification gap. Use [] when no gap is being declared.");

export const researchEvidenceBundleInputSchema = z.object({
  kind: z.literal("RESEARCH_EVIDENCE_BUNDLE"),
  version: z.literal(RESEARCH_BRIDGE_VERSION),
  missionId: researchMissionIdSchema,
  executionId: researchExecutionIdSchema,
  assistedVerificationFingerprint: z.string().regex(/^assisted-evidence:[0-9a-f]{64}$/).optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  researchToolExecutions: z.array(researchToolExecutionInputSchema).max(100),
  authorityCandidates: z.array(authorityCandidateInputSchema).max(100),
  legalAnalysisContributions: z.array(legalAnalysisContributionSchema).max(32).optional(),
  citationObservations: z.array(z.unknown()),
  legalResearchSuggestions: z.array(z.unknown()),
  evidenceGaps: z.array(researchGapInputSchema).max(100),
  conflicts: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  suggestedFollowUpMissions: z.array(z.unknown()),
  humanDecisionEscalations: z.array(z.unknown()),
  completionState: z.enum(COMPLETION_STATES),
}).strict();

export function canonicalizeResearchEvidenceBundleInput(
  input: z.infer<typeof researchEvidenceBundleInputSchema>,
): ResearchEvidenceBundle | null {
  const authorityCandidates = input.authorityCandidates.map((candidate) => {
    const { candidateId, ...candidateInput } = candidate;
    const canonical = createAuthorityCandidate(candidateInput as AuthorityCandidateInput);
    return candidateId && candidateId !== canonical.candidateId ? null : canonical;
  });
  if (authorityCandidates.some((candidate) => candidate === null)) return null;
  return {
    ...input,
    authorityCandidates: authorityCandidates.filter((candidate) => candidate !== null),
  } as ResearchEvidenceBundle;
}

export const RESEARCH_MCP_WRITE_ARGUMENT_SCHEMAS = {
  research_claim_mission: z.object({
    missionId: researchMissionIdSchema,
    executionId: researchExecutionIdSchema,
    leaseDurationMs: z.number().int().min(1_000).max(86_400_000),
  }).strict(),
  research_submit_evidence_bundle: z.object({
    bundle: researchEvidenceBundleInputSchema,
    claimToken: researchClaimTokenSchema,
  }).strict(),
  research_submit_documentary_evidence: z.object({
    missionId: researchMissionIdSchema,
    executionId: researchExecutionIdSchema,
    claimToken: researchClaimTokenSchema,
    snapshot: assistedVerificationSnapshotSchema,
    documents: z.array(submittedDocumentEvidenceSchema).min(1).max(16),
  }).strict(),
  research_complete_mission: z.object({
    missionId: researchMissionIdSchema,
    executionId: researchExecutionIdSchema,
    bundleId: z.string().min(1).max(96),
    claimToken: researchClaimTokenSchema,
  }).strict(),
  research_defer_mission: z.object({
    missionId: researchMissionIdSchema,
    executionId: researchExecutionIdSchema,
    claimToken: researchClaimTokenSchema,
    disposition: z.enum(["DEFER", "RELEASE"]),
    reasonCode: z.string().min(1).max(256),
  }).strict(),
} as const;

export type ResearchMcpWriteAction = keyof typeof RESEARCH_MCP_WRITE_ARGUMENT_SCHEMAS;
