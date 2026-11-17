import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const runtimePage = readFileSync(
  resolve(process.cwd(), "src/app/admin/runtime/page.tsx"),
  "utf8",
);

describe("document extraction runtime diagnostics UI", () => {
  it("shows only the parser's sanitized failure message next to its error code", () => {
    expect(runtimePage).toContain(
      'attempt.failureCode === "DIRECT_PARSER_FAILURE" && attempt.failureMessage',
    );
    expect(runtimePage).toContain("{attempt.failureMessage}");
  });
});
