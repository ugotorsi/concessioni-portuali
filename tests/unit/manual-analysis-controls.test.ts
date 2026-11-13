import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ManualAnalysisControls } from "@/app/admin/runtime/ManualAnalysisControls";

const baseProps = {
  procedimenti: [{ id: "proc-1", label: "Fascicolo di prova" }],
  tenants: [{ id: "ente-1", label: "Ente di prova" }],
  defaultAiModelCode: "OPENAI:gpt-test",
  singleExecutionId: "single-execution-id",
  batchExecutionId: "batch-execution-id",
  singleAction: async () => {},
  batchAction: async () => {},
};

describe("ManualAnalysisControls eligibility guard", () => {
  it("disables both submissions and explains when no AI model is manually enabled", () => {
    const markup = renderToStaticMarkup(createElement(ManualAnalysisControls, {
      ...baseProps,
      aiModels: [
        { code: "OPENAI:gpt-test", label: "OpenAI", enabled: false },
        { code: "ANTHROPIC:claude-test", label: "Anthropic", enabled: false },
      ],
    }));
    const disabledSubmits = markup.match(/<button[^>]*type="submit"[^>]*disabled/g) ?? [];
    expect(disabledSubmits).toHaveLength(2);
    expect(markup).toContain("Nessun motore AI");
  });

  it("falls back to the first enabled model when the default is not eligible", () => {
    const markup = renderToStaticMarkup(createElement(ManualAnalysisControls, {
      ...baseProps,
      aiModels: [
        { code: "OPENAI:gpt-test", label: "OpenAI", enabled: false },
        { code: "ANTHROPIC:claude-test", label: "Anthropic", enabled: true },
      ],
    }));
    expect(markup).toContain('<option value="ANTHROPIC:claude-test" selected="">');
    expect(markup).not.toContain("Nessun motore AI");
    const disabledSubmits = markup.match(/<button[^>]*type="submit"[^>]*disabled/g) ?? [];
    expect(disabledSubmits).toHaveLength(0);
  });

  it("keeps the configured default when it is eligible", () => {
    const markup = renderToStaticMarkup(createElement(ManualAnalysisControls, {
      ...baseProps,
      aiModels: [
        { code: "OPENAI:gpt-test", label: "OpenAI", enabled: true },
        { code: "ANTHROPIC:claude-test", label: "Anthropic", enabled: true },
      ],
    }));
    expect(markup).toContain('<option value="OPENAI:gpt-test" selected="">');
  });
});
