import { describe, expect, it } from "vitest";

import { buildDashboardFascicoloHref } from "@/lib/dashboard-navigation";

describe("dashboard fascicolo navigation", () => {
  it("opens recent fascicoli on their canonical route", () => {
    expect(buildDashboardFascicoloHref("fascicolo-1")).toBe("/procedimenti/fascicolo-1");
  });

  it("opens attention items on supported workspace sections", () => {
    expect(buildDashboardFascicoloHref("fascicolo-1", "deadlines"))
      .toBe("/procedimenti/fascicolo-1?section=deadlines");
    expect(buildDashboardFascicoloHref("fascicolo-1", "issues"))
      .toBe("/procedimenti/fascicolo-1?section=issues");
  });
});
