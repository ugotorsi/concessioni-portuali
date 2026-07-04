import { describe, expect, it } from "vitest";

import { getPecReceiptWarning, normalizeProtocolloMetadata, normalizeProtocolloNumber } from "@/server/documents/protocollo";

describe("protocollo metadata utility", () => {
  it("normalizes protocol numbers", () => {
    expect(normalizeProtocolloNumber(" pg/2026/  001 ")).toBe("PG/2026/ 001");
  });

  it("requires message id when channel is PEC", () => {
    expect(() =>
      normalizeProtocolloMetadata({
        canale: "PEC",
        numeroProtocollo: "PG/2026/001",
        dataProtocollo: "2026-03-01",
      }),
    ).toThrow(/Message-ID/i);
  });

  it("computes PEC warning when one receipt is missing", () => {
    const warning = getPecReceiptWarning({
      canale: "PEC",
      pecRicevutaAccettazioneId: "ACC-1",
      pecRicevutaConsegnaId: undefined,
    });

    expect(warning).toBe(true);
  });

  it("rejects protocol date-number mismatch", () => {
    expect(() =>
      normalizeProtocolloMetadata({
        numeroProtocollo: "PG/2026/010",
      }),
    ).toThrow(/Numero e data protocollo/i);
  });
});
