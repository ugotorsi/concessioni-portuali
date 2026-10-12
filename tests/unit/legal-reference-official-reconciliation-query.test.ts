import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  legalReferenceOfficialReconciliation: { findMany: vi.fn() },
  legalSource: { findMany: vi.fn() },
}));
const tenantMock = vi.hoisted(() => ({
  context: { isAdmin: false, role: "GIURIDICO", accessibleTenantIds: ["ente-1"] },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: vi.fn(async () => tenantMock.context),
  isTenantContextConstrained: vi.fn((context) => !context.isAdmin),
}));

import { Prisma } from "@/generated/prisma/client";
import {
  getOfficialReconciliationReviewQueue,
  OfficialReconciliationReviewQueueError,
} from "@/server/queries/legal-reference-official-reconciliation";

describe("official reconciliation review queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantMock.context = { isAdmin: false, role: "GIURIDICO", accessibleTenantIds: ["ente-1"] };
    prismaMock.legalReferenceOfficialReconciliation.findMany.mockResolvedValue([]);
  });

  it("returns an empty queue only when the query succeeds with no candidates", async () => {
    await expect(getOfficialReconciliationReviewQueue()).resolves.toEqual({ status: "READY", items: [] });
    expect(prismaMock.legalReferenceOfficialReconciliation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          mention: { extractionAttempt: { neutralIntake: { enteId: { in: ["ente-1"] } } } },
        }),
      }),
    );
  });

  it("preserves existing global queue semantics for ADMIN", async () => {
    tenantMock.context = { isAdmin: true, role: "ADMIN", accessibleTenantIds: [] };
    await getOfficialReconciliationReviewQueue();
    expect(prismaMock.legalReferenceOfficialReconciliation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { state: { in: ["INCOMPLETE", "PENDING_REVIEW", "CONFLICTED"] } } }),
    );
  });

  it("returns a distinct state only for the missing reconciliation schema", async () => {
    const cause = new Prisma.PrismaClientKnownRequestError("missing table", {
      code: "P2021", clientVersion: "7.8.0",
      meta: { modelName: "LegalReferenceOfficialReconciliation" },
    });
    prismaMock.legalReferenceOfficialReconciliation.findMany.mockRejectedValue(cause);
    await expect(getOfficialReconciliationReviewQueue()).resolves.toEqual({
      status: "SCHEMA_UNAVAILABLE", items: [],
    });
  });

  it("returns SCHEMA_UNAVAILABLE for a missing Block 3B.8B reconciliation column", async () => {
    const cause = new Prisma.PrismaClientKnownRequestError("missing column", {
      code: "P2022", clientVersion: "7.8.0",
      meta: { column: "LegalReferenceOfficialReconciliation.identityFingerprint" },
    });
    prismaMock.legalReferenceOfficialReconciliation.findMany.mockRejectedValue(cause);
    await expect(getOfficialReconciliationReviewQueue()).resolves.toEqual({
      status: "SCHEMA_UNAVAILABLE", items: [],
    });
  });

  it.each([
    ["P2021", { table: "LegalSource" }],
    ["P2022", { column: "LegalSource.canonicalKey" }],
  ])("does not classify unrelated %s errors as reconciliation schema absence", async (code, meta) => {
    const cause = new Prisma.PrismaClientKnownRequestError("unrelated schema", {
      code, clientVersion: "7.8.0", meta,
    });
    prismaMock.legalReferenceOfficialReconciliation.findMany.mockRejectedValue(cause);
    await expect(getOfficialReconciliationReviewQueue()).rejects.toMatchObject({
      code: "OFFICIAL_RECONCILIATION_REVIEW_QUEUE_FAILED", cause,
    });
  });

  it("surfaces database failures with typed semantics", async () => {
    const cause = new Error("DATABASE_UNAVAILABLE");
    prismaMock.legalReferenceOfficialReconciliation.findMany.mockRejectedValue(cause);

    await expect(getOfficialReconciliationReviewQueue()).rejects.toMatchObject({
      code: "OFFICIAL_RECONCILIATION_REVIEW_QUEUE_FAILED",
      cause,
    });
    await expect(getOfficialReconciliationReviewQueue()).rejects
      .toBeInstanceOf(OfficialReconciliationReviewQueueError);
  });
});