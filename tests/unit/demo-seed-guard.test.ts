import { describe, expect, it } from "vitest";

import { assertDemoSeedAllowed } from "@/lib/demo-seed-guard";

describe("demo seed guard", () => {
  it("allows an explicitly enabled local disposable seed", () => {
    expect(() => assertDemoSeedAllowed({ ALLOW_DEMO_SEED: "true", NODE_ENV: "development" }))
      .not.toThrow();
  });

  it.each(["preview", "production"])("rejects Vercel %s even when explicitly enabled", (vercelEnvironment) => {
    expect(() => assertDemoSeedAllowed({
      ALLOW_DEMO_SEED: "true",
      VERCEL_ENV: vercelEnvironment,
    })).toThrow("forbidden");
  });

  it("rejects production and implicit local execution", () => {
    expect(() => assertDemoSeedAllowed({ ALLOW_DEMO_SEED: "true", NODE_ENV: "production" }))
      .toThrow("forbidden");
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "development" }))
      .toThrow("ALLOW_DEMO_SEED=true");
  });
});