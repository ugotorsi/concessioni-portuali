import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};
let prismaClient: PrismaClient | undefined;

function getPrismaClient(): PrismaClient {
  const existingClient = prismaClient ?? globalForPrisma.prisma;
  if (existingClient) return existingClient;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Configure a PostgreSQL connection string before using the database.");
  }

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
