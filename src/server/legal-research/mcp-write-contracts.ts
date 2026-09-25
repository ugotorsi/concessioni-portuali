import { z } from "zod";

import { RESEARCH_BRIDGE_VERSION } from "@/server/legal-research/bridge";

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

export const researchEvidenceBundleInputSchema = z.object({
  kind: z.literal("RESEARCH_EVIDENCE_BUNDLE"),
  version: z.literal(RESEARCH_BRIDGE_VERSION),
  missionId: researchMissionIdSchema,
  executionId: researchExecutionIdSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  researchToolExecutions: z.array(z.unknown()),
  authorityCandidates: z.array(z.unknown()),
  citationObservations: z.array(z.unknown()),
  legalResearchSuggestions: z.array(z.unknown()),
  evidenceGaps: z.array(z.unknown()),
  conflicts: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  suggestedFollowUpMissions: z.array(z.unknown()),
  humanDecisionEscalations: z.array(z.unknown()),
  completionState: z.enum(COMPLETION_STATES),
}).strict();

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
