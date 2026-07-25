import { describe, expect, it } from "vitest";

import { resolveRuntimeEnvironment } from "@/lib/runtime-environment";

describe("runtime environment", () => {
  it("keeps demo disabled by default", () => {
    const runtime = resolveRuntimeEnvironment({
      NODE_ENV: "development",
      VERCEL_ENV: undefined,
      INVESTOR_DEMO_MODE: undefined,
    });

    expect(runtime.demoModeEnabled).toBe(false);
    expect(runtime.demoAuthenticationAllowed).toBe(false);
    expect(runtime.productionDemoConflict).toBe(false);
  });

  it("allows demo auth only when explicitly enabled in preview", () => {
    const runtime = resolveRuntimeEnvironment({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      INVESTOR_DEMO_MODE: "true",
    });

    expect(runtime.isPreviewRuntime).toBe(true);
    expect(runtime.isProductionRuntime).toBe(false);
    expect(runtime.demoAuthenticationAllowed).toBe(true);
    expect(runtime.productionDemoConflict).toBe(false);
  });

  it("fails closed for demo auth in production even when demo flag is enabled", () => {
    const runtime = resolveRuntimeEnvironment({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      INVESTOR_DEMO_MODE: "true",
    });

    expect(runtime.isProductionRuntime).toBe(true);
    expect(runtime.demoModeEnabled).toBe(true);
    expect(runtime.demoAuthenticationAllowed).toBe(false);
    expect(runtime.productionDemoConflict).toBe(true);
  });

  it("treats NODE_ENV production as production when VERCEL_ENV is absent", () => {
    const runtime = resolveRuntimeEnvironment({
      NODE_ENV: "production",
      VERCEL_ENV: undefined,
      INVESTOR_DEMO_MODE: "true",
    });

    expect(runtime.isProductionRuntime).toBe(true);
    expect(runtime.demoAuthenticationAllowed).toBe(false);
    expect(runtime.productionDemoConflict).toBe(true);
  });

  it("ignores browser-controlled inputs by relying only on server env", () => {
    const runtime = resolveRuntimeEnvironment({
      NODE_ENV: "development",
      VERCEL_ENV: undefined,
      INVESTOR_DEMO_MODE: "false",
    });

    expect(runtime.demoAuthenticationAllowed).toBe(false);
  });
});