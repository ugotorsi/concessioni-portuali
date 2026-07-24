import { describe, expect, it } from "vitest";

import { legalRulePackManifestSchema } from "@/server/legal-rules/manifest";

describe("legal rule pack manifest", () => {
  it("accepts a minimal valid manifest", () => {
    const parsed = legalRulePackManifestSchema.parse({
      packCode: "pack-test",
      packVersion: "1.0.0",
      tenantEnteCode: "DEMO-ENTE-ADSP",
      authority: {
        code: "ADSP-MTC",
        name: "Authority Demo",
        level: "ADSP",
      },
      port: {
        code: "NAPOLI-SALERNO",
        name: "Porto Demo",
      },
      sources: [
        {
          sourceKey: "SRC-1",
          title: "Fonte 1",
          sourceType: "DELIBERA",
        },
      ],
      rules: [
        {
          sourceKey: "SRC-1",
          ruleCode: "RULE-1",
          title: "Regola 1",
          summary: "Sommario regola 1",
          category: "CANONE",
          outcome: {
            outputSeverity: "MEDIA",
            outcomeTitle: "Outcome",
            outcomeSummary: "Outcome summary",
          },
        },
      ],
    });

    expect(parsed.packCode).toBe("pack-test");
    expect(parsed.rules[0]?.status).toBe("ATTIVA");
    expect(parsed.rules[0]?.outcome.humanReviewRequired).toBe(true);
  });

  it("rejects manifest when a rule references an invalid category", () => {
    expect(() =>
      legalRulePackManifestSchema.parse({
        packCode: "pack-test",
        packVersion: "1.0.0",
        tenantEnteCode: "DEMO-ENTE-ADSP",
        authority: {
          code: "ADSP-MTC",
          name: "Authority Demo",
          level: "ADSP",
        },
        port: {
          code: "NAPOLI-SALERNO",
          name: "Porto Demo",
        },
        sources: [
          {
            sourceKey: "SRC-1",
            title: "Fonte 1",
            sourceType: "DELIBERA",
          },
        ],
        rules: [
          {
            sourceKey: "SRC-1",
            ruleCode: "RULE-1",
            title: "Regola 1",
            summary: "Sommario regola 1",
            category: "INVALID",
            outcome: {
              outputSeverity: "MEDIA",
              outcomeTitle: "Outcome",
              outcomeSummary: "Outcome summary",
            },
          },
        ],
      }),
    ).toThrow();
  });
});
