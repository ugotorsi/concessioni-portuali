import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import * as OTPAuth from "otpauth";

const MFA_ENCRYPTION_VERSION = "v1";
const MFA_ENCRYPTION_AAD = Buffer.from("noetra:mfa:v1", "utf8");
const MFA_REQUIRED_ROLES = new Set([
  "ADMIN",
  "OPERATORE_SOCIETA",
  "GIURIDICO",
  "TECNICO",
  "ECONOMICO",
]);

function getEncryptionKey(): Buffer {
  const encodedKey = process.env.MFA_ENCRYPTION_KEY?.trim();

  if (!encodedKey) {
    throw new Error("MFA_ENCRYPTION_KEY is required.");
  }

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }

  return key;
}

function createTotp(secret: OTPAuth.Secret, accountLabel: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: "Noetra",
    label: accountLabel,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
}

export function isMfaRequiredRole(role: string): boolean {
  return MFA_REQUIRED_ROLES.has(role);
}

export function generateMfaSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function createMfaOtpAuthUri(secret: string, accountLabel: string): string {
  return createTotp(OTPAuth.Secret.fromBase32(secret), accountLabel).toString();
}

export function verifyMfaCode(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) {
    return false;
  }

  const delta = createTotp(OTPAuth.Secret.fromBase32(secret), "account").validate({
    token: code,
    window: 1,
  });

  return delta !== null;
}

export function encryptMfaSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MFA_ENCRYPTION_AAD);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    MFA_ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptMfaSecret(payload: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = payload.split(".");
  if (
    version !== MFA_ENCRYPTION_VERSION
    || !encodedIv
    || !encodedTag
    || !encodedCiphertext
  ) {
    throw new Error("Invalid encrypted MFA secret.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAAD(MFA_ENCRYPTION_AAD);
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const value = randomBytes(10).toString("hex").toUpperCase();
    return `${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.replaceAll("-", "").toUpperCase()).digest("hex");
}

export function verifyRecoveryCode(code: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashRecoveryCode(code), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}