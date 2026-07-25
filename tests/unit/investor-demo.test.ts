import { afterEach, describe, expect, it } from "vitest";

import { INVESTOR_DEMO_MODE_ENV_KEY, isInvestorDemoMode, isInvestorDemoRoute } from "@/lib/investor-demo";

describe("investor demo mode helpers", () => {
  const originalValue = process.env[INVESTOR_DEMO_MODE_ENV_KEY];
  const originalNodeEnv = process.env.NODE_ENV;
  const originalVercelEnv = process.env.VERCEL_ENV;

  afterEach(() => {
    if (typeof originalValue === "undefined") {
      delete process.env[INVESTOR_DEMO_MODE_ENV_KEY];
    } else {
      process.env[INVESTOR_DEMO_MODE_ENV_KEY] = originalValue;
    }

    if (typeof originalNodeEnv === "undefined") {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (typeof originalVercelEnv === "undefined") {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnv;
    }
  });

  it("enables demo mode only when env is exactly true", () => {
    process.env[INVESTOR_DEMO_MODE_ENV_KEY] = "true";
    expect(isInvestorDemoMode()).toBe(true);

    process.env[INVESTOR_DEMO_MODE_ENV_KEY] = "TRUE";
    expect(isInvestorDemoMode()).toBe(false);

    process.env[INVESTOR_DEMO_MODE_ENV_KEY] = "false";
    expect(isInvestorDemoMode()).toBe(false);
  });

  it("matches only allowed demo routes", () => {
    expect(isInvestorDemoRoute("/dashboard")).toBe(true);
    expect(isInvestorDemoRoute("/demo")).toBe(true);
    expect(isInvestorDemoRoute("/verticali")).toBe(true);
    expect(isInvestorDemoRoute("/normativa/orchestrazione")).toBe(true);
    expect(isInvestorDemoRoute("/documenti/abc")).toBe(true);

    expect(isInvestorDemoRoute("/api/auth/session")).toBe(false);
    expect(isInvestorDemoRoute("/login")).toBe(false);
    expect(isInvestorDemoRoute("/audit")).toBe(false);
  });

  it("fails closed in production even when demo env flag is true", () => {
    process.env[INVESTOR_DEMO_MODE_ENV_KEY] = "true";
    process.env.VERCEL_ENV = "production";
    process.env.NODE_ENV = "production";

    expect(isInvestorDemoMode()).toBe(false);
  });
});