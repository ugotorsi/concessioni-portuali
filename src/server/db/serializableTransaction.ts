import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_ATTEMPTS = 3;

export interface SerializableTransactionRetryOptions {
  isRetryableError?: (error: unknown) => boolean;
}

function isPrismaSerializationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;
  if (error.meta?.code === "40001") return true;
  const adapterError = error.meta?.driverAdapterError;
  if (!adapterError || typeof adapterError !== "object") return false;
  const cause: unknown = Reflect.get(adapterError, "cause");
  return Boolean(cause && typeof cause === "object"
    && Reflect.get(cause, "originalCode") === "40001"
    && Reflect.get(cause, "kind") === "TransactionWriteConflict");
}

export async function runSerializableTransactionWithRetry<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  options: SerializableTransactionRetryOptions = {},
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const retryable =
        isPrismaSerializationConflict(error)
        || options.isRetryableError?.(error) === true;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new Error("Serializable transaction attempts exhausted.");
}