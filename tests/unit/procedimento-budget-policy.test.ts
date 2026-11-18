import { describe, expect, it, vi } from "vitest";

import {
  ensureDefaultProcedimentoBudgetPolicy,
  ProcedimentoBudgetConfigurationError,
  readDefaultProcedimentoBudgetAuthorization,
  type BudgetPolicyTransaction,
  type DefaultProcedimentoBudgetAuthorization,
} from "@/server/runtime/procedimentoBudgetPolicy";

const authorization: DefaultProcedimentoBudgetAuthorization = {
  authorized: true,
  currency: "EUR",
  hardCapAmount: "1.000000",
  windowSeconds: 86_400,
};

function policy(overrides: Partial<{
  id: string;
  enabled: boolean;
  hardCapAmount: string;
  windowSeconds: number;
}> = {}) {
  const hardCapAmount = overrides.hardCapAmount ?? "1.000000";
  return {
    id: overrides.id ?? "policy-1",
    enabled: overrides.enabled ?? true,
    hardCapAmount: { toString: () => hardCapAmount },
    windowSeconds: overrides.windowSeconds ?? 86_400,
  };
}

function transaction() {
  return {
    $queryRawUnsafe: vi.fn(async (_query: string, ..._values: unknown[]) => [
      { id: "procedure-1", enteId: "tenant-1" },
    ]),
    runtimeBudgetPolicy: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  } satisfies BudgetPolicyTransaction;
}

describe("default procedimento budget authorization", () => {
  it("remains disabled unless an administrator explicitly enables it", () => {
    expect(readDefaultProcedimentoBudgetAuthorization({})).toEqual({
      authorized: false,
    });
    expect(readDefaultProcedimentoBudgetAuthorization({
      RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_ENABLED: "false",
      RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_CAP_EUR: "1.00",
      RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_WINDOW_SECONDS: "86400",
    })).toEqual({ authorized: false });
  });

  it("reads an administrator-configured cap and window", () => {
    expect(readDefaultProcedimentoBudgetAuthorization({
      RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_ENABLED: "true",
      RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_CAP_EUR: "1.00",
      RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_WINDOW_SECONDS: "86400",
    })).toEqual(authorization);
  });

  it("fails closed when enabled configuration is incomplete or invalid", () => {
    expect(() => readDefaultProcedimentoBudgetAuthorization({
      RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_ENABLED: "true",
      RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_CAP_EUR: "0",
      RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_WINDOW_SECONDS: "86400",
    })).toThrow(ProcedimentoBudgetConfigurationError);
    expect(() => readDefaultProcedimentoBudgetAuthorization({
      RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_ENABLED: "true",
      RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_CAP_EUR: "1.00",
      RUNTIME_PROCEDIMENTO_BUDGET_DEFAULT_WINDOW_SECONDS: "0",
    })).toThrow(ProcedimentoBudgetConfigurationError);
  });
});

describe("ensureDefaultProcedimentoBudgetPolicy", () => {
  it("does not create a policy without explicit economic authorization", async () => {
    const tx = transaction();
    await expect(ensureDefaultProcedimentoBudgetPolicy({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      authorization: { authorized: false },
    }, tx)).resolves.toEqual({ outcome: "NOT_AUTHORIZED", policy: null });
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(tx.runtimeBudgetPolicy.create).not.toHaveBeenCalled();
  });

  it("locks the procedimento and creates the authorized scoped policy", async () => {
    const tx = transaction();
    tx.runtimeBudgetPolicy.findFirst.mockResolvedValue(null);
    tx.runtimeBudgetPolicy.create.mockResolvedValue(policy());

    await expect(ensureDefaultProcedimentoBudgetPolicy({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      authorization,
    }, tx)).resolves.toEqual({
      outcome: "CREATED",
      policy: {
        id: "policy-1",
        enabled: true,
        hardCapAmount: "1.000000",
        windowSeconds: 86_400,
      },
    });
    expect(String(tx.$queryRawUnsafe.mock.calls[0]?.[0])).toContain("FOR UPDATE");
    expect(tx.runtimeBudgetPolicy.create).toHaveBeenCalledWith({
      data: {
        scope: "PROCEDIMENTO",
        tenantId: "tenant-1",
        procedimentoId: "procedure-1",
        currency: "EUR",
        hardCapAmount: "1.000000",
        windowSeconds: 86_400,
        enabled: true,
      },
      select: {
        id: true,
        enabled: true,
        hardCapAmount: true,
        windowSeconds: true,
      },
    });
  });

  it("preserves an existing customized or disabled policy", async () => {
    const tx = transaction();
    tx.runtimeBudgetPolicy.findFirst.mockResolvedValue(policy({
      enabled: false,
      hardCapAmount: "0.750000",
      windowSeconds: 43_200,
    }));

    await expect(ensureDefaultProcedimentoBudgetPolicy({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      authorization,
    }, tx)).resolves.toEqual({
      outcome: "EXISTING",
      policy: {
        id: "policy-1",
        enabled: false,
        hardCapAmount: "0.750000",
        windowSeconds: 43_200,
      },
    });
    expect(tx.runtimeBudgetPolicy.create).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant provisioning", async () => {
    const tx = transaction();
    tx.$queryRawUnsafe.mockResolvedValue([
      { id: "procedure-1", enteId: "tenant-2" },
    ]);

    await expect(ensureDefaultProcedimentoBudgetPolicy({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      authorization,
    }, tx)).rejects.toThrow("PROCEDIMENTO_BUDGET_TENANT_MISMATCH");
    expect(tx.runtimeBudgetPolicy.create).not.toHaveBeenCalled();
  });

  it("converges on the existing policy after a concurrent create", async () => {
    const tx = transaction();
    tx.runtimeBudgetPolicy.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(policy({ id: "policy-concurrent" }));
    tx.runtimeBudgetPolicy.create.mockRejectedValue(
      Object.assign(new Error("concurrent insert"), { code: "P2002" }),
    );

    await expect(ensureDefaultProcedimentoBudgetPolicy({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      authorization,
    }, tx)).resolves.toEqual(expect.objectContaining({
      outcome: "EXISTING",
      policy: expect.objectContaining({ id: "policy-concurrent" }),
    }));
  });

  it("surfaces non-conflict creation failures", async () => {
    const tx = transaction();
    tx.runtimeBudgetPolicy.findFirst.mockResolvedValue(null);
    tx.runtimeBudgetPolicy.create.mockRejectedValue(new Error("database unavailable"));

    await expect(ensureDefaultProcedimentoBudgetPolicy({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      authorization,
    }, tx)).rejects.toThrow("database unavailable");
    expect(tx.runtimeBudgetPolicy.findFirst).toHaveBeenCalledTimes(1);
  });
});
