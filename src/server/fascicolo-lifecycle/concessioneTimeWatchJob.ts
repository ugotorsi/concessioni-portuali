import { createHash } from "node:crypto";

import { z } from "zod";

import { normalizeAsyncJobAdmission, type AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJobInTransaction } from "@/server/async-jobs/persistence";
import type { AsyncJobHandler } from "@/server/async-jobs/registry";
import { stableStringify } from "@/server/audit/hash";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import {
  buildFascicoloReevaluationAdmission,
  buildFascicoloReevaluationAdmissionV2,
} from "./fascicoloReevaluationJob";

export const FASCICOLO_TIME_WATCH_OPERATION = "FASCICOLO_TIME_WATCH_V1" as const;
export const FASCICOLO_TIME_WATCH_CONTRACT_VERSION = "CONCESSIONE_TIME_WATCH_V1" as const;
export const FASCICOLO_TIME_WATCH_V2_OPERATION = "FASCICOLO_TIME_WATCH_V2" as const;
export const FASCICOLO_TIME_WATCH_V2_CONTRACT_VERSION = "CONCESSIONE_TIME_WATCH_V2" as const;
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

export interface ConcessioneTemporalStateV2 extends ConcessioneTemporalState {
  readonly expiryGeneration: number;
}

export interface ConcessioneTimeWatchOccurrence {
  readonly subjectType: "CONCESSIONE";
  readonly subjectId: string;
  readonly tenantId: string;
  readonly threshold: ConcessioneTimeWatchThreshold;
  readonly thresholdAt: Date;
  readonly expectedTemporalFingerprint: string;
}

export interface ConcessioneTimeWatchOccurrenceV2 extends ConcessioneTimeWatchOccurrence {
  readonly expiryGeneration: number;
}

type ParsedConcessioneTimeWatchReference = Readonly<{
  subjectId: string;
  tenantId: string;
  threshold: ConcessioneTimeWatchThreshold;
  thresholdAt: string;
  expectedTemporalFingerprint: string;
}>;

type ParsedConcessioneTimeWatchReferenceV2 = ParsedConcessioneTimeWatchReference & Readonly<{
  expiryGeneration: number;
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

const referenceSchemaV2 = z.object({
  referenceType: z.literal("FASCICOLO_TIME_WATCH"),
  referenceId: identifier,
  referenceVersion: z.literal("V2"),
  metadata: z.object({
    contractVersion: z.literal(FASCICOLO_TIME_WATCH_V2_CONTRACT_VERSION),
    subjectType: z.literal("CONCESSIONE"),
    tenantId: identifier,
    thresholdCode: z.enum(CONCESSIONE_TIME_WATCH_THRESHOLDS),
    thresholdAt: instant,
    expiryGeneration: z.number().int().positive(),
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

export function fingerprintConcessioneTemporalStateV2(
  input: Pick<ConcessioneTemporalStateV2, "id" | "enteId" | "dataScadenza" | "expiryGeneration">,
): string {
  if (
    !input.id.trim()
    || !input.enteId?.trim()
    || Number.isNaN(input.dataScadenza.getTime())
    || !Number.isInteger(input.expiryGeneration)
    || input.expiryGeneration <= 0
  ) {
    throw new ConcessioneTimeWatchInputError("INVALID_TIME_WATCH_REFERENCE");
  }
  return createHash("sha256").update(stableStringify({
    contractVersion: FASCICOLO_TIME_WATCH_V2_CONTRACT_VERSION,
    subjectType: "CONCESSIONE",
    subjectId: input.id,
    tenantId: input.enteId,
    dataScadenza: input.dataScadenza.toISOString(),
    expiryGeneration: input.expiryGeneration,
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

export function deriveConcessioneTimeWatchOccurrencesV2(
  concessione: ConcessioneTemporalStateV2,
  now: Date,
): readonly ConcessioneTimeWatchOccurrenceV2[] {
  if (
    !concessione.enteId?.trim()
    || Number.isNaN(now.getTime())
    || !isConcessioneTimeWatchApplicable(concessione.stato)
  ) {
    return [];
  }
  const expectedTemporalFingerprint = fingerprintConcessioneTemporalStateV2(concessione);
  const occurrences = CONCESSIONE_TIME_WATCH_THRESHOLDS.map((threshold) => ({
    subjectType: "CONCESSIONE" as const,
    subjectId: concessione.id,
    tenantId: concessione.enteId!,
    threshold,
    thresholdAt: thresholdAtForConcessione(concessione.dataScadenza, threshold),
    expectedTemporalFingerprint,
    expiryGeneration: concessione.expiryGeneration,
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

function occurrenceFingerprintV2(occurrence: ConcessioneTimeWatchOccurrenceV2): string {
  return createHash("sha256").update(stableStringify({
    operation: FASCICOLO_TIME_WATCH_V2_OPERATION,
    contractVersion: FASCICOLO_TIME_WATCH_V2_CONTRACT_VERSION,
    subjectType: occurrence.subjectType,
    subjectId: occurrence.subjectId,
    threshold: occurrence.threshold,
    thresholdAt: occurrence.thresholdAt.toISOString(),
    expectedTemporalFingerprint: occurrence.expectedTemporalFingerprint,
    expiryGeneration: occurrence.expiryGeneration,
  }), "utf8").digest("hex");
}

export function buildConcessioneTimeWatchReevaluationAdmission(input: {
  occurrence: ConcessioneTimeWatchOccurrence;
  procedimentoId: string;
  triggeredAt: Date;
}): AsyncJobAdmissionInput {
  const logicalOperationId = occurrenceFingerprint(input.occurrence);
  return buildFascicoloReevaluationAdmission({
    procedimentoId: input.procedimentoId,
    change: {
      kind: "TIME_THRESHOLD_REACHED",
      origin: "WATCHDOG",
      triggeredAt: input.triggeredAt.toISOString(),
      stateFingerprint: input.occurrence.expectedTemporalFingerprint,
      subjectType: input.occurrence.subjectType,
      subjectId: input.occurrence.subjectId,
      procedimentoId: input.procedimentoId,
      threshold: input.occurrence.threshold,
      thresholdAt: input.occurrence.thresholdAt.toISOString(),
    },
  }, {
    tenantId: input.occurrence.tenantId,
    admissionType: "AUTHORIZED_SYSTEM",
    initiatingUserId: null,
    actorId: "system:fascicolo-time-watch",
    actorEmail: null,
    actorRole: "SYSTEM",
    policyDecisionRef: FASCICOLO_TIME_WATCH_POLICY_DECISION_REF,
    correlationId: `fascicolo-time-watch:${logicalOperationId}`,
  });
}

export function buildConcessioneTimeWatchReevaluationAdmissionV2(input: {
  occurrence: ConcessioneTimeWatchOccurrenceV2;
  procedimentoId: string;
  triggeredAt: Date;
}): AsyncJobAdmissionInput {
  const logicalOperationId = occurrenceFingerprintV2(input.occurrence);
  return buildFascicoloReevaluationAdmissionV2({
    procedimentoId: input.procedimentoId,
    change: {
      kind: "TIME_THRESHOLD_REACHED",
      origin: "WATCHDOG",
      triggeredAt: input.triggeredAt.toISOString(),
      stateFingerprint: input.occurrence.expectedTemporalFingerprint,
      subjectType: input.occurrence.subjectType,
      subjectId: input.occurrence.subjectId,
      procedimentoId: input.procedimentoId,
      threshold: input.occurrence.threshold,
      thresholdAt: input.occurrence.thresholdAt.toISOString(),
      expiryGeneration: input.occurrence.expiryGeneration,
    },
  }, {
    tenantId: input.occurrence.tenantId,
    admissionType: "AUTHORIZED_SYSTEM",
    initiatingUserId: null,
    actorId: "system:fascicolo-time-watch",
    actorEmail: null,
    actorRole: "SYSTEM",
    policyDecisionRef: FASCICOLO_TIME_WATCH_POLICY_DECISION_REF,
    correlationId: `fascicolo-time-watch:${logicalOperationId}`,
  });
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

export function buildConcessioneTimeWatchAdmissionV2(
  occurrence: ConcessioneTimeWatchOccurrenceV2,
): AsyncJobAdmissionInput {
  const logicalOperationId = occurrenceFingerprintV2(occurrence);
  const admission: AsyncJobAdmissionInput = {
    operation: FASCICOLO_TIME_WATCH_V2_OPERATION,
    logicalOperationId,
    purpose: FASCICOLO_TIME_WATCH_PURPOSE,
    correlationId: `fascicolo-time-watch:${logicalOperationId}`,
    policyDecisionRef: FASCICOLO_TIME_WATCH_POLICY_DECISION_REF,
    inputReference: {
      referenceType: "FASCICOLO_TIME_WATCH",
      referenceId: occurrence.subjectId,
      referenceVersion: "V2",
      metadata: {
        contractVersion: FASCICOLO_TIME_WATCH_V2_CONTRACT_VERSION,
        subjectType: occurrence.subjectType,
        tenantId: occurrence.tenantId,
        thresholdCode: occurrence.threshold,
        thresholdAt: occurrence.thresholdAt.toISOString(),
        expiryGeneration: occurrence.expiryGeneration,
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

export function parseConcessioneTimeWatchReferenceV2(input: unknown): ParsedConcessioneTimeWatchReferenceV2 {
  const parsed = referenceSchemaV2.safeParse(input);
  if (!parsed.success) throw new ConcessioneTimeWatchInputError("INVALID_TIME_WATCH_REFERENCE");
  const occurrence: ConcessioneTimeWatchOccurrenceV2 = {
    subjectType: "CONCESSIONE",
    subjectId: parsed.data.referenceId,
    tenantId: parsed.data.metadata.tenantId,
    threshold: parsed.data.metadata.thresholdCode,
    thresholdAt: new Date(parsed.data.metadata.thresholdAt),
    expectedTemporalFingerprint: parsed.data.metadata.expectedTemporalFingerprintHash,
    expiryGeneration: parsed.data.metadata.expiryGeneration,
  };
  if (occurrenceFingerprintV2(occurrence) !== parsed.data.metadata.watchFingerprintHash) {
    throw new ConcessioneTimeWatchInputError("TIME_WATCH_FINGERPRINT_MISMATCH");
  }
  return Object.freeze({
    subjectId: occurrence.subjectId,
    tenantId: occurrence.tenantId,
    threshold: occurrence.threshold,
    thresholdAt: occurrence.thresholdAt.toISOString(),
    expectedTemporalFingerprint: occurrence.expectedTemporalFingerprint,
    expiryGeneration: occurrence.expiryGeneration,
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

function resultV2(referenceId: string, outcomeCode: string, threshold: string, thresholdAt: string, count = 0) {
  return {
    referenceType: "FASCICOLO_TIME_WATCH_RESULT",
    referenceId,
    referenceVersion: "V2",
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
          select: { id: true, enteId: true, dataScadenza: true, stato: true, expiryGeneration: true },
        });
        if (!concessione) {
          return result(input.subjectId, "NO_OP_SUBJECT_NOT_FOUND_OR_SCOPE_MISMATCH", input.threshold, input.thresholdAt);
        }
        if (!isConcessioneTimeWatchApplicable(concessione.stato)) {
          return result(input.subjectId, "NO_OP_SUBJECT_NOT_APPLICABLE", input.threshold, input.thresholdAt);
        }
        if (concessione.expiryGeneration !== 0) {
          return result(input.subjectId, "NO_OP_STALE_LEGACY_GENERATION", input.threshold, input.thresholdAt);
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
          await admitAsyncJobInTransaction(tx, buildConcessioneTimeWatchReevaluationAdmission({
            occurrence: {
              subjectType: "CONCESSIONE",
              subjectId: concessione.id,
              tenantId: input.tenantId,
              threshold: input.threshold,
              thresholdAt: new Date(input.thresholdAt),
              expectedTemporalFingerprint: currentFingerprint,
            },
            procedimentoId: procedimento.id,
            triggeredAt,
          }));
        }
        return result(input.subjectId, "THRESHOLD_REACHED", input.threshold, input.thresholdAt, procedimenti.length);
      });
    },
  };
}

export function createConcessioneTimeWatchV2Handler(
  dependencies: { now?: () => Date } = {},
): AsyncJobHandler<ParsedConcessioneTimeWatchReferenceV2> {
  return {
    operation: FASCICOLO_TIME_WATCH_V2_OPERATION,
    parseInput: parseConcessioneTimeWatchReferenceV2,
    async execute(input) {
      const triggeredAt = (dependencies.now ?? (() => new Date()))();
      return runSerializableTransactionWithRetry(async (tx) => {
        const concessione = await tx.concessione.findFirst({
          where: { id: input.subjectId, enteId: input.tenantId },
          select: { id: true, enteId: true, dataScadenza: true, stato: true, expiryGeneration: true },
        });
        if (!concessione) {
          return resultV2(input.subjectId, "NO_OP_SUBJECT_NOT_FOUND_OR_SCOPE_MISMATCH", input.threshold, input.thresholdAt);
        }
        if (!isConcessioneTimeWatchApplicable(concessione.stato)) {
          return resultV2(input.subjectId, "NO_OP_SUBJECT_NOT_APPLICABLE", input.threshold, input.thresholdAt);
        }
        if (concessione.expiryGeneration !== input.expiryGeneration) {
          return resultV2(input.subjectId, "NO_OP_STALE_OCCURRENCE", input.threshold, input.thresholdAt);
        }
        const currentFingerprint = fingerprintConcessioneTemporalStateV2(concessione);
        const currentThresholdAt = thresholdAtForConcessione(concessione.dataScadenza, input.threshold).toISOString();
        if (
          currentFingerprint !== input.expectedTemporalFingerprint
          || currentThresholdAt !== input.thresholdAt
        ) {
          return resultV2(input.subjectId, "NO_OP_STALE_OCCURRENCE", input.threshold, input.thresholdAt);
        }
        if (triggeredAt.getTime() < new Date(input.thresholdAt).getTime()) {
          return resultV2(input.subjectId, "NO_OP_THRESHOLD_NOT_REACHED", input.threshold, input.thresholdAt);
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
          return resultV2(input.subjectId, "NO_OP_NO_ACTIVE_PROCEDIMENTO", input.threshold, input.thresholdAt);
        }
        for (const procedimento of procedimenti) {
          await admitAsyncJobInTransaction(tx, buildConcessioneTimeWatchReevaluationAdmissionV2({
            occurrence: {
              subjectType: "CONCESSIONE",
              subjectId: concessione.id,
              tenantId: input.tenantId,
              threshold: input.threshold,
              thresholdAt: new Date(input.thresholdAt),
              expectedTemporalFingerprint: currentFingerprint,
              expiryGeneration: input.expiryGeneration,
            },
            procedimentoId: procedimento.id,
            triggeredAt,
          }));
        }
        return resultV2(input.subjectId, "THRESHOLD_REACHED", input.threshold, input.thresholdAt, procedimenti.length);
      });
    },
  };
}