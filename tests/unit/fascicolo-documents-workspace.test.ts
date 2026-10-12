import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FascicoloDocumentsArchive,
  type FascicoloDocumentArchiveItem,
} from "@/components/documents/FascicoloDocumentsArchive";

const documents: FascicoloDocumentArchiveItem[] = [
  {
    id: "doc-1",
    name: "Titolo concessorio",
    type: "Titolo Concessorio",
    typeCode: "TITOLO_CONCESSORIO",
    state: "Caricato",
    isFileAvailable: true,
    documentDate: "15/02/2021",
    acquiredAt: "19/08/2021",
    acquiredAtTimestamp: 1629331200000,
    sender: "Autorità portuale",
    openHref: "/documenti/doc-1/download",
    details: [{ label: "Protocollo", value: "PG/2021/42" }],
  },
  {
    id: "doc-2",
    name: "Ricevuta canone",
    type: "Pagamento",
    typeCode: "PAGAMENTO",
    state: "Caricato",
    isFileAvailable: false,
    acquiredAt: "30/05/2025",
    acquiredAtTimestamp: 1748563200000,
    alert: "Ricevuta PEC da verificare",
    openHref: "/documenti/doc-2/download",
  },
];

function renderArchive(items = documents, withUpload = true): string {
  return renderToStaticMarkup(createElement(FascicoloDocumentsArchive, {
    documents: items,
    uploadForm: withUpload ? createElement("form", null, "Upload") : undefined,
  }));
}

describe("Fascicolo documents workspace", () => {
  it("renders a compact professional archive with primary metadata and actions", () => {
    const html = renderArchive();

    expect(html).toContain("Atti e documenti acquisiti nel fascicolo.");
    expect(html).toContain("2 documenti");
    expect(html).toContain("1 documento da verificare");
    expect(html).toContain("Titolo concessorio");
    expect(html).toContain("Data documento: 15/02/2021");
    expect(html).toContain("Acquisito: 19/08/2021");
    expect(html).toContain("Provenienza: Autorità portuale");
    expect(html).toContain("Apri documento");
    expect(html).toContain("Azioni e dettagli");
  });

  it("omits missing technical metadata instead of printing empty placeholders", () => {
    const html = renderArchive();

    expect(html).not.toContain("Direzione non indicata");
    expect(html).not.toContain("Canale non indicato");
    expect(html).not.toContain("Protocollo non indicato");
    expect(html).not.toContain("Stato tecnico: -");
  });

  it("never links a document without a verified file version", () => {
    const available = renderArchive([documents[0]], false);
    const unavailable = renderArchive([documents[1]], false);

    expect(available).toContain("Apri documento");
    expect(available).not.toContain("Documento non ancora verificato");
    expect(unavailable).not.toContain("Apri documento");
    expect(unavailable).toContain("Documento non ancora verificato");
    expect(unavailable).not.toMatch(/LEGACY_UNVERIFIED|currentFileVersionId|storageKey|checksum|hash/i);
  });

  it("does not forward technical document internals from legacy or intake", () => {
    const legacySource = readFileSync("src/components/documents/EntityDocumentsPanel.tsx", "utf8");
    const intakeSource = readFileSync("src/components/procedimenti/FascicoloIntakeDetail.tsx", "utf8");

    for (const source of [legacySource, intakeSource]) {
      expect(source).not.toContain('{ label: "Stato tecnico"');
      expect(source).not.toContain('{ label: "Conservazione"');
      expect(source).not.toContain('{ label: "Impronta"');
    }
  });

  it("offers useful local filtering, ordering, and a collapsed upload", () => {
    const html = renderArchive();

    expect(html).toContain("Tipologia");
    expect(html).toContain("Tutte le tipologie");
    expect(html).toContain("Più recenti");
    expect(html).toContain("Più vecchi");
    expect(html).toContain("Nome");
    expect(html).toContain("Allega documento");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(">Upload<");
  });

  it("uses the required compact empty state", () => {
    const html = renderArchive([]);

    expect(html).toContain("Nessun documento ancora acquisito.");
    expect(html).toContain("Allega il primo documento");
  });

  it("is shared by legacy and intake without a wide table", () => {
    const archiveSource = readFileSync("src/components/documents/FascicoloDocumentsArchive.tsx", "utf8");
    const detailSource = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");
    const intakeSource = readFileSync("src/components/procedimenti/FascicoloIntakeDetail.tsx", "utf8");

    expect(archiveSource).toContain("md:grid-cols-[minmax(0,1fr)_auto]");
    expect(archiveSource).toContain("w-[min(15rem,calc(100vw-2rem))]");
    expect(archiveSource).toContain("left-0 z-10");
    expect(archiveSource).toContain("md:left-auto md:right-0");
    expect(archiveSource).not.toContain("<Table");
    expect(detailSource).toContain("archiveMode");
    expect(detailSource).toContain('activeSection === "documents"');
    expect(intakeSource).toContain("<FascicoloDocumentsArchive");
    expect(intakeSource).toContain('activeSection === "documents"');
  });
});
