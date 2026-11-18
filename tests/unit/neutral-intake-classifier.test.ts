import { describe, expect, it } from "vitest";

import {
  classifyNeutralIntakeEvidenceV1,
  type NeutralIntakeClassificationProjection,
} from "@/server/intake/classification/classifier";

function projection(text: string, overrides: Partial<NeutralIntakeClassificationProjection> = {}) {
  return {
    pageCount: 2,
    normalizedCharacterCount: text.length,
    beginningText: text,
    endingText: text,
    headingLines: text.split("\n").slice(0, 20),
    extractionQualityInsufficient: false,
    ...overrides,
  };
}

describe("NeutralIntake local document-nature classifier v1", () => {
  it("classifies a genuine general regulation as a legal-source candidate", () => {
    const text = "REGOLAMENTO PER L'USO DEL PORTO\nDISPOSIZIONI GENERALI\nARTICOLO 1 Oggetto\nARTICOLO 2 Ambito\nARTICOLO 3 Obblighi\nENTRATA IN VIGORE dalla pubblicazione.";
    expect(classifyNeutralIntakeEvidenceV1(projection(text))).toMatchObject({
      outcome: "LEGAL_SOURCE_CANDIDATE",
      reasonCodes: ["SELF_IDENTIFIES_REGULATION", "GENERAL_NORMATIVE_STRUCTURE"],
    });
  });

  it.each([
    ["TAR", "TRIBUNALE AMMINISTRATIVO REGIONALE DEL LAZIO\nSENTENZA\nREPUBBLICA ITALIANA\nIN NOME DEL POPOLO ITALIANO\nLa controversia viene decisa nel merito con motivazione completa.\nP.Q.M. il Tribunale accoglie il ricorso."],
    ["TRIBUNALE", "TRIBUNALE DI ROMA\nSENTENZA\nREPUBBLICA ITALIANA\nIN NOME DEL POPOLO ITALIANO\nLa controversia viene decisa nel merito con motivazione completa.\nP.Q.M. il Tribunale rigetta la domanda."],
    ["CONSIGLIO DI STATO", "CONSIGLIO DI STATO\nSENTENZA\nREPUBBLICA ITALIANA\nIN NOME DEL POPOLO ITALIANO\nLa controversia viene decisa nel merito con motivazione completa.\nP.Q.M. il Consiglio accoglie l'appello."],
    ["CASSAZIONE SENTENZA", "CORTE SUPREMA DI CASSAZIONE\nSENTENZA\nREPUBBLICA ITALIANA\nIN NOME DEL POPOLO ITALIANO\nMotivazione della decisione sul ricorso proposto dalle parti nel giudizio.\nP.Q.M. la Corte rigetta il ricorso."],
    ["CASSAZIONE ORDINANZA", "CORTE SUPREMA DI CASSAZIONE\nORDINANZA\nREPUBBLICA ITALIANA\nLa Corte esamina il ricorso, i motivi e le difese delle parti e decide definitivamente la controversia.\nP.Q.M. rigetta il ricorso e condanna alle spese."],
    ["CORTE COSTITUZIONALE", "SENTENZA N. 10\nREPUBBLICA ITALIANA\nIN NOME DEL POPOLO ITALIANO\nLA CORTE COSTITUZIONALE\nNel giudizio di legittimità costituzionale, esaminati gli atti e le deduzioni, decide la questione.\nPER QUESTI MOTIVI dichiara la questione non fondata."],
    ["CORTE DEI CONTI", "SENTENZA N. 25/2026\nREPUBBLICA ITALIANA\nIN NOME DEL POPOLO ITALIANO\nLA CORTE DEI CONTI\nSEZIONE GIURISDIZIONALE\nNel giudizio di responsabilità, esaminati gli atti e le difese, decide nel merito.\nP.Q.M. condanna il convenuto al pagamento."],
  ])("classifies a genuine %s decision as a legal-source candidate", (_name, text) => {
    expect(classifyNeutralIntakeEvidenceV1(projection(text))).toMatchObject({
      outcome: "LEGAL_SOURCE_CANDIDATE",
      reasonCodes: ["JUDICIAL_DECISION_STRUCTURE"],
    });
  });

  it("keeps a citation-heavy pleading as a case document", () => {
    const ricorso = "RICORSO\nPer la società ricorrente. Si richiama Consiglio di Stato, sentenza n. 42/2024, e se ne discute il P.Q.M. La parte cita gli articoli 1, 2 e 3 e chiede l'annullamento dell'atto impugnato.";
    expect(classifyNeutralIntakeEvidenceV1(projection(ricorso))).toMatchObject({ outcome: "CASE_DOCUMENT", reasonCodes: ["CASE_FILING_STRUCTURE"] });
    const memoria = "MEMORIA\nPer la parte resistente. Si richiama Corte di Cassazione, sentenza n. 90/2025, con citazione degli articoli di legge e del passaggio conclusivo P.Q.M. La parte conclude per il rigetto del ricorso.";
    expect(classifyNeutralIntakeEvidenceV1(projection(memoria))).toMatchObject({ outcome: "CASE_DOCUMENT", reasonCodes: ["CASE_FILING_STRUCTURE"] });
  });

  it("treats a specific concession determination as a case document", () => {
    const text = "DETERMINAZIONE N. 18\nProcedimento relativo alla società Alfa, concessionario dell'area portuale. Si autorizza il pagamento e si rilascia la specifica concessione richiesta.";
    expect(classifyNeutralIntakeEvidenceV1(projection(text))).toMatchObject({ outcome: "CASE_DOCUMENT", reasonCodes: ["SPECIFIC_ADMINISTRATIVE_ACT"] });
    const ordinance = "ORDINANZA N. 9\nAlla società Alfa concessionario dell'area. Si ordina il pagamento della sanzione relativa al procedimento specifico e si dispone la notifica all'interessato.";
    expect(classifyNeutralIntakeEvidenceV1(projection(ordinance)).outcome).not.toBe("LEGAL_SOURCE_CANDIDATE");
  });

  it.each([
    ["CONTRATTO", "CONTRATTO DI SERVIZI\nTRA la società Alfa e la società Beta, le parti convengono e stipulano quanto segue per la durata indicata nel presente documento."],
    ["CORRESPONDENCE", "PEC\nMittente: ufficio@example.it\nDestinatario: societa@example.it\nOggetto: richiesta integrazione documentale nel procedimento amministrativo in corso."],
  ])("classifies %s as a case document", (_name, text) => {
    expect(classifyNeutralIntakeEvidenceV1(projection(text))).toMatchObject({ outcome: "CASE_DOCUMENT" });
  });

  it("fails insufficient or poor-quality evidence toward review", () => {
    expect(classifyNeutralIntakeEvidenceV1(projection("testo breve"))).toMatchObject({ outcome: "UNCERTAIN_REVIEW_REQUIRED", reasonCodes: ["INSUFFICIENT_EVIDENCE"] });
    expect(classifyNeutralIntakeEvidenceV1(projection("testo ambiguo ".repeat(20), { extractionQualityInsufficient: true }))).toMatchObject({ outcome: "UNCERTAIN_REVIEW_REQUIRED", reasonCodes: ["EXTRACTION_QUALITY_INSUFFICIENT"] });
  });

  it("fails conflicting strong document forms toward review", () => {
    const text = "REGOLAMENTO GENERALE\nMEMORIA\nPer la parte ricorrente nel procedimento, con disposizioni generali. ARTICOLO 1. ARTICOLO 2. ARTICOLO 3. ENTRATA IN VIGORE.";
    expect(classifyNeutralIntakeEvidenceV1(projection(text))).toMatchObject({ outcome: "UNCERTAIN_REVIEW_REQUIRED", reasonCodes: ["MIXED_STRONG_SIGNALS"] });
  });

  it("does not accept public-authority or channel provenance as classification input", () => {
    const ambiguous = projection("Documento dell'autorità portuale con protocollo ufficiale relativo a una pratica specifica, privo di una forma documentale conclusiva o di struttura normativa.");
    const withIgnoredProvenance = { ...ambiguous, ingressChannel: "official-web", provider: "public-authority" };
    expect(classifyNeutralIntakeEvidenceV1(withIgnoredProvenance)).toEqual(classifyNeutralIntakeEvidenceV1(ambiguous));
    expect(classifyNeutralIntakeEvidenceV1(ambiguous).outcome).toBe("UNCERTAIN_REVIEW_REQUIRED");
  });
});