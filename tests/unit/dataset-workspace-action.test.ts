import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditSuccess: vi.fn(),
  cookieSet: vi.fn(),
  requireAdminWithMfa: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mocks.cookieSet })),
}));
vi.mock("@/lib/auth", () => ({
  requireAdminWithMfa: mocks.requireAdminWithMfa,
}));
vi.mock("@/lib/next-auth-secret", () => ({
  resolveNextAuthSecret: vi.fn(() => "dataset-workspace-action-secret-value"),
}));
vi.mock("@/server/audit/auditLog", () => ({
  auditSuccess: mocks.auditSuccess,
}));

import {
  DATASET_WORKSPACE_COOKIE,
  DATASET_WORKSPACE_TTL_SECONDS,
} from "@/lib/dataset-workspace";
import { selectDatasetWorkspaceAction } from "@/server/actions/dataset-workspace";

function selectionForm(scope: "PROFESSIONAL" | "SYNTHETIC") {
  const formData = new FormData();
  formData.set("scope", scope);
  formData.set("confirmation", `SELECT_DATASET_WORKSPACE_${scope}`);
  return formData;
}

describe("dataset workspace selection action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminWithMfa.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.test",
      role: "ADMIN",
      mfaVerified: true,
    });
    mocks.auditSuccess.mockResolvedValue(undefined);
  });

  it("sets the signed cookie and invalidates every dataset-sensitive route", async () => {
    const before = Date.now();
    const result = await selectDatasetWorkspaceAction(selectionForm("SYNTHETIC"));

    expect(mocks.cookieSet).toHaveBeenCalledWith(
      DATASET_WORKSPACE_COOKIE,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        maxAge: DATASET_WORKSPACE_TTL_SECONDS,
        path: "/",
        sameSite: "strict",
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(result).toEqual({
      scope: "SYNTHETIC",
      expiresAt: expect.any(Number),
    });
    expect(result.expiresAt).toBeGreaterThanOrEqual(
      before + DATASET_WORKSPACE_TTL_SECONDS * 1_000,
    );
  });

  it("does not mutate cookies when confirmation is missing", async () => {
    const formData = new FormData();
    formData.set("scope", "SYNTHETIC");

    await expect(selectDatasetWorkspaceAction(formData))
      .rejects.toThrow("DATASET_WORKSPACE_CONFIRMATION_REQUIRED");
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
