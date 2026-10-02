import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import {
  FascicoloProposals,
  fascicoloProposalStatusLabel,
  fascicoloProposalTypeLabel,
  type FascicoloProposal,
} from "@/components/procedimenti/FascicoloProposals";

function proposal(overrides: Partial<FascicoloProposal> = {}): FascicoloProposal {
  return {
    id: "proposal-technical-id",
    procedimentoId: "procedure-technical-id",
    proposalType: "DEADLINE",
    status: "PROPOSED",
    title: "Verificare il termine procedimentale",
    description: "Valutare la scadenza indicata nel fascicolo prima di registrarla.",
    rationale: "Il termine emerge dagli elementi documentati e richiede revisione professionale.",
    reviewVersion: 0,
    warningCodes: [],
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    ...overrides,
  };
}

function render(proposals: readonly FascicoloProposal[]): string {
  return renderToStaticMarkup(createElement(FascicoloProposals, { proposals, canManage: false }));
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("Fascicolo proposals workspace", () => {
  it("maps exactly the seven persisted proposal types", () => {
    expect([
      fascicoloProposalTypeLabel("DEADLINE"),
      fascicoloProposalTypeLabel("CRITICALITY"),
      fascicoloProposalTypeLabel("DOCUMENT_REQUIREMENT"),
      fascicoloProposalTypeLabel("CHECKLIST_ITEM"),
      fascicoloProposalTypeLabel("ACTIVITY"),
      fascicoloProposalTypeLabel("NOTE"),
      fascicoloProposalTypeLabel("SUBJECT_UPDATE"),
    ]).toEqual(["Scadenza", "Criticità", "Documento richiesto", "Verifica", "Attività", "Nota", "Aggiornamento soggetto"]);
  });

  it("translates every real status and keeps approval distinct from materialization", () => {
    expect([
      fascicoloProposalStatusLabel("PROPOSED"),
      fascicoloProposalStatusLabel("APPROVED"),
      fascicoloProposalStatusLabel("REJECTED"),
      fascicoloProposalStatusLabel("AMENDED_AND_APPROVED"),
      fascicoloProposalStatusLabel("MATERIALIZED"),
      fascicoloProposalStatusLabel("SUPERSEDED"),
      fascicoloProposalStatusLabel("STALE"),
    ]).toEqual(["Da revisionare", "Approvata", "Rifiutata", "Approvata con modifiche", "Materializzata", "Superata", "Non più attuale"]);
    const html = render([
      proposal({ id: "approved", status: "APPROVED", title: "Proposta approvata" }),
      proposal({ id: "materialized", status: "MATERIALIZED", title: "Proposta attuata", materializedAt: new Date("2026-10-02T10:00:00.000Z"), materializedEntityType: "Scadenza" }),
    ]);
    expect(html).toContain("Approvate</h3>");
    expect(html).toContain("Attuate</h3>");
    expect(html).toContain("Approvata");
    expect(html).toContain("Materializzata");
  });

  it("renders review-first cards, professional fields, indicators, and no technical data", () => {
    const html = render([
      proposal(),
      proposal({ id: "rejected", status: "REJECTED", title: "Proposta non approvata", reviewedAt: new Date("2026-10-02T10:00:00.000Z"), reviewNote: "Non coerente con gli atti disponibili." }),
    ]);
    const text = visibleText(html);
    expect(html).toContain("Proposte");
    expect(html).toContain("Azioni e aggiornamenti suggeriti, soggetti a revisione e approvazione.");
    expect(html.indexOf("Da revisionare</h3>")).toBeLessThan(html.indexOf("Rifiutate</h3>"));
    expect(html).toContain("Nessuna proposta produce effetti operativi senza approvazione.");
    expect(html).toContain("Valutare la scadenza indicata nel fascicolo prima di registrarla.");
    expect(html).toContain("Motivazione");
    expect(html).toContain("Non coerente con gli atti disponibili.");
    expect(text).not.toContain("proposal-technical-id");
    expect(text).not.toContain("procedure-technical-id");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("JSON.stringify");
    expect(text.toLocaleLowerCase("it")).not.toMatch(/\b(ai|provider|payload|fingerprint|runtime|queue|job)\b/);
  });

  it("omits unavailable fields and renders the exact empty state", () => {
    const sparse = render([proposal()]);
    const empty = render([]);
    expect(sparse).not.toContain("Revisionata il");
    expect(sparse).not.toContain("Nota di revisione");
    expect(sparse).not.toContain("Attuata il");
    expect(sparse).not.toContain("Elemento aggiornato");
    expect(empty).toContain("Non risultano proposte operative per questo fascicolo.");
    expect(empty).toContain("Le proposte vengono sottoposte a revisione prima di produrre effetti sul fascicolo.");
  });

  it("shares legacy and intake UX without automatic generation or materialization", () => {
    const legacy = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");
    const intake = readFileSync("src/components/procedimenti/FascicoloIntakeDetail.tsx", "utf8");
    const component = readFileSync("src/components/procedimenti/FascicoloProposals.tsx", "utf8");
    expect(legacy).toContain('activeSection === "proposals"');
    expect(intake).toContain('activeSection === "proposals"');
    expect(legacy).toContain("<FascicoloProposals");
    expect(intake).toContain("<FascicoloProposals");
    expect(legacy).not.toContain("<FascicoloDocumentRequirementProposalsPanel");
    expect(component).not.toContain("generateOperationalProposalsAction");
    expect(component).not.toContain("JSON.stringify");
    expect(component).not.toContain("proposedPayload");
    expect(component).toContain("action={reviewOperationalProposalAction}");
    expect(component).toContain("action={materializeOperationalProposalAction}");
    expect(component).not.toContain("materializeOperationalProposalAction(");
    expect(component).not.toContain("reviewOperationalProposalAction(");
  });
});