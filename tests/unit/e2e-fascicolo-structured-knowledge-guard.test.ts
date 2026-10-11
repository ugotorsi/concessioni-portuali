import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calculateE2EStructuredAnalysisMaximumCost,
  createE2EFascicoloStructuredKnowledgeTransport,
  E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR,
} from "@/server/ai/e2eFascicoloStructuredKnowledgeGuard";
import {
  OPENAI_ANALYSIS_MODEL,
  OPENAI_RESPONSES_ENDPOINTS,
} from "@/server/ai/providers/openai";
import {
  reserveRuntimeCost,
  settleRuntimeCost,
  type RuntimeCostContext,
} from "@/server/runtime/cost";
import type { RuntimeSqlExecutor } from "@/server/runtime/health";

const databases: PGlite[] = [];

function requestBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: OPENAI_ANALYSIS_MODEL,
    max_output_tokens: 40_000,
    input: "test",
    ...overrides,
  });
}

function dependencies() {
  return {
    transport: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    reserveCost: vi.fn().mockResolvedValue({
      reservationId: "reservation-e2e",
      outcome: "RESERVED" as const,
    }),
    settleCost: vi.fn().mockResolvedValue(undefined),
  };
}

function guardedTransport(
  deps: NonNullable<
    Parameters<typeof createE2EFascicoloStructuredKnowledgeTransport>[1]
  >,
) {
  return createE2EFascicoloStructuredKnowledgeTransport({
    tenantId: "ente-e2e",
    procedimentoId: "procedimento-intake-9a0169f9de7e3a1ec2364691",
    projectId: "proj_e2e",
    region: "EU",
  }, deps);
}

function costContext(db: PGlite): RuntimeCostContext {
  return {
    transaction: <T>(operation: (executor: RuntimeSqlExecutor) => Promise<T>) =>
      db.transaction((tx) => operation({
        query: async <R>(sql: string, params: readonly unknown[] = []) => ({
          rows: await tx.query<R>(sql, [...params]).then((result) => result.rows),
        }),
      })),
  };
}

async function budgetDatabase(): Promise<PGlite> {
  const db = new PGlite();
  databases.push(db);
  await db.exec(`
    CREATE TABLE "RuntimeBudgetPolicy" (
      "id" TEXT PRIMARY KEY,
      "scope" TEXT NOT NULL,
      "tenantId" TEXT,
      "procedimentoId" TEXT,
      "currency" TEXT NOT NULL,
      "hardCapAmount" NUMERIC(18,6) NOT NULL,
      "windowSeconds" INTEGER NOT NULL,
      "enabled" BOOLEAN NOT NULL,
      "effectiveFrom" TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE "RuntimeCostReservation" (
      "id" TEXT PRIMARY KEY,
      "tenantId" TEXT,
      "procedimentoId" TEXT,
      "jobId" TEXT,
      "provider" TEXT NOT NULL,
      "operationType" TEXT NOT NULL,
      "currency" TEXT NOT NULL,
      "estimatedAmount" NUMERIC(18,6) NOT NULL,
      "reservedAmount" NUMERIC(18,6) NOT NULL,
      "actualAmount" NUMERIC(18,6),
      "releasedAmount" NUMERIC(18,6),
      "status" TEXT NOT NULL,
      "idempotencyKey" CHAR(64) UNIQUE NOT NULL,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      "settledAt" TIMESTAMPTZ,
      "releasedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO "RuntimeBudgetPolicy"
      ("id","scope","tenantId","procedimentoId","currency","hardCapAmount",
       "windowSeconds","enabled","effectiveFrom")
    VALUES
      ('global','GLOBAL',NULL,NULL,'EUR',2.00,86400,true,CURRENT_TIMESTAMP),
      ('tenant','TENANT','ente-e2e',NULL,'EUR',2.00,86400,true,CURRENT_TIMESTAMP),
      ('procedure','PROCEDIMENTO','ente-e2e',
       'procedimento-intake-9a0169f9de7e3a1ec2364691','EUR',2.00,86400,true,
       CURRENT_TIMESTAMP);
  `);
  return db;
}

describe("E2E fascicolo structured knowledge provider guard", () => {
  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()));
  });

  it("keeps the conservative maximum below EUR 2", () => {
    expect(calculateE2EStructuredAnalysisMaximumCost({
      requestBytes: 120_000,
      maxOutputTokens: 40_000,
    })).toBe(E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR);
    expect(E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR).toBeLessThan(2);
  });

  it("settles the maximum before one provider call and selects the project", async () => {
    const deps = dependencies();
    const transport = guardedTransport(deps);

    await transport(OPENAI_RESPONSES_ENDPOINTS.EU, {
      method: "POST",
      body: requestBody(),
    });

    expect(deps.reserveCost).toHaveBeenCalledTimes(1);
    expect(deps.settleCost).toHaveBeenCalledWith({
      reservationId: "reservation-e2e",
      actualAmount: E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR,
    });
    expect(deps.settleCost.mock.invocationCallOrder[0])
      .toBeLessThan(deps.transport.mock.invocationCallOrder[0]);
    const headers = new Headers(deps.transport.mock.calls[0]?.[1]?.headers);
    expect(headers.get("OpenAI-Project")).toBe("proj_e2e");
  });

  it("rejects oversized input, output, and a different model before reservation", async () => {
    const cases = [
      requestBody({ input: "x".repeat(120_000) }),
      requestBody({ max_output_tokens: 40_001 }),
      requestBody({ model: "different-model" }),
    ];

    for (const body of cases) {
      const deps = dependencies();
      await expect(guardedTransport(deps)(OPENAI_RESPONSES_ENDPOINTS.EU, {
        method: "POST",
        body,
      })).rejects.toBeDefined();
      expect(deps.reserveCost).not.toHaveBeenCalled();
      expect(deps.transport).not.toHaveBeenCalled();
    }
  });

  it("blocks concurrent or repeated calls with the persistent reservation", async () => {
    const deps = dependencies();
    let reserved = false;
    deps.reserveCost.mockImplementation(async () => {
      if (reserved) {
        return { reservationId: "reservation-e2e", outcome: "REUSED" as const };
      }
      reserved = true;
      return { reservationId: "reservation-e2e", outcome: "RESERVED" as const };
    });

    const first = guardedTransport(deps);
    const second = guardedTransport(deps);

    const outcomes = await Promise.allSettled([
      first(OPENAI_RESPONSES_ENDPOINTS.EU, { body: requestBody() }),
      second(OPENAI_RESPONSES_ENDPOINTS.EU, { body: requestBody() }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(deps.transport).toHaveBeenCalledTimes(1);
  });

  it("persists one settled attempt across concurrent transports in an isolated database", async () => {
    const db = await budgetDatabase();
    const context = costContext(db);
    const provider = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const persistentDependencies = {
      transport: provider,
      reserveCost: (input: Parameters<typeof reserveRuntimeCost>[0]) =>
        reserveRuntimeCost(input, context),
      settleCost: (input: Parameters<typeof settleRuntimeCost>[0]) =>
        settleRuntimeCost(input, context),
    };

    const outcomes = await Promise.allSettled([
      guardedTransport(persistentDependencies)(OPENAI_RESPONSES_ENDPOINTS.EU, {
        body: requestBody(),
      }),
      guardedTransport(persistentDependencies)(OPENAI_RESPONSES_ENDPOINTS.EU, {
        body: requestBody(),
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
    const reservations = await db.query<{ status: string; actualAmount: string }>(`
      SELECT "status","actualAmount"::text AS "actualAmount"
      FROM "RuntimeCostReservation"
    `);
    expect(reservations.rows).toEqual([{
      status: "SETTLED",
      actualAmount: E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR.toFixed(6),
    }]);
  });

  it("persists the one-shot before a provider error and blocks a database-backed retry", async () => {
    const db = await budgetDatabase();
    const context = costContext(db);
    const provider = vi.fn().mockRejectedValue(new Error("provider failure"));
    const persistentDependencies = {
      transport: provider,
      reserveCost: (input: Parameters<typeof reserveRuntimeCost>[0]) =>
        reserveRuntimeCost(input, context),
      settleCost: (input: Parameters<typeof settleRuntimeCost>[0]) =>
        settleRuntimeCost(input, context),
    };

    await expect(guardedTransport(persistentDependencies)(
      OPENAI_RESPONSES_ENDPOINTS.EU,
      { body: requestBody() },
    )).rejects.toThrow("provider failure");
    await expect(guardedTransport(persistentDependencies)(
      OPENAI_RESPONSES_ENDPOINTS.EU,
      { body: requestBody() },
    )).rejects.toThrow("RUNTIME_COST_RESERVATION_ALREADY_ACTIVE");

    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each(["provider error", "timeout"])(
    "keeps the one-shot consumed after %s",
    async () => {
      const deps = dependencies();
      deps.transport.mockRejectedValue(new Error("simulated failure"));
      const first = guardedTransport(deps);

      await expect(first(OPENAI_RESPONSES_ENDPOINTS.EU, {
        body: requestBody(),
      })).rejects.toThrow("simulated failure");

      deps.reserveCost.mockResolvedValue({
        reservationId: "reservation-e2e",
        outcome: "REUSED",
      });
      const retry = guardedTransport(deps);
      await expect(retry(OPENAI_RESPONSES_ENDPOINTS.EU, {
        body: requestBody(),
      })).rejects.toThrow("RUNTIME_COST_RESERVATION_ALREADY_ACTIVE");
      expect(deps.transport).toHaveBeenCalledTimes(1);
    },
  );

  it("does not transmit when reservation or settlement fails", async () => {
    const reservationFailure = dependencies();
    reservationFailure.reserveCost.mockRejectedValue(new Error("budget unavailable"));
    await expect(guardedTransport(reservationFailure)(
      OPENAI_RESPONSES_ENDPOINTS.EU,
      { body: requestBody() },
    )).rejects.toThrow("budget unavailable");
    expect(reservationFailure.transport).not.toHaveBeenCalled();

    const settlementFailure = dependencies();
    settlementFailure.settleCost.mockRejectedValue(new Error("settlement unavailable"));
    await expect(guardedTransport(settlementFailure)(
      OPENAI_RESPONSES_ENDPOINTS.EU,
      { body: requestBody() },
    )).rejects.toThrow("settlement unavailable");
    expect(settlementFailure.transport).not.toHaveBeenCalled();
  });
});
