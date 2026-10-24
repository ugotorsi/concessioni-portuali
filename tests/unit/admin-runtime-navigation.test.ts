import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

import { Sidebar } from "@/components/layout/Sidebar";

function render(role: Parameters<typeof Sidebar>[0]["role"]) {
  return renderToStaticMarkup(createElement(Sidebar, { role, roleLabel: role }));
}

describe("ADMIN runtime navigation", () => {
  beforeEach(() => {
    mocks.pathname = "/dashboard";
  });

  it("shows the existing runtime page only to ADMIN users on desktop and mobile", () => {
    const admin = render("ADMIN");

    expect(admin.match(/href="\/admin\/runtime"/g)).toHaveLength(2);
    expect(admin.match(/Stato dei servizi/g)).toHaveLength(2);
    expect(render("GIURIDICO")).not.toContain("/admin/runtime");
    expect(render("VIEWER_ADSP")).not.toContain("/admin/runtime");
  });

  it("marks the runtime link active on its exact route", () => {
    mocks.pathname = "/admin/runtime";

    const admin = render("ADMIN");
    expect(admin.match(/href="\/admin\/runtime"/g)).toHaveLength(2);
    expect(admin.match(/aria-current="page"/g)).toHaveLength(2);
  });
});
