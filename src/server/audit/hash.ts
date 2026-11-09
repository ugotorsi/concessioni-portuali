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

export interface AuditHashRecord extends Omit<ComputeAuditHashInput, "previousHash" | "actor"> {
  id: string;
  previousHash: string | null;
  currentHash: string;
  userId: string | null;
  userEmail: string | null;
  userRole: string | null;
}

export interface AuditHashChainVerification {
  valid: boolean;
  verifiedCount: number;
  finalHash: string | null;
  issue: {
    recordId: string;
    code: "PREVIOUS_HASH_MISMATCH" | "CURRENT_HASH_MISMATCH" | "HASH_ALGORITHM_DOWNGRADE";
    expectedHash: string | null;
    observedHash: string | null;
  } | null;
}

export type HistoricalAuditHashAlgorithm =
  | "LEGACY_SEED_STRING_METADATA"
  | "CANONICAL_WITHOUT_ENTE_ID"
  | "CANONICAL_WITH_ENTE_ID";

export type HistoricalAuditHashAlgorithmCounts = Record<HistoricalAuditHashAlgorithm, number>;

export interface HistoricalAuditHashVerificationState {
  previousHash: string | null;
  seedPrefixOpen: boolean;
  canonicalWithEnteIdObserved: boolean;
}

export interface HistoricalAuditHashChainVerification extends AuditHashChainVerification {
  state: HistoricalAuditHashVerificationState;
  algorithmCounts: HistoricalAuditHashAlgorithmCounts;
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

function computeCanonicalAuditHashWithoutEnteId(record: AuditHashRecord): string {
  const payload = {
    previousHash: record.previousHash,
    userId: record.userId,
    userEmail: record.userEmail,
    userRole: record.userRole,
    azione: record.azione,
    entita: record.entita,
    entitaId: record.entitaId,
    concessioneId: record.concessioneId,
    esito: record.esito,
    metadata: record.metadata,
    createdAt: record.createdAt.toISOString(),
  };

  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function computeLegacySeedAuditHash(record: AuditHashRecord): string | null {
  if (
    !record.metadata
    || Array.isArray(record.metadata)
    || typeof record.metadata !== "object"
  ) {
    return null;
  }
  const metadata = record.metadata as Record<string, Prisma.JsonValue>;
  if (
    Object.keys(metadata).sort().join(",") !== "message,seed"
    || metadata.seed !== true
    || typeof metadata.message !== "string"
  ) {
    return null;
  }
  const payload = {
    previousHash: record.previousHash,
    userId: record.userId,
    userEmail: record.userEmail,
    userRole: record.userRole,
    azione: record.azione,
    entita: record.entita,
    entitaId: record.entitaId,
    concessioneId: record.concessioneId,
    esito: record.esito,
    metadata: { seed: "true", message: metadata.message },
    createdAt: record.createdAt.toISOString(),
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createHistoricalAuditHashVerificationState(): HistoricalAuditHashVerificationState {
  return {
    previousHash: null,
    seedPrefixOpen: true,
    canonicalWithEnteIdObserved: false,
  };
}

function emptyHistoricalAlgorithmCounts(): HistoricalAuditHashAlgorithmCounts {
  return {
    LEGACY_SEED_STRING_METADATA: 0,
    CANONICAL_WITHOUT_ENTE_ID: 0,
    CANONICAL_WITH_ENTE_ID: 0,
  };
}

export function verifyHistoricalAuditHashRecords(
  records: readonly AuditHashRecord[],
  initialState: HistoricalAuditHashVerificationState = createHistoricalAuditHashVerificationState(),
): HistoricalAuditHashChainVerification {
  const state = { ...initialState };
  const algorithmCounts = emptyHistoricalAlgorithmCounts();
  let verifiedCount = 0;
  for (const record of records) {
    if (record.previousHash !== state.previousHash) {
      return {
        valid: false,
        verifiedCount,
        finalHash: state.previousHash,
        issue: {
          recordId: record.id,
          code: "PREVIOUS_HASH_MISMATCH",
          expectedHash: state.previousHash,
          observedHash: record.previousHash,
        },
        state,
        algorithmCounts,
      };
    }

    const currentHash = computeAuditHash({
      previousHash: record.previousHash,
      createdAt: record.createdAt,
      azione: record.azione,
      entita: record.entita,
      entitaId: record.entitaId,
      enteId: record.enteId,
      concessioneId: record.concessioneId,
      esito: record.esito,
      actor: {
        userId: record.userId,
        userEmail: record.userEmail,
        userRole: record.userRole,
      },
      metadata: record.metadata,
    });
    const canonicalWithoutEnteIdHash = computeCanonicalAuditHashWithoutEnteId(record);
    const legacySeedHash = computeLegacySeedAuditHash(record);
    let algorithm: HistoricalAuditHashAlgorithm | null = null;
    let knownButDisallowed = false;

    if (record.currentHash === currentHash) {
      algorithm = "CANONICAL_WITH_ENTE_ID";
    } else if (record.currentHash === canonicalWithoutEnteIdHash) {
      if (!state.canonicalWithEnteIdObserved) {
        algorithm = "CANONICAL_WITHOUT_ENTE_ID";
      } else {
        knownButDisallowed = true;
      }
    } else if (legacySeedHash && record.currentHash === legacySeedHash) {
      if (state.seedPrefixOpen) {
        algorithm = "LEGACY_SEED_STRING_METADATA";
      } else {
        knownButDisallowed = true;
      }
    }

    if (!algorithm) {
      return {
        valid: false,
        verifiedCount,
        finalHash: state.previousHash,
        issue: {
          recordId: record.id,
          code: knownButDisallowed ? "HASH_ALGORITHM_DOWNGRADE" : "CURRENT_HASH_MISMATCH",
          expectedHash: currentHash,
          observedHash: record.currentHash,
        },
        state,
        algorithmCounts,
      };
    }

    algorithmCounts[algorithm] += 1;
    state.previousHash = record.currentHash;
    if (algorithm !== "LEGACY_SEED_STRING_METADATA") {
      state.seedPrefixOpen = false;
    }
    if (algorithm === "CANONICAL_WITH_ENTE_ID") {
      state.canonicalWithEnteIdObserved = true;
    }
    verifiedCount += 1;
  }

  return {
    valid: true,
    verifiedCount,
    finalHash: state.previousHash,
    issue: null,
    state,
    algorithmCounts,
  };
}

export function verifyAuditHashRecords(
  records: readonly AuditHashRecord[],
  initialPreviousHash: string | null = null,
): AuditHashChainVerification {
  let previousHash = initialPreviousHash;
  let verifiedCount = 0;
  for (const record of records) {
    if (record.previousHash !== previousHash) {
      return {
        valid: false,
        verifiedCount,
        finalHash: previousHash,
        issue: {
          recordId: record.id,
          code: "PREVIOUS_HASH_MISMATCH",
          expectedHash: previousHash,
          observedHash: record.previousHash,
        },
      };
    }
    const expectedCurrentHash = computeAuditHash({
      previousHash,
      createdAt: record.createdAt,
      azione: record.azione,
      entita: record.entita,
      entitaId: record.entitaId,
      enteId: record.enteId,
      concessioneId: record.concessioneId,
      esito: record.esito,
      actor: {
        userId: record.userId,
        userEmail: record.userEmail,
        userRole: record.userRole,
      },
      metadata: record.metadata,
    });
    if (record.currentHash !== expectedCurrentHash) {
      return {
        valid: false,
        verifiedCount,
        finalHash: previousHash,
        issue: {
          recordId: record.id,
          code: "CURRENT_HASH_MISMATCH",
          expectedHash: expectedCurrentHash,
          observedHash: record.currentHash,
        },
      };
    }
    previousHash = record.currentHash;
    verifiedCount += 1;
  }
  return { valid: true, verifiedCount, finalHash: previousHash, issue: null };
}
