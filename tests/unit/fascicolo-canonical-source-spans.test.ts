import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildCanonicalSourceSpans } from "@/server/fascicolo-knowledge/canonicalStructuredPersistence";
import type {
  KnowledgeEvidenceCandidate,
  KnowledgeItemKind,
  PreparedKnowledgeItemCandidate,
} from "@/server/fascicolo-knowledge/contracts";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const basisRef = "DOCUMENT_1.PAGE_1";

function candidate(
  kind: KnowledgeItemKind,
  normalizedText: string,
  sourceText: string,
  quote = normalizedText,
): PreparedKnowledgeItemCandidate {
  const evidence: KnowledgeEvidenceCandidate = {
    provenanceType: "FASCICOLO_DOCUMENT_EXTRACTION",
    documentoId: "document-1",
    documentFileVersionId: "version-1",
    documentExtractionAttemptId: "attempt-1",
    pageNumber: 1,
    textSha256: digest(sourceText),
    quoteSha256: null,
    basisRef,
  };
  return {
    kind,
    normalizedIdentity: normalizedText,
    normalizedText,
    structuredPayload: {
      sourceQuotes: [{ basisRef, quote }],
    },
    confidence: 90,
    evidence: [evidence],
    semanticKey: digest(`semantic:${kind}:${normalizedText}`),
    semanticKeyVersion: "V1",
    contentFingerprint: digest(`content:${kind}:${normalizedText}`),
  };
}

describe("canonical source spans", () => {
  it.each(["FACT", "EVENT"] as const)(
    "persists an authentic, unique %s quotation against the original source text",
    (kind) => {
      const sourceText = "Il  provvedimento dispone la sospensione immediata.";
      const quote = "dispone la sospensione immediata";
      const semanticDescription = "Il provvedimento ha disposto con effetto immediato la sospensione.";

      expect(buildCanonicalSourceSpans(
        candidate(kind, semanticDescription, sourceText, quote),
        new Map([[basisRef, sourceText]]),
      )).toEqual([{
        basisRef,
        startOffset: sourceText.indexOf(quote),
        endOffset: sourceText.indexOf(quote) + quote.length,
        quote,
        quoteSha256: digest(quote),
      }]);
    },
  );

  it("rejects a normalized source representation whose digest is not the extraction digest", () => {
    const sourceText = "Il  provvedimento dispone la sospensione immediata.";
    const normalizedText = "Il provvedimento dispone la sospensione immediata.";
    const item = candidate(
      "FACT",
      "Il provvedimento sospende immediatamente gli effetti.",
      sourceText,
      "dispone la sospensione immediata",
    );

    expect(() => buildCanonicalSourceSpans(
      item,
      new Map([[basisRef, normalizedText]]),
    )).toThrow(`CANONICAL_SOURCE_TEXT_HASH_MISMATCH:${basisRef}`);
  });

  it.each([
    ["assente", "Il provvedimento dispone la sospensione.", "ordina la sospensione"],
    ["ambigua", "Sospensione disposta. Sospensione disposta.", "Sospensione disposta"],
  ])("rejects an %s quotation instead of fabricating a source span", (_case, sourceText, quote) => {
    expect(() => buildCanonicalSourceSpans(
      candidate("FACT", "Ricostruzione semantica distinta.", sourceText, quote),
      new Map([[basisRef, sourceText]]),
    )).toThrow(/CANONICAL_ITEM_SOURCE_QUOTE_REQUIRED/);
  });

  it.each(["PARTY_POSITION", "LEGAL_ACT", "LEGAL_ISSUE"] as const)(
    "requires a punctual quotation for %s instead of treating the whole page as a quote",
    (kind) => {
      const sourceText = "Testo completo della pagina.";
      const item = candidate(kind, "Descrizione giuridica", sourceText, "");

      expect(() => buildCanonicalSourceSpans(
        item,
        new Map([[basisRef, sourceText]]),
      )).toThrow(/CANONICAL_ITEM_SOURCE_QUOTE_REQUIRED/);
    },
  );

  it("rejects the whole page as a generic quotation", () => {
    const sourceText = "Testo completo della pagina.";

    expect(() => buildCanonicalSourceSpans(
      candidate("LEGAL_ISSUE", "Questione giuridica ricostruita.", sourceText, sourceText),
      new Map([[basisRef, sourceText]]),
    )).toThrow(/CANONICAL_ITEM_SOURCE_QUOTE_REQUIRED/);
  });

  it.each(["PARTY_POSITION", "LEGAL_ACT", "LEGAL_ISSUE", "RESEARCH_QUESTION"] as const)(
    "accepts %s only with its explicit punctual quotation",
    (kind) => {
      const sourceText = "Il concessionario dichiara che l'area e stata liberata.";
      const quote = "l'area e stata liberata";
      const spans = buildCanonicalSourceSpans(
        candidate(kind, "Ricostruzione giuridica distinta dalla prova testuale.", sourceText, quote),
        new Map([[basisRef, sourceText]]),
      );

      expect(spans).toEqual([expect.objectContaining({
        basisRef,
        quote,
        quoteSha256: digest(quote),
      })]);
      expect(spans[0].quote).not.toBe(sourceText);
    },
  );
});
