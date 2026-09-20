import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { canManageConcessioneExpiry, type CurrentUser, type DemoRole } from "@/lib/auth";
import type { CurrentTenantContext } from "@/lib/tenant-auth";
import { admitAsyncJobInTransaction } from "@/server/async-jobs/persistence";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { stableStringify } from "@/server/audit/hash";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import {
  buildConcessioneTimeWatchAdmissionV2,
  buildConcessioneTimeWatchReevaluationAdmissionV2,
  deriveConcessioneTimeWatchOccurrencesV2,
} from "./concessioneTimeWatchJob";

export const CONCESSIONE_EXPIRY_CHANGE_FLAG = "CONCESSIONE_EXPIRY_CHANGE_ENABLED" as const;

export interface ConcessioneExpiryChangeInput {
  requestId: string;
  concessioneId: string;
  expectedGeneration: number;
  expectedDataScadenza: string;
  newDate: string;
  motivation: string;
  reference?: string | null;
}

export type ConcessioneExpiryChangeResult =
  | Readonly<{ outcome: "UPDATED"; concessioneId: string; expiryGeneration: number }>
  | Readonly<{ outcome: "REPLAYED"; concessioneId: string; expiryGeneration: number }>
  | Readonly<{ outcome: "CONFLICT"; concessioneId: string }>
  | Readonly<{ outcome: "ALREADY_CURRENT"; concessioneId: string; expiryGeneration: number }>;

interface NormalizedExpiryChangeInput extends ConcessioneExpiryChangeInput {
  expectedDataScadenza: string;
  newDataScadenza: Date;
  motivation: string;
  reference: string | null;
  payloadFingerprint: string;
}

export function isConcessioneExpiryChangeEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[CONCESSIONE_EXPIRY_CHANGE_FLAG] === "true";
}

function normalizeInput(input: ConcessioneExpiryChangeInput): NormalizedExpiryChangeInput {
  const requestId = input.requestId.trim();
  const concessioneId = input.concessioneId.trim();
  const motivation = input.motivation.trim();
  const reference = input.reference?.trim() || null;
  const expectedDate = new Date(input.expectedDataScadenza);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.newDate);
  const newDataScadenza = dateMatch
    ? new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])))
    : new Date(Number.NaN);
  if (
    !requestId
    || requestId.length > 128
    || !concessioneId
    || !Number.isInteger(input.expectedGeneration)
    || input.expectedGeneration < 0
    || Number.isNaN(expectedDate.getTime())
    || Number.isNaN(newDataScadenza.getTime())
    || newDataScadenza.toISOString().slice(0, 10) !== input.newDate
    || !motivation
    || motivation.length > 2000
    || (reference?.length ?? 0) > 1000
  ) {
    throw new Error("INVALID_CONCESSIONE_EXPIRY_CHANGE");
  }
  const expectedDataScadenza = expectedDate.toISOString();
  const payloadFingerprint = createHash("sha256").update(stableStringify({
    concessioneId,
    expectedGeneration: input.expectedGeneration,
    expectedDataScadenza,
    newDataScadenza: newDataScadenza.toISOString(),
    motivation,
    reference,
  }), "utf8").digest("hex");
  return {
    ...input,
    requestId,
    concessioneId,
    expectedDataScadenza,
    newDataScadenza,
    motivation,
    reference,
    payloadFingerprint,
  };
}

function resolveEffectiveRole(
  context: CurrentTenantContext,
  actor: CurrentUser,
  enteId: string,
): DemoRole | null {
  if (context.userId !== actor.id) return null;
  if (actor.role === "ADMIN" && context.isAdmin) return "ADMIN";
  return context.tenantMemberships.find((membership) => membership.enteId === enteId)?.role ?? null;
}

function sameUtcDay(left: Date, right: Date): boolean {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

function isCommandUniquenessConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const modelName = (error.meta as { modelName?: unknown } | undefined)?.modelName;
  return modelName === "ConcessioneExpiryChangeCommand";
}

function persistedUserId(userId: string): string | null {
  return userId === "staging-preview-admin" ? null : userId;
}

export async function changeConcessioneExpiry(input: {
  command: ConcessioneExpiryChangeInput;
  actor: CurrentUser;
  tenantContext: CurrentTenantContext;
  now?: Date;
}): Promise<ConcessioneExpiryChangeResult> {
  if (!isConcessioneExpiryChangeEnabled()) throw new Error("CONCESSIONE_EXPIRY_CHANGE_DISABLED");
  const command = normalizeInput(input.command);
  const changedAt = input.now ?? new Date();
  if (Number.isNaN(changedAt.getTime())) throw new Error("INVALID_CONCESSIONE_EXPIRY_CHANGE_TIME");

  return runSerializableTransactionWithRetry(async (tx) => {
    const concessione = await tx.concessione.findUnique({
      where: { id: command.concessioneId },
      select: { id: true, enteId: true, dataScadenza: true, expiryGeneration: true, stato: true },
    });
    if (!concessione?.enteId) throw new Error("CONCESSIONE_NOT_FOUND_OR_TENANT_MISSING");

    const effectiveRole = resolveEffectiveRole(input.tenantContext, input.actor, concessione.enteId);
    if (!effectiveRole || !canManageConcessioneExpiry(effectiveRole)) {
      throw new Error("Tenant access denied.");
    }

    const existingCommand = await tx.concessioneExpiryChangeCommand.findUnique({
      where: { requestId: command.requestId },
    });
    if (existingCommand) {
      if (
        existingCommand.actorId === input.actor.id
        && existingCommand.payloadFingerprint === command.payloadFingerprint
      ) {
        return {
          outcome: "REPLAYED" as const,
          concessioneId: existingCommand.concessioneId,
          expiryGeneration: existingCommand.resultingGeneration,
        };
      }
      return { outcome: "CONFLICT" as const, concessioneId: command.concessioneId };
    }

    if (
      concessione.expiryGeneration !== command.expectedGeneration
      || concessione.dataScadenza.toISOString() !== command.expectedDataScadenza
    ) {
      return { outcome: "CONFLICT" as const, concessioneId: command.concessioneId };
    }
    if (sameUtcDay(concessione.dataScadenza, command.newDataScadenza)) {
      return {
        outcome: "ALREADY_CURRENT" as const,
        concessioneId: concessione.id,
        expiryGeneration: concessione.expiryGeneration,
      };
    }

    const resultingGeneration = concessione.expiryGeneration + 1;
    const updated = await tx.concessione.updateMany({
      where: {
        id: concessione.id,
        enteId: concessione.enteId,
        expiryGeneration: command.expectedGeneration,
        dataScadenza: concessione.dataScadenza,
      },
      data: {
        dataScadenza: command.newDataScadenza,
        expiryGeneration: resultingGeneration,
      },
    });
    if (updated.count !== 1) return { outcome: "CONFLICT" as const, concessioneId: concessione.id };

    await tx.concessioneExpiryChangeCommand.create({
      data: {
        requestId: command.requestId,
        payloadFingerprint: command.payloadFingerprint,
        concessioneId: concessione.id,
        enteId: concessione.enteId,
        expectedGeneration: command.expectedGeneration,
        resultingGeneration,
        previousDataScadenza: concessione.dataScadenza,
        newDataScadenza: command.newDataScadenza,
        motivation: command.motivation,
        reference: command.reference,
        actorUserId: persistedUserId(input.actor.id),
        actorId: input.actor.id,
        actorEmail: input.actor.email,
        actorRole: effectiveRole,
      },
    });

    await tx.fascicoloSignal.updateMany({
      where: {
        concessioneId: concessione.id,
        enteId: concessione.enteId,
        status: "OPEN",
        kind: "CONCESSION_EXPIRY",
        subjectType: "CONCESSIONE",
        subjectId: concessione.id,
        ruleCode: "CONCESSION_EXPIRY_WINDOW",
      },
      data: { status: "SUPERSEDED", supersededAt: changedAt },
    });

    await createAuditLogInTransaction(tx, {
      azione: "CONCESSIONE_EXPIRY_CHANGED",
      entita: "Concessione",
      entitaId: concessione.id,
      enteId: concessione.enteId,
      concessioneId: concessione.id,
      esito: "SUCCESS",
      actor: {
        userId: persistedUserId(input.actor.id),
        userEmail: input.actor.email,
        userRole: effectiveRole,
      },
      metadata: {
        requestId: command.requestId,
        previousDataScadenza: concessione.dataScadenza.toISOString(),
        newDataScadenza: command.newDataScadenza.toISOString(),
        previousGeneration: concessione.expiryGeneration,
        resultingGeneration,
        motivation: command.motivation,
        reference: command.reference,
      },
    });

    const temporalState = { ...concessione, dataScadenza: command.newDataScadenza, expiryGeneration: resultingGeneration };
    const occurrences = deriveConcessioneTimeWatchOccurrencesV2(temporalState, changedAt);
    for (const occurrence of occurrences) {
      await admitAsyncJobInTransaction(tx, buildConcessioneTimeWatchAdmissionV2(occurrence));
    }

    const maturedOccurrence = occurrences.find((occurrence) => occurrence.thresholdAt.getTime() <= changedAt.getTime());
    if (maturedOccurrence) {
      const procedimenti = await tx.procedimento.findMany({
        where: { concessioneId: concessione.id, stato: { in: ["DA_AVVIARE", "IN_CORSO"] } },
        select: { id: true },
      });
      for (const procedimento of procedimenti) {
        await admitAsyncJobInTransaction(tx, buildConcessioneTimeWatchReevaluationAdmissionV2({
          occurrence: maturedOccurrence,
          procedimentoId: procedimento.id,
          triggeredAt: changedAt,
        }));
      }
    }

    return { outcome: "UPDATED" as const, concessioneId: concessione.id, expiryGeneration: resultingGeneration };
  }, { isRetryableError: isCommandUniquenessConflict });
}