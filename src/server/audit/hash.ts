import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";

export type NormalizedMetadata = Prisma.InputJsonValue | null;

export interface ComputeAuditHashInput {
  previousHash: string | null;
  createdAt: Date;
  azione: string;
  entita: string;
  entitaId: string | null;
  enteId: string | null;
  concessioneId: string | null;
  esito: "SUCCESS" | "FAILURE";
  actor: {
    userId: string | null;
    userEmail: string | null;
    userRole: string | null;
  };
  metadata: Prisma.InputJsonValue | null;
}

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

export function sanitizeMetadata(metadata: Prisma.InputJsonValue | null | undefined): NormalizedMetadata {
  if (metadata === undefined || metadata === null) {
    return null;
  }

  return sortObjectKeys(metadata) as Prisma.InputJsonValue;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

export function computeAuditHash(input: ComputeAuditHashInput): string {
  const payload = {
    previousHash: input.previousHash,
    userId: input.actor.userId,
    userEmail: input.actor.userEmail,
    userRole: input.actor.userRole,
    azione: input.azione,
    entita: input.entita,
    entitaId: input.entitaId,
    enteId: input.enteId,
    concessioneId: input.concessioneId,
    esito: input.esito,
    metadata: input.metadata,
    createdAt: input.createdAt.toISOString(),
  };

  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}
