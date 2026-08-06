import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("staging admin login UI", () => {
  it("enables preview-only bypass gate in login page", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");

    expect(source).toContain('process.env.STAGING_ADMIN_BYPASS === "true"');
    expect(source).toContain('process.env.VERCEL_ENV === "preview"');
    expect(source).toContain("Accesso amministratore - ambiente staging");
  });

  it("uses single staging admin button form without email/password fields", () => {
    const pageSource = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const formSource = readFileSync(
      resolve(process.cwd(), "src/components/forms/StagingAdminLoginForm.tsx"),
      "utf8",
    );

    expect(pageSource).toContain("<StagingAdminLoginForm initialErrorMessage={errorMessage} />");
    expect(formSource).toContain('signIn("credentials", {');
    expect(formSource).toContain('stagingBypass: "true"');
    expect(formSource).toContain("Entra come amministratore");

    expect(formSource).not.toContain('name="email"');
    expect(formSource).not.toContain('name="password"');
    expect(formSource).not.toContain('type="email"');
    expect(formSource).not.toContain('type="password"');
  });
});
