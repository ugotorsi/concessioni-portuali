import type { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeAuditHash, sanitizeMetadata } from "@/server/audit/hash";
import { getAuditRequestContext, type AuditRequestContext } from "@/server/audit/requestContext";

interface AuditActor {
  userId?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
}

interface CreateAuditLogInput {
  azione: string;
  entita: string;
  entitaId?: string | null;
  enteId?: string | null;
  concessioneId?: string | null;
  esito: "SUCCESS" | "FAILURE";
  metadata?: Prisma.InputJsonValue | null;
  actor?: AuditActor;
  requestContext?: AuditRequestContext;
}

async function acquireActivityLogHashChainTransactionLock(
  tx: Prisma.TransactionClient,
): Promise<void> {
  // Existing callers are not all Serializable, so the global chain needs its own transaction lock.
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('concessioni-portuali'),
      hashtext('activity-log-hash-chain:v1')
    )
  `;
}

async function resolveActor(actor?: AuditActor): Promise<Required<AuditActor>> {
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

async function createAuditLogRecord(
  tx: Prisma.TransactionClient,
  input: CreateAuditLogInput,
  actor: Required<AuditActor>,
  context: AuditRequestContext,
) {
  const metadata = sanitizeMetadata(input.metadata);
  const createdAt = new Date();
  await acquireActivityLogHashChainTransactionLock(tx);
  const previous = await tx.activityLog.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { currentHash: true },
  });

  const previousHash = previous?.currentHash ?? null;
  const currentHash = computeAuditHash({
    previousHash,
    createdAt,
    azione: input.azione,
    entita: input.entita,
    entitaId: input.entitaId ?? null,
    enteId: input.enteId ?? null,
    concessioneId: input.concessioneId ?? null,
    esito: input.esito,
    actor,
    metadata,
  });

  return tx.activityLog.create({
    data: {
      userId: actor.userId,
      userEmail: actor.userEmail,
      userRole: actor.userRole,
      enteId: input.enteId ?? null,
      concessioneId: input.concessioneId ?? null,
      azione: input.azione,
      entita: input.entita,
      entitaId: input.entitaId ?? null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      esito: input.esito,
      metadata: metadata ?? undefined,
      previousHash,
      currentHash,
      createdAt,
    },
  });
}

export async function createAuditLogInTransaction(tx: Prisma.TransactionClient, input: CreateAuditLogInput) {
  const actor = await resolveActor(input.actor);
  const context = input.requestContext ?? (await getAuditRequestContext());
  return createAuditLogRecord(tx, input, actor, context);
}

export async function createAuditLog(input: CreateAuditLogInput) {
  return prisma.$transaction((tx) => createAuditLogInTransaction(tx, input));
}

export function auditSuccess(input: Omit<CreateAuditLogInput, "esito">) {
  return createAuditLog({ ...input, esito: "SUCCESS" });
}

export function auditFailure(input: Omit<CreateAuditLogInput, "esito">) {
  return createAuditLog({ ...input, esito: "FAILURE" });
}
