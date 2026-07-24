import { beforeEach, describe, expect, it, vi } from "vitest";

const isInvestorDemoModeMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());
const getVerticaliOverviewMock = vi.hoisted(() => vi.fn());
const getVerticaleWorkspaceBySlugMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/investor-demo", () => ({
  isInvestorDemoMode: isInvestorDemoModeMock,
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/server/queries/verticali", () => ({
  getVerticaliOverview: getVerticaliOverviewMock,
  getVerticaleWorkspaceBySlug: getVerticaleWorkspaceBySlugMock,
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

import VerticaliPage from "@/app/verticali/page";
import VerticaleWorkspacePage from "@/app/verticali/[verticale]/page";

describe("verticali investor demo guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    getVerticaliOverviewMock.mockResolvedValue([]);
    getVerticaleWorkspaceBySlugMock.mockResolvedValue({
      verticale: {
        value: "PORTUALE_ADSP",
        slug: "portuale-adsp",
        label: "Portuale / AdSP",
        description: "desc",
        coverageLabel: "Perimetro configurato",
        concessioniCount: 0,
        hasConcessioni: false,
      },
      indicatori: {
        concessioni: 0,
        criticitaAperte: 0,
        scadenzeAperteScadute: 0,
        procedimentiInCorso: 0,
        documenti: 0,
        report: 0,
      },
      concessioni: [],
    });
  });

  it("does not query vertical data in demo mode for /verticali", async () => {
    isInvestorDemoModeMock.mockReturnValue(true);

    const element = await VerticaliPage();

    expect(element).toBeTruthy();
    expect(requireRoleMock).not.toHaveBeenCalled();
    expect(getVerticaliOverviewMock).not.toHaveBeenCalled();
  });

  it("does not query vertical data in demo mode for /verticali/[verticale]", async () => {
    isInvestorDemoModeMock.mockReturnValue(true);

    const element = await VerticaleWorkspacePage({
      params: Promise.resolve({ verticale: "concessioni" }),
    });

    expect(element).toBeTruthy();
    expect(requireRoleMock).not.toHaveBeenCalled();
    expect(getVerticaleWorkspaceBySlugMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("keeps ordinary behavior when demo mode is disabled", async () => {
    isInvestorDemoModeMock.mockReturnValue(false);

    await VerticaliPage();
    await VerticaleWorkspacePage({
      params: Promise.resolve({ verticale: "portuale-adsp" }),
    });

    expect(requireRoleMock).toHaveBeenCalledTimes(2);
    expect(getVerticaliOverviewMock).toHaveBeenCalledTimes(1);
    expect(getVerticaleWorkspaceBySlugMock).toHaveBeenCalledWith("portuale-adsp");
  });
});
