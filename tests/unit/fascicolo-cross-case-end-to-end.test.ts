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
  return {
    report,
    catalog,
    regime,
    sources,
    profile,
    element,
    recommended: catalog.recommended.map((template) => template.templateKey),
    recommendedTemplates: catalog.recommended,
  };
}

describe("NOETRA cross-case end-to-end acceptance (knowledge → report → port regime → profiles → acts)", () => {
  it("Porto Aurora: occupation outside the perimeter, 2021 title, instruction phase", () => {
    const { regime, sources, profile, catalog, recommended } = run("porto-aurora-occupazione");
    expect(regime?.grantDate?.date).toBe("2021-01-20");
    expect(sources).toMatchObject({
      L84_ART18: "PREVIOUS_TEXT_APPLICABLE",
      DI_202_2022: "PARTIALLY_APPLICABLE",
      DM_110_2023: "APPLICABILITY_TO_VERIFY",
      ART_57_2018: "DATE_TO_VERIFY",
      ART_242_2025: "APPLICABILITY_TO_VERIFY",
    });
    expect(profile?.profileId).toBe("UNAUTHORIZED_OCCUPATION");
    expect(catalog.phase).toBe("INSTRUCTION");
    expect(recommended).toEqual(expect.arrayContaining(["CATALOG:INGIUNZIONE_ART54", "CATALOG:VALUTAZIONE_CONTRODEDUZIONI"]));
    expect(recommended).not.toContain("CATALOG:COMUNICAZIONE_AVVIO");
  });

  it("partial fee payment: credit recovery, not decadence", () => {
    const { sources, profile, element, recommended } = run("canone-acconto");
    expect(sources.DM_110_2023).toBe("APPLICABILITY_TO_VERIFY");
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

  it("a request for change of control on a pre-existing title requires verification under ART 242/2025", () => {
    const { regime, sources } = run("cambio-controllo-2026");
    expect(regime?.grantDate?.date).toBe("2019-05-10");
    expect(sources.ART_242_2025).toBe("APPLICABILITY_TO_VERIFY");
    expect(regime?.postReformEvents.map((event) => event.date)).toEqual(["2026-04-15"]);
    expect(regime?.sources.find((source) => source.sourceId === "ART_242_2025")?.reasoning)
      .toContain("una domanda non prova da sola");
  });

  it("declared decadence with pending review: post-decision acts only", () => {
    const { regime, catalog, recommendedTemplates } = run("decadenza-con-riesame");
    expect(regime).not.toBeNull();
    expect(catalog.phase).toBe("POST_DECISION");
    expect(catalog.reviewPending).toBe(true);
    expect(recommendedTemplates.length).toBeGreaterThan(0);
    expect(recommendedTemplates.every((template) => template.source === "REPORT_PLAN")).toBe(true);
    expect(recommendedTemplates.some((template) => /riesame/i.test(template.title))).toBe(true);
  });

  it("uses evidenced final acts for guidance without changing stale authoritative metadata", () => {
    const scenario = SCENARIOS.find((entry) => entry.name === "decadenza-con-riesame");
    if (!scenario?.input.proceduralContext) throw new Error("Missing review scenario");
    const context = {
      ...scenario.input.proceduralContext,
      stato: "IN_CORSO",
      dataProvvedimentoFinale: null,
      finalAct: null,
      documentTitles: [],
    };
    const { payload } = buildStructuredFascicoloReport({ ...scenario.input, proceduralContext: context });
    const catalog = buildActTemplateCatalog({
      payload,
      context: { procedimentoLabel: "procedimento di prova", responsabile: null, unitaOrganizzativa: null },
    });
    expect(payload.proceduralContext?.stato).toBe("IN_CORSO");
    expect(catalog).toMatchObject({ phase: "POST_DECISION", documentaryAhead: true, reviewPending: true });
    expect(payload.operationalPlans?.[0].steps.map((step) => step.activityCode))
      .toEqual(["PORT:POST:REVIEW", "PORT:POST:FINAL_ACT_REVIEW", "PORT:POST:FOLLOW_UP"]);
    expect(payload.legalApplication?.[0].consequences.join(" ")).toContain("Istanza di riesame");
    expect(payload.legalApplication?.[0].consequences.join(" ")).not.toContain("Prima di qualsiasi provvedimento");
    expect([...catalog.recommended, ...catalog.others].map((template) => template.title))
      .not.toContain("Contestazione degli addebiti");
  });

  it("non-port matter: no port regime and no maritime-domain templates", () => {
    const { report, regime, recommended } = run("materia-non-portuale");
    expect(regime ?? null).toBeNull();
    expect(recommended.filter((key) => key.startsWith("CATALOG:"))).toEqual([]);
    expect(report.payload.regulatoryApplicability).toEqual([]);
    expect(JSON.stringify(report.payload.legalApplication)).not.toMatch(/cod\. nav\.|art\. 47|concessionario|demanio/i);
    expect(report.payload.legalApplication?.[0].conclusion).toContain("individuare e verificare le fonti normative");
    expect(report.payload.legalApplication?.[0].conclusion).not.toContain("fondata sul solo dato normativo");
    expect(report.payload.legalApplication?.[0].conclusionStatus).toBe("SOURCES_TO_VERIFY");
    expect(JSON.stringify(report.payload.operationalPlans)).not.toMatch(/cod\. nav\.|art\. 47|concessionario|demanio/i);
    expect(report.payload.operationalPlans?.[0].steps.map((step) => step.activityCode))
      .toEqual(["GENERAL:FACTS", "GENERAL:LEGAL", "GENERAL:PARTICIPATION", "GENERAL:DECISION"]);
    const decision = report.payload.operationalPlans?.[0].steps.find((step) => step.activityCode === "GENERAL:DECISION");
    expect(decision?.draftTitle).toBe("Schema di decisione motivata");
    expect(decision?.draftTemplate).toContain("[ORGANO COMPETENTE E FONDAMENTO]");
    expect(decision?.draftTemplate).toContain("[DECISIONE MOTIVATA");
    expect(decision?.draftTemplate).not.toMatch(/cod\. nav\.|art\. 47|concessionario|demanio/i);
  });
});
