import { describe, expect, it } from "vitest";

import {
  getArt47Description,
  getArt47Label,
  getRischioDecadenzaBadgeVariant,
  getRischioDecadenzaLabel,
  inferArt47FromCriticitaTipologia,
} from "@/lib/art47";

describe("art47 helpers", () => {
  it("restituisce label e descrizione per lettera nota", () => {
    expect(getArt47Label("D_OMESSO_PAGAMENTO_CANONE")).toContain("Lettera d");
    expect(getArt47Description("D_OMESSO_PAGAMENTO_CANONE")).toContain("canoni");
  });

  it("gestisce valori nulli", () => {
    expect(getArt47Label(null)).toBe("-");
    expect(getArt47Description(undefined)).toContain("Nessuna");
    expect(getRischioDecadenzaLabel(null)).toBe("-");
    expect(getRischioDecadenzaBadgeVariant(undefined)).toBe("default");
  });

  it("calcola variante badge rischio", () => {
    expect(getRischioDecadenzaBadgeVariant("BASSO")).toBe("success");
    expect(getRischioDecadenzaBadgeVariant("MEDIO")).toBe("warning");
    expect(getRischioDecadenzaBadgeVariant("ALTO")).toBe("danger");
    expect(getRischioDecadenzaBadgeVariant("CRITICO")).toBe("danger");
  });

  it("fornisce inferenza assistiva per morosita", () => {
    const inferred = inferArt47FromCriticitaTipologia("MOROSITA");

    expect(inferred.suggestedLettera).toBe("D_OMESSO_PAGAMENTO_CANONE");
    expect(inferred.suggestedRischio).toBe("ALTO");
    expect(inferred.reason).toContain("assistivo");
  });
});
