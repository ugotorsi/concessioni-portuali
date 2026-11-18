import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("verticali workspace UX", () => {
  it("renders configured verticals with real read-model counts", () => {
    const page = readSource("src/app/verticali/page.tsx");
    const query = readSource("src/server/queries/verticali.ts");

    expect(page).toContain("verticali.map((item)");
    expect(page).toContain("item.concessioniCount");
    expect(page).toContain("item.fascicoliCount");
    expect(query).toContain("VERTICALI_CONFIG.map");
    expect(page).not.toContain('href="/verticali/patrimonio-immobiliare-pubblico"');
    expect(page).toContain("Ambito previsto dalla roadmap");
    expect(page).not.toContain("Perimetro configurato");
  });

  it("keeps concession actions fascicolo-first without choosing among multiple files", () => {
    const page = readSource("src/app/verticali/[verticale]/page.tsx");

    expect(page).toContain("item.fascicoli.length === 1");
    expect(page).toContain('href={`/procedimenti/${item.fascicoli[0].id}`}');
    expect(page).toContain("item.fascicoli.length > 1");
    expect(page).toContain("item.fascicoli.map((fascicolo)");
    expect(page).toContain('href={`/procedimenti/${fascicolo.id}`}');
    expect(page).toContain("item.fascicoli.length === 0");
    expect(page).toContain('href={`/concessioni/${item.id}`}');
    expect(page).toContain("Nessun fascicolo collegato");
    expect(page).not.toContain("ID tecnico");
  });

  it("labels unfiltered destinations as general navigation", () => {
    const page = readSource("src/app/verticali/[verticale]/page.tsx");

    for (const label of [
      "Apri tutti i documenti",
      "Apri tutti i rapporti",
      "Apri tutte le criticita",
      "Apri tutte le scadenze",
      "Apri tutti i fascicoli",
    ]) {
      expect(page).toContain(label);
    }
    expect(page).toContain("non sono filtrati per questa verticale");
    expect(page).not.toContain("report del perimetro");
    expect(page).not.toContain("tenant");
    expect(page).not.toContain("<Table");
  });
});