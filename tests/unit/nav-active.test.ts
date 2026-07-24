import { describe, expect, it } from "vitest";

import { isNavItemActive } from "@/components/layout/nav-active";

describe("isNavItemActive", () => {
  it("matches exact routes in exact mode", () => {
    expect(isNavItemActive("/verticali", "/verticali", "exact")).toBe(true);
    expect(isNavItemActive("/verticali/portuale-adsp", "/verticali", "exact")).toBe(false);
  });

  it("matches section root and child routes in section mode", () => {
    expect(isNavItemActive("/verticali", "/verticali", "section")).toBe(true);
    expect(isNavItemActive("/verticali/portuale-adsp", "/verticali", "section")).toBe(true);
  });

  it("does not match similar prefixes without a child slash", () => {
    expect(isNavItemActive("/verticali-altro", "/verticali", "section")).toBe(false);
  });

  it("keeps other sections behavior stable", () => {
    expect(isNavItemActive("/concessioni/abc", "/concessioni", "section")).toBe(true);
    expect(isNavItemActive("/report/xyz", "/concessioni", "section")).toBe(false);
  });
});
