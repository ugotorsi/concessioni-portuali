import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import {
  OPENAI_ANALYSIS_MODEL,
  OPENAI_RESPONSES_ENDPOINTS,
  type OpenAiFetch,
  type OpenAiRegion,
} from "@/server/ai/providers/openai";
import {
  E2E_STRUCTURED_KNOWLEDGE_OPENAI_PROJECT_ID,
  E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID,
  E2E_STRUCTURED_KNOWLEDGE_TENANT_ID,
} from "@/server/ai/fascicoloDocumentStructuredKnowledgeAccess";
import { RuntimeCostReservationConflictError } from "@/server/runtime/cost";
import type { RuntimeSqlExecutor } from "@/server/runtime/health";

const MAX_REQUEST_BYTES = 120_000;
const MAX_OUTPUT_TOKENS = 40_000;
const INPUT_USD_PER_MILLION_TOKENS = 2.5;
const OUTPUT_USD_PER_MILLION_TOKENS = 12;
const USD_TO_EUR_WITH_SAFETY_MARGIN = 1.5;
export const E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR = 1.17;
export const E2E_STRUCTURED_ANALYSIS_OPERATION =
  "E2E_FASCICOLO_STRUCTURED_ANALYSIS_ONCE";
const E2E_STRUCTURED_ANALYSIS_HARD_CAP_EUR = 2;
const E2E_POLICY_IDS = {
  GLOBAL: "e2e_ai_one_shot_20261011_global_disabled",
  TENANT: "e2e_ai_one_shot_20261011_tenant_disabled",
  PROCEDIMENTO: "e2e_ai_one_shot_20261011_procedimento_disabled",
} as const;

export interface E2EOneShotCostContext {
  transaction<T>(operation: (executor: RuntimeSqlExecutor) => Promise<T>): Promise<T>;
}

const defaultCostContext: E2EOneShotCostContext = {
  transaction: (operation) => runSerializableTransactionWithRetry((tx) => operation({
    async query<T>(sql: string, params: readonly unknown[] = []) {
      return { rows: await tx.$queryRawUnsafe<T[]>(sql, ...params) };
    },
  })),
};

type ConsumeE2EOneShotCost = typeof consumeE2EStructuredAnalysisCost;

export class E2EFascicoloStructuredKnowledgeGuardError extends Error {
  constructor(
    readonly code:
      | "INVALID_PROVIDER_REQUEST"
      | "PROVIDER_REQUEST_TOO_LARGE"
      | "PROVIDER_OUTPUT_LIMIT_TOO_LARGE"
      | "PROVIDER_COST_LIMIT_EXCEEDED"
      | "AUTHORIZATION_INVALID"
      | "AUTHORIZATION_EXPIRED"
      | "E2E_POLICY_CONFIGURATION_INVALID",
  ) {
    super(code);
    this.name = "E2EFascicoloStructuredKnowledgeGuardError";
  }
}

function requestBody(init: RequestInit | undefined): {
  serialized: string;
  parsed: Record<string, unknown>;
} {
  if (typeof init?.body !== "string") {
    throw new E2EFascicoloStructuredKnowledgeGuardError("INVALID_PROVIDER_REQUEST");
  }
  try {
    const parsed = JSON.parse(init.body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid body");
    }
    return { serialized: init.body, parsed: parsed as Record<string, unknown> };
  } catch {
    throw new E2EFascicoloStructuredKnowledgeGuardError("INVALID_PROVIDER_REQUEST");
  }
}

export function calculateE2EStructuredAnalysisMaximumCost(input: {
  requestBytes: number;
  maxOutputTokens: number;
}): number {
  const inputCost = input.requestBytes * INPUT_USD_PER_MILLION_TOKENS / 1_000_000;
  const outputCost =
    input.maxOutputTokens * OUTPUT_USD_PER_MILLION_TOKENS / 1_000_000;
  return (inputCost + outputCost) * USD_TO_EUR_WITH_SAFETY_MARGIN;
}

function authorizationWindow(input: {
  authorizationNotBefore?: string;
  authorizationExpiresAt?: string;
}, now: Date): { expiresAt: string } {
  const notBefore = input.authorizationNotBefore;
  const expiresAt = input.authorizationExpiresAt;
  if (
    typeof notBefore !== "string"
    || typeof expiresAt !== "string"
    || !notBefore.endsWith("Z")
    || !expiresAt.endsWith("Z")
  ) {
    throw new E2EFascicoloStructuredKnowledgeGuardError("AUTHORIZATION_INVALID");
  }
  const notBeforeMs = Date.parse(notBefore);
  const expiresAtMs = Date.parse(expiresAt);
  const nowMs = now.getTime();
  if (
    !Number.isFinite(notBeforeMs)
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= notBeforeMs
    || expiresAtMs - notBeforeMs > 10 * 60 * 1_000
  ) {
    throw new E2EFascicoloStructuredKnowledgeGuardError("AUTHORIZATION_INVALID");
  }
  if (!Number.isFinite(nowMs) || nowMs < notBeforeMs || nowMs >= expiresAtMs) {
    throw new E2EFascicoloStructuredKnowledgeGuardError("AUTHORIZATION_EXPIRED");
  }
  return { expiresAt };
}

export async function consumeE2EStructuredAnalysisCost(input: {
  tenantId: string;
  procedimentoId: string;
  authorizationExpiresAt: string;
}, context: E2EOneShotCostContext = defaultCostContext): Promise<{
  reservationId: string;
  outcome: "CONSUMED" | "REUSED";
}> {
  if (
    input.tenantId !== E2E_STRUCTURED_KNOWLEDGE_TENANT_ID
    || input.procedimentoId !== E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID
  ) {
    throw new E2EFascicoloStructuredKnowledgeGuardError("INVALID_PROVIDER_REQUEST");
  }
  const idempotencyKey = createHash("sha256")
    .update(`${E2E_STRUCTURED_ANALYSIS_OPERATION}:${input.tenantId}:${input.procedimentoId}`)
    .digest("hex");

  return context.transaction(async (tx) => {
    const policies = await tx.query<{
      id: string;
      scope: "GLOBAL" | "TENANT" | "PROCEDIMENTO";
      tenantId: string | null;
      procedimentoId: string | null;
      currency: string;
      hardCapAmount: string;
      windowSeconds: number;
      enabled: boolean;
    }>(`
      SELECT "id","scope","tenantId","procedimentoId","currency",
        "hardCapAmount"::text,"windowSeconds","enabled"
      FROM "RuntimeBudgetPolicy"
      WHERE "id" IN ($1,$2,$3)
      ORDER BY "scope","id"
      FOR UPDATE
    `, [
      E2E_POLICY_IDS.GLOBAL,
      E2E_POLICY_IDS.TENANT,
      E2E_POLICY_IDS.PROCEDIMENTO,
    ]);
    const expectedPolicies = [
      {
        id: E2E_POLICY_IDS.GLOBAL,
        scope: "GLOBAL",
        tenantId: null,
        procedimentoId: null,
        windowSeconds: 1_200,
      },
      {
        id: E2E_POLICY_IDS.TENANT,
        scope: "TENANT",
        tenantId: input.tenantId,
        procedimentoId: null,
        windowSeconds: 31_536_000,
      },
      {
        id: E2E_POLICY_IDS.PROCEDIMENTO,
        scope: "PROCEDIMENTO",
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        windowSeconds: 31_536_000,
      },
    ] as const;
    const policiesValid = expectedPolicies.every((expected) =>
      policies.rows.some((policy) =>
        policy.id === expected.id
        && policy.scope === expected.scope
        && policy.tenantId === expected.tenantId
        && policy.procedimentoId === expected.procedimentoId
        && policy.currency === "EUR"
        && Number(policy.hardCapAmount) === E2E_STRUCTURED_ANALYSIS_HARD_CAP_EUR
        && policy.windowSeconds === expected.windowSeconds
        && policy.enabled === false
      )
    );
    if (policies.rows.length !== expectedPolicies.length || !policiesValid) {
      throw new E2EFascicoloStructuredKnowledgeGuardError(
        "E2E_POLICY_CONFIGURATION_INVALID",
      );
    }

    const existing = await tx.query<{ id: string }>(`
      SELECT "id"
      FROM "RuntimeCostReservation"
      WHERE "idempotencyKey"=$1
      FOR UPDATE
    `, [idempotencyKey]);
    if (existing.rows[0]) {
      return { reservationId: existing.rows[0].id, outcome: "REUSED" };
    }

    const spent = await tx.query<{ amount: string }>(`
      SELECT COALESCE(SUM(
        CASE WHEN "status"='SETTLED' THEN "actualAmount" ELSE "reservedAmount" END
      ),0)::text AS "amount"
      FROM "RuntimeCostReservation"
      WHERE "tenantId"=$1
        AND "procedimentoId"=$2
        AND "provider"='OPENAI'
        AND "operationType"=$3
        AND "currency"='EUR'
        AND "status" IN ('RESERVED','SETTLED')
    `, [input.tenantId, input.procedimentoId, E2E_STRUCTURED_ANALYSIS_OPERATION]);
    if (
      Number(spent.rows[0]?.amount ?? 0) + E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR
      > E2E_STRUCTURED_ANALYSIS_HARD_CAP_EUR
    ) {
      throw new E2EFascicoloStructuredKnowledgeGuardError(
        "PROVIDER_COST_LIMIT_EXCEEDED",
      );
    }

    const reservationId = `runtime_cost_${idempotencyKey}`.slice(0, 96);
    await tx.query(`
      INSERT INTO "RuntimeCostReservation" (
        "id","tenantId","procedimentoId","jobId","provider","operationType","currency",
        "estimatedAmount","reservedAmount","actualAmount","releasedAmount","status",
        "idempotencyKey","expiresAt","settledAt"
      ) VALUES (
        $1,$2,$3,NULL,'OPENAI',$4,'EUR',$5::numeric,$5::numeric,$5::numeric,0,
        'SETTLED',$6,$7::timestamptz,CURRENT_TIMESTAMP
      )
    `, [
      reservationId,
      input.tenantId,
      input.procedimentoId,
      E2E_STRUCTURED_ANALYSIS_OPERATION,
      E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR.toFixed(6),
      idempotencyKey,
      input.authorizationExpiresAt,
    ]);
    return { reservationId, outcome: "CONSUMED" };
  });
}

export function createE2EFascicoloStructuredKnowledgeTransport(input: {
  tenantId: string;
  procedimentoId: string;
  projectId?: string;
  region?: string;
  authorizationNotBefore?: string;
  authorizationExpiresAt?: string;
}, dependencies: {
  transport?: OpenAiFetch;
  consumeCost?: ConsumeE2EOneShotCost;
  now?: () => Date;
} = {}): OpenAiFetch {
  const projectId = input.projectId?.trim();
  if (
    projectId !== E2E_STRUCTURED_KNOWLEDGE_OPENAI_PROJECT_ID
    || input.region !== "GLOBAL"
    || input.tenantId !== E2E_STRUCTURED_KNOWLEDGE_TENANT_ID
    || input.procedimentoId !== E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID
  ) {
    throw new E2EFascicoloStructuredKnowledgeGuardError("INVALID_PROVIDER_REQUEST");
  }
  const region: OpenAiRegion = input.region;
  const transport = dependencies.transport ?? globalThis.fetch.bind(globalThis);
  const consumeCost = dependencies.consumeCost ?? consumeE2EStructuredAnalysisCost;
  const now = dependencies.now ?? (() => new Date());
  let attempted = false;

  return async (url, init) => {
    if (attempted || url.toString() !== OPENAI_RESPONSES_ENDPOINTS[region]) {
      throw new E2EFascicoloStructuredKnowledgeGuardError("INVALID_PROVIDER_REQUEST");
    }
    attempted = true;
    const authorization = authorizationWindow(input, now());

    const body = requestBody(init);
    const requestBytes = Buffer.byteLength(body.serialized, "utf8");
    if (requestBytes > MAX_REQUEST_BYTES) {
      throw new E2EFascicoloStructuredKnowledgeGuardError("PROVIDER_REQUEST_TOO_LARGE");
    }
    if (body.parsed.model !== OPENAI_ANALYSIS_MODEL) {
      throw new E2EFascicoloStructuredKnowledgeGuardError("INVALID_PROVIDER_REQUEST");
    }
    const maxOutputTokens = body.parsed.max_output_tokens;
    if (
      typeof maxOutputTokens !== "number"
      || !Number.isSafeInteger(maxOutputTokens)
      || maxOutputTokens <= 0
      || maxOutputTokens > MAX_OUTPUT_TOKENS
    ) {
      throw new E2EFascicoloStructuredKnowledgeGuardError(
        "PROVIDER_OUTPUT_LIMIT_TOO_LARGE",
      );
    }

    const maximumCostEur = calculateE2EStructuredAnalysisMaximumCost({
      requestBytes,
      maxOutputTokens,
    });
    if (maximumCostEur > E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR) {
      throw new E2EFascicoloStructuredKnowledgeGuardError(
        "PROVIDER_COST_LIMIT_EXCEEDED",
      );
    }

    const reservation = await consumeCost({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      authorizationExpiresAt: authorization.expiresAt,
    });
    if (reservation.outcome === "REUSED") {
      throw new RuntimeCostReservationConflictError();
    }

    authorizationWindow(input, now());

    const headers = new Headers(init?.headers);
    headers.set("OpenAI-Project", projectId);
    return transport(url, { ...init, headers });
  };
}
