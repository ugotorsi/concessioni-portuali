import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

interface ExpectedOutcome {
  scenarioId: string;
  documents: readonly {
    file: string;
    basisRef: string;
    role: string;
  }[];
  requiredCoverage: Readonly<Record<string, boolean>>;
  expectedIssueThemes: readonly string[];
  epistemicRequirements: readonly string[];
}

const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "fascicolo-legal-acceptance");
const expected = JSON.parse(
  readFileSync(path.join(fixtureRoot, "expected-outcome.json"), "utf8"),
) as ExpectedOutcome;

describe("synthetic legal acceptance dossier", () => {
  it("keeps source documents separate from the expected outcome", () => {
    expect(expected.documents).toHaveLength(4);
    const documents = expected.documents.map((document) => ({
      ...document,
      text: readFileSync(path.join(fixtureRoot, document.file), "utf8"),
    }));

    expect(new Set(documents.map((document) => document.file)).size).toBe(4);
    expect(new Set(documents.map((document) => document.basisRef)).size).toBe(4);
    expect(documents.every((document) => document.text.includes("DOCUMENTO INTERAMENTE SINTETICO"))).toBe(true);
    expect(documents.every((document) => !document.text.includes("expectedIssueThemes"))).toBe(true);
  });

  it("covers prescriptions, formal notice, defenses, and contradictory technical evidence", () => {
    expect(expected.documents.map((document) => document.role)).toEqual([
      "PRESCRIPTIONS",
      "FORMAL_NOTICE",
      "DEFENSES",
      "TECHNICAL_REPORT",
    ]);
    expect(Object.values(expected.requiredCoverage).every(Boolean)).toBe(true);
    expect(expected.expectedIssueThemes.length).toBeGreaterThanOrEqual(5);
    expect(expected.epistemicRequirements).toContain("do not treat allegations as established facts");
  });
});
