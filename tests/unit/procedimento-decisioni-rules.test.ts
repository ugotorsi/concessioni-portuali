import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  getDecisionRulePreviewForTipologia,
  isChecklistMandatoryForTipologia,
  resolveDecisionOutcome,
} from "@/server/procedimenti/decisioni";

describe("procedimento decision matrix", () => {
  it("decadenza dichiarata produce effetto decaduta", () => {
    const outcome = resolveDecisionOutcome({
      tipologiaProcedimento: "AVVIO_DECADENZA",
      tipoDecisione: "DECADENZA_DICHIARATA",
    });

    expect(outcome.effettoTitolo).toBe("CONCESSIONE_DECADUTA");
    expect(outcome.statoConcessioneSuccessivo).toBe("DECADUTA");
    expect(outcome.statoFinaleProcedimento).toBe("CONCLUSO");
    expect(outcome.requiresDocumento).toBe(true);
  });

  it("revoca disposta produce effetto revocata", () => {
    const outcome = resolveDecisionOutcome({
      tipologiaProcedimento: "AVVIO_REVOCA",
      tipoDecisione: "REVOCA_DISPOSTA",
    });

    expect(outcome.effettoTitolo).toBe("CONCESSIONE_REVOCATA");
    expect(outcome.statoConcessioneSuccessivo).toBe("REVOCATA");
    expect(outcome.statoFinaleProcedimento).toBe("CONCLUSO");
    expect(outcome.requiresDocumento).toBe(true);
  });

  it("archiviazione non produce effetto titolo", () => {
    const outcome = resolveDecisionOutcome({
      tipologiaProcedimento: "AVVIO_REVOCA",
      tipoDecisione: "ARCHIVIAZIONE",
    });

    expect(outcome.effettoTitolo).toBe("NESSUNO");
    expect(outcome.statoConcessioneSuccessivo).toBeNull();
    expect(outcome.statoFinaleProcedimento).toBe("ARCHIVIATO");
  });

  it("tipologie diverse consentono solo chiusura senza effetto o archiviazione", () => {
    const preview = getDecisionRulePreviewForTipologia("DIFFIDA");

    expect(preview.map((item) => item.tipoDecisione)).toEqual([
      "CHIUSURA_SENZA_EFFETTO",
      "ARCHIVIAZIONE",
    ]);
  });

  it("blocca decisioni incompatibili con tipologia", () => {
    expect(() =>
      resolveDecisionOutcome({
        tipologiaProcedimento: "DIFFIDA",
        tipoDecisione: "DECADENZA_DICHIARATA",
      }),
    ).toThrow(/non consentita/i);
  });

  it("checklist obbligatoria solo per avvio decadenza/revoca", () => {
    expect(isChecklistMandatoryForTipologia("AVVIO_DECADENZA")).toBe(true);
    expect(isChecklistMandatoryForTipologia("AVVIO_REVOCA")).toBe(true);
    expect(isChecklistMandatoryForTipologia("DIFFIDA")).toBe(false);
  });

  it("query procedimento usa statoEffetto persistito senza derivazioni", () => {
    const filePath = path.join(process.cwd(), "src/server/queries/procedimenti.ts");
    const content = readFileSync(filePath, "utf8");

    expect(content).toContain("statoEffetto: procedimento.decisioneProcedimento.statoEffetto");
    expect(content).toContain("effettoApplicatoAt: procedimento.decisioneProcedimento.effettoApplicatoAt");
    expect(content).not.toContain(" as\n    | ((typeof procedimento.decisioneProcedimento)");
    expect(content).not.toContain("function deriveDecisionEffectStatus");
    expect(content).not.toContain("statoConcessioneAttuale");
  });

  it("query concessione usa statoEffetto persistito senza derivazioni", () => {
    const filePath = path.join(process.cwd(), "src/server/queries/concessioni.ts");
    const content = readFileSync(filePath, "utf8");

    expect(content).toContain("statoEffetto: true");
    expect(content).toContain("effettoApplicatoAt: true");
    expect(content).toContain("statoEffetto: concessione.decisioniProcedimento[0].statoEffetto");
    expect(content).toContain("effettoApplicatoAt: concessione.decisioniProcedimento[0].effettoApplicatoAt");
    expect(content).not.toContain(" as (typeof concessione.decisioniProcedimento)[number]");
    expect(content).not.toContain("function deriveDecisionEffectStatus");
    expect(content).not.toContain("statoConcessioneAttuale");
  });

  it("Prisma Client generato espone statoEffetto, effettoApplicatoAt, effectVersion ed enum StatoEffettoProcedimento", () => {
    const modelPath = path.join(process.cwd(), "src/generated/prisma/models/DecisioneProcedimento.ts");
    const enumsPath = path.join(process.cwd(), "src/generated/prisma/enums.ts");
    const model = readFileSync(modelPath, "utf8");
    const enums = readFileSync(enumsPath, "utf8");

    expect(model).toContain("statoEffetto");
    expect(model).toContain("effettoApplicatoAt");
    expect(model).toContain("effectVersion");
    expect(enums).toContain("StatoEffettoProcedimento");
  });

  it("migrazione legacy non classifica automaticamente APPLICATO", () => {
    const filePath = path.join(process.cwd(), "prisma/migrations/20260802_p0d1_stato_effetto/migration.sql");
    const content = readFileSync(filePath, "utf8");

    expect(content).toContain("I record legacy con effetto non sono classificati automaticamente come APPLICATI");
    expect(content).not.toContain("SET\n  \"statoEffetto\" = 'APPLICATO'");
    expect(content).toContain("\"effettoApplicatoAt\" = NULL");
    expect(content).toContain("\"effectVersion\" = 0");
  });
});
