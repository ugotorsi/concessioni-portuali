import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_ATTEMPTS = 3;
const RETRYABLE_POSTGRES_CODES = new Set([
  "40001",
  "40P01",
  "55P03",
]);

export interface SerializableTransactionRetryOptions {
  isRetryableError?: (error: unknown) => boolean;
  timeoutMs?: number;
}

function hasRetryablePostgresCode(error: unknown, seen = new Set<object>()): boolean {
  if (!error || typeof error !== "object") return false;
  if (seen.has(error)) return false;
  seen.add(error);
  const code = "code" in error ? error.code : null;
  if (typeof code === "string" && RETRYABLE_POSTGRES_CODES.has(code)) return true;
  const cause = "cause" in error ? error.cause : null;
  return cause === error ? false : hasRetryablePostgresCode(cause, seen);
}

export function isRetryableSerializableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return true;
  }
  return hasRetryablePostgresCode(error);
}

export async function runSerializableTransactionWithRetry<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  options: SerializableTransactionRetryOptions = {},
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      });
    } catch (error) {
      const retryable =
        isRetryableSerializableTransactionError(error)
        || options.isRetryableError?.(error) === true;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new Error("Serializable transaction attempts exhausted.");
}