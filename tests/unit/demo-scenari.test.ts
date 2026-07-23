import { describe, expect, it } from "vitest";

import { DEMO_SCENARIO_BLUEPRINTS } from "@/server/queries/demo-scenari";

describe("demo scenari blueprints", () => {
  it("espone 6 scenari istituzionali", () => {
    expect(DEMO_SCENARIO_BLUEPRINTS).toHaveLength(6);
  });

  it("ogni scenario ha titolo e descrizione", () => {
    for (const item of DEMO_SCENARIO_BLUEPRINTS) {
      expect(item.title.trim().length).toBeGreaterThan(0);
      expect(item.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("scenario morosita contiene riferimento art. 47", () => {
    const morosita = DEMO_SCENARIO_BLUEPRINTS.find((item) => item.slug === "morosita-art47");
    expect(morosita).toBeDefined();
    expect(`${morosita?.title} ${morosita?.description} ${morosita?.platformFocus}`.toLowerCase()).toContain("art. 47");
  });

  it("scenario regolarizzazione contiene nota non automatica", () => {
    const regolarizzazione = DEMO_SCENARIO_BLUEPRINTS.find(
      (item) => item.slug === "regolarizzazione-pre-provvedimento",
    );
    expect(regolarizzazione).toBeDefined();
    expect(regolarizzazione?.notes.toLowerCase()).toContain("non determina in automatico");
  });

  it("scenario art.10-bis contiene riferimento preavviso", () => {
    const art10bis = DEMO_SCENARIO_BLUEPRINTS.find((item) => item.slug === "istanza-parte-art10bis");
    expect(art10bis).toBeDefined();
    expect(`${art10bis?.title} ${art10bis?.description} ${art10bis?.administrativeProblem}`.toLowerCase()).toContain(
      "preavviso",
    );
  });

  it("scenario comune costiero evidenzia verticale turistico-ricreativa", () => {
    const comuneCostiero = DEMO_SCENARIO_BLUEPRINTS.find((item) => item.slug === "comune-costiero-stagionale");
    expect(comuneCostiero).toBeDefined();
    expect(
      `${comuneCostiero?.title} ${comuneCostiero?.description} ${comuneCostiero?.platformFocus}`.toLowerCase(),
    ).toContain("costier");
    expect(comuneCostiero?.notes.toLowerCase()).toContain("non come automatismo");
  });
});
