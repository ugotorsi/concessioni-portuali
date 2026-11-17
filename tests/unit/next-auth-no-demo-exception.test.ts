import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import * as nextAuthModule from "@/lib/next-auth";

describe("next-auth without demo email exception", () => {
  it("does not export canAuthenticateEmailForRuntime", () => {
    expect("canAuthenticateEmailForRuntime" in nextAuthModule).toBe(false);
  });

  it("contains no demo.local special-case guard in auth flow", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/next-auth.ts"), "utf8");

    expect(source).not.toContain("canAuthenticateEmailForRuntime");
    expect(source).not.toContain("demoAuthenticationAllowed");
    expect(source).not.toContain("@/lib/demo-auth");
    expect(source).not.toContain("demo.local");
  });
});
