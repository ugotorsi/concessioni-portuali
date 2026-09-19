import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { stableStringify } from "@/server/audit/hash";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import type { FascicoloChange } from "./change";

export const FASCICOLO_SIGNAL_KIND = "CONCESSION_EXPIRY" as const;
export const FASCICOLO_SIGNAL_RULE_CODE = "CONCESSION_EXPIRY_WINDOW" as const;
export const FASCICOLO_SIGNAL_RULE_VERSION = 1 as const;
export const FASCICOLO_SIGNAL_SOURCE_OPERATION = "FASCICOLO_TIME_WATCH_V1" as const;

const CONCESSIONE_TIME_WATCH_CONTRACT_VERSION = "CONCESSIONE_TIME_WATCH_V1";
const supportedThresholds = {
  CONCESSION_90_DAYS: { attentionLevel: "LOW", rank: 1, daysBeforeExpiry: 90 },
  CONCESSION_60_DAYS: { attentionLevel: "MEDIUM", rank: 2, daysBeforeExpiry: 60 },
  CONCESSION_30_DAYS: { attentionLevel: "HIGH", rank: 3, daysBeforeExpiry: 30 },
  DEADLINE_DUE: { attentionLevel: "CRITICAL", rank: 4, daysBeforeExpiry: 0 },
} as const;

type SupportedThreshold = keyof typeof supportedThresholds;
type AttentionLevel = (typeof supportedThresholds)[SupportedThreshold]["attentionLevel"];

type SignalCandidate = Readonly<{
  procedimentoId: string;
  subjectId: string;
  generationFingerprint: string;
  threshold: SupportedThreshold;
  thresholdAt: Date;
  attentionLevel: AttentionLevel;
}>;

export type FascicoloSignalProjectionResult = Readonly<{
  outcome:
    | "NOT_APPLICABLE"
    | "NO_OP_SUBJECT_NOT_FOUND_OR_SCOPE_MISMATCH"
    | "NO_OP_STALE_GENERATION"
    | "NO_OP_THRESHOLD_MISMATCH"
    | "CREATED"
    | "REPLAYED"
    | "ESCALATED"
    | "SUPERSEDED_REPLAY";
  signalId: string | null;
}>;

function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function deriveCandidate(change: FascicoloChange): SignalCandidate | null {
  if (
    change.kind !== "TIME_THRESHOLD_REACHED"
    || change.subjectType !== "CONCESSIONE"
    || change.procedimentoId === null
    || !(change.threshold in supportedThresholds)
  ) {
    return null;
  }
  const threshold = change.threshold as SupportedThreshold;
  return Object.freeze({
    procedimentoId: change.procedimentoId,
    subjectId: change.subjectId,
    generationFingerprint: change.stateFingerprint,
    threshold,
    thresholdAt: new Date(change.thresholdAt),
    attentionLevel: supportedThresholds[threshold].attentionLevel,
  });
}

function temporalFingerprint(input: {
  id: string;
  enteId: string;
  dataScadenza: Date;
}): string {
  return sha256({
    contractVersion: CONCESSIONE_TIME_WATCH_CONTRACT_VERSION,
    subjectType: "CONCESSIONE",
    subjectId: input.id,
    tenantId: input.enteId,
    dataScadenza: input.dataScadenza.toISOString(),
  });
}

function expectedThresholdAt(dataScadenza: Date, threshold: SupportedThreshold): Date {
  return new Date(
    dataScadenza.getTime() - supportedThresholds[threshold].daysBeforeExpiry * 24 * 60 * 60 * 1_000,
  );
}

function laterOf(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function factsSnapshot(candidate: SignalCandidate, dataScadenza: Date) {
  return {
    subjectType: "CONCESSIONE",
    subjectId: candidate.subjectId,
    procedimentoId: candidate.procedimentoId,
    threshold: candidate.threshold,
    thresholdAt: candidate.thresholdAt.toISOString(),
    dataScadenza: dataScadenza.toISOString(),
  } as const;
}

function semanticKey(enteId: string, candidate: SignalCandidate): string {
  return sha256({
    kind: FASCICOLO_SIGNAL_KIND,
    ruleCode: FASCICOLO_SIGNAL_RULE_CODE,
    ruleVersion: FASCICOLO_SIGNAL_RULE_VERSION,
    enteId,
    procedimentoId: candidate.procedimentoId,
    subjectType: "CONCESSIONE",
    subjectId: candidate.subjectId,
  });
}

function identityKey(signalSemanticKey: string, generationFingerprint: string): string {
  return sha256({ semanticKey: signalSemanticKey, generationFingerprint });
}

async function auditSignal(
  tx: Prisma.TransactionClient,
  input: {
    action: "FASCICOLO_SIGNAL_CREATED" | "FASCICOLO_SIGNAL_ESCALATED" | "FASCICOLO_SIGNAL_SUPERSEDED";
    signalId: string;
    enteId: string;
    concessioneId: string;
    metadata: Prisma.InputJsonValue;
  },
): Promise<void> {
  await createAuditLogInTransaction(tx, {
    azione: input.action,
    entita: "FascicoloSignal",
    entitaId: input.signalId,
    enteId: input.enteId,
    concessioneId: input.concessioneId,
    esito: "SUCCESS",
    actor: {
      userId: null,
      userEmail: null,
      userRole: "SYSTEM",
    },
    metadata: input.metadata,
  });
}

export async function projectFascicoloSignalInTransaction(
  tx: Prisma.TransactionClient,
  change: FascicoloChange,
  observedAt: Date,
): Promise<FascicoloSignalProjectionResult> {
  const candidate = deriveCandidate(change);
  if (candidate === null) return { outcome: "NOT_APPLICABLE", signalId: null };
  if (Number.isNaN(observedAt.getTime())) throw new Error("INVALID_SIGNAL_OBSERVED_AT");

  const procedimento = await tx.procedimento.findFirst({
    where: {
      id: candidate.procedimentoId,
      concessioneId: candidate.subjectId,
      concessione: { enteId: { not: null } },
    },
    select: {
      id: true,
      concessione: {
        select: { id: true, enteId: true, dataScadenza: true },
      },
    },
  });
  const concessione = procedimento?.concessione;
  if (!procedimento || !concessione?.enteId) {
    return { outcome: "NO_OP_SUBJECT_NOT_FOUND_OR_SCOPE_MISMATCH", signalId: null };
  }
  if (temporalFingerprint({ ...concessione, enteId: concessione.enteId }) !== candidate.generationFingerprint) {
    return { outcome: "NO_OP_STALE_GENERATION", signalId: null };
  }
  if (expectedThresholdAt(concessione.dataScadenza, candidate.threshold).getTime() !== candidate.thresholdAt.getTime()) {
    return { outcome: "NO_OP_THRESHOLD_MISMATCH", signalId: null };
  }

  const signalSemanticKey = semanticKey(concessione.enteId, candidate);
  const signalIdentityKey = identityKey(signalSemanticKey, candidate.generationFingerprint);
  const existingGeneration = await tx.fascicoloSignal.findUnique({
    where: { identityKey: signalIdentityKey },
  });
  if (existingGeneration) {
    const lastObservedAt = laterOf(existingGeneration.lastObservedAt, observedAt);
    if (existingGeneration.status === "SUPERSEDED") {
      await tx.fascicoloSignal.update({
        where: { id: existingGeneration.id },
        data: { lastObservedAt },
      });
      return { outcome: "SUPERSEDED_REPLAY", signalId: existingGeneration.id };
    }
    if (supportedThresholds[candidate.threshold].rank <= supportedThresholds[existingGeneration.currentThreshold as SupportedThreshold]?.rank) {
      await tx.fascicoloSignal.update({
        where: { id: existingGeneration.id },
        data: { lastObservedAt },
      });
      return { outcome: "REPLAYED", signalId: existingGeneration.id };
    }
    const escalated = await tx.fascicoloSignal.update({
      where: { id: existingGeneration.id },
      data: {
        currentThreshold: candidate.threshold,
        attentionLevel: candidate.attentionLevel,
        factsSnapshot: factsSnapshot(candidate, concessione.dataScadenza),
        lastObservedAt,
      },
    });
    await auditSignal(tx, {
      action: "FASCICOLO_SIGNAL_ESCALATED",
      signalId: escalated.id,
      enteId: concessione.enteId,
      concessioneId: concessione.id,
      metadata: {
        fromThreshold: existingGeneration.currentThreshold,
        toThreshold: candidate.threshold,
        generationFingerprint: candidate.generationFingerprint,
      },
    });
    return { outcome: "ESCALATED", signalId: escalated.id };
  }

  const openGeneration = await tx.fascicoloSignal.findFirst({
    where: { semanticKey: signalSemanticKey, status: "OPEN" },
  });
  if (openGeneration) {
    await tx.fascicoloSignal.update({
      where: { id: openGeneration.id },
      data: { status: "SUPERSEDED", supersededAt: observedAt },
    });
    await auditSignal(tx, {
      action: "FASCICOLO_SIGNAL_SUPERSEDED",
      signalId: openGeneration.id,
      enteId: concessione.enteId,
      concessioneId: concessione.id,
      metadata: {
        previousGenerationFingerprint: openGeneration.generationFingerprint,
        replacementGenerationFingerprint: candidate.generationFingerprint,
      },
    });
  }

  const created = await tx.fascicoloSignal.create({
    data: {
      enteId: concessione.enteId,
      concessioneId: concessione.id,
      procedimentoId: procedimento.id,
      kind: FASCICOLO_SIGNAL_KIND,
      sourceOperation: FASCICOLO_SIGNAL_SOURCE_OPERATION,
      ruleCode: FASCICOLO_SIGNAL_RULE_CODE,
      ruleVersion: FASCICOLO_SIGNAL_RULE_VERSION,
      subjectType: "CONCESSIONE",
      subjectId: concessione.id,
      semanticKey: signalSemanticKey,
      generationFingerprint: candidate.generationFingerprint,
      identityKey: signalIdentityKey,
      currentThreshold: candidate.threshold,
      attentionLevel: candidate.attentionLevel,
      factsSnapshot: factsSnapshot(candidate, concessione.dataScadenza),
      status: "OPEN",
      detectedAt: observedAt,
      lastObservedAt: observedAt,
    },
  });
  await auditSignal(tx, {
    action: "FASCICOLO_SIGNAL_CREATED",
    signalId: created.id,
    enteId: concessione.enteId,
    concessioneId: concessione.id,
    metadata: {
      kind: FASCICOLO_SIGNAL_KIND,
      ruleCode: FASCICOLO_SIGNAL_RULE_CODE,
      ruleVersion: FASCICOLO_SIGNAL_RULE_VERSION,
      threshold: candidate.threshold,
      attentionLevel: candidate.attentionLevel,
      generationFingerprint: candidate.generationFingerprint,
      supersededSignalId: openGeneration?.id ?? null,
    },
  });
  return { outcome: "CREATED", signalId: created.id };
}

export async function projectFascicoloSignal(
  change: FascicoloChange,
  observedAt = new Date(),
): Promise<FascicoloSignalProjectionResult> {
  if (deriveCandidate(change) === null) return { outcome: "NOT_APPLICABLE", signalId: null };
  return runSerializableTransactionWithRetry((tx) =>
    projectFascicoloSignalInTransaction(tx, change, observedAt));
}
