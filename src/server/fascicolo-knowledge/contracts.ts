import { z } from "zod";

export const FASCICOLO_KNOWLEDGE_CONTRACT_VERSION = "FASCICOLO_KNOWLEDGE_V1" as const;
export const FASCICOLO_KNOWLEDGE_SEMANTIC_KEY_VERSION = "SEMANTIC_KEY_V1" as const;

export const knowledgeItemKindSchema = z.enum([
  "GENERIC",
  "PARTY_ROLE",
  "PARTY_POSITION",
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
export const knowledgeIdentityStateSchema = z.enum([
  "VERIFIED_NEW",
  "VERIFIED_CONTINUATION",
  "AMBIGUOUS",
  "LEGACY_UNVERIFIED",
]);
export const knowledgeSourceSpanSchema = z.object({
  documentoId: identifierSchema,
  documentFileVersionId: identifierSchema,
  pageNumber: z.number().int().positive(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  quote: z.string().min(1).max(100_000),
  textSha256: sha256Schema,
  quoteSha256: sha256Schema,
  basisRef: documentBasisRefSchema,
}).strict().refine((value) => value.endOffset > value.startOffset, {
  message: "SOURCE_SPAN_END_NOT_AFTER_START",
});
const sourceSpanFingerprints = z.array(sha256Schema).min(1).max(1_000)
  .transform((values) => [...new Set(values)].sort());
export const knowledgeIdentityBasisSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("SERVER_ASSIGNED_NEW"),
    sourceSpanFingerprints,
  }).strict(),
  z.object({
    type: z.literal("VERIFIED_SOURCE_SPAN_CONTINUITY"),
    predecessorItemId: identifierSchema,
    predecessorRevisionId: identifierSchema,
    sourceSpanFingerprints,
  }).strict(),
  z.object({
    type: z.literal("AMBIGUOUS_CONTINUITY"),
    candidatePredecessorItemIds: z.array(identifierSchema).min(1).max(100)
      .transform((values) => [...new Set(values)].sort()),
    reasonCodes: z.array(z.enum([
      "SOURCE_SPAN_MISSING",
      "SOURCE_SPAN_NOT_UNIQUE",
      "MULTIPLE_PREDECESSORS",
      "MULTIPLE_CANDIDATES_FOR_PREDECESSOR",
      "DOCUMENT_VERSION_CHANGED",
      "CONTINUITY_CLAIM_UNVERIFIED",
    ])).min(1).max(20).transform((values) => [...new Set(values)].sort()),
    sourceSpanFingerprints: z.array(sha256Schema).max(1_000)
      .transform((values) => [...new Set(values)].sort()),
  }).strict(),
]);
export const canonicalKnowledgeIdentitySchema = z.object({
  id: identifierSchema,
  tenantId: identifierSchema,
  procedimentoId: identifierSchema,
  kind: knowledgeItemKindSchema,
  createdInRevisionId: identifierSchema,
  creationBasis: knowledgeIdentityBasisSchema
    .refine((basis) => basis.type === "SERVER_ASSIGNED_NEW", "INVALID_CANONICAL_IDENTITY_CREATION_BASIS"),
}).strict();
export const persistedKnowledgeIdentitySchema = z.discriminatedUnion("state", [
  z.object({
    physicalItemId: identifierSchema,
    identityId: identifierSchema,
    state: z.literal("VERIFIED_NEW"),
    basis: z.null(),
  }).strict(),
  z.object({
    physicalItemId: identifierSchema,
    identityId: identifierSchema,
    state: z.literal("VERIFIED_CONTINUATION"),
    basis: knowledgeIdentityBasisSchema
      .refine((basis) => basis.type === "VERIFIED_SOURCE_SPAN_CONTINUITY", "INVALID_CONTINUATION_IDENTITY_BASIS"),
  }).strict(),
  z.object({
    physicalItemId: identifierSchema,
    identityId: z.null(),
    state: z.literal("AMBIGUOUS"),
    basis: knowledgeIdentityBasisSchema
      .refine((basis) => basis.type === "AMBIGUOUS_CONTINUITY", "INVALID_AMBIGUOUS_IDENTITY_BASIS"),
  }).strict(),
  z.object({
    physicalItemId: identifierSchema,
    identityId: z.null(),
    state: z.literal("LEGACY_UNVERIFIED"),
    basis: z.null(),
  }).strict(),
]);
export const KNOWLEDGE_SEMANTIC_CLASSIFICATION_VERSION =
  "KNOWLEDGE_SEMANTIC_CLASSIFICATION_V1" as const;
export const knowledgeSemanticClassificationSchema = z.object({
  version: z.literal(KNOWLEDGE_SEMANTIC_CLASSIFICATION_VERSION),
  fingerprint: sha256Schema,
}).strict();

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
export type KnowledgeIdentityState = z.output<typeof knowledgeIdentityStateSchema>;
export type KnowledgeSourceSpan = z.output<typeof knowledgeSourceSpanSchema>;
export type KnowledgeIdentityBasis = z.output<typeof knowledgeIdentityBasisSchema>;
export type CanonicalKnowledgeIdentity = z.output<typeof canonicalKnowledgeIdentitySchema>;
export type PersistedKnowledgeIdentity = z.output<typeof persistedKnowledgeIdentitySchema>;

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