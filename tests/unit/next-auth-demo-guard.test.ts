import { describe, expect, it } from "vitest";

import { canAuthenticateEmailForRuntime } from "@/lib/next-auth";

describe("next-auth demo credential guard", () => {
  it("denies demo identities outside authorized demo runtime", () => {
    const allowed = canAuthenticateEmailForRuntime("admin@demo.local", {
      demoAuthenticationAllowed: false,
    });

    expect(allowed).toBe(false);
  });

  it("allows demo identities in authorized demo runtime", () => {
    const allowed = canAuthenticateEmailForRuntime("admin@demo.local", {
      demoAuthenticationAllowed: true,
    });

    expect(allowed).toBe(true);
  });

  it("keeps non-demo identities unaffected", () => {
    const denied = canAuthenticateEmailForRuntime("operatore@example.it", {
      demoAuthenticationAllowed: false,
    });

    const allowed = canAuthenticateEmailForRuntime("operatore@example.it", {
      demoAuthenticationAllowed: true,
    });

    expect(denied).toBe(true);
    expect(allowed).toBe(true);
  });
});