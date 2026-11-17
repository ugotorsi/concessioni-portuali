import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentTenantContext } = vi.hoisted(() => ({
  getCurrentTenantContext: vi.fn(async () => {
    throw new Error("headers() called outside a request scope");
  }),
}));

vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext,
  isTenantContextConstrained: () => false,
}));

vi.mock("@/lib/prisma", () => {
  const model = new Proxy({}, {
    get: (_target, method) => async () => (method === "findUnique" || method === "findFirst" ? null : []),
  });
  return { prisma: new Proxy({}, { get: () => model }) };
});

import { OrchestrationInputError, resolveApplicableLegalRules } from "@/server/legal-rules/orchestrator";

describe("resolveApplicableLegalRules system scope", () => {
  beforeEach(() => {
    getCurrentTenantContext.mockClear();
  });

  it("resolves for a background worker without reading the HTTP session", async () => {
    const result = await resolveApplicableLegalRules(
      { enteId: "tenant-1", referenceDate: "2019-12-05T00:00:00.000Z", includeHistorical: true, includePending: true },
      { systemTenantId: "tenant-1" },
    );
    expect(getCurrentTenantContext).not.toHaveBeenCalled();
    expect(result.applicableRules).toEqual([]);
  });

  it("rejects a system scope that does not match the requested tenant", async () => {
    await expect(resolveApplicableLegalRules(
      { enteId: "tenant-2", referenceDate: "2026-11-01T00:00:00.000Z" },
      { systemTenantId: "tenant-1" },
    )).rejects.toBeInstanceOf(OrchestrationInputError);
    expect(getCurrentTenantContext).not.toHaveBeenCalled();
  });
});
