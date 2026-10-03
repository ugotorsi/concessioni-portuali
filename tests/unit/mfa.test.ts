import * as OTPAuth from "otpauth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMfaOtpAuthUri,
  decryptMfaSecret,
  encryptMfaSecret,
  generateMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  isMfaRequiredRole,
  verifyMfaCode,
  verifyRecoveryCode,
} from "@/lib/mfa";

describe("MFA security primitives", () => {
  beforeEach(() => {
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  });

  afterEach(() => vi.unstubAllEnvs());

  it("requires MFA for privileged write roles", () => {
    expect(isMfaRequiredRole("ADMIN")).toBe(true);
    expect(isMfaRequiredRole("OPERATORE_SOCIETA")).toBe(true);
    expect(isMfaRequiredRole("VIEWER_ADSP")).toBe(false);
  });

  it("encrypts and authenticates the TOTP secret", () => {
    const secret = generateMfaSecret();
    const encrypted = encryptMfaSecret(secret);

    expect(encrypted).not.toContain(secret);
    expect(decryptMfaSecret(encrypted)).toBe(secret);
    expect(() => decryptMfaSecret(`${encrypted.slice(0, -1)}A`)).toThrow();
  });

  it("verifies only valid TOTP values", () => {
    const secret = generateMfaSecret();
    const token = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();

    expect(verifyMfaCode(secret, token)).toBe(true);
    expect(verifyMfaCode(secret, "000000")).toBe(false);
    expect(verifyMfaCode(secret, "not-an-otp")).toBe(false);
    expect(createMfaOtpAuthUri(secret, "admin@example.test")).toContain("otpauth://totp/");
  });

  it("stores recovery codes as non-reversible hashes", () => {
    const [code] = generateRecoveryCodes(1);
    const hash = hashRecoveryCode(code);

    expect(hash).not.toContain(code);
    expect(verifyRecoveryCode(code, hash)).toBe(true);
    expect(verifyRecoveryCode("AAAAA-BBBBB-CCCCC-DDDDD", hash)).toBe(false);
  });
});