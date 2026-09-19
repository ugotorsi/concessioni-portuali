import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveWorkosLoginCallback } from "@/server/auth/workos-login-callback";

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

  it("uses real credentials and preserves a validated WorkOS callback", () => {
    const pageSource = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const formSource = readFileSync(
      resolve(process.cwd(), "src/components/forms/LoginCredentialsForm.tsx"),
      "utf8",
    );

    expect(pageSource).toContain("isStagingAdminBypassEnabled() && !trustedWorkosCallback");
    expect(pageSource).toContain("callbackUrl={trustedWorkosCallback ?? undefined}");
    expect(formSource).toContain('callbackUrl: callbackUrl ?? "/dashboard"');
    expect(formSource).toContain("window.location.assign(callbackUrl)");
    expect(formSource).toContain('session.user?.role === "VIEWER_ADSP"');
  });

  it.each([
    "https://evil.example/api/auth/workos/complete?external_auth_id=valid",
    "//evil.example/api/auth/workos/complete?external_auth_id=valid",
    "javascript:alert(1)",
    "data:text/plain,invalid",
    "/dashboard",
    "/api/auth/workos/complete",
    "/api/auth/workos/complete?external_auth_id=bad%20value",
    "/api/auth/workos/complete?external_auth_id=valid&extra=value",
    "/api/auth/workos/complete?external_auth_id=first&external_auth_id=second",
  ])("rejects untrusted WorkOS callback %s", (callbackUrl) => {
    expect(resolveWorkosLoginCallback(callbackUrl)).toBeNull();
  });

  it("canonicalizes the only accepted WorkOS continuation", () => {
    expect(resolveWorkosLoginCallback(
      "/api/auth/workos/complete?external_auth_id=external_auth_abc-123",
    )).toBe("/api/auth/workos/complete?external_auth_id=external_auth_abc-123");
    expect(resolveWorkosLoginCallback([
      "/api/auth/workos/complete?external_auth_id=external_auth_abc-123",
    ])).toBeNull();
  });
});
