import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { Pool } from "pg";

import {
  assertIsolatedPreviewEnvironment,
  assertProductionDatabaseIdentity,
} from "@/server/release/previewIsolation";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};
let prismaClient: PrismaClient | undefined;

/**
 * Opt-in environment guard: when EXPECTED_DATABASE_HOST_PREFIX is set, refuse to
 * connect to any database whose host does not start with that prefix. This
 * prevents isolated environments from inheriting a foreign DATABASE_URL.
 */
export function assertExpectedDatabaseHost(databaseUrl: string, expectedHostPrefix: string | undefined) {
  const expected = expectedHostPrefix?.trim();
  if (!expected) return;
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("DATABASE_HOST_GUARD_REJECTED: DATABASE_URL is not a valid connection URL.");
  }
  if (!host.startsWith(expected)) {
    throw new Error("DATABASE_HOST_GUARD_REJECTED: DATABASE_URL host does not match EXPECTED_DATABASE_HOST_PREFIX.");
  }
}

function getPrismaClient(): PrismaClient {
  const existingClient = prismaClient ?? globalForPrisma.prisma;
  if (existingClient) return existingClient;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Configure a PostgreSQL connection string before using the database.");
  }

  assertExpectedDatabaseHost(databaseUrl, process.env.EXPECTED_DATABASE_HOST_PREFIX);
  assertProductionDatabaseIdentity(process.env);
  assertIsolatedPreviewEnvironment(process.env);

  const client = new PrismaClient({
    adapter: new PrismaPg(
      new Pool({ connectionString: databaseUrl }),
      { disposeExternalPool: true },
    ),
  });
  prismaClient = client;

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }

  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value: unknown = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
