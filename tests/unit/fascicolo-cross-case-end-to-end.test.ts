import { describe, expect, it } from "vitest";

import { buildStructuredFascicoloReport } from "@/server/fascicolo-report";
import { buildActTemplateCatalog } from "@/server/fascicolo-acts/templates";
import { SCENARIOS } from "./fascicolo-cross-case-scenarios";

function run(name: string) {
  const scenario = SCENARIOS.find((entry) => entry.name === name);
  if (!scenario) throw new Error(`Unknown scenario ${name}`);
  const report = buildStructuredFascicoloReport(scenario.input);
  const catalog = buildActTemplateCatalog({
    payload: report.payload,
    context: { procedimentoLabel: name, responsabile: null, unitaOrganizzativa: null },
  });
  const regime = report.payload.portRegime;
  const sources = Object.fromEntries((regime?.sources ?? []).map((source) => [source.sourceId, source.status]));
  const applications = report.payload.legalApplication ?? [];
  const profile = applications.find((entry) => entry.elementAnalysis)?.elementAnalysis;
  const element = (id: string) => profile?.elements.find((entry) => entry.elementId === id)?.status;
  return { report, catalog, regime, sources, profile, element, recommended: catalog.recommended.map((template) => template.templateKey) };
}

describe("NOETRA cross-case end-to-end acceptance (knowledge → report → port regime → profiles → acts)", () => {
  it("Porto Aurora: occupation outside the perimeter, 2021 title, instruction phase", () => {
    const { regime, sources, profile, catalog, recommended } = run("porto-aurora-occupazione");
    expect(regime?.grantDate?.date).toBe("2021-01-20");
    expect(sources).toMatchObject({
      L84_ART18: "PREVIOUS_TEXT_APPLICABLE",
      DI_202_2022: "PARTIALLY_APPLICABLE",
      DM_110_2023: "NOT_APPLICABLE_RATIONE_TEMPORIS",
      ART_57_2018: "FULLY_APPLICABLE",
      ART_242_2025: "PARTIALLY_APPLICABLE",
    });
    expect(profile?.profileId).toBe("UNAUTHORIZED_OCCUPATION");
    expect(catalog.phase).toBe("INSTRUCTION");
    expect(recommended).toEqual(expect.arrayContaining(["CATALOG:INGIUNZIONE_ART54", "CATALOG:VALUTAZIONE_CONTRODEDUZIONI"]));
    expect(recommended).not.toContain("CATALOG:COMUNICAZIONE_AVVIO");
  });

  it("partial fee payment: credit recovery, not decadence", () => {
    const { sources, profile, element, recommended } = run("canone-acconto");
    expect(sources.DM_110_2023).toBe("FULLY_APPLICABLE");
    expect(profile?.profileId).toBe("FEE_PAYMENT");
    expect(element("fee-due")).toBe("INDICATED");
    expect(element("non-payment")).toBe("INDICATED");
    expect(recommended).toContain("CATALOG:MESSA_IN_MORA_CANONE");
    expect(recommended).not.toContain("CATALOG:CONTESTAZIONE_DECADENZA");
  });

  it("third-party use with documented authorization: contrary evidence, clarification only", () => {
    const { profile, element, recommended } = run("uso-terzi-autorizzato");
    expect(profile?.profileId).toBe("THIRD_PARTY_USE");
    expect(element("no-authorization")).toBe("CONTRARY_EVIDENCE");
    expect(recommended).toContain("CATALOG:RICHIESTA_CHIARIMENTI_USO_TERZI");
    expect(recommended).not.toContain("CATALOG:CONTESTAZIONE_DECADENZA");
  });

  it("2026 title: grant date anchored to issuance, ART 242/2025 fully applicable, investment term not yet expired", () => {
    const { regime, sources, profile, element, recommended } = run("titolo-2026-investimenti");
    expect(regime?.grantDate?.date).toBe("2026-06-20");
    expect(regime?.procedureStartDate?.date).toBe("2026-03-15");
    expect(sources.ART_242_2025).toBe("FULLY_APPLICABLE");
    expect(sources.ART_57_2018).toBe("SUPERSEDED");
    expect(profile?.profileId).toBe("INVESTMENT_DEFAULT");
    expect(element("non-performance")).toBe("NOT_PROVEN");
    expect(profile?.qualification).toMatch(/non ancora scaduto/);
    expect(recommended).not.toContain("CATALOG:DIFFIDA_ADEMPIERE_INVESTIMENTI");
    expect(recommended).not.toContain("CATALOG:CONTESTAZIONE_DECADENZA");
  });

  it("change of control after 01/03/2026 on a pre-existing title triggers ART 242/2025 misura 1.2 ii)", () => {
    const { regime, sources } = run("cambio-controllo-2026");
    expect(regime?.grantDate?.date).toBe("2019-05-10");
    expect(sources.ART_242_2025).toBe("PARTIALLY_APPLICABLE");
    expect(regime?.postReformEvents.map((event) => event.date)).toEqual(["2026-04-15"]);
  });

  it("declared decadence with pending review: post-decision acts only", () => {
    const { regime, catalog, recommended } = run("decadenza-con-riesame");
    expect(regime).not.toBeNull();
    expect(catalog.phase).toBe("POST_DECISION");
    expect(catalog.reviewPending).toBe(true);
    expect(recommended.length).toBeGreaterThan(0);
    expect(recommended.every((key) => key.startsWith("PLAN:"))).toBe(true);
    expect(recommended.some((key) => /riesame/i.test(key))).toBe(true);
  });

  it("non-port matter: no port regime and no maritime-domain templates", () => {
    const { regime, recommended } = run("materia-non-portuale");
    expect(regime ?? null).toBeNull();
    expect(recommended.filter((key) => key.startsWith("CATALOG:"))).toEqual([]);
  });
});
