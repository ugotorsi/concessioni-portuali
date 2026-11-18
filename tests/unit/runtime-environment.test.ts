import { describe, expect, it } from "vitest";

import { resolveRuntimeEnvironment } from "@/lib/runtime-environment";

describe("runtime environment", () => {
  it("classifies development runtime when envs are unset", () => {
    const runtime = resolveRuntimeEnvironment({
      NODE_ENV: "development",
      VERCEL_ENV: undefined,
    });

    expect(runtime.isDevelopmentRuntime).toBe(true);
    expect(runtime.isPreviewRuntime).toBe(false);
    expect(runtime.isProductionRuntime).toBe(false);
  });

  it("classifies preview runtime", () => {
    const runtime = resolveRuntimeEnvironment({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
    });

    expect(runtime.isPreviewRuntime).toBe(true);
    expect(runtime.isProductionRuntime).toBe(false);
    expect(runtime.isDevelopmentRuntime).toBe(false);
  });

  it("classifies production runtime from VERCEL_ENV", () => {
    const runtime = resolveRuntimeEnvironment({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
    });

    expect(runtime.isProductionRuntime).toBe(true);
    expect(runtime.isPreviewRuntime).toBe(false);
    expect(runtime.isDevelopmentRuntime).toBe(false);
  });

  it("treats NODE_ENV production as production when VERCEL_ENV is absent", () => {
    const runtime = resolveRuntimeEnvironment({
      NODE_ENV: "production",
      VERCEL_ENV: undefined,
    });

    expect(runtime.isProductionRuntime).toBe(true);
    expect(runtime.isPreviewRuntime).toBe(false);
  });
});