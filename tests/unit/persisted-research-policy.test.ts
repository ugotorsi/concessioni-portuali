import { describe, expect, it } from "vitest";

import { hasServerResearchExecutionChannel } from "@/server/legal-research/persisted-research-policy";

describe("persisted research policy", () => {
  it("keeps ChatGPT MCP and technical sources outside server-side provider execution", () => {
    expect(hasServerResearchExecutionChannel(["CHATGPT_MCP"])).toBe(false);
    expect(hasServerResearchExecutionChannel(["TECHNICAL_SOURCES"])).toBe(false);
    expect(hasServerResearchExecutionChannel([
      "CHATGPT_MCP",
      "TECHNICAL_SOURCES",
    ])).toBe(false);
  });

  it.each(["LEGAL_DATA_HUNTER", "MOONLIT", "SIMPLICITER"] as const)(
    "admits server-side research when %s is selected",
    (channel) => {
      expect(hasServerResearchExecutionChannel([channel])).toBe(true);
    },
  );
});
