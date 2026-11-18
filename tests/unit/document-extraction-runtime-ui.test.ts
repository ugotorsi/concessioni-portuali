import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const runtimePage = readFileSync(
  resolve(process.cwd(), "src/app/admin/runtime/page.tsx"),
  "utf8",
);
const fascicoloPage = readFileSync(
  resolve(process.cwd(), "src/app/procedimenti/[id]/page.tsx"),
  "utf8",
);
const runtimeActions = readFileSync(
  resolve(process.cwd(), "src/app/admin/runtime/actions.ts"),
  "utf8",
);

describe("document extraction runtime diagnostics UI", () => {
  it("shows only the parser's sanitized failure message next to its error code", () => {
    expect(runtimePage).toContain(
      'attempt.failureCode === "DIRECT_PARSER_FAILURE" && attempt.failureMessage',
    );
    expect(runtimePage).toContain("{attempt.failureMessage}");
  });

  it("offers an ADMIN-only guided retry from the fascicolo and returns there after admission", () => {
    expect(fascicoloPage).toContain('role === "ADMIN" && fascicoloRetryableAttempts.length > 0');
    expect(fascicoloPage).toContain("action={retryFailedDocumentExtraction}");
    expect(fascicoloPage).toContain("Retry disponibile solo per ADMIN con MFA attiva.");
    expect(fascicoloPage).toContain("Autorizza retry e torna al fascicolo");
    expect(runtimeActions).toContain("const currentUser = await requireAdminWithMfa();");
    expect(runtimeActions).toContain(
      'redirect(`/procedimenti/${encodeURIComponent(attempt.procedimentoId)}?section=documents&extraction=retry-queued`)',
    );
  });

  it("offers aggregate terminal recovery inside the fascicolo without exposing job identifiers", () => {
    expect(fascicoloPage).toContain("recoverFascicoloTerminalDocumentExtractionsAction");
    expect(fascicoloPage).toContain("Riprendi lettura documenti");
    expect(fascicoloPage).toContain("nuovi job auditati senza modificare lo storico");
    expect(fascicoloPage).not.toContain('name="jobId"');
  });
});
