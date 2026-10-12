import { z } from "zod";

export const FASCICOLO_KNOWLEDGE_CONTRACT_VERSION = "FASCICOLO_KNOWLEDGE_V1" as const;
export const FASCICOLO_KNOWLEDGE_SEMANTIC_KEY_VERSION = "SEMANTIC_KEY_V1" as const;

export const knowledgeItemKindSchema = z.enum([
  "GENERIC",
  "PARTY_ROLE",
  "FACT",
  "EVENT",
  "LEGAL_ACT",
  "MEASURE",
  "CONTRADICTION",
  "GAP",
  "DEADLINE_CANDIDATE",
  "LEGAL_ISSUE",
  "RESEARCH_QUESTION",
]);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const identifierSchema = z.string().trim().min(1).max(256);
export const documentBasisRefSchema = z.string().regex(/^DOCUMENT_[1-9]\d*\.PAGE_[1-9]\d*$/);

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));

export const knowledgeScopeSchema = z.object({
  tenantId: identifierSchema,
  procedimentoId: identifierSchema,
}).strict();

const commonKnowledgeEvidence = {
  documentoId: identifierSchema,
  documentFileVersionId: identifierSchema,
  pageNumber: z.number().int().positive(),
  textSha256: sha256Schema,
  quoteSha256: sha256Schema.nullable().optional().transform((value) => value ?? null),
  basisRef: documentBasisRefSchema,
};

export const knowledgeEvidenceCandidateSchema = z.object({
  ...commonKnowledgeEvidence,
  provenanceType: z.enum([
    "DOCUMENT_EXTRACTION",
    "FASCICOLO_DOCUMENT_EXTRACTION",
  ]).default("DOCUMENT_EXTRACTION"),
  extractionAttemptId: identifierSchema.optional(),
  documentExtractionAttemptId: identifierSchema.optional(),
}).strict().superRefine((value, context) => {
  const valid = value.provenanceType === "DOCUMENT_EXTRACTION"
    ? value.extractionAttemptId !== undefined && value.documentExtractionAttemptId === undefined
    : value.documentExtractionAttemptId !== undefined && value.extractionAttemptId === undefined;
  if (!valid) {
    context.addIssue({
      code: "custom",
      message: "EXTRACTION_PROVENANCE_ID_MISMATCH",
    });
  }
});

export const knowledgeItemCandidateSchema = z.object({
  kind: knowledgeItemKindSchema,
  normalizedIdentity: z.string().trim().min(1).max(4_000),
  normalizedText: z.string().trim().min(1).max(100_000),
  structuredPayload: jsonValueSchema,
  confidence: z.number().int().min(0).max(100).nullable().optional().transform((value) => value ?? null),
  evidence: z.array(knowledgeEvidenceCandidateSchema).min(1).max(1_000),
}).strict();

export const preparedKnowledgeItemCandidateSchema = knowledgeItemCandidateSchema.extend({
  semanticKey: sha256Schema,
  semanticKeyVersion: z.string().trim().min(1).max(64),
  contentFingerprint: sha256Schema,
}).strict();

export type KnowledgeScope = z.output<typeof knowledgeScopeSchema>;
export type KnowledgeEvidenceCandidate = z.output<typeof knowledgeEvidenceCandidateSchema>;
export type KnowledgeItemCandidate = z.output<typeof knowledgeItemCandidateSchema>;
export type KnowledgeItemKind = z.output<typeof knowledgeItemKindSchema>;

export type KnowledgeItemReviewStatus = "AI_PROPOSED" | "HUMAN_CONFIRMED" | "REJECTED";
export type KnowledgeRelationType = "RELATED_TO" | "SUPERSEDES" | "CONTRADICTS" | "ISSUE_DERIVED_FROM" | "QUESTION_FOR_ISSUE";

export type PreparedKnowledgeItemCandidate = z.output<typeof preparedKnowledgeItemCandidateSchema>;

export interface PersistedKnowledgeItemIdentity {
  readonly id: string;
  readonly semanticKey: string;
  readonly semanticKeyVersion: string;
  readonly contentFingerprint: string;
  readonly status: KnowledgeItemReviewStatus;
}

export type KnowledgeReconciliationClassification =
  | "ADDED"
  | "UNCHANGED"
  | "MODIFIED"
  | "NO_LONGER_SUPPORTED";

export interface KnowledgeReconciliationEntry {
  readonly classification: KnowledgeReconciliationClassification;
  readonly semanticKey: string;
  readonly semanticKeyVersion: string;
  readonly previousItemId: string | null;
  readonly candidate: PreparedKnowledgeItemCandidate | null;
  readonly nextStatus: KnowledgeItemReviewStatus | null;
}