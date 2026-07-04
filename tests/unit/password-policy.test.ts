import { describe, expect, it } from "vitest";

import {
  getPasswordPolicyDescription,
  maskEmailForSecurityLog,
  validatePasswordPolicy,
} from "@/lib/password-policy";

describe("password policy", () => {
  it("accetta password robuste", () => {
    const result = validatePasswordPolicy("Strong!Pass123", "utente@demo.local");

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rifiuta password deboli o comuni", () => {
    const result = validatePasswordPolicy("admin123", "admin@demo.local");

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("espone descrizione policy", () => {
    const description = getPasswordPolicyDescription();

    expect(description).toContain("almeno");
    expect(description).toContain("maiuscola");
    expect(description).toContain("simbolo");
  });

  it("maschera email per log di sicurezza", () => {
    expect(maskEmailForSecurityLog("admin@demo.local")).toBe("ad***@demo.local");
    expect(maskEmailForSecurityLog("x@demo.local")).toBe("x*@demo.local");
    expect(maskEmailForSecurityLog("invalid")).toBe("invalid-email");
  });
});
