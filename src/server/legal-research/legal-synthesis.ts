import { z } from "zod";

export const LEGAL_ANALYSIS_CONTRIBUTION_VERSION = "LEGAL_ANALYSIS_CONTRIBUTION_V1" as const;

const id = z.string().trim().min(1).max(256);
const semanticKey = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().trim().min(20).max(20_000);
const references = z.array(id).min(1).max(32);

const groundedArgumentSchema = z.object({
  text,
  sourceCandidateIds: references,
  factBasisRefs: references,
}).strict();

const ruleApplicationSchema = z.object({
  title: z.string().trim().min(3).max(512),
  rule: text,
  sourceCandidateIds: references,
  relevantFacts: text,
  factBasisRefs: references,
  application: text,
  outcome: text,
}).strict();

const strategySchema = z.object({
  title: z.string().trim().min(3).max(512),
  rationale: text,
  sourceCandidateIds: references,
  factBasisRefs: references,
  risks: z.array(text).min(1).max(12),
}).strict();

export const legalAnalysisContributionSchema = z.object({
  version: z.literal(LEGAL_ANALYSIS_CONTRIBUTION_VERSION),
  contributionId: id,
  legalIssueSemanticKey: semanticKey,
  researchQuestionSemanticKey: semanticKey,
  issueStatement: text,
  ruleApplications: z.array(ruleApplicationSchema).min(1).max(20),
  supportingArguments: z.array(groundedArgumentSchema).min(1).max(20),
  contraryArguments: z.array(groundedArgumentSchema).min(1).max(20),
  evidenceAssessment: z.object({
    strengths: z.array(groundedArgumentSchema).min(1).max(20),
    weaknesses: z.array(groundedArgumentSchema).min(1).max(20),
    missingEvidence: z.array(text).max(20),
  }).strict(),
  reasonedConclusion: z.object({
    text,
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    decisiveSourceCandidateIds: references,
    decisiveFactBasisRefs: references,
    conditions: z.array(text).max(20),
  }).strict(),
  strategies: z.array(strategySchema).min(1).max(12),
  uncertainties: z.array(text).max(20),
}).strict();

export type LegalAnalysisContribution = z.infer<typeof legalAnalysisContributionSchema>;

export function contributionCandidateIds(
  contribution: LegalAnalysisContribution,
): readonly string[] {
  return [...new Set([
    ...contribution.ruleApplications.flatMap((item) => item.sourceCandidateIds),
    ...contribution.supportingArguments.flatMap((item) => item.sourceCandidateIds),
    ...contribution.contraryArguments.flatMap((item) => item.sourceCandidateIds),
    ...contribution.evidenceAssessment.strengths.flatMap((item) => item.sourceCandidateIds),
    ...contribution.evidenceAssessment.weaknesses.flatMap((item) => item.sourceCandidateIds),
    ...contribution.reasonedConclusion.decisiveSourceCandidateIds,
    ...contribution.strategies.flatMap((item) => item.sourceCandidateIds),
  ])].sort();
}

export function contributionBasisRefs(
  contribution: LegalAnalysisContribution,
): readonly string[] {
  return [...new Set([
    ...contribution.ruleApplications.flatMap((item) => item.factBasisRefs),
    ...contribution.supportingArguments.flatMap((item) => item.factBasisRefs),
    ...contribution.contraryArguments.flatMap((item) => item.factBasisRefs),
    ...contribution.evidenceAssessment.strengths.flatMap((item) => item.factBasisRefs),
    ...contribution.evidenceAssessment.weaknesses.flatMap((item) => item.factBasisRefs),
    ...contribution.reasonedConclusion.decisiveFactBasisRefs,
    ...contribution.strategies.flatMap((item) => item.factBasisRefs),
  ])].sort();
}
