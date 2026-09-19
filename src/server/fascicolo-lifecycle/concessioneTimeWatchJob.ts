import { createHash } from "node:crypto";

import { z } from "zod";

import { normalizeAsyncJobAdmission, type AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJobInTransaction } from "@/server/async-jobs/persistence";
import type { AsyncJobHandler } from "@/server/async-jobs/registry";
import { stableStringify } from "@/server/audit/hash";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import { buildFascicoloReevaluationAdmission } from "./fascicoloReevaluationJob";

export const FASCICOLO_TIME_WATCH_OPERATION = "FASCICOLO_TIME_WATCH_V1" as const;
export const FASCICOLO_TIME_WATCH_CONTRACT_VERSION = "CONCESSIONE_TIME_WATCH_V1" as const;
export const FASCICOLO_TIME_WATCH_PURPOSE = "FASCICOLO_TIME_THRESHOLD_REVALIDATION" as const;
export const FASCICOLO_TIME_WATCH_POLICY_DECISION_REF = "FASCICOLO_TIME_WATCH_SYSTEM_ADMISSION_V1" as const;

export const CONCESSIONE_TIME_WATCH_THRESHOLDS = [
  "CONCESSION_90_DAYS",
  "CONCESSION_60_DAYS",
  "CONCESSION_30_DAYS",
  "DEADLINE_DUE",
] as const;

export type ConcessioneTimeWatchThreshold = (typeof CONCESSIONE_TIME_WATCH_THRESHOLDS)[number];

export interface ConcessioneTemporalState {
  readonly id: string;
  readonly enteId: string | null;
  readonly dataScadenza: Date;
  readonly stato: string;
}

export interface ConcessioneTimeWatchOccurrence {
  readonly subjectType: "CONCESSIONE";
  readonly subjectId: string;
  readonly tenantId: string;
  readonly threshold: ConcessioneTimeWatchThreshold;
  readonly thresholdAt: Date;
  readonly expectedTemporalFingerprint: string;
}

type ParsedConcessioneTimeWatchReference = Readonly<{
  subjectId: string;
  tenantId: string;
  threshold: ConcessioneTimeWatchThreshold;
  thresholdAt: string;
  expectedTemporalFingerprint: string;
}>;

const identifier = z.string().trim().min(1).max(256);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const instant = z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const applicableStates = new Set(["ATTIVA", "IN_PROROGA"]);

const referenceSchema = z.object({
  referenceType: z.literal("FASCICOLO_TIME_WATCH"),
  referenceId: identifier,
  referenceVersion: z.literal("V1"),
  metadata: z.object({
    contractVersion: z.literal(FASCICOLO_TIME_WATCH_CONTRACT_VERSION),
    subjectType: z.literal("CONCESSIONE"),
    tenantId: identifier,
    thresholdCode: z.enum(CONCESSIONE_TIME_WATCH_THRESHOLDS),
    thresholdAt: instant,
    expectedTemporalFingerprintHash: sha256,
    watchFingerprintHash: sha256,
  }).strict(),
}).strict();

export class ConcessioneTimeWatchInputError extends Error {
  constructor(readonly code: "INVALID_TIME_WATCH_REFERENCE" | "TIME_WATCH_FINGERPRINT_MISMATCH") {
    super(code);
    this.name = "ConcessioneTimeWatchInputError";
  }
}

function subtractUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1_000);
}

export function isConcessioneTimeWatchApplicable(stato: string): boolean {
  return applicableStates.has(stato);
}

export function fingerprintConcessioneTemporalState(
  input: Pick<ConcessioneTemporalState, "id" | "enteId" | "dataScadenza">,
): string {
  if (!input.id.trim() || !input.enteId?.trim() || Number.isNaN(input.dataScadenza.getTime())) {
    throw new ConcessioneTimeWatchInputError("INVALID_TIME_WATCH_REFERENCE");
  }
  return createHash("sha256").update(stableStringify({
    contractVersion: FASCICOLO_TIME_WATCH_CONTRACT_VERSION,
    subjectType: "CONCESSIONE",
    subjectId: input.id,
    tenantId: input.enteId,
    dataScadenza: input.dataScadenza.toISOString(),
  }), "utf8").digest("hex");
}

export function thresholdAtForConcessione(
  dataScadenza: Date,
  threshold: ConcessioneTimeWatchThreshold,
): Date {
  if (Number.isNaN(dataScadenza.getTime())) {
    throw new ConcessioneTimeWatchInputError("INVALID_TIME_WATCH_REFERENCE");
  }
  switch (threshold) {
    case "CONCESSION_90_DAYS": return subtractUtcDays(dataScadenza, 90);
    case "CONCESSION_60_DAYS": return subtractUtcDays(dataScadenza, 60);
    case "CONCESSION_30_DAYS": return subtractUtcDays(dataScadenza, 30);
    case "DEADLINE_DUE": return new Date(dataScadenza);
  }
}

export function deriveConcessioneTimeWatchOccurrences(
  concessione: ConcessioneTemporalState,
  now: Date,
): readonly ConcessioneTimeWatchOccurrence[] {
  if (
    !concessione.enteId?.trim()
    || Number.isNaN(now.getTime())
    || !isConcessioneTimeWatchApplicable(concessione.stato)
  ) {
    return [];
  }
  const expectedTemporalFingerprint = fingerprintConcessioneTemporalState(concessione);
  const occurrences = CONCESSIONE_TIME_WATCH_THRESHOLDS.map((threshold) => ({
    subjectType: "CONCESSIONE" as const,
    subjectId: concessione.id,
    tenantId: concessione.enteId!,
    threshold,
    thresholdAt: thresholdAtForConcessione(concessione.dataScadenza, threshold),
    expectedTemporalFingerprint,
  }));
  const matured = occurrences.filter((occurrence) => occurrence.thresholdAt.getTime() <= now.getTime());
  const latestMatured = matured.at(-1);
  return Object.freeze([
    ...(latestMatured ? [latestMatured] : []),
    ...occurrences.filter((occurrence) => occurrence.thresholdAt.getTime() > now.getTime()),
  ].map((occurrence) => Object.freeze(occurrence)));
}

function occurrenceFingerprint(occurrence: ConcessioneTimeWatchOccurrence): string {
  return createHash("sha256").update(stableStringify({
    operation: FASCICOLO_TIME_WATCH_OPERATION,
    contractVersion: FASCICOLO_TIME_WATCH_CONTRACT_VERSION,
    subjectType: occurrence.subjectType,
    subjectId: occurrence.subjectId,
    threshold: occurrence.threshold,
    thresholdAt: occurrence.thresholdAt.toISOString(),
    expectedTemporalFingerprint: occurrence.expectedTemporalFingerprint,
  }), "utf8").digest("hex");
}

export function buildConcessioneTimeWatchAdmission(
  occurrence: ConcessioneTimeWatchOccurrence,
): AsyncJobAdmissionInput {
  const logicalOperationId = occurrenceFingerprint(occurrence);
  const admission: AsyncJobAdmissionInput = {
    operation: FASCICOLO_TIME_WATCH_OPERATION,
    logicalOperationId,
    purpose: FASCICOLO_TIME_WATCH_PURPOSE,
    correlationId: `fascicolo-time-watch:${logicalOperationId}`,
    policyDecisionRef: FASCICOLO_TIME_WATCH_POLICY_DECISION_REF,
    inputReference: {
      referenceType: "FASCICOLO_TIME_WATCH",
      referenceId: occurrence.subjectId,
      referenceVersion: "V1",
      metadata: {
        contractVersion: FASCICOLO_TIME_WATCH_CONTRACT_VERSION,
        subjectType: occurrence.subjectType,
        tenantId: occurrence.tenantId,
        thresholdCode: occurrence.threshold,
        thresholdAt: occurrence.thresholdAt.toISOString(),
        expectedTemporalFingerprintHash: occurrence.expectedTemporalFingerprint,
        watchFingerprintHash: logicalOperationId,
      },
    },
    maxAttempts: 3,
    availableAt: new Date(occurrence.thresholdAt),
    admission: {
      admissionType: "AUTHORIZED_SYSTEM",
      tenantId: occurrence.tenantId,
      initiatingUserId: null,
      actor: {
        actorId: "system:fascicolo-time-watch",
        actorEmail: null,
        actorRole: "SYSTEM",
      },
    },
  };
  normalizeAsyncJobAdmission(admission);
  return admission;
}

export function parseConcessioneTimeWatchReference(input: unknown): ParsedConcessioneTimeWatchReference {
  const parsed = referenceSchema.safeParse(input);
  if (!parsed.success) throw new ConcessioneTimeWatchInputError("INVALID_TIME_WATCH_REFERENCE");
  const occurrence: ConcessioneTimeWatchOccurrence = {
    subjectType: "CONCESSIONE",
    subjectId: parsed.data.referenceId,
    tenantId: parsed.data.metadata.tenantId,
    threshold: parsed.data.metadata.thresholdCode,
    thresholdAt: new Date(parsed.data.metadata.thresholdAt),
    expectedTemporalFingerprint: parsed.data.metadata.expectedTemporalFingerprintHash,
  };
  if (occurrenceFingerprint(occurrence) !== parsed.data.metadata.watchFingerprintHash) {
    throw new ConcessioneTimeWatchInputError("TIME_WATCH_FINGERPRINT_MISMATCH");
  }
  return Object.freeze({
    subjectId: occurrence.subjectId,
    tenantId: occurrence.tenantId,
    threshold: occurrence.threshold,
    thresholdAt: occurrence.thresholdAt.toISOString(),
    expectedTemporalFingerprint: occurrence.expectedTemporalFingerprint,
  });
}

function result(referenceId: string, outcomeCode: string, threshold: string, thresholdAt: string, count = 0) {
  return {
    referenceType: "FASCICOLO_TIME_WATCH_RESULT",
    referenceId,
    referenceVersion: "V1",
    metadata: { outcomeCode, thresholdCode: threshold, thresholdAt, reevaluationJobCount: count },
  };
}

export function createConcessioneTimeWatchHandler(
  dependencies: { now?: () => Date } = {},
): AsyncJobHandler<ParsedConcessioneTimeWatchReference> {
  return {
    operation: FASCICOLO_TIME_WATCH_OPERATION,
    parseInput: parseConcessioneTimeWatchReference,
    async execute(input, context) {
      const triggeredAt = (dependencies.now ?? (() => new Date()))();
      return runSerializableTransactionWithRetry(async (tx) => {
        const concessione = await tx.concessione.findFirst({
          where: { id: input.subjectId, enteId: input.tenantId },
          select: { id: true, enteId: true, dataScadenza: true, stato: true },
        });
        if (!concessione) {
          return result(input.subjectId, "NO_OP_SUBJECT_NOT_FOUND_OR_SCOPE_MISMATCH", input.threshold, input.thresholdAt);
        }
        if (!isConcessioneTimeWatchApplicable(concessione.stato)) {
          return result(input.subjectId, "NO_OP_SUBJECT_NOT_APPLICABLE", input.threshold, input.thresholdAt);
        }
        const currentFingerprint = fingerprintConcessioneTemporalState(concessione);
        const currentThresholdAt = thresholdAtForConcessione(concessione.dataScadenza, input.threshold).toISOString();
        if (
          currentFingerprint !== input.expectedTemporalFingerprint
          || currentThresholdAt !== input.thresholdAt
        ) {
          return result(input.subjectId, "NO_OP_STALE_OCCURRENCE", input.threshold, input.thresholdAt);
        }
        if (triggeredAt.getTime() < new Date(input.thresholdAt).getTime()) {
          return result(input.subjectId, "NO_OP_THRESHOLD_NOT_REACHED", input.threshold, input.thresholdAt);
        }
        const procedimenti = await tx.procedimento.findMany({
          where: {
            concessioneId: concessione.id,
            stato: { in: ["DA_AVVIARE", "IN_CORSO"] },
          },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        if (procedimenti.length === 0) {
          return result(input.subjectId, "NO_OP_NO_ACTIVE_PROCEDIMENTO", input.threshold, input.thresholdAt);
        }
        for (const procedimento of procedimenti) {
          await admitAsyncJobInTransaction(tx, buildFascicoloReevaluationAdmission({
            procedimentoId: procedimento.id,
            change: {
              kind: "TIME_THRESHOLD_REACHED",
              origin: "WATCHDOG",
              triggeredAt: triggeredAt.toISOString(),
              stateFingerprint: currentFingerprint,
              subjectType: "CONCESSIONE",
              subjectId: concessione.id,
              procedimentoId: procedimento.id,
              threshold: input.threshold,
              thresholdAt: input.thresholdAt,
            },
          }, {
            tenantId: input.tenantId,
            admissionType: "AUTHORIZED_SYSTEM",
            initiatingUserId: null,
            actorId: "system:fascicolo-time-watch",
            actorEmail: null,
            actorRole: "SYSTEM",
            policyDecisionRef: FASCICOLO_TIME_WATCH_POLICY_DECISION_REF,
            correlationId: context.correlationId,
          }));
        }
        return result(input.subjectId, "THRESHOLD_REACHED", input.threshold, input.thresholdAt, procedimenti.length);
      });
    },
  };
}