import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { authOptions } from "@/lib/next-auth";

describe("next-auth staging bypass hardening", () => {
  it("does not register a staging bypass credential", () => {
    const credentials = authOptions.providers[0]?.options?.credentials;

    expect(credentials).toMatchObject({
      email: { type: "email" },
      password: { type: "password" },
    });
    expect(credentials).not.toHaveProperty("stagingBypass");
  });

  it("contains no environment-gated administrator bypass implementation", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/next-auth.ts"), "utf8");

    expect(source).not.toContain("STAGING_ADMIN_BYPASS");
    expect(source).not.toContain("stagingBypass");
    expect(source).not.toContain("staging-preview-admin");
  });
});
