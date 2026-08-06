import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("next-auth auth diagnostics logging safety", () => {
  it("gates diagnostics behind AUTH_DIAGNOSTICS env flag", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/next-auth.ts"), "utf8");
    expect(source).toContain('process.env.AUTH_DIAGNOSTICS === "true"');
  });

  it("defines helper log formats exactly once", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/next-auth.ts"), "utf8");

    expect(source).toContain("console.info(`AUTH_DIAG_${key}=${value}`)");
    expect(source).toContain("console.info(`AUTH_DIAG_REJECTION_STAGE=${stage}`)");
  });

  it("contains only expected diagnostic indicator/stage call sites", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/next-auth.ts"), "utf8");

    expect(source).toContain('logAuthDiagnostic("USER_FOUND", Boolean(user));');
    expect(source).toContain('logAuthDiagnostic("ACTIVE", Boolean(user.attivo));');
    expect(source).toContain('logAuthDiagnostic("PASSWORD_HASH_PRESENT", Boolean(user.passwordHash));');
    expect(source).toContain(
      'logAuthDiagnostic("LOCKED", Boolean(user.lockedUntil && user.lockedUntil > now));',
    );
    expect(source).toContain('logAuthDiagnostic("MFA_ENABLED", Boolean(user.mfaEnabled));');
    expect(source).toContain(
      'logAuthDiagnostic("MUST_CHANGE_PASSWORD", Boolean(user.mustChangePassword));',
    );
    expect(source).toContain('logAuthDiagnostic("PASSWORD_MATCH", isPasswordValid);');

    expect(source).toContain('logAuthDiagnosticStage("INVALID_CREDENTIALS_PAYLOAD");');
    expect(source).toContain('logAuthDiagnosticStage("USER_NOT_FOUND");');
    expect(source).toContain('logAuthDiagnosticStage("INACTIVE");');
    expect(source).toContain('logAuthDiagnosticStage("PASSWORD_HASH_MISSING");');
    expect(source).toContain('logAuthDiagnosticStage("LOCKED");');
    expect(source).toContain('logAuthDiagnosticStage("PASSWORD_MISMATCH");');
    expect(source).toContain('logAuthDiagnosticStage("MFA");');
    expect(source).toContain('logAuthDiagnosticStage("SESSION_CREATED");');
  });

  it("does not log sensitive auth values", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/next-auth.ts"),
      "utf8",
    );

    const forbiddenLoggingPatterns = [
      /console\.(?:info|error|log)\s*\([^)]*parsed\.data\.email/,
      /console\.(?:info|error|log)\s*\([^)]*parsed\.data\.password/,
      /console\.(?:info|error|log)\s*\([^)]*user\.email/,
      /console\.(?:info|error|log)\s*\([^)]*user\.id/,
      /console\.(?:info|error|log)\s*\([^)]*user\.nome/,
      /console\.(?:info|error|log)\s*\([^)]*user\.passwordHash/,
      /console\.(?:info|error|log)\s*\([^)]*DATABASE_URL/,
      /console\.(?:info|error|log)\s*\([^)]*rawCredentials/,
      /`[^`]*\$\{parsed\.data\.email\}[^`]*`/,
      /`[^`]*\$\{parsed\.data\.password\}[^`]*`/,
      /`[^`]*\$\{user\.(?:email|id|nome|passwordHash)\}[^`]*`/,
      /JSON\.stringify\s*\(\s*(?:user|rawCredentials|error)\s*\)/,
    ];

    for (const pattern of forbiddenLoggingPatterns) {
      expect(source).not.toMatch(pattern);
    }

    expect(source).toContain(
      'logAuthDiagnostic("PASSWORD_HASH_PRESENT", Boolean(user.passwordHash));',
    );
  });

  it("does not contain extra console calls beyond diagnostic helpers", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/next-auth.ts"), "utf8");
    const consoleCalls = source.match(/console\.(?:info|error|log)\s*\(/g) ?? [];

    expect(consoleCalls).toHaveLength(2);
  });
});
