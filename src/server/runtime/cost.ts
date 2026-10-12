import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import type { RuntimeSqlExecutor } from "./health";

export class RuntimeBudgetExceededError extends Error {
  constructor(readonly scope: "GLOBAL" | "TENANT" | "PROCEDIMENTO") {
    super(`RUNTIME_BUDGET_EXCEEDED_${scope}`);
    this.name = "RuntimeBudgetExceededError";
  }
}

export class RuntimeCostReservationConflictError extends Error {
  constructor() {
    super("RUNTIME_COST_RESERVATION_ALREADY_ACTIVE");
    this.name = "RuntimeCostReservationConflictError";
  }
}

export class RuntimeBudgetPolicyMissingError extends Error {
  constructor(readonly scope: "GLOBAL" | "TENANT" | "PROCEDIMENTO") {
    super(`RUNTIME_BUDGET_POLICY_MISSING_${scope}`);
    this.name = "RuntimeBudgetPolicyMissingError";
  }
}

export interface RuntimeCostContext {
  transaction<T>(operation: (executor: RuntimeSqlExecutor) => Promise<T>): Promise<T>;
}

const defaultContext: RuntimeCostContext = {
  transaction: (operation) => runSerializableTransactionWithRetry((tx) => operation({
    async query<T>(sql: string, params: readonly unknown[] = []) {
      return { rows: await tx.$queryRawUnsafe<T[]>(sql, ...params) };
    },
  })),
};

function decimal(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_COST_AMOUNT");
  return value.toFixed(6);
}

export async function reserveRuntimeCost(input: {
  tenantId: string | null;
  procedimentoId: string | null;
  jobId: string | null;
  provider: string;
  operationType: string;
  currency?: string;
  estimatedAmount: number;
  reservationTtlSeconds?: number;
  idempotencyKey: string;
}, context: RuntimeCostContext = defaultContext): Promise<{ reservationId: string; outcome: "RESERVED" | "REUSED" }> {
  const currency = input.currency ?? "EUR";
  const amount = decimal(input.estimatedAmount);
  const ttl = input.reservationTtlSeconds ?? 900;
  const key = createHash("sha256").update(input.idempotencyKey).digest("hex");
  return context.transaction(async (tx) => {
    const existing = await tx.query<{ id: string; status: string; active: boolean }>(`
      SELECT "id","status",("expiresAt">CURRENT_TIMESTAMP) AS "active"
      FROM "RuntimeCostReservation" WHERE "idempotencyKey"=$1 FOR UPDATE
    `, [key]);
    const previous = existing.rows[0];
    if (previous && (previous.status === "SETTLED" || (previous.status === "RESERVED" && previous.active))) {
      return { reservationId: previous.id, outcome: "REUSED" };
    }
    const policies = await tx.query<{ id: string; scope: "GLOBAL" | "TENANT" | "PROCEDIMENTO"; hardCapAmount: string; windowSeconds: number }>(`
      SELECT "id","scope","hardCapAmount"::text,"windowSeconds"
      FROM "RuntimeBudgetPolicy"
      WHERE "enabled"=true AND "currency"=$1 AND "effectiveFrom"<=CURRENT_TIMESTAMP
        AND (("scope"='GLOBAL') OR ("scope"='TENANT' AND "tenantId"=$2)
          OR ("scope"='PROCEDIMENTO' AND "tenantId"=$2 AND "procedimentoId"=$3))
      ORDER BY "scope","id" FOR UPDATE
    `, [currency, input.tenantId, input.procedimentoId]);
    const requiredScopes: Array<"GLOBAL" | "TENANT" | "PROCEDIMENTO"> = ["GLOBAL"];
    if (input.tenantId) requiredScopes.push("TENANT");
    if (input.procedimentoId) requiredScopes.push("PROCEDIMENTO");
    for (const scope of requiredScopes) {
      if (!policies.rows.some((policy) => policy.scope === scope)) {
        throw new RuntimeBudgetPolicyMissingError(scope);
      }
    }
    for (const policy of policies.rows) {
      const spent = await tx.query<{ amount: string }>(`
        SELECT COALESCE(SUM(CASE WHEN "status"='SETTLED' THEN "actualAmount" ELSE "reservedAmount" END),0)::text AS "amount"
        FROM "RuntimeCostReservation"
        WHERE "currency"=$1 AND "createdAt">=CURRENT_TIMESTAMP-($2*INTERVAL '1 second')
          AND "status" IN ('RESERVED','SETTLED')
          AND ("status"='SETTLED' OR "expiresAt">CURRENT_TIMESTAMP)
          AND ($3='GLOBAL' OR ($3='TENANT' AND "tenantId"=$4)
            OR ($3='PROCEDIMENTO' AND "tenantId"=$4 AND "procedimentoId"=$5))
      `, [currency, policy.windowSeconds, policy.scope, input.tenantId, input.procedimentoId]);
      if (Number(spent.rows[0]?.amount ?? 0) + input.estimatedAmount > Number(policy.hardCapAmount)) {
        throw new RuntimeBudgetExceededError(policy.scope);
      }
    }
    const id = previous?.id ?? `runtime_cost_${key}`.slice(0, 96);
    if (previous) {
      await tx.query(`
        UPDATE "RuntimeCostReservation" SET "status"='RESERVED',
          "estimatedAmount"=$2::numeric, "reservedAmount"=$2::numeric,
          "actualAmount"=NULL, "releasedAmount"=NULL, "settledAt"=NULL, "releasedAt"=NULL,
          "createdAt"=CURRENT_TIMESTAMP,
          "expiresAt"=CURRENT_TIMESTAMP+($3*INTERVAL '1 second'), "updatedAt"=CURRENT_TIMESTAMP
        WHERE "id"=$1
      `, [id, amount, ttl]);
    } else await tx.query(`
      INSERT INTO "RuntimeCostReservation" (
        "id","tenantId","procedimentoId","jobId","provider","operationType","currency",
        "estimatedAmount","reservedAmount","status","idempotencyKey","expiresAt"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$8::numeric,'RESERVED',$9,
        CURRENT_TIMESTAMP+($10*INTERVAL '1 second'))
    `, [id, input.tenantId, input.procedimentoId, input.jobId, input.provider,
      input.operationType, currency, amount, key, ttl]);
    return { reservationId: id, outcome: "RESERVED" };
  });
}

export async function settleRuntimeCost(input: {
  reservationId: string;
  actualAmount: number;
}, context: RuntimeCostContext = defaultContext): Promise<void> {
  const actual = decimal(input.actualAmount);
  await context.transaction(async (tx) => {
    await tx.query(`
      UPDATE "RuntimeCostReservation" SET "status"='SETTLED', "actualAmount"=$2::numeric,
        "releasedAmount"=GREATEST("reservedAmount"-$2::numeric,0), "settledAt"=CURRENT_TIMESTAMP
      WHERE "id"=$1 AND "status"='RESERVED'
    `, [input.reservationId, actual]);
  });
}

export async function releaseRuntimeCost(
  reservationId: string,
  context: RuntimeCostContext = defaultContext,
): Promise<void> {
  await context.transaction(async (tx) => {
    await tx.query(`
      UPDATE "RuntimeCostReservation" SET "status"='RELEASED',
        "releasedAmount"="reservedAmount", "releasedAt"=CURRENT_TIMESTAMP
      WHERE "id"=$1 AND "status"='RESERVED'
    `, [reservationId]);
  });
}

export async function withRuntimeCostGate<T>(
  input: Parameters<typeof reserveRuntimeCost>[0],
  call: () => Promise<{ value: T; actualAmount: number }>,
  context: RuntimeCostContext = defaultContext,
): Promise<T> {
  const reservation = await reserveRuntimeCost(input, context);
  if (reservation.outcome === "REUSED") throw new RuntimeCostReservationConflictError();
  try {
    const result = await call();
    await settleRuntimeCost({ reservationId: reservation.reservationId, actualAmount: result.actualAmount }, context);
    return result.value;
  } catch (error) {
    await releaseRuntimeCost(reservation.reservationId, context);
    throw error;
  }
}