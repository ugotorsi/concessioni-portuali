import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getCurrentTenantContext: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  repairDatasetClassification: vi.fn(),
  requireAdminWithMfa: vi.fn(),
  requireTenantAccess: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({
  requireAdminWithMfa: mocks.requireAdminWithMfa,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { procedimento: { findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: mocks.getCurrentTenantContext,
  requireTenantAccess: mocks.requireTenantAccess,
}));
vi.mock("@/server/dataset-classification/repair", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/dataset-classification/repair")>(),
  repairDatasetClassification: mocks.repairDatasetClassification,
}));

import { repairDatasetClassificationAction } from "@/server/actions/dataset-classification-repair";
import { DATASET_CLASSIFICATION_REPAIR_CONFIRMATION } from "@/server/dataset-classification/repair";

function repairForm() {
  const formData = new FormData();
  formData.set("procedimentoId", "procedure-1");
  formData.set("expectedFingerprint", "a".repeat(64));
  formData.set("reason", "Correzione della classificazione sintetica preesistente.");
  formData.set("confirmation", DATASET_CLASSIFICATION_REPAIR_CONFIRMATION);
  return formData;
}

describe("dataset classification repair action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminWithMfa.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.test",
      role: "ADMIN",
    });
    mocks.getCurrentTenantContext.mockResolvedValue({
      tenantIds: ["tenant-demo"],
      defaultTenantId: "tenant-demo",
      datasetScope: "PROFESSIONAL",
    });
    mocks.findFirst.mockResolvedValue({ id: "procedure-1", enteId: "tenant-demo" });
    mocks.repairDatasetClassification.mockResolvedValue({
      tenantId: "tenant-demo",
      procedimentoId: "procedure-1",
      targetClass: "DEMO",
      targetScope: "SYNTHETIC",
      changedRootCount: 2,
    });
  });

  it("requires an MFA administrator and a root visible in the selected workspace", async () => {
    await repairDatasetClassificationAction(repairForm());

    expect(mocks.requireAdminWithMfa).toHaveBeenCalledOnce();
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        id: "procedure-1",
        datasetClass: "PROFESSIONAL",
      },
      select: { id: true, enteId: true },
    });
    expect(mocks.requireTenantAccess).toHaveBeenCalledWith(
      expect.objectContaining({ datasetScope: "PROFESSIONAL" }),
      "tenant-demo",
      { mode: "write", allowWhenEnteMissing: false },
    );
    expect(mocks.repairDatasetClassification).toHaveBeenCalledWith({
      procedimentoId: "procedure-1",
      expectedFingerprint: "a".repeat(64),
      reason: "Correzione della classificazione sintetica preesistente.",
      actor: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard?datasetRepair=synthetic");
  });

  it("rejects a request without the exact confirmation before any write", async () => {
    const formData = repairForm();
    formData.delete("confirmation");

    await expect(repairDatasetClassificationAction(formData)).rejects.toThrow();
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.repairDatasetClassification).not.toHaveBeenCalled();
  });
});
