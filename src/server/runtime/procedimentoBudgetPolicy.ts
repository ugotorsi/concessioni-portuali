import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

const CURRENCY = "EUR";
const MAX_WINDOW_SECONDS = 31 * 24 * 60 * 60;
const DECIMAL_AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

export class ProcedimentoBudgetConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProcedimentoBudgetConfigurationError";
  }
}

export type DefaultProcedimentoBudgetAuthorization =
  | { readonly authorized: false }
  | {
      readonly authorized: true;
      readonly currency: typeof CURRENCY;
      readonly hardCapAmount: string;
      readonly windowSeconds: number;
    };

export type ProcedimentoBudgetPolicyOutcome =
  | { readonly outcome: "NOT_AUTHORIZED"; readonly policy: null }
  | {
      readonly outcome: "CREATED" | "EXISTING";
      readonly policy: {
        readonly id: string;
        readonly enabled: boolean;
        readonly hardCapAmount: string;
        readonly windowSeconds: number;
      };
    };

interface BudgetPolicyRecord {
  readonly id: string;
  readonly enabled: boolean;
  readonly hardCapAmount: { toString(): string };
  readonly windowSeconds: number;
}

export interface BudgetPolicyTransaction {
  $queryRawUnsafe(
    query: string,
    ...values: unknown[]
  ): Promise<Array<{ id: string; enteId: string }>>;
  runtimeBudgetPolicy: {
    findFirst(input: object): Promise<BudgetPolicyRecord | null>;
    create(input: object): Promise<BudgetPolicyRecord>;
  };
}

function normalizedAmount(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!DECIMAL_AMOUNT.test(trimmed) || Number(trimmed) <= 0) {
    throw new ProcedimentoBudgetConfigurationError(
      "RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_CAP_EUR_INVALID",
    );
  }
  return Number(trimmed).toFixed(6);
}

function boundedWindow(value: string | undefined): number {
  const trimmed = value?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) {
    throw new ProcedimentoBudgetConfigurationError(
      "RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_WINDOW_SECONDS_INVALID",
    );
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_WINDOW_SECONDS) {
    throw new ProcedimentoBudgetConfigurationError(
      "RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_WINDOW_SECONDS_INVALID",
    );
  }
  return parsed;
}

export function readDefaultProcedimentoBudgetAuthorization(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DefaultProcedimentoBudgetAuthorization {
  const enabled = environment.RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_ENABLED
    ?.trim()
    .toLowerCase();
  if (enabled === undefined || enabled === "" || enabled === "false") {
    return { authorized: false };
  }
  if (enabled !== "true") {
    throw new ProcedimentoBudgetConfigurationError(
      "RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_ENABLED_INVALID",
    );
  }
  return {
    authorized: true,
    currency: CURRENCY,
    hardCapAmount: normalizedAmount(
      environment.RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_CAP_EUR,
    ),
    windowSeconds: boundedWindow(
      environment.RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_WINDOW_SECONDS,
    ),
  };
}

async function findExistingPolicy(
  tx: BudgetPolicyTransaction,
  tenantId: string,
  procedimentoId: string,
) {
  return tx.runtimeBudgetPolicy.findFirst({
    where: {
      scope: "PROCEDIMENTO",
      tenantId,
      procedimentoId,
      currency: CURRENCY,
    },
    select: {
      id: true,
      enabled: true,
      hardCapAmount: true,
      windowSeconds: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

function policyResult(
  outcome: "CREATED" | "EXISTING",
  policy: NonNullable<Awaited<ReturnType<typeof findExistingPolicy>>>,
): ProcedimentoBudgetPolicyOutcome {
  return {
    outcome,
    policy: {
      id: policy.id,
      enabled: policy.enabled,
      hardCapAmount: policy.hardCapAmount.toString(),
      windowSeconds: policy.windowSeconds,
    },
  };
}

function isUniqueConstraintConflict(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "P2002",
  );
}

export async function ensureDefaultProcedimentoBudgetPolicy(
  input: {
    tenantId: string;
    procedimentoId: string;
    authorization?: DefaultProcedimentoBudgetAuthorization;
  },
  tx: BudgetPolicyTransaction,
): Promise<ProcedimentoBudgetPolicyOutcome> {
  const authorization = input.authorization
    ?? readDefaultProcedimentoBudgetAuthorization();
  if (!authorization.authorized) {
    return { outcome: "NOT_AUTHORIZED", policy: null };
  }

  const locked = await tx.$queryRawUnsafe(
    `SELECT "id", "enteId"
       FROM "Procedimento"
      WHERE "id" = $1
      FOR UPDATE`,
    input.procedimentoId,
  );
  const procedimento = locked[0];
  if (!procedimento || procedimento.enteId !== input.tenantId) {
    throw new Error("PROCEDIMENTO_BUDGET_TENANT_MISMATCH");
  }

  const existing = await findExistingPolicy(
    tx,
    input.tenantId,
    input.procedimentoId,
  );
  if (existing) {
    return policyResult("EXISTING", existing);
  }

  try {
    const created = await tx.runtimeBudgetPolicy.create({
      data: {
        scope: "PROCEDIMENTO",
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        currency: authorization.currency,
        hardCapAmount: authorization.hardCapAmount,
        windowSeconds: authorization.windowSeconds,
        enabled: true,
      },
      select: {
        id: true,
        enabled: true,
        hardCapAmount: true,
        windowSeconds: true,
      },
    });
    return policyResult("CREATED", created);
  } catch (error) {
    if (!isUniqueConstraintConflict(error)) {
      throw error;
    }
    const concurrent = await findExistingPolicy(
      tx,
      input.tenantId,
      input.procedimentoId,
    );
    if (concurrent) {
      return policyResult("EXISTING", concurrent);
    }
    throw error;
  }
}

export async function provisionDefaultProcedimentoBudgetPolicy(input: {
  tenantId: string;
  procedimentoId: string;
  authorization?: DefaultProcedimentoBudgetAuthorization;
}): Promise<ProcedimentoBudgetPolicyOutcome> {
  return runSerializableTransactionWithRetry((tx) => (
    ensureDefaultProcedimentoBudgetPolicy(input, tx)
  ));
}
