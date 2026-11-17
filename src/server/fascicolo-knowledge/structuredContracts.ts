import { z } from "zod";

import { documentBasisRefSchema, knowledgeItemKindSchema } from "./contracts";

export const FASCICOLO_STRUCTURED_KNOWLEDGE_VERSION = "FASCICOLO_STRUCTURED_KNOWLEDGE_V1" as const;
export const FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION = "SEMANTIC_KEY_V2" as const;
export const FASCICOLO_STRUCTURED_KNOWLEDGE_SEMANTIC_RULES = Object.freeze([
  { code: "INTERVAL_FROM_AFTER_TO", requirement: "An interval start date must not be after its end date." },
  { code: "UNKNOWN_REFERENCE_DATE_MUST_BE_EMPTY", requirement: "An UNKNOWN reference-date basis must not contain a date, item, or user-confirmed source." },
  { code: "USER_CONFIRMED_DATE_INVALID", requirement: "A USER_CONFIRMED reference-date basis must contain a matching confirmed date and no item reference." },
  { code: "REFERENCE_DATE_BASIS_INCOMPLETE", requirement: "Every other reference-date basis must contain a date and an existing item reference, with no user-confirmed source." },
  { code: "DUPLICATE_SUBJECT_LOCAL_ID", requirement: "Subject localId values must be unique." },
  { code: "DUPLICATE_ITEM_LOCAL_ID", requirement: "Item localId values must be unique." },
  { code: "DUPLICATE_ISSUE_LOCAL_ID", requirement: "Legal-issue localId values must be unique." },
  { code: "DUPLICATE_QUESTION_LOCAL_ID", requirement: "Research-question localId values must be unique." },
  { code: "DUPLICATE_DOCUMENT_INVENTORY_LOCAL_ID", requirement: "Document-inventory localId values must be unique." },
  { code: "DUPLICATE_SOURCE_QUOTE", requirement: "The itemLocalId, basisRef, and quote tuple must be unique." },
  { code: "INVALID_SOURCE_QUOTE_REFERENCE", requirement: "Every source quote must reference an existing item and one of that item's basisRefs." },
  { code: "MISSING_SOURCE_QUOTE", requirement: "Every item basisRef must have at least one matching source quote." },
  { code: "UNKNOWN_SUBJECT_LOCAL_ID", requirement: "Every subject reference must resolve to an existing subject." },
  { code: "UNRESOLVED_REQUIRED_ITEM_REFERENCE", requirement: "Every contradiction and proceeding-identity dependency must resolve without a self-reference." },
  { code: "INVALID_PROCEEDING_ANCHOR", requirement: "Every proceeding anchor must resolve to a LEGAL_ACT or MEASURE; a legal-issue anchor must also be one of its origins." },
  { code: "INVALID_PROCEEDING_IDENTITY_EVIDENCE", requirement: "Proceeding-identity evidence must be included in the item or legal-issue origin evidence." },
  { code: "INVALID_PROCEEDING_RESOLUTION", requirement: "A verified proceeding resolution must have a matching canonical identity; unresolved resolutions must not contain one." },
  { code: "INVALID_ISSUE_ORIGIN", requirement: "Every legal-issue origin must resolve to a compatible PARTY_POSITION, FACT, EVENT, LEGAL_ACT, MEASURE, CONTRADICTION, or GAP item." },
  { code: "UNKNOWN_LEGAL_ISSUE", requirement: "Every research question must reference an existing legal issue." },
  { code: "UNKNOWN_REFERENCE_DATE_ITEM", requirement: "Every non-null reference-date itemLocalId must reference an existing item." },
  { code: "REFERENCE_DATE_ITEM_NOT_ISSUE_ORIGIN", requirement: "A reference-date item must be one of the referenced legal issue's origins." },
  { code: "REFERENCE_DATE_BASIS_KIND_INVALID", requirement: "EVENT_DATE requires an EVENT, MEASURE_DATE requires a MEASURE, and CHALLENGED_ACT_DATE requires a challenged LEGAL_ACT or MEASURE." },
  { code: "REFERENCE_DATE_MISMATCH", requirement: "A research-question referenceDate must equal the exact date on its referenced item." },
  { code: "REFERENCE_DATE_BASIS_TYPE_UNSUPPORTED", requirement: "Provider-generated questions may use EVENT_DATE, MEASURE_DATE, CHALLENGED_ACT_DATE, USER_CONFIRMED, or UNKNOWN only." },
  { code: "UNKNOWN_DOCUMENT_INVENTORY_ITEM", requirement: "Every document-inventory relatedItemLocalId must reference an existing item." },
  { code: "MATERIAL_DOCUMENT_REQUIRES_ITEMS", requirement: "Every MATERIAL document must reference at least one knowledge item." },
  { code: "MATERIAL_DOCUMENT_BASIS_UNCOVERED", requirement: "Every basisRef of a MATERIAL document must also ground at least one of its related items." },
  { code: "UNCERTAIN_DOCUMENT_REQUIRES_GAP", requirement: "Every UNCERTAIN document must reference at least one GAP item." },
] as const);

export type FascicoloStructuredKnowledgeSemanticCode =
  typeof FASCICOLO_STRUCTURED_KNOWLEDGE_SEMANTIC_RULES[number]["code"];

const structuredKnowledgeSemanticCodes = new Set<string>(
  FASCICOLO_STRUCTURED_KNOWLEDGE_SEMANTIC_RULES.map((rule) => rule.code),
);

export function structuredKnowledgeValidationCode(issue: {
  readonly code: string;
  readonly message: string;
}): FascicoloStructuredKnowledgeSemanticCode | `ZOD_${string}` | "UNCLASSIFIED_SEMANTIC_VIOLATION" {
  if (issue.code === "custom") {
    return structuredKnowledgeSemanticCodes.has(issue.message)
      ? issue.message as FascicoloStructuredKnowledgeSemanticCode
      : "UNCLASSIFIED_SEMANTIC_VIOLATION";
  }
  return `ZOD_${issue.code.toUpperCase()}`;
}

const id = z.string().trim().min(1).max(256);
const text = z.string().trim().min(1).max(100_000);
const shortText = z.string().trim().min(1).max(512);
const basisRefs = z.array(documentBasisRefSchema).min(1).max(64);
const sourceQuoteSchema = z.object({
  itemLocalId: id,
  basisRef: documentBasisRefSchema,
  quote: text,
  span: z.object({
    id,
    documentVersionId: id,
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    textSha256: z.string().regex(/^[a-f0-9]{64}$/),
    quoteSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().nullable().optional(),
}).strict();
export const evidenceCandidateSchema = z.object({
  itemLocalId: id,
  evidenceSpanId: id,
}).strict();
export const documentInventoryClassificationSchema = z.enum([
  "MATERIAL",
  "NOT_MATERIAL",
  "UNCERTAIN",
]);
export const documentInventoryProfileSchema = z.enum([
  "PROCEDURAL",
  "LEGAL",
  "ACCOUNTING",
  "TECHNICAL",
  "ENVIRONMENTAL",
  "SAFETY",
  "EVIDENTIARY",
  "OTHER",
]);
export const documentInventoryEntrySchema = z.object({
  localId: id,
  basisRefs: z.array(documentBasisRefSchema).min(1).max(512),
  documentType: shortText,
  documentDate: shortText.nullable().default(null),
  issuer: shortText.nullable().default(null),
  recipients: z.array(shortText).max(100).default([]),
  proceduralPhase: shortText.nullable().default(null),
  subject: shortText,
  summary: text,
  referencedActs: z.array(shortText).max(100).default([]),
  attachments: z.array(shortText).max(100).default([]),
  materialProfiles: z.array(documentInventoryProfileSchema).min(1).max(8),
  classification: documentInventoryClassificationSchema,
  rationale: text,
  relatedItemLocalIds: z.array(id).max(200).default([]),
}).strict();
const localIds = z.array(id).max(100);
const confidence = z.number().int().min(0).max(100).nullable().optional().transform((value) => value ?? null);
const isoDate = z.string().date();
export const proceedingKindSchema = z.enum([
  "ADMINISTRATIVE_ORIGINAL",
  "ADMINISTRATIVE_OTHER",
  "JUDICIAL_REVIEW",
  "JUDICIAL_APPEAL",
  "CRIMINAL",
  "INTERNAL_INSTRUCTION",
  "INCIDENTAL",
  "UNKNOWN",
]);
const proceedingIdentitySchema = z.object({
  declaredKey: id.nullable().default(null),
  canonicalAnchorLocalId: id,
  kind: proceedingKindSchema,
  evidenceBasisRefs: basisRefs,
}).strict();
export const proceedingIdentityHintSchema = z.object({
  declaredKey: id.nullable(),
  kind: proceedingKindSchema,
  candidateAnchorLocalId: id.nullable(),
  evidenceBasisRefs: basisRefs,
}).strict();
export const proceedingIdentityResolutionSchema = z.object({
  status: z.enum([
    "VERIFIED",
    "NOT_DOCUMENTED",
    "AMBIGUOUS",
    "INSUFFICIENT_EVIDENCE",
    "UNVERIFIED_CLAIM",
  ]),
  action: z.enum(["PRESERVED", "REBUILT", "MARKED_UNRESOLVED"]),
  reason: z.enum([
    "MODEL_DID_NOT_DECLARE",
    "NO_DOCUMENTED_ANCHOR",
    "MULTIPLE_DOCUMENTED_ANCHORS",
    "ANCHOR_EVIDENCE_NOT_AUTHENTIC",
    "MODEL_CLAIM_NOT_VERIFIABLE",
  ]).nullable(),
  providerClaim: proceedingIdentityHintSchema.nullable(),
  candidateAnchorLocalIds: z.array(id).max(100),
}).strict();

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
    .refine((value) => value.from <= value.to, { message: "INTERVAL_FROM_AFTER_TO", path: ["from"] }),
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

const partyPosition = z.object({
  ...common,
  kind: z.literal("PARTY_POSITION"),
  payload: z.object({
    subjectLocalId: id,
    positionType: z.enum(["DEFENSE", "CLAIM", "OBJECTION", "REQUEST"]),
    normalizedStatement: text,
    context: shortText.nullable().default(null),
    relatedItemLocalIds: localIds.default([]),
  }).strict(),
}).strict();

const fact = z.object({
  ...common,
  kind: z.literal("FACT"),
  payload: z.object({
    normalizedStatement: text,
    subjectLocalIds: localIds.default([]),
    object: shortText.nullable().default(null),
    qualifier: shortText.nullable().default(null),
    proceedingIdentity: proceedingIdentitySchema.nullable().optional(),
    proceedingIdentityResolution: proceedingIdentityResolutionSchema.nullable().optional(),
  }).strict(),
}).strict();

const event = z.object({
  ...common,
  kind: z.literal("EVENT"),
  payload: z.object({
    title: shortText,
    normalizedStatement: text,
    date: structuredDateSchema,
    subjectLocalIds: localIds.default([]),
    relatedItemLocalIds: localIds.default([]),
    proceedingIdentity: proceedingIdentitySchema.nullable().optional(),
    proceedingIdentityResolution: proceedingIdentityResolutionSchema.nullable().optional(),
  }).strict(),
}).strict();

const proposalFact = z.object({
  ...common,
  kind: z.literal("FACT"),
  payload: fact.shape.payload.omit({
    proceedingIdentity: true,
    proceedingIdentityResolution: true,
  }).extend({
    proceedingIdentityHint: proceedingIdentityHintSchema.nullable(),
  }).strict(),
}).strict();

const proposalEvent = z.object({
  ...common,
  kind: z.literal("EVENT"),
  payload: event.shape.payload.omit({
    proceedingIdentity: true,
    proceedingIdentityResolution: true,
  }).extend({
    proceedingIdentityHint: proceedingIdentityHintSchema.nullable(),
  }).strict(),
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
  targetProceedingIdentity: proceedingIdentitySchema.nullable().optional(),
  targetProceedingResolution: proceedingIdentityResolutionSchema.nullable().optional(),
}).strict();

export const legalIssueProposalSchema = legalIssueCandidateSchema.omit({
  targetProceedingIdentity: true,
  targetProceedingResolution: true,
}).extend({
  targetProceedingHint: proceedingIdentityHintSchema.nullable(),
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
      context.addIssue({ code: "custom", path: ["referenceDateBasis"], message: "UNKNOWN_REFERENCE_DATE_MUST_BE_EMPTY" });
    }
  } else if (value.referenceDateBasis.type === "USER_CONFIRMED") {
    if (value.referenceDate === null || value.referenceDateBasis.itemLocalId !== null
      || value.referenceDateBasis.userConfirmedDateSource?.confirmedDate !== value.referenceDate) {
      context.addIssue({ code: "custom", path: ["referenceDateBasis"], message: "USER_CONFIRMED_DATE_INVALID" });
    }
  } else if (value.referenceDate === null || value.referenceDateBasis.itemLocalId === null
    || value.referenceDateBasis.userConfirmedDateSource !== null) {
    context.addIssue({ code: "custom", path: ["referenceDateBasis"], message: "REFERENCE_DATE_BASIS_INCOMPLETE" });
  }
});

export const structuredKnowledgeItemSchema = z.discriminatedUnion("kind", [
  partyRole, partyPosition, fact, event, legalAct, measure, contradiction, gap, deadline,
]);
export const structuredKnowledgeProposalItemSchema = z.discriminatedUnion("kind", [
  partyRole,
  partyPosition,
  proposalFact,
  proposalEvent,
  legalAct,
  measure,
  contradiction,
  gap,
  deadline,
]);

export const fascicoloStructuredKnowledgeSchema = z.object({
  version: z.literal(FASCICOLO_STRUCTURED_KNOWLEDGE_VERSION),
  subjects: z.array(fascicoloSubjectCandidateSchema).max(500),
  items: z.array(structuredKnowledgeItemSchema).max(10_000),
  sourceQuotes: z.array(sourceQuoteSchema).max(100_000).default([]),
  documentInventory: z.array(documentInventoryEntrySchema).max(10_000).optional(),
  legalIssues: z.array(legalIssueCandidateSchema).max(1_000).optional().default([]),
  researchQuestions: z.array(researchQuestionCandidateSchema).max(1_000).optional().default([]),
}).strict().superRefine((value, context) => {
  const subjectIds = value.subjects.map((subject) => subject.localId);
  const itemIds = value.items.map((item) => item.localId);
  const issueIds = value.legalIssues.map((issue) => issue.localId);
  const questionIds = value.researchQuestions.map((question) => question.localId);
  const inventoryIds = (value.documentInventory ?? []).map((document) => document.localId);
  if (new Set(subjectIds).size !== subjectIds.length) context.addIssue({ code: "custom", path: ["subjects"], message: "DUPLICATE_SUBJECT_LOCAL_ID" });
  if (new Set(itemIds).size !== itemIds.length) context.addIssue({ code: "custom", path: ["items"], message: "DUPLICATE_ITEM_LOCAL_ID" });
  if (new Set(issueIds).size !== issueIds.length) context.addIssue({ code: "custom", path: ["legalIssues"], message: "DUPLICATE_ISSUE_LOCAL_ID" });
  if (new Set(questionIds).size !== questionIds.length) context.addIssue({ code: "custom", path: ["researchQuestions"], message: "DUPLICATE_QUESTION_LOCAL_ID" });
  if (new Set(inventoryIds).size !== inventoryIds.length) context.addIssue({ code: "custom", path: ["documentInventory"], message: "DUPLICATE_DOCUMENT_INVENTORY_LOCAL_ID" });
  const sourceQuoteKeys = value.sourceQuotes.map((sourceQuote) => (
    `${sourceQuote.itemLocalId}\u001f${sourceQuote.basisRef}\u001f${sourceQuote.quote}`
  ));
  if (new Set(sourceQuoteKeys).size !== sourceQuoteKeys.length) {
    context.addIssue({ code: "custom", path: ["sourceQuotes"], message: "DUPLICATE_SOURCE_QUOTE" });
  }
  for (const [index, sourceQuote] of value.sourceQuotes.entries()) {
    const item = value.items.find((candidate) => candidate.localId === sourceQuote.itemLocalId);
    if (!item || !item.basisRefs.includes(sourceQuote.basisRef)) {
      context.addIssue({ code: "custom", path: ["sourceQuotes", index], message: "INVALID_SOURCE_QUOTE_REFERENCE" });
    }
  }
  for (const [index, item] of value.items.entries()) {
    const referencedSubjects = item.kind === "PARTY_ROLE" || item.kind === "PARTY_POSITION" ? [item.payload.subjectLocalId]
      : item.kind === "FACT" || item.kind === "EVENT" ? item.payload.subjectLocalIds
        : item.kind === "LEGAL_ACT" || item.kind === "MEASURE" ? [item.payload.authoritySubjectLocalId].filter(Boolean)
          : [];
    if (referencedSubjects.some((subjectId) => !subjectIds.includes(subjectId!))) {
      context.addIssue({ code: "custom", path: ["items", index, "payload"], message: "UNKNOWN_SUBJECT_LOCAL_ID" });
    }
    const requiredItemReferences = item.kind === "CONTRADICTION"
      ? item.payload.conflictingItemLocalIds
      : [];
    if (requiredItemReferences.some((localId) => localId === item.localId || !itemIds.includes(localId))) {
      context.addIssue({ code: "custom", path: ["items", index, "payload"], message: "UNRESOLVED_REQUIRED_ITEM_REFERENCE" });
    }
    if (item.kind === "FACT" || item.kind === "EVENT") {
      const identity = item.payload.proceedingIdentity;
      const resolution = item.payload.proceedingIdentityResolution;
      if (identity) {
        const anchor = value.items.find((candidate) => (
          candidate.localId === identity.canonicalAnchorLocalId
        ));
        if (!anchor || (anchor.kind !== "LEGAL_ACT" && anchor.kind !== "MEASURE")) {
          context.addIssue({ code: "custom", path: ["items", index, "payload", "proceedingIdentity", "canonicalAnchorLocalId"], message: "INVALID_PROCEEDING_ANCHOR" });
        }
        if (identity.evidenceBasisRefs.some((basisRef) => !item.basisRefs.includes(basisRef))) {
          context.addIssue({ code: "custom", path: ["items", index, "payload", "proceedingIdentity", "evidenceBasisRefs"], message: "INVALID_PROCEEDING_IDENTITY_EVIDENCE" });
        }
      }
      if (resolution && (
        (resolution.status === "VERIFIED" && (!identity
          || !resolution.candidateAnchorLocalIds.includes(identity.canonicalAnchorLocalId)))
        || (resolution.status !== "VERIFIED" && identity != null)
      )) {
        context.addIssue({ code: "custom", path: ["items", index, "payload", "proceedingIdentityResolution"], message: "INVALID_PROCEEDING_RESOLUTION" });
      }
    }
  }
  const allowedOriginKinds = new Set(["PARTY_POSITION", "FACT", "EVENT", "LEGAL_ACT", "MEASURE", "CONTRADICTION", "GAP"]);
  for (const [index, issue] of value.legalIssues.entries()) {
    if (issue.originatingItemLocalIds.some((localId) => {
      const item = value.items.find((candidate) => candidate.localId === localId);
      return !item || !allowedOriginKinds.has(item.kind);
    })) context.addIssue({ code: "custom", path: ["legalIssues", index, "originatingItemLocalIds"], message: "INVALID_ISSUE_ORIGIN" });
    const targetIdentity = issue.targetProceedingIdentity;
    const targetResolution = issue.targetProceedingResolution;
    if (targetIdentity) {
      const anchor = value.items.find((candidate) => (
        candidate.localId === targetIdentity.canonicalAnchorLocalId
      ));
      if (!anchor || (anchor.kind !== "LEGAL_ACT" && anchor.kind !== "MEASURE")
        || !issue.originatingItemLocalIds.includes(targetIdentity.canonicalAnchorLocalId)) {
        context.addIssue({ code: "custom", path: ["legalIssues", index, "targetProceedingIdentity", "canonicalAnchorLocalId"], message: "INVALID_PROCEEDING_ANCHOR" });
      }
      const originBasisRefs = new Set(issue.originatingItemLocalIds.flatMap((localId) => (
        value.items.find((candidate) => candidate.localId === localId)?.basisRefs ?? []
      )));
      if (targetIdentity.evidenceBasisRefs.some((basisRef) => !originBasisRefs.has(basisRef))) {
        context.addIssue({ code: "custom", path: ["legalIssues", index, "targetProceedingIdentity", "evidenceBasisRefs"], message: "INVALID_PROCEEDING_IDENTITY_EVIDENCE" });
      }
    }
    if (targetResolution && (
      (targetResolution.status === "VERIFIED" && (!targetIdentity
        || !targetResolution.candidateAnchorLocalIds.includes(targetIdentity.canonicalAnchorLocalId)))
      || (targetResolution.status !== "VERIFIED" && targetIdentity != null)
    )) {
      context.addIssue({ code: "custom", path: ["legalIssues", index, "targetProceedingResolution"], message: "INVALID_PROCEEDING_RESOLUTION" });
    }
  }
  for (const [index, question] of value.researchQuestions.entries()) {
    if (!issueIds.includes(question.legalIssueLocalId)) {
      context.addIssue({ code: "custom", path: ["researchQuestions", index, "legalIssueLocalId"], message: "UNKNOWN_LEGAL_ISSUE" });
    }
    const basisItemId = question.referenceDateBasis.itemLocalId;
    if (basisItemId !== null && !itemIds.includes(basisItemId)) {
      context.addIssue({ code: "custom", path: ["researchQuestions", index, "referenceDateBasis", "itemLocalId"], message: "UNKNOWN_REFERENCE_DATE_ITEM" });
    }
  }
  for (const [index, document] of (value.documentInventory ?? []).entries()) {
    if (document.relatedItemLocalIds.some((localId) => !itemIds.includes(localId))) {
      context.addIssue({ code: "custom", path: ["documentInventory", index, "relatedItemLocalIds"], message: "UNKNOWN_DOCUMENT_INVENTORY_ITEM" });
    }
    if (document.classification === "MATERIAL" && document.relatedItemLocalIds.length === 0) {
      context.addIssue({ code: "custom", path: ["documentInventory", index, "relatedItemLocalIds"], message: "MATERIAL_DOCUMENT_REQUIRES_ITEMS" });
    }
    if (document.classification === "UNCERTAIN" && !document.relatedItemLocalIds.some((localId) => (
      value.items.find((item) => item.localId === localId)?.kind === "GAP"
    ))) {
      context.addIssue({ code: "custom", path: ["documentInventory", index, "relatedItemLocalIds"], message: "UNCERTAIN_DOCUMENT_REQUIRES_GAP" });
    }
  }
});

export const fascicoloDocumentStructuredKnowledgeSchema =
  fascicoloStructuredKnowledgeSchema.superRefine((value, context) => {
    for (const [index, item] of value.items.entries()) {
      if (item.basisRefs.some((basisRef) => !value.sourceQuotes.some((sourceQuote) => (
        sourceQuote.itemLocalId === item.localId && sourceQuote.basisRef === basisRef
      )))) {
        context.addIssue({ code: "custom", path: ["items", index, "basisRefs"], message: "MISSING_SOURCE_QUOTE" });
      }
    }
    for (const [index, question] of value.researchQuestions.entries()) {
      const issue = value.legalIssues.find((candidate) => (
        candidate.localId === question.legalIssueLocalId
      ));
      const basisItemId = question.referenceDateBasis.itemLocalId;
      const basisItem = basisItemId === null
        ? undefined
        : value.items.find((candidate) => candidate.localId === basisItemId);
      if (basisItem && issue && !issue.originatingItemLocalIds.includes(basisItem.localId)) {
        context.addIssue({ code: "custom", path: ["researchQuestions", index, "referenceDateBasis", "itemLocalId"], message: "REFERENCE_DATE_ITEM_NOT_ISSUE_ORIGIN" });
      }
      const basisType = question.referenceDateBasis.type;
      const basisKindValid = (basisType === "EVENT_DATE" && basisItem?.kind === "EVENT")
        || (basisType === "MEASURE_DATE" && basisItem?.kind === "MEASURE")
        || (basisType === "CHALLENGED_ACT_DATE"
          && (basisItem?.kind === "LEGAL_ACT" || basisItem?.kind === "MEASURE")
          && basisItem.payload.proceduralRole === "CHALLENGED_ACT")
        || basisType === "USER_CONFIRMED"
        || basisType === "UNKNOWN";
      if (!basisKindValid) {
        context.addIssue({
          code: "custom",
          path: ["researchQuestions", index, "referenceDateBasis", "type"],
          message: ["FACT_DATE", "APPLICATION_DATE", "CONCESSION_PERIOD"].includes(basisType)
            ? "REFERENCE_DATE_BASIS_TYPE_UNSUPPORTED"
            : "REFERENCE_DATE_BASIS_KIND_INVALID",
        });
      }
      if (basisItem && (basisItem.kind === "EVENT"
        || basisItem.kind === "LEGAL_ACT"
        || basisItem.kind === "MEASURE")) {
        const itemDate = basisItem.payload.date;
        if (itemDate.precision !== "EXACT" || itemDate.from !== question.referenceDate) {
          context.addIssue({ code: "custom", path: ["researchQuestions", index, "referenceDate"], message: "REFERENCE_DATE_MISMATCH" });
        }
      }
    }
  });

export const fascicoloDocumentKnowledgeCandidateProposalSchema = z.object({
  version: z.literal(FASCICOLO_STRUCTURED_KNOWLEDGE_VERSION),
  subjects: z.array(fascicoloSubjectCandidateSchema).max(500),
  items: z.array(structuredKnowledgeProposalItemSchema).max(10_000),
  evidenceCandidates: z.array(evidenceCandidateSchema).max(100_000),
  documentInventory: z.array(documentInventoryEntrySchema).max(10_000),
  legalIssues: z.array(legalIssueProposalSchema).max(1_000),
  researchQuestions: z.array(researchQuestionCandidateSchema).max(1_000),
}).strict();

export const fascicoloDocumentKnowledgeProposalSchema = z.object({
  version: z.literal(FASCICOLO_STRUCTURED_KNOWLEDGE_VERSION),
  subjects: z.array(fascicoloSubjectCandidateSchema).max(500),
  items: z.array(structuredKnowledgeProposalItemSchema).max(10_000),
  sourceQuotes: z.array(sourceQuoteSchema).max(100_000),
  documentInventory: z.array(documentInventoryEntrySchema).max(10_000),
  legalIssues: z.array(legalIssueProposalSchema).max(1_000),
  researchQuestions: z.array(researchQuestionCandidateSchema).max(1_000),
}).strict();

export type FascicoloSubjectCandidate = z.output<typeof fascicoloSubjectCandidateSchema>;
export type FascicoloStrongIdentifier = z.output<typeof fascicoloStrongIdentifierSchema>;
export type FascicoloStructuredKnowledge = z.output<typeof fascicoloStructuredKnowledgeSchema>;
export type FascicoloDocumentKnowledgeProposal = z.output<
  typeof fascicoloDocumentKnowledgeCandidateProposalSchema
> | z.output<typeof fascicoloDocumentKnowledgeProposalSchema>;
export type StructuredKnowledgeItem = z.output<typeof structuredKnowledgeItemSchema>;
export type StructuredKnowledgeProposalItem = z.output<
  typeof structuredKnowledgeProposalItemSchema
>;
export type ProceedingIdentityHint = z.output<typeof proceedingIdentityHintSchema>;
export type ProceedingIdentityResolution = z.output<
  typeof proceedingIdentityResolutionSchema
>;
export type StructuredDate = z.output<typeof structuredDateSchema>;
export type LegalIssueCandidate = z.output<typeof legalIssueCandidateSchema>;
export type ResearchQuestionCandidate = z.output<typeof researchQuestionCandidateSchema>;
export type DocumentInventoryEntry = z.output<typeof documentInventoryEntrySchema>;

export const lot2KnowledgeKinds = knowledgeItemKindSchema.exclude(["GENERIC", "LEGAL_ISSUE", "RESEARCH_QUESTION"]).options;