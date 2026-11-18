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
        balanceSufficient: null,
        verificationCode: "AI_PROVIDER_CONNECTION_VERIFIED",
        verificationHttpStatus: 200,
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
    expect(markup).toContain("AI_PROVIDER_CONNECTION_VERIFIED");
    expect(markup).toContain("Solo GET amministrative");
  });

  it("renders sanitized DeepSeek balance readiness without exposing amounts", () => {
    const markup = renderToStaticMarkup(createElement(AiEngineControls, {
      engines: [{
        provider: "DEEPSEEK",
        label: "DeepSeek · V4 Pro",
        model: "deepseek-v4-pro",
        credentialConfigured: true,
        connectionStatus: "VERIFIED",
        credentialValid: true,
        modelAvailable: true,
        balanceSufficient: true,
        verificationCode: "AI_PROVIDER_CONNECTION_VERIFIED",
        verificationHttpStatus: 200,
        modelTechnicallyQualified: false,
        lastVerifiedAtLabel: "07/11/2026, 09:00:00",
        realDataAuthorized: false,
        manualEnabled: false,
        manualEligible: false,
        automaticSelected: false,
        automaticEligible: false,
        globalAiEnabled: false,
        generalAutomationEnabled: false,
        operational: false,
        estimatedCostLimitEur: null,
        billingApproval: "NOT_APPROVED",
        status: "DISABLED",
        error: "Provider non ancora autorizzato per fascicoli reali.",
      }],
      updateManualAction: noOpAction,
      selectAutomaticAction: noOpAction,
      verifyConnectionAction: noOpAction,
    }));

    expect(markup).toContain("Saldo API utilizzabile");
    expect(markup).toContain(">Sì<");
    expect(markup).not.toContain("total_balance");
    expect(markup).not.toContain("2.00");
  });
});
