import { createHash } from "node:crypto";

import { z } from "zod";

import { stableStringify } from "@/server/audit/hash";

export const FASCICOLO_CHANGE_CONTRACT_VERSION = "FASCICOLO_CHANGE_V1" as const;
export const FASCICOLO_CHANGE_FINGERPRINT_ALGORITHM = "sha256" as const;

const identifier = z.string().trim().min(1).max(256);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const instant = z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const identifierList = z.array(identifier).max(1_000).transform((items) => [...new Set(items)].sort());

const legalAssessmentTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UNDETERMINED") }).strict(),
  z.object({ kind: z.literal("INSTANT"), date: instant }).strict(),
  z.object({
    kind: z.literal("INTERVAL"),
    from: instant.nullable(),
    to: instant.nullable(),
  }).strict().superRefine((value, context) => {
    if (value.from === null && value.to === null) {
      context.addIssue({ code: "custom", message: "A legal interval requires at least one boundary." });
    }
    if (value.from !== null && value.to !== null && value.from > value.to) {
      context.addIssue({ code: "custom", message: "The legal interval is inverted." });
    }
  }),
]);

const commonShape = {
  triggeredAt: instant,
  origin: z.enum([
    "USER_ACTION",
    "NEUTRAL_INTAKE",
    "WORKER",
    "WATCHDOG",
    "LEGAL_SOURCE_MONITOR",
    "CASE_LAW_MONITOR",
  ]),
  stateFingerprint: sha256,
  legalAssessmentTarget: legalAssessmentTargetSchema.optional()
    .default({ kind: "UNDETERMINED" as const }),
};

export const fascicoloChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("DOCUMENT_CHANGED"),
    ...commonShape,
    procedimentoId: identifier,
    documentId: identifier,
    documentVersionId: identifier.nullable(),
    changeType: z.enum(["CREATED", "VERSION_CHANGED", "METADATA_CHANGED", "ARCHIVED"]),
    legalEvidenceKind: z.enum(["NONE", "LEGAL_SOURCE", "CASE_LAW", "UNRESOLVED"]),
  }).strict(),
  z.object({
    kind: z.literal("FASCICOLO_DATA_CHANGED"),
    ...commonShape,
    procedimentoId: identifier,
    changedArea: z.enum(["GENERAL", "LEGAL_FACTS", "DOCUMENT_CONTEXT"]),
  }).strict(),
  z.object({
    kind: z.literal("CONCESSIONE_CHANGED"),
    ...commonShape,
    concessioneId: identifier,
    linkedProcedimentoIds: identifierList,
    affectsLegalContext: z.boolean(),
    affectsRequirementScreening: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal("CRITICITA_CHANGED"),
    ...commonShape,
    criticitaId: identifier,
    concessioneId: identifier,
    procedimentoId: identifier.nullable(),
    linkedLegalDependencyChanged: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal("REQUIREMENT_EVIDENCE_CHANGED"),
    ...commonShape,
    procedimentoId: identifier,
    requirementId: identifier,
    evidenceId: identifier.nullable(),
    changeType: z.enum(["REQUIREMENT_CHANGED", "EVIDENCE_ADDED", "EVIDENCE_REVOKED"]),
  }).strict(),
  z.object({
    kind: z.literal("LEGAL_SOURCE_CHANGED"),
    ...commonShape,
    legalSourceId: identifier,
    legalExpressionVersionId: identifier.nullable(),
    linkedProcedimentoIds: identifierList,
    changeType: z.enum(["IDENTITY", "CONTENT", "TEMPORAL_METADATA", "STATUS"]),
  }).strict(),
  z.object({
    kind: z.literal("CASE_LAW_CHANGED"),
    ...commonShape,
    legalSourceId: identifier,
    linkedProcedimentoIds: identifierList,
    decisionDate: instant.nullable(),
    changeType: z.enum(["NEW_DECISION", "CONTENT", "IDENTITY", "TREATMENT"]),
    requiresFurtherResearch: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal("TIME_THRESHOLD_REACHED"),
    ...commonShape,
    subjectType: z.enum(["CONCESSIONE", "SCADENZA", "PROCEDIMENTO", "PAGAMENTO", "REQUIREMENT", "OBBLIGO"]),
    subjectId: identifier,
    procedimentoId: identifier.nullable(),
    threshold: z.enum([
      "CONCESSION_90_DAYS",
      "CONCESSION_60_DAYS",
      "CONCESSION_30_DAYS",
      "DEADLINE_DUE",
      "DEADLINE_OVERDUE",
      "PAYMENT_OVERDUE",
      "MISSING_DOCUMENT_DUE",
      "NEXT_REVIEW_DUE",
    ]),
    thresholdAt: instant,
  }).strict(),
]);

export type FascicoloChange = z.output<typeof fascicoloChangeSchema>;
export type FascicoloChangeInput = z.input<typeof fascicoloChangeSchema>;
export type LegalAssessmentTarget = FascicoloChange["legalAssessmentTarget"];

export class FascicoloChangeValidationError extends Error {
  readonly code = "INVALID_FASCICOLO_CHANGE" as const;

  constructor() {
    super("INVALID_FASCICOLO_CHANGE");
    this.name = "FascicoloChangeValidationError";
  }
}

export function parseFascicoloChange(input: unknown): FascicoloChange {
  const parsed = fascicoloChangeSchema.safeParse(input);
  if (!parsed.success) throw new FascicoloChangeValidationError();
  return Object.freeze(parsed.data);
}

export function fingerprintFascicoloChange(input: unknown): string {
  const change = parseFascicoloChange(input);
  const { triggeredAt: _triggeredAt, ...causalState } = change;
  return createHash(FASCICOLO_CHANGE_FINGERPRINT_ALGORITHM)
    .update(stableStringify({
      contractVersion: FASCICOLO_CHANGE_CONTRACT_VERSION,
      change: causalState,
    }), "utf8")
    .digest("hex");
}