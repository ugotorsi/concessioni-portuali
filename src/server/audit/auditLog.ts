import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  computeAuditHash,
  sanitizeMetadata,
  verifyAuditHashRecords,
  type AuditHashRecord,
  type AuditHashChainVerification,
} from "@/server/audit/hash";
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
  const namespace = "concessioni-portuali";
  const resource = "activity-log-hash-chain:v1";
  const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT TRUE AS "acquired"
    FROM pg_advisory_xact_lock(
      hashtext(${namespace}),
      hashtext(${resource})
    )
  `;
  if (rows.length !== 1 || rows[0]?.acquired !== true) {
    throw new Error("ACTIVITY_LOG_HASH_CHAIN_LOCK_FAILED");
  }
}

async function resolveActor(actor?: AuditActor): Promise<Required<AuditActor>> {
  if (actor?.userId || actor?.userEmail || actor?.userRole) {
    return {
      userId: actor.userId ?? null,
      userEmail: actor.userEmail ?? null,
      userRole: actor.userRole ?? null,
    };
  }

  const { getCurrentUser } = await import("@/lib/auth");
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
  await acquireActivityLogHashChainTransactionLock(tx);
  const previous = await tx.activityLog.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { currentHash: true, createdAt: true },
  });

  // The chain is read by timestamp; concurrent writes and clock skew must not reorder it.
  const createdAt = new Date(Math.max(Date.now(), (previous?.createdAt.getTime() ?? -1) + 1));
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

export async function verifyCompleteAuditLogChain(
  batchSize = 1_000,
): Promise<AuditHashChainVerification> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error("AUDIT_HASH_CHAIN_BATCH_SIZE_INVALID");
  }
  let last: { createdAt: Date; id: string } | null = null;
  let previousHash: string | null = null;
  let verifiedCount = 0;
  for (;;) {
    const rows: AuditHashRecord[] = await prisma.activityLog.findMany({
      where: last
        ? {
            OR: [
              { createdAt: { gt: last.createdAt } },
              { createdAt: last.createdAt, id: { gt: last.id } },
            ],
          }
        : undefined,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: batchSize,
      select: {
        id: true,
        createdAt: true,
        userId: true,
        userEmail: true,
        userRole: true,
        azione: true,
        entita: true,
        entitaId: true,
        enteId: true,
        concessioneId: true,
        esito: true,
        metadata: true,
        previousHash: true,
        currentHash: true,
      },
    });
    if (rows.length === 0) {
      return { valid: true, verifiedCount, finalHash: previousHash, issue: null };
    }
    const result = verifyAuditHashRecords(rows, previousHash);
    verifiedCount += result.verifiedCount;
    if (!result.valid) {
      return { ...result, verifiedCount };
    }
    previousHash = result.finalHash;
    const tail: AuditHashRecord = rows.at(-1)!;
    last = { createdAt: tail.createdAt, id: tail.id };
    if (rows.length < batchSize) {
      return { valid: true, verifiedCount, finalHash: previousHash, issue: null };
    }
  }
}
