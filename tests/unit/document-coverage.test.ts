import { describe, expect, it } from "vitest";

import { buildDocumentCoverage } from "@/lib/document-coverage";
import { documentCoverageSummaries, professionalGapSummaries } from "@/lib/professional-text";

const page = (documentoId: string, pageNumber: number, text: string) => ({ documentoId, pageNumber, text });

describe("document coverage", () => {
  it("distinguishes pages missing from the original from pages present without text", () => {
    const excerpts = Array.from({ length: 34 }, (_, index) => {
      const filePage = index + 1;
      return page("doc-1", filePage, `Dossier concessione PAG. ${filePage + 6}\nTesto della pagina ${filePage}.`);
    }).filter((excerpt) => excerpt.pageNumber !== 12);
    const [entry] = buildDocumentCoverage({
      documents: [{ reference: "DOCUMENT_1", documentoId: "doc-1", name: "dossier.pdf", status: "AVAILABLE", pageCount: 34 }],
      excerpts,
    });

    expect(entry!.missingOriginalPages).toEqual([1, 2, 3, 4, 5, 6]);
    expect(entry!.pagesWithoutText).toEqual([12]);
    expect(entry!.textPages).toHaveLength(33);
    expect(entry!.internalNumberingEvidence).toContain("numerazione interna 7");
  });

  it("does not infer missing pages from page references inside the body", () => {
    const longBody = "Premesso che ".repeat(40);
    const [entry] = buildDocumentCoverage({
      documents: [{ reference: "DOCUMENT_1", documentoId: "doc-1", name: "atto.pdf", status: "AVAILABLE", pageCount: 3 }],
      excerpts: [
        page("doc-1", 1, `${longBody} come indicato a pag. 9 del verbale ${longBody}`),
        page("doc-1", 2, `${longBody} si veda la pagina 14 ${longBody}`),
        page("doc-1", 3, "Conclusione senza numerazione."),
      ],
    });
    expect(entry!.missingOriginalPages).toEqual([]);
    expect(entry!.pagesWithoutText).toEqual([]);
  });

  it("requires a consistent numbering before claiming a leading gap", () => {
    const [entry] = buildDocumentCoverage({
      documents: [{ reference: "DOCUMENT_1", documentoId: "doc-1", name: "atto.pdf", status: "AVAILABLE", pageCount: 2 }],
      excerpts: [page("doc-1", 1, "Pag. 5 di 9 introduzione"), page("doc-1", 2, "Pag. 2 di 9 seguito")],
    });
    expect(entry!.missingOriginalPages).toEqual([]);
  });

  it("does not report pages that were read as documentary gaps", () => {
    const coverage = buildDocumentCoverage({
      documents: [{ reference: "DOCUMENT_1", documentoId: "doc-1", name: "dossier.pdf", status: "AVAILABLE", pageCount: 3 }],
      excerpts: [page("doc-1", 1, "Testo"), page("doc-1", 2, "Testo")],
    });
    const gap = (pageNumber: number) => ({
      normalizedText: `Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_1.PAGE_${pageNumber}.`,
    });
    const summaries = professionalGapSummaries([gap(1), gap(2), gap(3), gap(9)], new Map(), coverage);
    const joined = summaries.join("\n");

    expect(joined).not.toMatch(/pagine 1, 2/);
    expect(joined).toContain("la pagina 3 è presente nel file ma priva di testo estraibile");
    expect(joined).toContain("la pagina 9 del documento 1 (dossier.pdf), che non esiste nel file acquisito (3 pagine)");
    expect(documentCoverageSummaries(coverage)).toEqual(["dossier.pdf: 3 pagine nel file, 2 con testo letto; senza testo: pag. 3."]);
  });

  it("keeps the legacy gap wording when no coverage is available", () => {
    const summaries = professionalGapSummaries([
      { normalizedText: "Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_1.PAGE_4." },
    ]);
    expect(summaries.join(" ")).toContain("pag");
    expect(summaries).toHaveLength(1);
  });

  it("states that unavailable documents cannot prove the absence of facts", () => {
    const coverage = buildDocumentCoverage({
      documents: [{ reference: "DOCUMENT_2", documentoId: "doc-2", name: "scansione.pdf", status: "OCR_REQUIRED", pageCount: 0 }],
      excerpts: [],
    });
    expect(professionalGapSummaries([], new Map(), coverage)[0]).toContain("non può esserne dedotta l'assenza di fatti rilevanti");
  });
});
