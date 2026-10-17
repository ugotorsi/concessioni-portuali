import { beforeEach, describe, expect, it, vi } from "vitest";

const { getModel, saveSnapshot } = vi.hoisted(() => ({
  getModel: vi.fn(),
  saveSnapshot: vi.fn(),
}));
vi.mock("@/server/queries/fascicolo-automatic-workflow", () => ({
  getFascicoloAutomaticWorkflowReadModelForTenant: getModel,
}));
vi.mock("@/server/fascicolo-report/repository", () => ({
  persistStructuredFascicoloReport: saveSnapshot,
}));
import { refreshStructuredReportAfterResearch } from "@/server/fascicolo-report/auto-refresh";

describe("Trusted research report auto-refresh", () => {
  const scope = { tenantId: "tenant-1", procedimentoId: "case-1" };
  beforeEach(() => vi.resetAllMocks());

  it("skips when the current Knowledge is missing", async () => {
    getModel.mockResolvedValue({ structuredReport: null });
    expect(await refreshStructuredReportAfterResearch(scope)).toBe("NO_KNOWLEDGE");
    expect(saveSnapshot).not.toHaveBeenCalled();
  });

  it("persists an idempotent unvalidated snapshot of the current research state", async () => {
    const draft = { reportFingerprint: "a".repeat(64), payload: {} };
    getModel.mockResolvedValue({ structuredReport: draft });
    saveSnapshot.mockResolvedValueOnce({ outcome: "CREATED" }).mockResolvedValueOnce({ outcome: "REUSED" });
    expect(await refreshStructuredReportAfterResearch(scope)).toBe("CREATED");
    expect(await refreshStructuredReportAfterResearch(scope)).toBe("REUSED");
    expect(saveSnapshot).toHaveBeenNthCalledWith(1, draft);
    expect(saveSnapshot).toHaveBeenCalledTimes(2);
  });

  it("propagates a failed archive to the MCP post-write logger", async () => {
    getModel.mockResolvedValue({ structuredReport: { reportFingerprint: "b" } });
    saveSnapshot.mockRejectedValue(new Error("REPORT_WRITE_FAILED"));
    await expect(refreshStructuredReportAfterResearch(scope)).rejects.toThrow("REPORT_WRITE_FAILED");
  });
});
