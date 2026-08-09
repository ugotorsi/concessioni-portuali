import { describe, expect, it } from "vitest";

import {
  buildPecReceiptObservationCandidate,
  buildPecReceiptFactsSnapshot,
  isPecReceiptObservationCandidate,
} from "@/server/fascicolo-observations/pecReceiptDetector";

const baseDocument = {
  id: "documento-1",
  procedimentoId: "procedimento-1",
  enteId: "ente-1",
  statoDocumento: "ATTIVO",
  canale: "PEC",
  pecRicevutaAccettazioneId: null,
  pecRicevutaConsegnaId: "consegna-1",
  pecWarningMancataRicevuta: true,
};

describe("PEC receipt observation detector", () => {
  it("creates a document-completeness candidate only for the persisted PEC warning", () => {
    const candidate = buildPecReceiptObservationCandidate(baseDocument, "procedimento-1", "ente-1");

    expect(candidate).toMatchObject({
      documentoId: "documento-1",
      kind: "DOCUMENT_COMPLETENESS",
      ruleCode: "P1-PEC-RECEIPT-001",
      ruleVersion: 1,
      factsSnapshot: {
        canale: "PEC",
        pecRicevutaAccettazioneId: null,
        pecRicevutaConsegnaId: "consegna-1",
        pecWarningMancataRicevuta: true,
      },
    });
  });

  it.each([
    ["warning false", { pecWarningMancataRicevuta: false }],
    ["archived document", { statoDocumento: "ARCHIVIATO" }],
    ["indirect document link", { procedimentoId: "procedimento-2" }],
    ["different tenant", { enteId: "ente-2" }],
  ])("rejects %s", (_label, override) => {
    expect(isPecReceiptObservationCandidate({ ...baseDocument, ...override }, "procedimento-1", "ente-1")).toBe(false);
  });

  it("keeps the facts snapshot limited to detector inputs", () => {
    expect(Object.keys(buildPecReceiptFactsSnapshot(baseDocument)).sort()).toEqual([
      "canale",
      "pecRicevutaAccettazioneId",
      "pecRicevutaConsegnaId",
      "pecWarningMancataRicevuta",
    ]);
  });
});