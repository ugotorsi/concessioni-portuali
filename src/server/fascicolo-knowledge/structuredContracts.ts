import { z } from "zod";

import { documentBasisRefSchema, knowledgeItemKindSchema } from "./contracts";

export const FASCICOLO_STRUCTURED_KNOWLEDGE_VERSION = "FASCICOLO_STRUCTURED_KNOWLEDGE_V1" as const;
export const FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION = "SEMANTIC_KEY_V2" as const;

const id = z.string().trim().min(1).max(256);
const text = z.string().trim().min(1).max(100_000);
const shortText = z.string().trim().min(1).max(512);
const basisRefs = z.array(documentBasisRefSchema).min(1).max(64);
const localIds = z.array(id).max(100);
const confidence = z.number().int().min(0).max(100).nullable().optional().transform((value) => value ?? null);
const isoDate = z.string().date();

export const fascicoloSubjectTypeSchema = z.enum([
  "PERSON",
  "ORGANIZATION",
  "PUBLIC_ADMINISTRATION",
  "OFFICE",
  "AUTHORITY",
  "UNKNOWN",
]);

export const fascicoloStrongIdentifierSchema = z.object({
  type: z.enum(["CODICE_FISCALE", "PARTITA_IVA", "PEC", "INSTITUTIONAL", "OTHER"]),
  value: shortText,
}).strict();

export const fascicoloSubjectCandidateSchema = z.object({
  localId: id,
  canonicalName: shortText,
  subjectType: fascicoloSubjectTypeSchema,
  strongIdentifiers: z.array(fascicoloStrongIdentifierSchema).max(32).default([]),
  aliases: z.array(shortText).max(100).default([]),
}).strict();

export const structuredDateSchema = z.discriminatedUnion("precision", [
  z.object({ precision: z.literal("EXACT"), from: isoDate, to: z.null().default(null), originalText: shortText.nullable().default(null), confidence }).strict(),
  z.object({ precision: z.literal("MONTH"), from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), to: z.null().default(null), originalText: shortText.nullable().default(null), confidence }).strict(),
  z.object({ precision: z.literal("YEAR"), from: z.string().regex(/^\d{4}$/), to: z.null().default(null), originalText: shortText.nullable().default(null), confidence }).strict(),
  z.object({ precision: z.literal("INTERVAL"), from: isoDate, to: isoDate, originalText: shortText.nullable().default(null), confidence }).strict()
    .refine((value) => value.from <= value.to, { message: "INTERVAL_FROM_AFTER_TO" }),
  z.object({ precision: z.literal("UNCERTAIN"), from: isoDate.nullable().default(null), to: isoDate.nullable().default(null), originalText: shortText, confidence }).strict(),
  z.object({ precision: z.literal("UNKNOWN"), from: z.null().default(null), to: z.null().default(null), originalText: shortText.nullable().default(null), confidence }).strict(),
]);

const common = {
  localId: id,
  confidence,
  basisRefs,
};

const partyRole = z.object({
  ...common,
  kind: z.literal("PARTY_ROLE"),
  payload: z.object({ subjectLocalId: id, role: shortText, context: shortText.nullable().default(null) }).strict(),
}).strict();

const fact = z.object({
  ...common,
  kind: z.literal("FACT"),
  payload: z.object({ normalizedStatement: text, subjectLocalIds: localIds.default([]), object: shortText.nullable().default(null), qualifier: shortText.nullable().default(null) }).strict(),
}).strict();

const event = z.object({
  ...common,
  kind: z.literal("EVENT"),
  payload: z.object({ title: shortText, normalizedStatement: text, date: structuredDateSchema, subjectLocalIds: localIds.default([]), relatedItemLocalIds: localIds.default([]) }).strict(),
}).strict();

const actPayload = z.object({
  documentBasisRef: documentBasisRefSchema,
  actType: shortText,
  proceduralRole: z.enum(["CHALLENGED_ACT"]).nullable().default(null),
  authoritySubjectLocalId: id.nullable().default(null),
  number: shortText.nullable().default(null),
  date: structuredDateSchema,
  title: shortText,
  declaredEffects: z.array(shortText).max(100).default([]),
}).strict();

const legalAct = z.object({ ...common, kind: z.literal("LEGAL_ACT"), payload: actPayload }).strict();
const measure = z.object({ ...common, kind: z.literal("MEASURE"), payload: actPayload }).strict();

const contradiction = z.object({
  ...common,
  kind: z.literal("CONTRADICTION"),
  payload: z.object({ description: text, conflictingItemLocalIds: z.array(id).min(2).max(20) }).strict(),
}).strict();

const gap = z.object({
  ...common,
  kind: z.literal("GAP"),
  payload: z.object({ gapType: shortText, description: text, impact: text, relatedItemLocalIds: localIds.default([]) }).strict(),
}).strict();

const deadline = z.object({
  ...common,
  kind: z.literal("DEADLINE_CANDIDATE"),
  payload: z.object({
    deadlineType: z.enum(["EXPLICIT_DATE", "CALCULATED_TERM", "SUSPECTED_TERM"]),
    baseDate: structuredDateSchema.nullable().default(null),
    resultingDate: structuredDateSchema.nullable().default(null),
    ruleText: text.nullable().default(null),
    calculationExplanation: text.nullable().default(null),
  }).strict(),
}).strict();

export const knowledgePrioritySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export const researchQuestionModeSchema = z.enum(["PRIMARY", "ADVERSE"]);
export const referenceDateBasisTypeSchema = z.enum([
  "FACT_DATE",
  "EVENT_DATE",
  "MEASURE_DATE",
  "APPLICATION_DATE",
  "CHALLENGED_ACT_DATE",
  "CONCESSION_PERIOD",
  "USER_CONFIRMED",
  "UNKNOWN",
]);

const referenceDateBasisSchema = z.object({
  type: referenceDateBasisTypeSchema,
  itemLocalId: id.nullable().default(null),
  rationale: text,
  userConfirmedDateSource: z.object({
    sourceId: id,
    sourceVersion: id,
    confirmedDate: isoDate,
  }).strict().nullable().default(null),
}).strict();

export const legalIssueCandidateSchema = z.object({
  localId: id,
  title: shortText,
  normalizedIssue: text,
  areaOfLaw: shortText.nullable().default(null),
  priority: knowledgePrioritySchema,
  rationale: text,
  originatingItemLocalIds: z.array(id).min(1).max(100),
  confidence,
  referenceDateBasis: referenceDateBasisSchema.nullable().default(null),
}).strict();

export const researchQuestionCandidateSchema = z.object({
  localId: id,
  legalIssueLocalId: id,
  canonicalQuestion: text,
  priority: knowledgePrioritySchema,
  referenceDate: isoDate.nullable(),
  referenceDateBasis: referenceDateBasisSchema,
  requestedCapabilities: z.array(z.enum(["SEMANTIC_DISCOVERY", "KEYWORD_DISCOVERY"])).min(1).max(2),
  mode: researchQuestionModeSchema,
}).strict().superRefine((value, context) => {
  if (value.referenceDateBasis.type === "UNKNOWN") {
    if (value.referenceDate !== null || value.referenceDateBasis.itemLocalId !== null
      || value.referenceDateBasis.userConfirmedDateSource !== null) {
      context.addIssue({ code: "custom", message: "UNKNOWN_REFERENCE_DATE_MUST_BE_EMPTY" });
    }
  } else if (value.referenceDateBasis.type === "USER_CONFIRMED") {
    if (value.referenceDate === null || value.referenceDateBasis.itemLocalId !== null
      || value.referenceDateBasis.userConfirmedDateSource?.confirmedDate !== value.referenceDate) {
      context.addIssue({ code: "custom", message: "USER_CONFIRMED_DATE_INVALID" });
    }
  } else if (value.referenceDate === null || value.referenceDateBasis.itemLocalId === null
    || value.referenceDateBasis.userConfirmedDateSource !== null) {
    context.addIssue({ code: "custom", message: "REFERENCE_DATE_BASIS_INCOMPLETE" });
  }
});

export const structuredKnowledgeItemSchema = z.discriminatedUnion("kind", [
  partyRole, fact, event, legalAct, measure, contradiction, gap, deadline,
]);

export const fascicoloStructuredKnowledgeSchema = z.object({
  version: z.literal(FASCICOLO_STRUCTURED_KNOWLEDGE_VERSION),
  subjects: z.array(fascicoloSubjectCandidateSchema).max(500),
  items: z.array(structuredKnowledgeItemSchema).max(10_000),
  legalIssues: z.array(legalIssueCandidateSchema).max(1_000).optional().default([]),
  researchQuestions: z.array(researchQuestionCandidateSchema).max(1_000).optional().default([]),
}).strict().superRefine((value, context) => {
  const subjectIds = value.subjects.map((subject) => subject.localId);
  const itemIds = value.items.map((item) => item.localId);
  const issueIds = value.legalIssues.map((issue) => issue.localId);
  const questionIds = value.researchQuestions.map((question) => question.localId);
  if (new Set(subjectIds).size !== subjectIds.length) context.addIssue({ code: "custom", message: "DUPLICATE_SUBJECT_LOCAL_ID" });
  if (new Set(itemIds).size !== itemIds.length) context.addIssue({ code: "custom", message: "DUPLICATE_ITEM_LOCAL_ID" });
  if (new Set(issueIds).size !== issueIds.length) context.addIssue({ code: "custom", message: "DUPLICATE_ISSUE_LOCAL_ID" });
  if (new Set(questionIds).size !== questionIds.length) context.addIssue({ code: "custom", message: "DUPLICATE_QUESTION_LOCAL_ID" });
  for (const item of value.items) {
    const referencedSubjects = item.kind === "PARTY_ROLE" ? [item.payload.subjectLocalId]
      : item.kind === "FACT" || item.kind === "EVENT" ? item.payload.subjectLocalIds
        : item.kind === "LEGAL_ACT" || item.kind === "MEASURE" ? [item.payload.authoritySubjectLocalId].filter(Boolean)
          : [];
    if (referencedSubjects.some((subjectId) => !subjectIds.includes(subjectId!))) {
      context.addIssue({ code: "custom", message: `UNKNOWN_SUBJECT_LOCAL_ID:${item.localId}` });
    }
  }
  const allowedOriginKinds = new Set(["FACT", "EVENT", "LEGAL_ACT", "MEASURE", "CONTRADICTION", "GAP"]);
  for (const issue of value.legalIssues) {
    if (issue.originatingItemLocalIds.some((localId) => {
      const item = value.items.find((candidate) => candidate.localId === localId);
      return !item || !allowedOriginKinds.has(item.kind);
    })) context.addIssue({ code: "custom", message: `INVALID_ISSUE_ORIGIN:${issue.localId}` });
  }
  for (const question of value.researchQuestions) {
    if (!issueIds.includes(question.legalIssueLocalId)) {
      context.addIssue({ code: "custom", message: `UNKNOWN_LEGAL_ISSUE:${question.localId}` });
    }
    const basisItemId = question.referenceDateBasis.itemLocalId;
    if (basisItemId !== null && !itemIds.includes(basisItemId)) {
      context.addIssue({ code: "custom", message: `UNKNOWN_REFERENCE_DATE_ITEM:${question.localId}` });
    }
  }
});

export type FascicoloSubjectCandidate = z.output<typeof fascicoloSubjectCandidateSchema>;
export type FascicoloStrongIdentifier = z.output<typeof fascicoloStrongIdentifierSchema>;
export type FascicoloStructuredKnowledge = z.output<typeof fascicoloStructuredKnowledgeSchema>;
export type StructuredKnowledgeItem = z.output<typeof structuredKnowledgeItemSchema>;
export type StructuredDate = z.output<typeof structuredDateSchema>;
export type LegalIssueCandidate = z.output<typeof legalIssueCandidateSchema>;
export type ResearchQuestionCandidate = z.output<typeof researchQuestionCandidateSchema>;

export const lot2KnowledgeKinds = knowledgeItemKindSchema.exclude(["GENERIC", "LEGAL_ISSUE", "RESEARCH_QUESTION"]).options;