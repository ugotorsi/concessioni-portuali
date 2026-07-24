import { describe, expect, it } from "vitest";

import {
  investorDemoConcessioni,
  investorDemoDashboard,
  investorDemoDocumenti,
  investorDemoNormativa,
  investorDemoOrchestration,
  investorDemoPrimaryLinks,
  investorDemoProcedimenti,
  investorDemoScadenze,
  investorDemoVerticals,
} from "@/lib/investor-demo-data";

function flattenStrings(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => flattenStrings(item)).join(" ");
  }

  if (input && typeof input === "object") {
    return Object.values(input)
      .map((value) => flattenStrings(value))
      .join(" ");
  }

  return "";
}

describe("investor demo fixtures", () => {
  it("contains expected fixture cardinality", () => {
    expect(investorDemoConcessioni.length).toBeGreaterThan(0);
    expect(investorDemoProcedimenti.length).toBeGreaterThan(0);
    expect(investorDemoDocumenti.length).toBeGreaterThan(0);
    expect(investorDemoScadenze.length).toBeGreaterThan(0);
    expect(investorDemoNormativa.length).toBeGreaterThan(0);
    expect(investorDemoVerticals.length).toBeGreaterThanOrEqual(3);
    expect(investorDemoPrimaryLinks.length).toBeGreaterThanOrEqual(8);
    expect(investorDemoDashboard.porti.length).toBe(3);
    expect(investorDemoOrchestration.reasoningTrace.length).toBeGreaterThan(0);
  });

  it("contains required vertical slugs for demo navigation", () => {
    const slugs = investorDemoVerticals.map((item) => item.slug);

    expect(slugs).toContain("concessioni");
    expect(slugs).toContain("normativa");
  });

  it("does not include direct personal contact details", () => {
    const allData = flattenStrings({
      investorDemoDashboard,
      investorDemoConcessioni,
      investorDemoProcedimenti,
      investorDemoDocumenti,
      investorDemoScadenze,
      investorDemoNormativa,
      investorDemoOrchestration,
    });

    expect(allData).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(allData.toLowerCase()).not.toContain("codice fiscale");
    expect(allData.toLowerCase()).not.toContain("partita iva");
  });
});