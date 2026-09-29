import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/procedimenti/FascicoloAutomaticWorkflowPanel.tsx", "utf8");

describe("Lotto 2 structured knowledge UI", () => {
  it("shows the required CURRENT knowledge sections in the existing fascicolo panel", () => {
    for (const label of [
      "Conoscenza strutturata del fascicolo",
      "Soggetti",
      "Cronologia derivata",
      "Fatti principali",
      "Contraddizioni aperte",
      "Lacune",
      "Scadenze candidate",
    ]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("model.knowledge");
  });

  it("visibly distinguishes AI proposals from human-confirmed knowledge", () => {
    expect(source).toContain("Proposta AI");
    expect(source).toContain("Confermata");
    expect(source).toContain('status === "HUMAN_CONFIRMED"');
  });

  it("shows the Lotto 3 issue to question to origin and mission chain with review states", () => {
    for (const label of [
      "Questioni giuridiche individuate",
      "Fondamento:",
      "Data di riferimento:",
      "Motivo:",
      "Missione:",
      "Proposta AI",
      "Confermata",
      "Respinta",
      "Da verificare",
    ]) expect(source).toContain(label);
    expect(source).toContain("researchQuestionSemanticKey");
    expect(source).toContain("historicalMissionCount");
  });

  it("shows Lotto 4 research coverage while keeping direction separate from source verification", () => {
    for (const label of [
      "Stato ricerca:",
      "Copertura:",
      "Favorevole",
      "Contrario",
      "Neutro",
      "Inconcludente",
      "Non valutato",
      "Fonte solo individuata",
      "Testo acquisito",
      "Identità verificata",
      "Aspetti scoperti:",
      "non costituisce una conclusione giuridica",
    ]) expect(source).toContain(label);
    expect(source).toContain("directionBadge(result.supportDirection)");
    expect(source).toContain("sourceStateLabel(result.sourceVerificationState)");
    expect(source).not.toContain("tesi confermata");
    expect(source).not.toContain("precedente valido");
  });

  it("shows Lotto 5 source usability separately from direction and exposes blockers and adverse research", () => {
    for (const label of [
      "Discovery:",
      "Fonti utilizzabili:",
      "Fonte utilizzabile",
      "Fonte bloccata",
      "Review richiesta",
      "Temporalmente applicabile",
      "Contenuto verificato",
      "Motivi di blocco:",
      "Gap fonti:",
      "Ricerca contraria:",
      "Autorità utilizzabili in conflitto",
    ]) expect(source).toContain(label);
    expect(source).toContain('result.usable ? "success"');
    expect(source).not.toContain("orientamento prevalente");
    expect(source).not.toContain("precedente decisivo");
  });
});
