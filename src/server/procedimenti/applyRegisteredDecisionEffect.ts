import type { Prisma } from "@/generated/prisma/client";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireTenantAccess } from "@/lib/tenant-auth";
import { computeAuditHash, sanitizeMetadata } from "@/server/audit/hash";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import type { AuditRequestContext } from "@/server/audit/requestContext";

interface ActorInput {
  userId?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
}

interface TenantContextInput {
  isAdmin: boolean;
  accessibleTenantIds: string[];
  role: string;
}

type StatoEffettoDecisione = "NON_PREVISTO" | "PENDENTE" | "PRONTO" | "APPLICATO" | "BLOCCATO" | "ERRORE";

interface ConcessioneStateConflictDetails {
  decisioneId: string;
  enteId: string | null;
  procedimentoId: string;
  concessioneId: string;
  expectedState: string;
  observedState: string | null;
  effectVersion: number;
  initialStatoEffetto: "PRONTO" | "PENDENTE";
}

class ApplyDecisionEffectError extends Error {
  constructor(
    public readonly code: "CONCESSIONE_STATE_CONFLICT" | "DECISION_INTEGRITY_ERROR",
    message: string,
    public readonly details?: ConcessioneStateConflictDetails,
    public readonly persistedStatoEffetto?: StatoEffettoDecisione,
    public readonly persistedEffectVersion?: number,
    public readonly persistedEffettoApplicatoAt?: Date | null,
  ) {
    super(message);
    this.name = "ApplyDecisionEffectError";
  }
}

export interface ApplyRegisteredDecisionEffectInput {
  decisioneId: string;
  actor?: ActorInput;
  tenantContext?: TenantContextInput | null;
  requestContext?: AuditRequestContext;
}

export interface ApplyRegisteredDecisionEffectResult {
  status: "APPLIED" | "ALREADY_APPLIED" | "NOT_READY";
  decisioneId: string;
  concessioneId: string | null;
  statoEffetto: StatoEffettoDecisione;
  appliedAt: Date | null;
}

interface DecisionRow {
  id: string;
  enteId: string | null;
  procedimentoId: string;
  concessioneId: string | null;
  tipoDecisione: string;
  effettoTitolo: string;
  statoConcessionePrecedente: string | null;
  statoConcessioneSuccessivo: string | null;
  statoEffetto: StatoEffettoDecisione;
  dataEfficacia: Date;
  effectVersion: number;
  effettoApplicatoAt: Date | null;
}

interface PersistedDecisionSnapshot {
  statoEffetto: StatoEffettoDecisione;
  effectVersion: number;
  effettoApplicatoAt: Date | null;
}

function isEffectExpected(row: DecisionRow): boolean {
  return row.effettoTitolo !== "NESSUNO" && row.statoConcessioneSuccessivo !== null && row.concessioneId !== null;
}

async function resolveActor(actor?: ActorInput): Promise<Required<ActorInput>> {
  if (actor?.userId || actor?.userEmail || actor?.userRole) {
    return {
      userId: actor.userId ?? null,
      userEmail: actor.userEmail ?? null,
      userRole: actor.userRole ?? null,
    };
  }

  const currentUser = await getCurrentUser();
  return {
    userId: currentUser?.id ?? null,
    userEmail: currentUser?.email ?? null,
    userRole: currentUser?.role ?? null,
  };
}

function buildMetadata(row: DecisionRow, note?: string): Prisma.InputJsonValue {
  return sanitizeMetadata({
    decisioneId: row.id,
    procedimentoId: row.procedimentoId,
    concessioneId: row.concessioneId,
    tipoDecisione: row.tipoDecisione,
    effettoTitolo: row.effettoTitolo,
    statoConcessionePrecedente: row.statoConcessionePrecedente,
    statoConcessioneSuccessivo: row.statoConcessioneSuccessivo,
    dataEfficacia: row.dataEfficacia.toISOString(),
    note,
  }) as Prisma.InputJsonValue;
}

async function loadPersistedDecisionSnapshot(
  tx: Prisma.TransactionClient,
  decisioneId: string,
): Promise<PersistedDecisionSnapshot | null> {
  return tx.decisioneProcedimento.findUnique({
    where: { id: decisioneId },
    select: {
      statoEffetto: true,
      effectVersion: true,
      effettoApplicatoAt: true,
    },
  });
}

async function writeConflictAuditInTx(input: {
  tx: Prisma.TransactionClient;
  actor: Required<ActorInput>;
  requestContext?: AuditRequestContext;
  details: ConcessioneStateConflictDetails;
  persisted: PersistedDecisionSnapshot | null;
  blockUpdateCount: number;
}) {
  const previous = await input.tx.activityLog.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { currentHash: true },
  });

  const createdAt = new Date();
  const previousHash = previous?.currentHash ?? null;
  const metadata = sanitizeMetadata({
    code: "CONCESSIONE_STATE_CONFLICT",
    decisioneId: input.details.decisioneId,
    procedimentoId: input.details.procedimentoId,
    concessioneId: input.details.concessioneId,
    expectedState: input.details.expectedState,
    observedState: input.details.observedState,
    initialStatoEffetto: input.details.initialStatoEffetto,
    effectVersion: input.details.effectVersion,
    persistedStatoEffetto: input.persisted?.statoEffetto ?? null,
    persistedEffectVersion: input.persisted?.effectVersion ?? null,
    blockUpdateCount: input.blockUpdateCount,
  }) as Prisma.InputJsonValue;

  const currentHash = computeAuditHash({
    previousHash,
    createdAt,
    azione: "EFFETTO_BLOCCATO_CONFLITTO_STATO",
    entita: "DecisioneProcedimento",
    entitaId: input.details.decisioneId,
    enteId: input.details.enteId,
    concessioneId: input.details.concessioneId,
    esito: "FAILURE",
    actor: {
      userId: input.actor.userId,
      userEmail: input.actor.userEmail,
      userRole: input.actor.userRole,
    },
    metadata,
  });

  await input.tx.activityLog.create({
    data: {
      userId: input.actor.userId,
      userEmail: input.actor.userEmail,
      userRole: input.actor.userRole,
      enteId: input.details.enteId,
      concessioneId: input.details.concessioneId,
      ipAddress: input.requestContext?.ipAddress ?? null,
      userAgent: input.requestContext?.userAgent ?? null,
      azione: "EFFETTO_BLOCCATO_CONFLITTO_STATO",
      entita: "DecisioneProcedimento",
      entitaId: input.details.decisioneId,
      esito: "FAILURE",
      metadata,
      previousHash,
      currentHash,
      createdAt,
    },
  });
}

async function persistBlockedStateAfterConflict(input: {
  actor: Required<ActorInput>;
  requestContext?: AuditRequestContext;
  details: ConcessioneStateConflictDetails;
}) {
  return prisma.$transaction(async (tx) => {
    const blockUpdate = await tx.decisioneProcedimento.updateMany({
      where: {
        id: input.details.decisioneId,
        effectVersion: input.details.effectVersion,
        statoEffetto: input.details.initialStatoEffetto,
      },
      data: {
        statoEffetto: "BLOCCATO",
        effettoApplicatoAt: null,
      },
    });

    const persisted = await loadPersistedDecisionSnapshot(tx, input.details.decisioneId);

    await writeConflictAuditInTx({
      tx,
      actor: input.actor,
      requestContext: input.requestContext,
      details: input.details,
      persisted,
      blockUpdateCount: blockUpdate.count,
    });

    return {
      persisted,
      blockUpdateCount: blockUpdate.count,
    };
  });
}

export async function applyRegisteredDecisionEffect(
  input: ApplyRegisteredDecisionEffectInput,
): Promise<ApplyRegisteredDecisionEffectResult> {
  const actor = await resolveActor(input.actor);

  try {
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<DecisionRow[]>`
        SELECT
          d."id",
          d."enteId",
          d."procedimentoId",
          d."concessioneId",
          d."tipoDecisione",
          d."effettoTitolo",
          d."statoConcessionePrecedente",
          d."statoConcessioneSuccessivo",
          d."statoEffetto",
          d."dataEfficacia",
          d."effectVersion",
          d."effettoApplicatoAt"
        FROM "DecisioneProcedimento" d
        WHERE d."id" = ${input.decisioneId}
        LIMIT 1
      `;

      const row = rows[0];
      if (!row) {
        throw new Error("Decisione non trovata.");
      }

      if (input.tenantContext) {
        requireTenantAccess(input.tenantContext as never, row.enteId, {
          mode: "write",
          allowWhenEnteMissing: false,
        });
      }

      if (!isEffectExpected(row)) {
        throw new Error("Effetto non previsto per questa decisione.");
      }

      if (!row.statoConcessionePrecedente) {
        throw new ApplyDecisionEffectError(
          "DECISION_INTEGRITY_ERROR",
          "Decisione incoerente: statoConcessionePrecedente mancante per effetto sul titolo.",
        );
      }

      const now = new Date();
      if (row.dataEfficacia.getTime() > now.getTime()) {
        return {
          status: "NOT_READY",
          decisioneId: row.id,
          concessioneId: row.concessioneId,
          statoEffetto: row.statoEffetto,
          appliedAt: null,
        };
      }

      if (row.statoEffetto === "APPLICATO") {
        return {
          status: "ALREADY_APPLIED",
          decisioneId: row.id,
          concessioneId: row.concessioneId,
          statoEffetto: "APPLICATO",
          appliedAt: row.effettoApplicatoAt,
        };
      }

      if (row.statoEffetto !== "PRONTO" && row.statoEffetto !== "PENDENTE") {
        throw new Error("Stato effetto non applicabile.");
      }

      const updated = await tx.$executeRaw`
        UPDATE "DecisioneProcedimento"
        SET
          "statoEffetto" = 'APPLICATO'::"StatoEffettoProcedimento",
          "effettoApplicatoAt" = ${now},
          "effectVersion" = "effectVersion" + 1
        WHERE
          "id" = ${row.id}
          AND "effectVersion" = ${row.effectVersion}
          AND "statoEffetto" IN ('PRONTO'::"StatoEffettoProcedimento", 'PENDENTE'::"StatoEffettoProcedimento")
          AND "dataEfficacia" <= ${now}
      `;

      if (updated === 0) {
        const afterRows = await tx.$queryRaw<Pick<DecisionRow, "statoEffetto" | "effettoApplicatoAt">[]>`
          SELECT "statoEffetto", "effettoApplicatoAt"
          FROM "DecisioneProcedimento"
          WHERE "id" = ${row.id}
          LIMIT 1
        `;

        const after = afterRows[0];
        if (after?.statoEffetto === "APPLICATO") {
          return {
            status: "ALREADY_APPLIED",
            decisioneId: row.id,
            concessioneId: row.concessioneId,
            statoEffetto: "APPLICATO",
            appliedAt: after.effettoApplicatoAt,
          };
        }

        throw new Error("Conflitto concorrente durante applicazione effetto.");
      }

      const concessioneUpdate = await tx.concessione.updateMany({
        where: {
          id: row.concessioneId ?? "",
          stato: row.statoConcessionePrecedente as never,
        },
        data: {
          stato: row.statoConcessioneSuccessivo as never,
        },
      });

      if (concessioneUpdate.count === 0) {
        const observedConcessione = await tx.concessione.findUnique({
          where: { id: row.concessioneId ?? "" },
          select: { stato: true },
        });

        throw new ApplyDecisionEffectError(
          "CONCESSIONE_STATE_CONFLICT",
          "CONCESSIONE_STATE_CONFLICT",
          {
            decisioneId: row.id,
            enteId: row.enteId,
            procedimentoId: row.procedimentoId,
            concessioneId: row.concessioneId ?? "",
            expectedState: row.statoConcessionePrecedente,
            observedState: observedConcessione?.stato ?? null,
            effectVersion: row.effectVersion,
            initialStatoEffetto: row.statoEffetto,
          },
        );
      }

      const previous = await tx.activityLog.findFirst({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { currentHash: true },
      });

      const createdAt = new Date();
      const previousHash = previous?.currentHash ?? null;
      const metadata = buildMetadata(row, "Applicazione tecnica separata dell'effetto registrato.");
      const currentHash = computeAuditHash({
        previousHash,
        createdAt,
        azione: "EFFETTO_APPLICATO",
        entita: "DecisioneProcedimento",
        entitaId: row.id,
        enteId: row.enteId,
        concessioneId: row.concessioneId,
        esito: "SUCCESS",
        actor: {
          userId: actor.userId,
          userEmail: actor.userEmail,
          userRole: actor.userRole,
        },
        metadata,
      });

      await tx.activityLog.create({
        data: {
          userId: actor.userId,
          userEmail: actor.userEmail,
          userRole: actor.userRole,
          enteId: row.enteId,
          concessioneId: row.concessioneId,
          ipAddress: input.requestContext?.ipAddress ?? null,
          userAgent: input.requestContext?.userAgent ?? null,
          azione: "EFFETTO_APPLICATO",
          entita: "DecisioneProcedimento",
          entitaId: row.id,
          esito: "SUCCESS",
          metadata,
          previousHash,
          currentHash,
          createdAt,
        },
      });

      return {
        status: "APPLIED",
        decisioneId: row.id,
        concessioneId: row.concessioneId,
        statoEffetto: "APPLICATO",
        appliedAt: now,
      };
    });
  } catch (error) {
    if (error instanceof ApplyDecisionEffectError && error.code === "CONCESSIONE_STATE_CONFLICT") {
      const details = error.details;
      if (details) {
        const persisted = await persistBlockedStateAfterConflict({
          actor,
          requestContext: input.requestContext,
          details,
        });

        throw new ApplyDecisionEffectError(
          "CONCESSIONE_STATE_CONFLICT",
          "CONCESSIONE_STATE_CONFLICT",
          details,
          persisted.persisted?.statoEffetto ?? details.initialStatoEffetto,
          persisted.persisted?.effectVersion,
          persisted.persisted?.effettoApplicatoAt ?? null,
        );
      }

      throw error;
    }

    await auditFailure({
      azione: "EFFETTO_APPLICAZIONE_FALLITA",
      entita: "DecisioneProcedimento",
      entitaId: input.decisioneId,
      actor: {
        userId: actor.userId,
        userEmail: actor.userEmail,
        userRole: actor.userRole,
      },
      metadata: sanitizeMetadata({
        reason: error instanceof Error ? error.message : "Errore sconosciuto",
      }),
      requestContext: input.requestContext,
    });

    throw error;
  }
}

export async function auditAlreadyAppliedDecisionEffect(input: {
  decisioneId: string;
  concessioneId: string | null;
  enteId: string | null;
  actor?: ActorInput;
  requestContext?: AuditRequestContext;
}) {
  const actor = await resolveActor(input.actor);

  await auditSuccess({
    azione: "EFFETTO_GIA_APPLICATO",
    entita: "DecisioneProcedimento",
    entitaId: input.decisioneId,
    concessioneId: input.concessioneId,
    enteId: input.enteId,
    actor: {
      userId: actor.userId,
      userEmail: actor.userEmail,
      userRole: actor.userRole,
    },
    metadata: sanitizeMetadata({
      note: "No-op idempotente: effetto gia applicato.",
    }),
    requestContext: input.requestContext,
  });
}
