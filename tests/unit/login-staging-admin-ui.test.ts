import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveWorkosLoginCallback } from "@/server/auth/workos-login-callback";

describe("login security UI", () => {
  it("never exposes a staging administrator bypass", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");

    expect(source).not.toContain("STAGING_ADMIN_BYPASS");
    expect(source).not.toContain("StagingAdminLoginForm");
    expect(source).not.toContain("Accesso amministratore - ambiente staging");
    expect(source).toContain("Noetra - Area riservata");
    expect(source).toContain('href="https://noetra.it"');
    expect(source).toContain("Torna a Noetra");
  });

  it("uses real credentials and preserves a validated WorkOS callback", () => {
    const pageSource = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const formSource = readFileSync(
      resolve(process.cwd(), "src/components/forms/LoginCredentialsForm.tsx"),
      "utf8",
    );

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
