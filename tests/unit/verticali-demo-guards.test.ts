import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getVerticaliOverviewMock = vi.hoisted(() => vi.fn());
const getVerticaleWorkspaceBySlugMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn());

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

describe("verticali route guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notFoundMock.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
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

  it("queries vertical data for /verticali", async () => {
    const element = await VerticaliPage();

    expect(element).toBeTruthy();
    expect(requireRoleMock).toHaveBeenCalledTimes(1);
    expect(getVerticaliOverviewMock).toHaveBeenCalledTimes(1);
  });

  it("queries vertical data for /verticali/[verticale]", async () => {
    const element = await VerticaleWorkspacePage({
      params: Promise.resolve({ verticale: "portuale-adsp" }),
    });

    expect(element).toBeTruthy();
    expect(requireRoleMock).toHaveBeenCalledTimes(1);
    expect(getVerticaleWorkspaceBySlugMock).toHaveBeenCalledWith("portuale-adsp");
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("calls notFound for unknown slug", async () => {
    getVerticaleWorkspaceBySlugMock.mockResolvedValueOnce(null);

    await expect(
      VerticaleWorkspacePage({
        params: Promise.resolve({ verticale: "verticale-non-esistente" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
