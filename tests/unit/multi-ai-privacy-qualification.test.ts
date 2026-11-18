import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_API_PRIVACY_QUALIFICATION,
  DEEPSEEK_OPEN_PLATFORM_PRIVACY_QUALIFICATION,
  MULTI_AI_PRIVACY_QUALIFICATION_VERSION,
} from "@/server/ai/qualification/privacyQualificationChecklists";

describe("multi-AI privacy qualification checklists", () => {
  it("keeps both providers blocked from real data", () => {
    expect(MULTI_AI_PRIVACY_QUALIFICATION_VERSION)
      .toBe("MULTI_AI_PRIVACY_QUALIFICATION_2026_11_05");
    expect(ANTHROPIC_API_PRIVACY_QUALIFICATION).toMatchObject({
      serviceScope: "Direct Anthropic commercial API",
      realDataDecision: "BLOCKED",
      overallResult: "NOT_TESTED",
    });
    expect(DEEPSEEK_OPEN_PLATFORM_PRIVACY_QUALIFICATION).toMatchObject({
      serviceScope: "DeepSeek Open Platform API",
      realDataDecision: "BLOCKED",
      overallResult: "FAIL",
    });
  });

  it("records unresolved Anthropic account, transfer, subprocessor, and governance gates", () => {
    const blockingIds = ANTHROPIC_API_PRIVACY_QUALIFICATION.items
      .filter((item) => item.blocking)
      .map((item) => item.id);
    expect(blockingIds).toEqual(expect.arrayContaining([
      "ANTHROPIC_ZDR_ACCOUNT_STATUS",
      "ANTHROPIC_TRANSFER_TIA",
      "ANTHROPIC_SUBPROCESSORS",
      "ANTHROPIC_NOETRA_GOVERNANCE",
    ]));
  });

  it("records DeepSeek API privacy gaps and the unresolved Garante scope", () => {
    const byId = Object.fromEntries(
      DEEPSEEK_OPEN_PLATFORM_PRIVACY_QUALIFICATION.items.map((item) => [
        item.id,
        item,
      ]),
    );
    expect(byId.DEEPSEEK_DPA_SCC_ART46).toMatchObject({
      result: "FAIL",
      blocking: true,
    });
    expect(byId.DEEPSEEK_API_RETENTION_TRAINING).toMatchObject({
      result: "FAIL",
      blocking: true,
    });
    expect(byId.DEEPSEEK_GARANTE_SCOPE).toMatchObject({
      result: "NOT_TESTED",
      blocking: true,
    });
  });
});
