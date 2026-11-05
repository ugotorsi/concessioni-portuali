import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiEngineControls } from "@/app/admin/runtime/AiEngineControls";
import { formatAdminRuntimeDateTime } from "@/app/admin/runtime/formatAdminRuntimeDateTime";

const noOpAction = async () => {};

describe("admin runtime AI engine timestamps", () => {
  it("formats timestamps deterministically in the Europe/Rome time zone", () => {
    expect(formatAdminRuntimeDateTime(new Date("2026-11-05T16:02:14.000Z")))
      .toBe("05/11/2026, 17:02:14");
  });

  it("renders the server-formatted timestamp without client-side date conversion", () => {
    const markup = renderToStaticMarkup(createElement(AiEngineControls, {
      engines: [{
        provider: "ANTHROPIC",
        label: "Anthropic · Claude Sonnet 5",
        model: "claude-sonnet-5",
        credentialConfigured: true,
        connectionStatus: "VERIFIED",
        credentialValid: true,
        modelAvailable: true,
        modelTechnicallyQualified: false,
        lastVerifiedAtLabel: "05/11/2026, 17:02:14",
        realDataAuthorized: false,
        manualEnabled: false,
        manualEligible: false,
        automaticSelected: false,
        automaticEligible: false,
        globalAiEnabled: true,
        generalAutomationEnabled: false,
        operational: false,
        estimatedCostLimitEur: null,
        billingApproval: "NOT_APPROVED",
        status: "DISABLED",
        error: null,
      }],
      updateManualAction: noOpAction,
      selectAutomaticAction: noOpAction,
      verifyConnectionAction: noOpAction,
    }));

    expect(markup).toContain("05/11/2026, 17:02:14");
  });
});
