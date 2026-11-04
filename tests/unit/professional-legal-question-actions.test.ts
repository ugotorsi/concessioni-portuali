import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureAutomaticResearchExecution } = vi.hoisted(() => ({
  ensureAutomaticResearchExecution: vi.fn(),
}));

vi.mock("@/server/legal-research/automatic-research-job", () => ({
  ensureAutomaticResearchExecution,
}));

import { startProfessionalLegalResearchAction } from "@/server/actions/professional-legal-questions";

describe("professional legal research action", () => {
  beforeEach(() => {
    ensureAutomaticResearchExecution.mockReset();
  });

  it("does not admit a provider job without explicit paid-research confirmation", async () => {
    const formData = new FormData();
    formData.set("procedimentoId", "procedure-1");
    formData.set("versionId", "version-1");

    await expect(startProfessionalLegalResearchAction(formData))
      .rejects.toThrow("PAID_RESEARCH_CONFIRMATION_REQUIRED");
    expect(ensureAutomaticResearchExecution).not.toHaveBeenCalled();
  });
});
