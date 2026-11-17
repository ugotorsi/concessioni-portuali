import { createHash } from "node:crypto";

import { Prisma, type LegalSourceTemporalAssessment } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import {
  assessLegalSourceTemporalApplicability,
  type TemporalApplicabilityState,
  type TemporalAssessmentInput,
  type TemporalAssessmentResult,
  type TemporalReasonCode,
  type TemporalValidityState,
  type TemporalWindowState,
} from ".";

export type PersistableTemporalAssessmentResult = Readonly<{
  assessmentVersion: string;
  validityState: TemporalValidityState;
  temporalWindowState: TemporalWindowState;
  applicabilityState: TemporalApplicabilityState;
  reasonCodes: readonly TemporalReasonCode[];
  referenceDate: string;
  effectiveInterval: Readonly<{ from: string | null; to: string | null }>;
  humanReviewRequired: boolean;
  confidence: TemporalAssessmentResult["confidence"];
}>;

export type TemporalAssessmentClient = Pick<
  Prisma.TransactionClient,
  "legalSourceTemporalAssessment"
>;

export class TemporalAssessmentPersistenceError extends Error {
  constructor(readonly code: "INVALID_ASSESSMENT" | "IDEMPOTENCY_CONFLICT" | "IDEMPOTENCY_RACE_LOST") {
    super(code);
    this.name = "TemporalAssessmentPersistenceError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sameInstant(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  const leftDate = parseDate(left);
  const rightDate = parseDate(right);
  return leftDate !== null && rightDate !== null && leftDate.getTime() === rightDate.getTime();
}

function validateAssessment(
  input: TemporalAssessmentInput,
  assessment: PersistableTemporalAssessmentResult,
): { referenceDate: Date; effectiveFrom: Date | null; effectiveTo: Date | null } {
  const referenceDate = parseDate(input.referenceDate);
  const effectiveFrom = input.expression.effectiveFrom === null
    ? null
    : parseDate(input.expression.effectiveFrom);
  const effectiveTo = input.expression.effectiveTo === null
    ? null
    : parseDate(input.expression.effectiveTo);
  if (
    !input.sourceFamilyId.trim()
    || !input.expression.expressionId.trim()
    || !assessment.assessmentVersion.trim()
    || assessment.assessmentVersion.length > 100
    || referenceDate === null
    || (input.expression.effectiveFrom !== null && effectiveFrom === null)
    || (input.expression.effectiveTo !== null && effectiveTo === null)
    || !sameInstant(input.referenceDate, assessment.referenceDate)
    || !sameInstant(input.expression.effectiveFrom, assessment.effectiveInterval.from)
    || !sameInstant(input.expression.effectiveTo, assessment.effectiveInterval.to)
  ) {
    throw new TemporalAssessmentPersistenceError("INVALID_ASSESSMENT");
  }
  return { referenceDate, effectiveFrom, effectiveTo };
}

export function temporalAssessmentInputFingerprint(
  input: TemporalAssessmentInput,
  assessmentVersion: string,
): string {
  const normalizedInput = {
    ...input,
    referenceDate: parseDate(input.referenceDate)?.toISOString() ?? input.referenceDate,
    expression: {
      ...input.expression,
      publicationDate: input.expression.publicationDate === null
        ? null
        : parseDate(input.expression.publicationDate)?.toISOString() ?? input.expression.publicationDate,
      effectiveFrom: input.expression.effectiveFrom === null
        ? null
        : parseDate(input.expression.effectiveFrom)?.toISOString() ?? input.expression.effectiveFrom,
      effectiveTo: input.expression.effectiveTo === null
        ? null
        : parseDate(input.expression.effectiveTo)?.toISOString() ?? input.expression.effectiveTo,
    },
  };
  return createHash("sha256").update(JSON.stringify(canonicalize({
    assessmentVersion,
    input: normalizedInput,
  })), "utf8").digest("hex");
}

function isInputFingerprintP2002(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const meta = error.meta as {
    modelName?: unknown;
    target?: unknown;
    driverAdapterError?: {
      cause?: { kind?: unknown; originalCode?: unknown; constraint?: { fields?: unknown } };
    };
  } | undefined;
  if (meta?.modelName !== "LegalSourceTemporalAssessment") return false;
  const adapterCause = meta.driverAdapterError?.cause;
  const rawFields = meta.target ?? (
    adapterCause?.kind === "UniqueConstraintViolation" && adapterCause.originalCode === "23505"
      ? adapterCause.constraint?.fields
      : undefined
  );
  if (rawFields === "temporal_assessment_identity_uq" || rawFields === "inputFingerprint") return true;
  return Array.isArray(rawFields)
    && rawFields.length === 1
    && rawFields[0] === "inputFingerprint";
}

function json(value: readonly TemporalReasonCode[]): Prisma.InputJsonValue {
  return [...value];
}

function reuseOrConflict(
  existing: LegalSourceTemporalAssessment,
  input: TemporalAssessmentInput,
  assessment: PersistableTemporalAssessmentResult,
  dates: { referenceDate: Date; effectiveFrom: Date | null; effectiveTo: Date | null },
) {
  const same = existing.sourceFamilyId === input.sourceFamilyId
    && existing.legalExpressionVersionId === input.expression.expressionId
    && existing.assessmentVersion === assessment.assessmentVersion
    && existing.referenceDate.getTime() === dates.referenceDate.getTime()
    && existing.validityState === assessment.validityState
    && existing.temporalWindowState === assessment.temporalWindowState
    && existing.applicabilityState === assessment.applicabilityState
    && JSON.stringify(existing.reasonCodes) === JSON.stringify(assessment.reasonCodes)
    && existing.effectiveFromSnapshot?.getTime() === dates.effectiveFrom?.getTime()
    && existing.effectiveToSnapshot?.getTime() === dates.effectiveTo?.getTime()
    && existing.humanReviewRequired === assessment.humanReviewRequired
    && existing.confidence === assessment.confidence;
  if (!same) throw new TemporalAssessmentPersistenceError("IDEMPOTENCY_CONFLICT");
  return { outcome: "REUSED" as const, assessment: existing };
}

export async function persistTemporalAssessment(
  input: TemporalAssessmentInput,
  assessment: PersistableTemporalAssessmentResult,
  client: TemporalAssessmentClient = prisma,
): Promise<{ outcome: "CREATED" | "REUSED"; assessment: LegalSourceTemporalAssessment }> {
  const dates = validateAssessment(input, assessment);
  const inputFingerprint = temporalAssessmentInputFingerprint(input, assessment.assessmentVersion);
  const existing = await client.legalSourceTemporalAssessment.findUnique({
    where: { inputFingerprint },
  });
  if (existing) return reuseOrConflict(existing, input, assessment, dates);

  try {
    const created = await client.legalSourceTemporalAssessment.create({
      data: {
        sourceFamilyId: input.sourceFamilyId,
        legalExpressionVersionId: input.expression.expressionId,
        assessmentVersion: assessment.assessmentVersion,
        referenceDate: dates.referenceDate,
        validityState: assessment.validityState,
        temporalWindowState: assessment.temporalWindowState,
        applicabilityState: assessment.applicabilityState,
        reasonCodes: json(assessment.reasonCodes),
        effectiveFromSnapshot: dates.effectiveFrom,
        effectiveToSnapshot: dates.effectiveTo,
        humanReviewRequired: assessment.humanReviewRequired,
        confidence: assessment.confidence,
        inputFingerprint,
      },
    });
    return { outcome: "CREATED", assessment: created };
  } catch (error) {
    if (!isInputFingerprintP2002(error)) throw error;
    const winner = await client.legalSourceTemporalAssessment.findUnique({
      where: { inputFingerprint },
    });
    if (!winner) throw new TemporalAssessmentPersistenceError("IDEMPOTENCY_RACE_LOST");
    return reuseOrConflict(winner, input, assessment, dates);
  }
}

export function assessAndPersistTemporalAssessment(
  input: TemporalAssessmentInput,
  client: TemporalAssessmentClient = prisma,
) {
  return persistTemporalAssessment(input, assessLegalSourceTemporalApplicability(input), client);
}

export function getTemporalAssessmentByIdentity(
  inputFingerprint: string,
  client: TemporalAssessmentClient = prisma,
) {
  return client.legalSourceTemporalAssessment.findUnique({ where: { inputFingerprint } });
}

export function getLatestTemporalAssessment(
  legalExpressionVersionId: string,
  referenceDate: Date,
  client: TemporalAssessmentClient = prisma,
) {
  return client.legalSourceTemporalAssessment.findFirst({
    where: { legalExpressionVersionId, referenceDate },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export function listTemporalAssessmentHistory(
  legalExpressionVersionId: string,
  referenceDate: Date,
  limit = 100,
  client: TemporalAssessmentClient = prisma,
) {
  return client.legalSourceTemporalAssessment.findMany({
    where: { legalExpressionVersionId, referenceDate },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: Math.min(100, Math.max(1, limit)),
  });
}