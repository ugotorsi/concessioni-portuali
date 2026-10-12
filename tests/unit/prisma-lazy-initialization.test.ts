import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const constructors = vi.hoisted(() => ({
  pool: vi.fn(),
  adapter: vi.fn(),
  client: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class MockPool {
    constructor(options: unknown) {
      constructors.pool(options);
    }
  },
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class MockPrismaPg {
    constructor(pool: unknown, options: unknown) {
      constructors.adapter(pool, options);
    }
  },
}));

vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: class MockPrismaClient {
    readonly user = {};

    constructor(options: unknown) {
      constructors.client(options);
    }

    $transaction() {
      constructors.transaction(this);
      return "transaction-result";
    }
  },
}));

const originalDatabaseUrl = process.env.DATABASE_URL;

describe("lazy Prisma initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it("imports without DATABASE_URL and creates no database objects", async () => {
    const module = await import("@/lib/prisma");

    expect(module.prisma).toBeDefined();
    expect(constructors.pool).not.toHaveBeenCalled();
    expect(constructors.adapter).not.toHaveBeenCalled();
    expect(constructors.client).not.toHaveBeenCalled();
  });

  it("rejects the first database use without DATABASE_URL", async () => {
    const { prisma } = await import("@/lib/prisma");

    expect(() => Reflect.get(prisma, "user")).toThrow(
      "DATABASE_URL is not set. Configure a PostgreSQL connection string before using the database.",
    );
    expect(constructors.pool).not.toHaveBeenCalled();
  });

  it("creates the configured client on first use and preserves its method receiver", async () => {
    process.env.DATABASE_URL = "mocked-database-configuration";
    const { prisma } = await import("@/lib/prisma");

    expect(constructors.client).not.toHaveBeenCalled();
    expect(prisma.$transaction([])).toBe("transaction-result");
    expect(prisma.user).toBeDefined();
    expect(constructors.pool).toHaveBeenCalledWith({ connectionString: "mocked-database-configuration" });
    expect(constructors.adapter).toHaveBeenCalledOnce();
    expect(constructors.client).toHaveBeenCalledOnce();
    expect(constructors.transaction).toHaveBeenCalledOnce();
    expect(constructors.transaction.mock.calls[0]?.[0]).toBe(
      (globalThis as { prisma?: unknown }).prisma,
    );
  });
});