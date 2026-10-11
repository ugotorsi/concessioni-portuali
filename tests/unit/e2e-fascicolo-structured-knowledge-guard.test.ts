import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calculateE2EStructuredAnalysisMaximumCost,
  consumeE2EStructuredAnalysisCost,
  createE2EFascicoloStructuredKnowledgeTransport,
  E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR,
  type E2EOneShotCostContext,
} from "@/server/ai/e2eFascicoloStructuredKnowledgeGuard";
import {
  E2E_STRUCTURED_KNOWLEDGE_OPENAI_PROJECT_ID,
  E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
  E2E_STRUCTURED_KNOWLEDGE_TENANT_ID,
} from "@/server/ai/fascicoloDocumentStructuredKnowledgeAccess";
import {
  OPENAI_ANALYSIS_MODEL,
  OPENAI_RESPONSES_ENDPOINTS,
} from "@/server/ai/providers/openai";
import type { RuntimeSqlExecutor } from "@/server/runtime/health";

const databases: PGlite[] = [];
const AUTHORIZATION_NOT_BEFORE = "2026-10-11T11:00:00.000Z";
const AUTHORIZATION_EXPIRES_AT = "2026-10-11T11:10:00.000Z";
const AUTHORIZED_NOW = new Date("2026-10-11T11:05:00.000Z");

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
    consumeCost: vi.fn().mockResolvedValue({
      reservationId: "reservation-e2e",
      outcome: "CONSUMED" as const,
    }),
    now: vi.fn(() => AUTHORIZED_NOW),
  };
}

function guardedTransport(
  deps: NonNullable<
    Parameters<typeof createE2EFascicoloStructuredKnowledgeTransport>[1]
  >,
) {
  return createE2EFascicoloStructuredKnowledgeTransport({
    tenantId: E2E_STRUCTURED_KNOWLEDGE_TENANT_ID,
    procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
    projectId: E2E_STRUCTURED_KNOWLEDGE_OPENAI_PROJECT_ID,
    region: "GLOBAL",
    authorizationNotBefore: AUTHORIZATION_NOT_BEFORE,
    authorizationExpiresAt: AUTHORIZATION_EXPIRES_AT,
  }, deps);
}

function costContext(db: PGlite): E2EOneShotCostContext {
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
      ('e2e_ai_one_shot_20261011_global_disabled',
       'GLOBAL',NULL,NULL,'EUR',2.00,1200,false,CURRENT_TIMESTAMP),
      ('e2e_ai_one_shot_20261011_tenant_disabled',
       'TENANT','cmrzd08yp000dqwudd9dvaidl',NULL,'EUR',2.00,31536000,false,
       CURRENT_TIMESTAMP),
      ('e2e_ai_one_shot_20261011_procedimento_disabled',
       'PROCEDIMENTO','cmrzd08yp000dqwudd9dvaidl',
       'procedimento-intake-9a0169f9de7e3a1ec2364691','EUR',2.00,31536000,false,
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

  it("consumes the maximum before one provider call and selects the project", async () => {
    const deps = dependencies();
    const transport = guardedTransport(deps);

    await transport(OPENAI_RESPONSES_ENDPOINTS.GLOBAL, {
      method: "POST",
      body: requestBody(),
    });

    expect(deps.consumeCost).toHaveBeenCalledWith({
      tenantId: E2E_STRUCTURED_KNOWLEDGE_TENANT_ID,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      authorizationExpiresAt: AUTHORIZATION_EXPIRES_AT,
    });
    expect(deps.consumeCost.mock.invocationCallOrder[0])
      .toBeLessThan(deps.transport.mock.invocationCallOrder[0]);
    const headers = new Headers(deps.transport.mock.calls[0]?.[1]?.headers);
    expect(headers.get("OpenAI-Project"))
      .toBe(E2E_STRUCTURED_KNOWLEDGE_OPENAI_PROJECT_ID);
  });

  it("rejects oversized input, output, and a different model before reservation", async () => {
    const cases = [
      requestBody({ input: "x".repeat(120_000) }),
      requestBody({ max_output_tokens: 40_001 }),
      requestBody({ model: "different-model" }),
    ];

    for (const body of cases) {
      const deps = dependencies();
      await expect(guardedTransport(deps)(OPENAI_RESPONSES_ENDPOINTS.GLOBAL, {
        method: "POST",
        body,
      })).rejects.toBeDefined();
      expect(deps.consumeCost).not.toHaveBeenCalled();
      expect(deps.transport).not.toHaveBeenCalled();
    }
  });

  it("blocks concurrent or repeated calls with the persistent reservation", async () => {
    const deps = dependencies();
    let reserved = false;
    deps.consumeCost.mockImplementation(async () => {
      if (reserved) {
        return { reservationId: "reservation-e2e", outcome: "REUSED" as const };
      }
      reserved = true;
      return { reservationId: "reservation-e2e", outcome: "CONSUMED" as const };
    });

    const first = guardedTransport(deps);
    const second = guardedTransport(deps);

    const outcomes = await Promise.allSettled([
      first(OPENAI_RESPONSES_ENDPOINTS.GLOBAL, { body: requestBody() }),
      second(OPENAI_RESPONSES_ENDPOINTS.GLOBAL, { body: requestBody() }),
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
      consumeCost: (input: Parameters<typeof consumeE2EStructuredAnalysisCost>[0]) =>
        consumeE2EStructuredAnalysisCost(input, context),
      now: () => AUTHORIZED_NOW,
    };

    const outcomes = await Promise.allSettled([
      guardedTransport(persistentDependencies)(OPENAI_RESPONSES_ENDPOINTS.GLOBAL, {
        body: requestBody(),
      }),
      guardedTransport(persistentDependencies)(OPENAI_RESPONSES_ENDPOINTS.GLOBAL, {
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
      consumeCost: (input: Parameters<typeof consumeE2EStructuredAnalysisCost>[0]) =>
        consumeE2EStructuredAnalysisCost(input, context),
      now: () => AUTHORIZED_NOW,
    };

    await expect(guardedTransport(persistentDependencies)(
      OPENAI_RESPONSES_ENDPOINTS.GLOBAL,
      { body: requestBody() },
    )).rejects.toThrow("provider failure");
    await expect(guardedTransport(persistentDependencies)(
      OPENAI_RESPONSES_ENDPOINTS.GLOBAL,
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

      await expect(first(OPENAI_RESPONSES_ENDPOINTS.GLOBAL, {
        body: requestBody(),
      })).rejects.toThrow("simulated failure");

      deps.consumeCost.mockResolvedValue({
        reservationId: "reservation-e2e",
        outcome: "REUSED",
      });
      const retry = guardedTransport(deps);
      await expect(retry(OPENAI_RESPONSES_ENDPOINTS.GLOBAL, {
        body: requestBody(),
      })).rejects.toThrow("RUNTIME_COST_RESERVATION_ALREADY_ACTIVE");
      expect(deps.transport).toHaveBeenCalledTimes(1);
    },
  );

  it("does not transmit when the atomic ledger consumption fails", async () => {
    const ledgerFailure = dependencies();
    ledgerFailure.consumeCost.mockRejectedValue(new Error("budget unavailable"));
    await expect(guardedTransport(ledgerFailure)(
      OPENAI_RESPONSES_ENDPOINTS.GLOBAL,
      { body: requestBody() },
    )).rejects.toThrow("budget unavailable");
    expect(ledgerFailure.transport).not.toHaveBeenCalled();
  });

  it("rejects expired authorization immediately before transmission", async () => {
    const deps = dependencies();
    deps.now
      .mockReturnValueOnce(AUTHORIZED_NOW)
      .mockReturnValueOnce(new Date(AUTHORIZATION_EXPIRES_AT));

    await expect(guardedTransport(deps)(OPENAI_RESPONSES_ENDPOINTS.GLOBAL, {
      body: requestBody(),
    })).rejects.toMatchObject({ code: "AUTHORIZATION_EXPIRED" });
    expect(deps.consumeCost).toHaveBeenCalledTimes(1);
    expect(deps.transport).not.toHaveBeenCalled();
  });

  it("rejects an authorization window longer than ten minutes", async () => {
    const deps = dependencies();
    const transport = createE2EFascicoloStructuredKnowledgeTransport({
      tenantId: E2E_STRUCTURED_KNOWLEDGE_TENANT_ID,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      projectId: E2E_STRUCTURED_KNOWLEDGE_OPENAI_PROJECT_ID,
      region: "GLOBAL",
      authorizationNotBefore: AUTHORIZATION_NOT_BEFORE,
      authorizationExpiresAt: "2026-10-11T11:10:00.001Z",
    }, deps);

    await expect(transport(OPENAI_RESPONSES_ENDPOINTS.GLOBAL, {
      body: requestBody(),
    })).rejects.toMatchObject({ code: "AUTHORIZATION_INVALID" });
    expect(deps.consumeCost).not.toHaveBeenCalled();
    expect(deps.transport).not.toHaveBeenCalled();
  });

  it("rejects enabled E2E policies instead of authorizing other operations", async () => {
    const db = await budgetDatabase();
    await db.exec(`
      UPDATE "RuntimeBudgetPolicy"
      SET "enabled"=true
      WHERE "scope"='GLOBAL'
    `);
    const provider = vi.fn();

    await expect(guardedTransport({
      transport: provider,
      consumeCost: (input) =>
        consumeE2EStructuredAnalysisCost(input, costContext(db)),
      now: () => AUTHORIZED_NOW,
    })(OPENAI_RESPONSES_ENDPOINTS.GLOBAL, {
      body: requestBody(),
    })).rejects.toMatchObject({ code: "E2E_POLICY_CONFIGURATION_INVALID" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("rejects a consumed ledger after a server restart", async () => {
    const db = await budgetDatabase();
    const context = costContext(db);
    const provider = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const persistentDependencies = {
      transport: provider,
      consumeCost: (input: Parameters<typeof consumeE2EStructuredAnalysisCost>[0]) =>
        consumeE2EStructuredAnalysisCost(input, context),
      now: () => AUTHORIZED_NOW,
    };

    await guardedTransport(persistentDependencies)(OPENAI_RESPONSES_ENDPOINTS.GLOBAL, {
      body: requestBody(),
    });
    await expect(guardedTransport(persistentDependencies)(
      OPENAI_RESPONSES_ENDPOINTS.GLOBAL,
      { body: requestBody() },
    )).rejects.toThrow("RUNTIME_COST_RESERVATION_ALREADY_ACTIVE");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("rejects consumption when prior one-shot ledger spend exceeds the cap", async () => {
    const db = await budgetDatabase();
    await db.exec(`
      INSERT INTO "RuntimeCostReservation" (
        "id","tenantId","procedimentoId","jobId","provider","operationType","currency",
        "estimatedAmount","reservedAmount","actualAmount","releasedAmount","status",
        "idempotencyKey","expiresAt","settledAt"
      ) VALUES (
        'prior','${E2E_STRUCTURED_KNOWLEDGE_TENANT_ID}',
        '${E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID}',NULL,'OPENAI',
        'E2E_FASCICOLO_STRUCTURED_ANALYSIS_ONCE','EUR',1,1,1,0,'SETTLED',
        '${"f".repeat(64)}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      )
    `);

    await expect(consumeE2EStructuredAnalysisCost({
      tenantId: E2E_STRUCTURED_KNOWLEDGE_TENANT_ID,
      procedimentoId: E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
      authorizationExpiresAt: AUTHORIZATION_EXPIRES_AT,
    }, costContext(db))).rejects.toMatchObject({
      code: "PROVIDER_COST_LIMIT_EXCEEDED",
    });
  });
});
