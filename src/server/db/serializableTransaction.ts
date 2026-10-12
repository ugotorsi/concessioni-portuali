import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_ATTEMPTS = 3;

export interface SerializableTransactionRetryOptions {
  isRetryableError?: (error: unknown) => boolean;
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
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        || options.isRetryableError?.(error) === true;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new Error("Serializable transaction attempts exhausted.");
}