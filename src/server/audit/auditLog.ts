import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
  concessioneId?: string | null;
  esito: "SUCCESS" | "FAILURE";
  metadata?: Prisma.InputJsonValue | null;
  actor?: AuditActor;
  requestContext?: AuditRequestContext;
}

type NormalizedMetadata = Prisma.InputJsonValue | null;

const sensitiveKeyPattern = /password|token|secret|session|cookie|authorization|apikey|api_key/i;

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeys(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !sensitiveKeyPattern.test(key))
      .sort(([a], [b]) => a.localeCompare(b));

    const sorted: Record<string, unknown> = {};
    for (const [key, nested] of entries) {
      sorted[key] = sortObjectKeys(nested);
    }

    return sorted;
  }

  return value;
}

function normalizeMetadata(metadata: Prisma.InputJsonValue | null | undefined): NormalizedMetadata {
  if (metadata === undefined || metadata === null) {
    return null;
  }

  return sortObjectKeys(metadata) as Prisma.InputJsonValue;
}

function stringifyForHash(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

function buildCurrentHash(input: {
  previousHash: string | null;
  createdAt: Date;
  azione: string;
  entita: string;
  entitaId: string | null;
  concessioneId: string | null;
  esito: "SUCCESS" | "FAILURE";
  actor: Required<AuditActor>;
  metadata: NormalizedMetadata;
}): string {
  const payload = {
    previousHash: input.previousHash,
    userId: input.actor.userId,
    userEmail: input.actor.userEmail,
    userRole: input.actor.userRole,
    azione: input.azione,
    entita: input.entita,
    entitaId: input.entitaId,
    concessioneId: input.concessioneId,
    esito: input.esito,
    metadata: input.metadata,
    createdAt: input.createdAt.toISOString(),
  };

  return createHash("sha256").update(stringifyForHash(payload)).digest("hex");
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

export async function createAuditLog(input: CreateAuditLogInput) {
  const actor = await resolveActor(input.actor);
  const context = input.requestContext ?? (await getAuditRequestContext());
  const metadata = normalizeMetadata(input.metadata);
  const createdAt = new Date();

  return prisma.$transaction(async (tx) => {
    const previous = await tx.activityLog.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { currentHash: true },
    });

    const previousHash = previous?.currentHash ?? null;
    const currentHash = buildCurrentHash({
      previousHash,
      createdAt,
      azione: input.azione,
      entita: input.entita,
      entitaId: input.entitaId ?? null,
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
  });
}

export function auditSuccess(input: Omit<CreateAuditLogInput, "esito">) {
  return createAuditLog({ ...input, esito: "SUCCESS" });
}

export function auditFailure(input: Omit<CreateAuditLogInput, "esito">) {
  return createAuditLog({ ...input, esito: "FAILURE" });
}
