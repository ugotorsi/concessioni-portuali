import { z } from "zod";

import { jsonValueSchema, type JsonValue } from "@/server/fascicolo-knowledge";

export const FASCICOLO_OPERATIONAL_PROPOSAL_POLICY_VERSION = "FASCICOLO_OPERATIONAL_PROPOSAL_V1" as const;

export const operationalProposalTypeSchema = z.enum([
  "DEADLINE",
  "CRITICALITY",
  "DOCUMENT_REQUIREMENT",
  "CHECKLIST_ITEM",
  "ACTIVITY",
  "NOTE",
  "SUBJECT_UPDATE",
]);

export const operationalProposalCandidateSchema = z.object({
  tenantId: z.string().trim().min(1).max(256),
  procedimentoId: z.string().trim().min(1).max(256),
  knowledgeRevisionId: z.string().trim().min(1).max(256),
  structuredReportId: z.string().trim().min(1).max(96).nullable(),
  structuredReportFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  policyVersion: z.literal(FASCICOLO_OPERATIONAL_PROPOSAL_POLICY_VERSION),
  proposalType: operationalProposalTypeSchema,
  title: z.string().trim().min(1).max(512),
  description: z.string().trim().min(1).max(100_000),
  proposedPayload: jsonValueSchema,
  originatingKnowledgeItemIds: z.array(z.string().trim().min(1).max(256)).max(1_000),
  originatingIssueSemanticKeys: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(1_000),
  originatingQuestionSemanticKeys: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(1_000),
  relevantResultIds: z.array(z.string().trim().min(1).max(256)).max(1_000),
  rationale: z.string().trim().min(1).max(100_000),
  confidence: z.number().int().min(0).max(100).nullable(),
  warningCodes: z.array(z.string().trim().min(1).max(128)).max(1_000),
  proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((candidate, context) => {
  const originCount = candidate.originatingKnowledgeItemIds.length
    + candidate.originatingIssueSemanticKeys.length
    + candidate.originatingQuestionSemanticKeys.length
    + candidate.relevantResultIds.length;
  if (originCount === 0) context.addIssue({ code: "custom", message: "STRUCTURED_ORIGIN_REQUIRED" });
});

export type OperationalProposalType = z.output<typeof operationalProposalTypeSchema>;
export type OperationalProposalCandidate = z.output<typeof operationalProposalCandidateSchema>;
export type OperationalProposalJson = JsonValue;