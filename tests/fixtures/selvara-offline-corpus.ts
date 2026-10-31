import extraction from "./selvara-offline-extraction.json";
import type { DocumentInventoryEntry } from "@/server/fascicolo-knowledge/structuredContracts";

const PDF_SHA256 = "644e04331c5482d28729b2efd91798b404da9940cc4487ee36ad056167c2741c";
const HASH_SCOPE = "OFFLINE_PDFJS_TEXT_NOT_NEON_CANONICAL";

if (extraction.sourcePdfSha256 !== PDF_SHA256 || extraction.pageCount !== 40) {
  throw new Error("SELVARA_OFFLINE_CORPUS_INTEGRITY_MISMATCH");
}

if (extraction.pages.some((page) => page.hashScope !== HASH_SCOPE)) {
  throw new Error("SELVARA_OFFLINE_PAGE_HASH_SCOPE_MISMATCH");
}

export const selvaraOfflineCorpusMetadata = {
  sourcePdfSha256: PDF_SHA256,
  pageCount: 40,
  extractionMethod: extraction.extraction,
  pageHashScope: HASH_SCOPE,
  canonicalNeonTextHashesAvailable: false,
} as const;

export const selvaraOfflinePages = extraction.pages.map((page) => ({
  pageNumber: page.pageNumber,
  reference: `DOCUMENT_1.PAGE_${page.pageNumber}`,
  text: page.text,
  offlineTextSha256: page.offlineTextSha256,
  hashScope: page.hashScope,
}));

const pageText = (pageNumber: number) => {
  const page = selvaraOfflinePages[pageNumber - 1];
  if (!page || page.pageNumber !== pageNumber) throw new Error(`SELVARA_PAGE_MISSING:${pageNumber}`);
  return page.text;
};

const exactQuote = (pageNumber: number, start: string, end = start) => {
  const text = pageText(pageNumber);
  const startIndex = text.indexOf(start);
  const duplicateIndex = text.indexOf(start, startIndex + start.length);
  const endIndex = startIndex < 0 ? -1 : text.indexOf(end, startIndex);
  if (startIndex < 0 || duplicateIndex >= 0 || endIndex < startIndex) {
    throw new Error(`SELVARA_EXACT_QUOTE_NOT_UNIQUE:PAGE_${pageNumber}:${start}`);
  }
  return text.slice(startIndex, endIndex + end.length);
};

const item = (
  localId: string,
  kind: string,
  pageNumber: number,
  payload: Record<string, unknown>,
) => ({
  localId,
  kind,
  confidence: 90,
  basisRefs: [`DOCUMENT_1.PAGE_${pageNumber}`],
  payload,
});

const sourceQuotes: Array<{ itemLocalId: string; basisRef: string; quote: string }> = [];
const quotedItem = (
  localId: string,
  kind: string,
  pageNumber: number,
  payload: Record<string, unknown>,
  start: string,
  end = start,
) => {
  sourceQuotes.push({
    itemLocalId: localId,
    basisRef: `DOCUMENT_1.PAGE_${pageNumber}`,
    quote: exactQuote(pageNumber, start, end),
  });
  return item(localId, kind, pageNumber, payload);
};

const unknownReferenceDate = (rationale: string) => ({
  type: "UNKNOWN",
  itemLocalId: null,
  rationale,
  userConfirmedDateSource: null,
});

export const selvaraOfflineStructuredKnowledge = {
  version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
  subjects: [{
    localId: "subject-concessionaria",
    canonicalName: "Terminal Selvara Logistica S.r.l.",
    subjectType: "ORGANIZATION",
    strongIdentifiers: [],
    aliases: ["TLS"],
  }, {
    localId: "subject-authority",
    canonicalName: "AdSP del Golfo di Selvara",
    subjectType: "PUBLIC_ADMINISTRATION",
    strongIdentifiers: [],
    aliases: ["AdSP", "Autorita concedente"],
  }, {
    localId: "subject-third-operator",
    canonicalName: "Magazzini Levante S.r.l.",
    subjectType: "ORGANIZATION",
    strongIdentifiers: [],
    aliases: ["Magazzini Levante"],
  }],
  items: [
    quotedItem("role-concessionaria", "PARTY_ROLE", 7, {
      subjectLocalId: "subject-concessionaria",
      role: "concessionaria",
      context: "concessione demaniale marittima n. 17/2023",
    }, "Atto di concessione demaniale marittima n. 17/2023", "A: Terminal Selvara Logistica S.r.l."),
    quotedItem("role-authority", "PARTY_ROLE", 7, {
      subjectLocalId: "subject-authority",
      role: "autorita concedente e vigilante",
      context: "concessione demaniale marittima n. 17/2023",
    }, "DA: AdSP del Golfo di Selvara"),
    quotedItem("act-concession", "LEGAL_ACT", 7, {
      documentBasisRef: "DOCUMENT_1.PAGE_7",
      actType: "concessione demaniale marittima",
      proceduralRole: null,
      authoritySubjectLocalId: "subject-authority",
      number: "17/2023",
      date: {
        precision: "EXACT",
        from: "2023-07-14",
        to: null,
        originalText: "14/07/2023",
        confidence: 100,
      },
      title: "Atto di concessione demaniale marittima n. 17/2023",
      declaredEffects: [
        "Uso del fronte banchina B4, del piazzale R4 e del magazzino M4",
        "Durata dal 1 agosto 2023 al 31 luglio 2035",
        "Canone annuo iniziale euro 192.000,00",
      ],
    }, "Atto di concessione demaniale marittima n. 17/2023", "ART. 7 - SICUREZZA E AMBIENTE."),
    quotedItem("fact-title-duration", "FACT", 7, {
      normalizedStatement: "La concessione decorre dal 1 agosto 2023 e scade il 31 luglio 2035, senza rinnovo tacito.",
      subjectLocalIds: ["subject-concessionaria", "subject-authority"],
      object: "durata della concessione",
      qualifier: "titolo concessorio",
    }, "ART. 3 - DURATA.", "decadenza consentiti dalla legge."),
    quotedItem("fact-canone", "FACT", 7, {
      normalizedStatement: "Il canone annuo iniziale e pari a euro 192.000,00, in quattro rate anticipate da euro 48.000.",
      subjectLocalIds: ["subject-concessionaria"],
      object: "canone concessorio",
      qualifier: "titolo concessorio",
    }, "ART. 4 - CANONE.", "separato conteggio."),
    quotedItem("fact-investment-program", "FACT", 4, {
      normalizedStatement: "Il programma vincolante I1-I4 ammonta a euro 1.500.000 e reca scadenze tra il 30 settembre 2024 e il 31 dicembre 2025.",
      subjectLocalIds: ["subject-concessionaria"],
      object: "programma investimenti I1-I4",
      qualifier: "piano industriale",
    }, "Programma investimenti vincolante:", "Totale euro 1.500.000."),
    quotedItem("deadline-i1-i4", "DEADLINE_CANDIDATE", 9, {
      deadlineType: "EXPLICIT_DATE",
      baseDate: null,
      resultingDate: {
        precision: "INTERVAL",
        from: "2024-09-30",
        to: "2025-12-31",
        originalText: "scadenze I1-I4",
        confidence: 100,
      },
      ruleText: "I1 entro il 30 settembre 2024; I2 entro il 31 dicembre 2024; I3 entro il 30 giugno 2025; I4 entro il 31 dicembre 2025.",
      calculationExplanation: "Date espresse nel disciplinare; ordini e fatture non provano l'entrata in funzione.",
    }, "2. MILESTONE.", "Ordini e fatture, da soli, non provano l'entrata in funzione."),
    quotedItem("event-m1-service", "EVENT", 14, {
      title: "Messa in servizio dichiarata della gru M1",
      normalizedStatement: "La gru M1, arrivata il 27 dicembre 2024, e dichiarata disponibile operativamente dal 9 gennaio 2025.",
      date: {
        precision: "EXACT",
        from: "2025-01-09",
        to: null,
        originalText: "9 gennaio 2025",
        confidence: 100,
      },
      subjectLocalIds: ["subject-concessionaria"],
      relatedItemLocalIds: ["fact-investment-program", "deadline-i1-i4"],
    }, "Arrivo al terminal", "Dal 9 gennaio 2025"),
    quotedItem("gap-m2", "GAP", 22, {
      gapType: "M2_NOT_DELIVERED",
      description: "L'ordine M2 reca una previsione del fornitore non vincolante al 31 dicembre 2026; consegna e messa in servizio non sono attestate.",
      impact: "L'adempimento I3 non risulta provato e la scadenza concessoria non risulta modificata.",
      relatedItemLocalIds: ["fact-investment-program", "deadline-i1-i4"],
    }, "Ordine M2", "Messa in servizio   Nessun verbale"),
    quotedItem("position-i1-complete", "PARTY_POSITION", 15, {
      subjectLocalId: "subject-concessionaria",
      positionType: "CLAIM",
      normalizedStatement: "La concessionaria dichiara I1 ultimato nel dicembre 2024, con certificazioni ancora in raccolta.",
      context: "rendiconto gestionale 2024",
      relatedItemLocalIds: ["fact-investment-program"],
    }, "I1   Impianto dichiarato ultimato nel dicembre 2024; certificazioni in raccolta"),
    quotedItem("gap-i1-certification", "GAP", 29, {
      gapType: "I1_FINAL_VERIFICATION_MISSING",
      description: "La verifica del 2026 rileva 16 punti luce su 18, una dichiarazione parziale e nessun verbale finale I1.",
      impact: "La completa entrata in funzione e la conformita dell'intera rete non sono verificabili.",
      relatedItemLocalIds: ["position-i1-complete", "fact-investment-program"],
    }, "Punti luce esterni", "Non verificabile in questo fascicolo"),
    quotedItem("contradiction-i1", "CONTRADICTION", 29, {
      description: "La dichiarazione aziendale di ultimazione di I1 contrasta con i due punti luce mancanti e con l'assenza del verbale finale rilevati nel 2026.",
      conflictingItemLocalIds: ["position-i1-complete", "gap-i1-certification"],
    }, "Punti luce esterni", "Non verificabile in questo fascicolo"),
    quotedItem("gap-i4", "GAP", 31, {
      gapType: "I4_INCOMPLETE_AND_UNVERIFIED",
      description: "Ad agosto 2026 il separatore di prima pioggia non risulta installato e il collaudo funzionale non risulta eseguito.",
      impact: "L'adempimento I4 e i presupposti ambientali richiedono istruttoria tecnica e documentale.",
      relatedItemLocalIds: ["fact-investment-program", "deadline-i1-i4"],
    }, "Trincea in area drenante", "Collaudo funzionale   Intero intervento   Non eseguito"),
    quotedItem("fact-third-party-service", "FACT", 16, {
      normalizedStatement: "Magazzini Levante svolge attivita con proprio personale e attrezzature in una porzione stabile di 180 m2 del magazzino M4.",
      subjectLocalIds: ["subject-concessionaria", "subject-third-operator"],
      object: "servizio logistico e uso di M4",
      qualifier: "contratto privato",
    }, "ART. 1 - Oggetto.", "per l’intera\ndurata contrattuale."),
    quotedItem("gap-third-party-authorization", "GAP", 16, {
      gapType: "PUBLIC_AUTHORIZATION_NOT_ATTACHED",
      description: "Al contratto non e allegato un assenso espresso dell'ente concedente.",
      impact: "La qualificazione del rapporto come servizio, affidamento operativo o subconcessione e la sua legittimita pubblicistica restano da accertare.",
      relatedItemLocalIds: ["fact-third-party-service"],
    }, "Non è allegato alcun assenso espresso dell’ente concedente."),
    quotedItem("position-repayment", "PARTY_POSITION", 18, {
      subjectLocalId: "subject-concessionaria",
      positionType: "REQUEST",
      normalizedStatement: "La concessionaria propone un ripiano del residuo della seconda rata 2025 e prospetta una compensazione per lavori straordinari.",
      context: "proposta aziendale non assentita dal creditore",
      relatedItemLocalIds: ["fact-canone"],
    }, "La società riconosce il pagamento parziale", "L’ufficio contabile aziendale annota che le scadenze originarie restano registrate nel proprio ERP."),
    quotedItem("gap-canone-reconciliation", "GAP", 36, {
      gapType: "TREASURY_RECONCILIATION_MISSING",
      description: "L'estratto aziendale non e certificazione della Tesoreria e non prova imputazione, interessi, aggiornamenti o pagamenti successivi.",
      impact: "L'esatta esposizione debitoria deve essere ricostruita dall'ufficio competente prima di contestazioni o misure.",
      relatedItemLocalIds: ["fact-canone", "position-repayment"],
    }, "Il tracciato movimenti_canoni.csv", "riscontro\ndella Tesoreria."),
    quotedItem("fact-traffic-shortfall", "FACT", 35, {
      normalizedStatement: "I totali gestionali sono 108.400 t per il 2024 e 125.600 t per il 2025 e includono trasferimenti interni non autonomamente probatori di traffici marittimi.",
      subjectLocalIds: ["subject-concessionaria"],
      object: "traffici-obiettivo",
      qualifier: "estratto gestionale non certificato",
    }, "Il file registri_movimentazione.csv", "rilevanza ai fini dell’obiettivo\nconcessorio."),
    quotedItem("gap-structural-loads", "GAP", 28, {
      gapType: "STRUCTURAL_CAPACITY_NOT_ATTESTED",
      description: "La portanza attuale di B4 non e attestata; il valore storico di 40 kN/m2 non autorizza qualsiasi combinazione di carichi.",
      impact: "Prima di nuove installazioni occorrono elaborati aggiornati, carichi puntuali e verifiche specialistiche.",
      relatedItemLocalIds: ["event-m1-service", "gap-m2"],
    }, "Banchina B4", "carichi puntuali e verifiche\ntecniche."),
    quotedItem("gap-safety", "GAP", 32, {
      gapType: "SAFETY_AND_INTERFERENCE_RECORDS_INCOMPLETE",
      description: "Il fascicolo non mostra aggiornamento del DVR per il nuovo operatore e registra formazione e coordinamento incompleti.",
      impact: "La concreta qualificazione degli affidamenti e delle interferenze richiede sopralluogo e acquisizione degli atti aggiornati.",
      relatedItemLocalIds: ["fact-third-party-service"],
    }, "DVR aziendale", "richiede sopralluogo e acquisizione\ndegli atti aggiornati."),
    quotedItem("gap-environment", "GAP", 33, {
      gapType: "ENVIRONMENTAL_EVIDENCE_INSUFFICIENT",
      description: "Il campione isolato e la documentazione disponibile non provano conformita o inquinamento dello scarico.",
      impact: "Occorrono identificazione dello scarico, disciplina territoriale, autorizzazioni e tracciabilita del campionamento.",
      relatedItemLocalIds: ["gap-i4"],
    }, "Punto scarico S-A", "superamenti di limiti di legge."),
    quotedItem("event-area-observations", "EVENT", 34, {
      title: "Rilievo privato delle aree V1, A1, Z2 e M4",
      normalizedStatement: "Nel 2026 V1, A1 e Z2 risultano liberi nel sopralluogo privato, mentre in M4 sono rilevati personale terzo e area segnata di 180 m2.",
      date: {
        precision: "EXACT",
        from: "2026-09-10",
        to: null,
        originalText: "10 settembre 2026",
        confidence: 100,
      },
      subjectLocalIds: ["subject-concessionaria", "subject-third-operator"],
      relatedItemLocalIds: ["fact-third-party-service"],
    }, "V1   Circa 18 m impegnati", "monitoraggio\ncontinuativo."),
    quotedItem("gap-evidentiary-status", "GAP", 40, {
      gapType: "ORIGINAL_PHOTOGRAPHS_NOT_AVAILABLE",
      description: "Il corpus contiene descrizioni delle fotografie, non gli originali, e le date non hanno attestazione forense.",
      impact: "Le descrizioni non sostituiscono sopralluogo qualificato, verifica degli originali o inventario.",
      relatedItemLocalIds: ["event-area-observations", "gap-structural-loads"],
    }, "Per ragioni didattiche sono disponibili descrizioni", "sopralluogo qualificato."),
    quotedItem("deadline-concession-expiry", "DEADLINE_CANDIDATE", 7, {
      deadlineType: "EXPLICIT_DATE",
      baseDate: {
        precision: "EXACT",
        from: "2023-08-01",
        to: null,
        originalText: "1 agosto 2023",
        confidence: 100,
      },
      resultingDate: {
        precision: "EXACT",
        from: "2035-07-31",
        to: null,
        originalText: "31 luglio 2035",
        confidence: 100,
      },
      ruleText: "Il rapporto scade il 31 luglio 2035 senza rinnovo tacito.",
      calculationExplanation: "Data espressa nel titolo.",
    }, "ART. 3 - DURATA.", "senza rinnovo\ntacito."),
  ],
  documentInventory: [] as DocumentInventoryEntry[],
  legalIssues: [{
    localId: "issue-canoni",
    title: "Canoni, imputazione dei pagamenti e proposta di ripiano",
    normalizedIssue: "Ricostruire le rate, i pagamenti, l'imputazione di Tesoreria e l'eventuale residuo prima di valutare la proposta di ripiano.",
    areaOfLaw: "concessioni demaniali e contabilita pubblica",
    priority: "HIGH",
    rationale: "Il titolo fissa rate da euro 48.000; risultano pagamenti parziali e un estratto aziendale non certificato.",
    originatingItemLocalIds: ["fact-canone", "position-repayment", "gap-canone-reconciliation"],
    confidence: 95,
    referenceDateBasis: null,
  }, {
    localId: "issue-investments",
    title: "Adempimento del programma investimenti I1-I4",
    normalizedIssue: "Verificare tempestivita, completezza, certificazioni e accettazione di eventuali riprogrammazioni per I1-I4.",
    areaOfLaw: "rapporto concessorio e istruttoria tecnica",
    priority: "HIGH",
    rationale: "M1 risulta operativa dopo la scadenza, M2 non consegnata, I1 non certificato integralmente e I4 incompleto.",
    originatingItemLocalIds: ["fact-investment-program", "event-m1-service", "gap-m2", "contradiction-i1", "gap-i4"],
    confidence: 95,
    referenceDateBasis: null,
  }, {
    localId: "issue-third-party",
    title: "Rapporto con Magazzini Levante e uso del magazzino M4",
    normalizedIssue: "Qualificare l'effettivo rapporto e verificare i titoli pubblicistici senza presumere automaticamente una subconcessione.",
    areaOfLaw: "concessioni demaniali e operazioni portuali",
    priority: "HIGH",
    rationale: "Il contratto assegna stabilmente 180 m2 e attivita a personale terzo, ma non reca assenso espresso dell'ente.",
    originatingItemLocalIds: ["fact-third-party-service", "gap-third-party-authorization", "event-area-observations", "gap-safety"],
    confidence: 95,
    referenceDateBasis: null,
  }, {
    localId: "issue-technical-safety",
    title: "Portanza, mezzi, impianto elettrico e sicurezza",
    normalizedIssue: "Accertare la capacita strutturale e la sicurezza operativa mediante documenti e verifiche specialistiche prima di prescrizioni definitive.",
    areaOfLaw: "sicurezza, tecnica e vigilanza concessoria",
    priority: "HIGH",
    rationale: "La relazione privata non attesta la portanza, I1 e incompleto e la documentazione sulle interferenze presenta lacune.",
    originatingItemLocalIds: ["gap-structural-loads", "gap-i1-certification", "gap-safety", "gap-evidentiary-status"],
    confidence: 90,
    referenceDateBasis: null,
  }, {
    localId: "issue-environment",
    title: "Drenaggio, scarico e documentazione ambientale",
    normalizedIssue: "Verificare completamento I4, titolo allo scarico, progetto approvato, gestione rifiuti e attendibilita del campionamento.",
    areaOfLaw: "ambiente e obblighi concessori",
    priority: "HIGH",
    rationale: "Il separatore non risulta installato e il campione isolato non consente conclusioni di conformita o illecito.",
    originatingItemLocalIds: ["gap-i4", "gap-environment"],
    confidence: 90,
    referenceDateBasis: null,
  }, {
    localId: "issue-traffici",
    title: "Traffici-obiettivo e criteri di computo",
    normalizedIssue: "Riconciliare i traffici con manifesti, registri di scalo e distinzione dei trasferimenti interni.",
    areaOfLaw: "monitoraggio concessorio",
    priority: "MEDIUM",
    rationale: "I totali aziendali sono inferiori agli obiettivi e includono componenti interne non autonomamente probatorie.",
    originatingItemLocalIds: ["fact-traffic-shortfall"],
    confidence: 90,
    referenceDateBasis: null,
  }],
  researchQuestions: [{
    localId: "question-canoni",
    legalIssueLocalId: "issue-canoni",
    canonicalQuestion: "Quali atti istruttori e contabili sono necessari per accertare e contestare un eventuale residuo, preservando il contraddittorio?",
    priority: "HIGH",
    referenceDate: null,
    referenceDateBasis: unknownReferenceDate("L'esatta imputazione dei pagamenti e il saldo richiedono riscontro della Tesoreria."),
    requestedCapabilities: ["SEMANTIC_DISCOVERY", "KEYWORD_DISCOVERY"],
    mode: "PRIMARY",
  }, {
    localId: "question-investments",
    legalIssueLocalId: "issue-investments",
    canonicalQuestion: "Come devono essere valutati ritardi, adempimenti parziali e richieste unilaterali di riprogrammazione degli investimenti concessori?",
    priority: "HIGH",
    referenceDate: null,
    referenceDateBasis: unknownReferenceDate("Le conseguenze dipendono dall'istruttoria sui singoli investimenti e dagli atti applicabili."),
    requestedCapabilities: ["SEMANTIC_DISCOVERY"],
    mode: "PRIMARY",
  }, {
    localId: "question-third-party",
    legalIssueLocalId: "issue-third-party",
    canonicalQuestion: "Quali elementi distinguono un servizio logistico da un affidamento operativo o da una subconcessione e quali autorizzazioni sono necessarie?",
    priority: "HIGH",
    referenceDate: null,
    referenceDateBasis: unknownReferenceDate("La qualificazione richiede fatti operativi e titoli pubblicistici non completi nel fascicolo."),
    requestedCapabilities: ["SEMANTIC_DISCOVERY", "KEYWORD_DISCOVERY"],
    mode: "PRIMARY",
  }, {
    localId: "question-technical-safety",
    legalIssueLocalId: "issue-technical-safety",
    canonicalQuestion: "Quali accertamenti strutturali, impiantistici e di sicurezza sono necessari prima di prescrizioni o nuove installazioni?",
    priority: "HIGH",
    referenceDate: null,
    referenceDateBasis: unknownReferenceDate("La memoria strutturale e le verifiche private dichiarano espressamente limiti conoscitivi."),
    requestedCapabilities: ["SEMANTIC_DISCOVERY"],
    mode: "PRIMARY",
  }, {
    localId: "question-environment",
    legalIssueLocalId: "issue-environment",
    canonicalQuestion: "Quali documenti e verifiche servono per accertare lo stato di I4, dello scarico e della gestione ambientale senza inferire illeciti non provati?",
    priority: "HIGH",
    referenceDate: null,
    referenceDateBasis: unknownReferenceDate("Titoli, progetto approvato e tracciabilita del campione non risultano completi."),
    requestedCapabilities: ["SEMANTIC_DISCOVERY", "KEYWORD_DISCOVERY"],
    mode: "PRIMARY",
  }],
  sourceQuotes,
};

export const selvaraOfflineStructuredKnowledgeBaseline = structuredClone(
  selvaraOfflineStructuredKnowledge,
);

const additionalItems = [
  quotedItem("act-public-notice", "LEGAL_ACT", 2, {
    documentBasisRef: "DOCUMENT_1.PAGE_2",
    actType: "avviso pubblico",
    proceduralRole: null,
    authoritySubjectLocalId: "subject-authority",
    number: "ADSP-SIM/2023/0142",
    date: { precision: "EXACT", from: "2023-03-01", to: null, originalText: "01/03/2023", confidence: 100 },
    title: "Avviso pubblico per concessione banchina B4 e retrobanchina R4",
    declaredEffects: ["Avvio della procedura comparativa", "Canone base euro 180.000", "Garanzia pari a due annualita"],
  }, "Avviso pubblico per concessione banchina B4 e retrobanchina R4", "Nessun diritto all'assegnazione deriva\ndalla presentazione dell'istanza."),
  quotedItem("position-application-offer", "PARTY_POSITION", 3, {
    subjectLocalId: "subject-concessionaria",
    positionType: "REQUEST",
    normalizedStatement: "La societa domanda la concessione per dodici anni, offre euro 192.000 annui e si impegna a richiedere preventiva autorizzazione per affidare a terzi parti del ciclo operativo.",
    context: "istanza e offerta economica",
    relatedItemLocalIds: ["act-public-notice"],
  }, "La scrivente, rappresentata", "eventuali interferenze con\nl'ormeggio pubblico."),
  quotedItem("act-comparative-record", "LEGAL_ACT", 5, {
    documentBasisRef: "DOCUMENT_1.PAGE_5",
    actType: "verbale di comparazione",
    proceduralRole: null,
    authoritySubjectLocalId: "subject-authority",
    number: "ADSP-SIM/2023/0388",
    date: { precision: "EXACT", from: "2023-05-22", to: null, originalText: "22/05/2023", confidence: 100 },
    title: "Verbale comparazione offerte e graduatoria",
    declaredEffects: ["Raccomandazione di aggiudicazione", "Prescrizione di integrare il drenaggio", "Fideiussione prima della consegna"],
  }, "Verbale comparazione offerte e graduatoria", "Il verbale non costituisce titolo all'occupazione dei beni."),
  quotedItem("act-award", "LEGAL_ACT", 6, {
    documentBasisRef: "DOCUMENT_1.PAGE_6",
    actType: "determinazione di aggiudicazione",
    proceduralRole: null,
    authoritySubjectLocalId: "subject-authority",
    number: "48/2023",
    date: { precision: "EXACT", from: "2023-06-15", to: null, originalText: "15/06/2023", confidence: 100 },
    title: "Determinazione di aggiudicazione della concessione B4/R4",
    declaredEffects: ["Aggiudicazione a Terminal Selvara Logistica", "Canone iniziale euro 192.000", "Efficacia subordinata a titolo, disciplinare e garanzia"],
  }, "Determinazione di aggiudicazione della concessione B4/R4", "di incaricare\nl'Ufficio demanio della predisposizione del titolo."),
  quotedItem("fact-direct-operation-obligations", "FACT", 8, {
    normalizedStatement: "Il titolo vieta cessione, subconcessione e affidamento a terzi di parti del ciclo operativo senza gli atti eventualmente richiesti e garantisce memorie nel procedimento di vigilanza.",
    subjectLocalIds: ["subject-concessionaria", "subject-authority"],
    object: "esercizio diretto, vigilanza e contraddittorio",
    qualifier: "clausole del titolo",
  }, "ART. 8 - ESERCIZIO DIRETTO.", "che puo presentare memorie nei termini indicati."),
  quotedItem("fact-concession-areas", "FACT", 10, {
    normalizedStatement: "La planimetria individua B4, R4 e M4; V1 e A1 devono restare sgombri e Z2 e esterna alla concessione.",
    subjectLocalIds: ["subject-concessionaria", "subject-authority"],
    object: "perimetro e aree di sicurezza",
    qualifier: "planimetria non georeferenziata",
  }, "La planimetria schematica P1", "La delimitazione va verificata nelle ispezioni insieme al verbale di consegna."),
  quotedItem("fact-guarantee", "FACT", 11, {
    normalizedStatement: "Il certificato simula una garanzia a prima richiesta di euro 384.000 con scadenza nominale 31 dicembre 2035, la cui effettiva validita richiede verifica.",
    subjectLocalIds: ["subject-concessionaria", "subject-authority"],
    object: "garanzia concessoria",
    qualifier: "certificato simulato non utilizzabile",
  }, "Si attesta, ai soli fini della simulazione", "il presente certificato non costituisce garanzia utilizzabile."),
  quotedItem("event-delivery", "EVENT", 12, {
    title: "Consegna del compendio",
    normalizedStatement: "Il 1 agosto 2023 il compendio fu consegnato con V1, A1 e Z2 liberi; la societa lo accetto senza riserve salvo verifiche impiantistiche.",
    date: { precision: "EXACT", from: "2023-08-01", to: null, originalText: "01/08/2023", confidence: 100 },
    subjectLocalIds: ["subject-concessionaria", "subject-authority"],
    relatedItemLocalIds: ["act-concession", "fact-concession-areas"],
  }, "Alle ore 10:30", "fatte salve le verifiche impiantistiche preliminari."),
  quotedItem("event-i1-progress-2024", "EVENT", 13, {
    title: "Stato parziale I1",
    normalizedStatement: "Al 27 agosto 2024 risultavano 13 punti luce su 18, quadro Q1 al 60 per cento e nessun collaudo definitivo.",
    date: { precision: "EXACT", from: "2024-08-27", to: null, originalText: "2024-08-27", confidence: 100 },
    subjectLocalIds: ["subject-concessionaria"],
    relatedItemLocalIds: ["fact-investment-program", "deadline-i1-i4"],
  }, "Stato forniture alla data del rapporto", "Non sono\nallegate dichiarazioni di conformità dell’intero impianto."),
  quotedItem("event-payment-2025-20k", "EVENT", 17, {
    title: "Pagamento parziale seconda rata 2025",
    normalizedStatement: "Il 27 giugno 2025 fu eseguito un pagamento di euro 20.000 qualificato come acconto sulla seconda rata 2025 di euro 48.000.",
    date: { precision: "EXACT", from: "2025-06-27", to: null, originalText: "27 giugno 2025", confidence: 100 },
    subjectLocalIds: ["subject-concessionaria", "subject-authority"],
    relatedItemLocalIds: ["fact-canone", "position-repayment"],
  }, "Importo   20.000,00 EUR", "prevista per il 1° aprile\n2025."),
  quotedItem("event-area-remediation", "EVENT", 19, {
    title: "Occupazioni temporanee e successiva rimozione",
    normalizedStatement: "Nel dicembre 2025 V1, A1 e Z2 furono temporaneamente occupate; il registro societario annota la successiva rimozione e il ripristino.",
    date: { precision: "INTERVAL", from: "2025-12-04", to: "2025-12-19", originalText: "4-19 dicembre 2025", confidence: 90 },
    subjectLocalIds: ["subject-concessionaria", "subject-third-operator"],
    relatedItemLocalIds: ["fact-concession-areas", "event-area-observations"],
  }, "04/12/2025   V1", "non costituiscono attestazione di conformità da\nparte di enti pubblici."),
  quotedItem("position-reprogramming", "PARTY_POSITION", 20, {
    subjectLocalId: "subject-concessionaria",
    positionType: "REQUEST",
    normalizedStatement: "La societa chiede di riprogrammare gli investimenti fino a dicembre 2026 e attribuisce parte degli scostamenti a mercato e meteo non certificati.",
    context: "rendiconto gestionale 2025",
    relatedItemLocalIds: ["fact-investment-program", "gap-m2", "gap-i4"],
  }, "La società domanda una ripianificazione", "non è allegato un atto pubblico di modifica del titolo."),
  quotedItem("event-payment-2026-15k", "EVENT", 21, {
    title: "Pagamento non imputato analiticamente",
    normalizedStatement: "Il 9 febbraio 2026 fu eseguito un bonifico di euro 15.000 per saldo arretrati senza quietanza analitica di imputazione.",
    date: { precision: "EXACT", from: "2026-02-09", to: null, originalText: "09 febbraio 2026", confidence: 100 },
    subjectLocalIds: ["subject-concessionaria", "subject-authority"],
    relatedItemLocalIds: ["fact-canone", "gap-canone-reconciliation"],
  }, "Data esecuzione   09 febbraio 2026", "quietanza analitica di\nimputazione alle rate."),
  quotedItem("position-completion-program", "PARTY_POSITION", 23, {
    subjectLocalId: "subject-concessionaria",
    positionType: "REQUEST",
    normalizedStatement: "La societa propone nuove date per I1, I3 e I4, ma il documento e unilaterale e non sostituisce le scadenze del disciplinare.",
    context: "programma aziendale di completamento",
    relatedItemLocalIds: ["position-reprogramming", "deadline-i1-i4"],
  }, "Intervento   Proposta societaria", "sulla natura\ndel rapporto con Magazzini Levante."),
  quotedItem("event-payment-2026-30k", "EVENT", 24, {
    title: "Pagamento parziale terza rata 2026",
    normalizedStatement: "Il 20 luglio 2026 furono versati euro 30.000 sulla terza rata 2026 di euro 48.000.",
    date: { precision: "EXACT", from: "2026-07-20", to: null, originalText: "20 luglio 2026", confidence: 100 },
    subjectLocalIds: ["subject-concessionaria", "subject-authority"],
    relatedItemLocalIds: ["fact-canone", "gap-canone-reconciliation"],
  }, "Importo   30.000,00 EUR", "rata originaria di euro 48.000,00."),
  quotedItem("fact-operational-status-2026", "FACT", 25, {
    normalizedStatement: "Nel settembre 2026 M1 era in esercizio, M2 assente, I1 documentato solo in parte, I4 senza separatore e Magazzini Levante ancora presente in M4.",
    subjectLocalIds: ["subject-concessionaria", "subject-third-operator"],
    object: "stato operativo complessivo",
    qualifier: "promemoria interno societario",
  }, "Situazione descritta dalla società", "continua ad utilizzare la superficie dedicata nel magazzino M4."),
  quotedItem("fact-metric-boundaries", "FACT", 26, {
    normalizedStatement: "Il rilievo indica V1 largo 5 metri, A1 come accesso di emergenza e Z2 esterna al titolo, ma non e georeferenziato.",
    subjectLocalIds: ["subject-concessionaria", "subject-authority"],
    object: "limiti fisici del compendio",
    qualifier: "rilievo convenzionale da verificare",
  }, "Misure convenzionali per il progetto", "prima di opere permanenti."),
  quotedItem("gap-bathymetry", "GAP", 27, {
    gapType: "BATHYMETRIC_AND_NAVIGATION_LIMITS_UNVERIFIED",
    description: "Il margine geometrico nominale di 0,3 metri a S4 non considera correzioni e lo zero non coincide in modo attestato con lo zero idrografico.",
    impact: "Il pescaggio massimo e la sicurezza dell'approdo richiedono verifica e prescrizioni dell'autorita competente.",
    relatedItemLocalIds: ["fact-concession-areas"],
  }, "Una simulazione di approdo commerciale", "prescrizioni delle autorità competenti."),
  quotedItem("gap-crane-documentation", "GAP", 30, {
    gapType: "CRANE_TECHNICAL_DOCUMENTATION_INCOMPLETE",
    description: "Per M1 non sono presenti copie delle verifiche successive alla prova privata; per M2 non esiste verbale di messa in esercizio.",
    impact: "Occorre acquisire i fascicoli tecnici senza inferire automaticamente che le verifiche M1 non siano state effettuate.",
    relatedItemLocalIds: ["event-m1-service", "gap-m2"],
  }, "M1 - gru mobile", "non prova da solo che le verifiche non siano state\neffettuate."),
  quotedItem("position-external-causes", "PARTY_POSITION", 37, {
    subjectLocalId: "subject-concessionaria",
    positionType: "DEFENSE",
    normalizedStatement: "La societa invoca giornate di vento, sospensioni meteomarine e calo di mercato, ma non allega ordinanze o serie statistiche verificabili.",
    context: "difesa sui mancati obiettivi di traffico",
    relatedItemLocalIds: ["fact-traffic-shortfall"],
  }, "Annotazioni meteo/ormeggio", "atti di\ninterdizione, se esistenti."),
  quotedItem("fact-private-technical-summary", "FACT", 38, {
    normalizedStatement: "La relazione privata rileva I1 incompleto, M1 presente, M2 assente e I4 al 55 per cento senza separatore o collaudo, precisando di non essere accertamento dell'ente.",
    subjectLocalIds: ["subject-concessionaria"],
    object: "consistenza lavori I1-I4",
    qualifier: "relazione tecnica privata non autoritativa",
  }, "Rilievo visivo e documentale", "le prove della consegna M2."),
  quotedItem("fact-m4-layout", "FACT", 39, {
    normalizedStatement: "Il rilievo privato individua 180 m2 di M4 con scaffalature e banchi di Magazzini Levante, senza qualificare giuridicamente il rapporto.",
    subjectLocalIds: ["subject-concessionaria", "subject-third-operator"],
    object: "uso stabile di zona L in M4",
    qualifier: "rilievo privato",
  }, "Distribuzione interna", "dell’effettivo esercizio."),
];

selvaraOfflineStructuredKnowledge.items.push(...additionalItems);

const addIssueOrigins = (issueId: string, itemIds: readonly string[]) => {
  const issue = selvaraOfflineStructuredKnowledge.legalIssues.find((candidate) => candidate.localId === issueId);
  if (!issue) throw new Error(`SELVARA_ISSUE_MISSING:${issueId}`);
  issue.originatingItemLocalIds.push(...itemIds);
};

addIssueOrigins("issue-canoni", ["event-payment-2025-20k", "event-payment-2026-15k", "event-payment-2026-30k"]);
addIssueOrigins("issue-investments", [
  "event-i1-progress-2024", "position-reprogramming", "position-completion-program",
  "fact-operational-status-2026", "gap-crane-documentation", "fact-private-technical-summary",
]);
addIssueOrigins("issue-third-party", [
  "position-application-offer", "fact-direct-operation-obligations", "event-area-remediation",
  "fact-operational-status-2026", "fact-m4-layout",
]);
addIssueOrigins("issue-technical-safety", [
  "fact-concession-areas", "event-delivery", "fact-metric-boundaries", "gap-bathymetry",
  "gap-crane-documentation", "fact-private-technical-summary",
]);
addIssueOrigins("issue-environment", ["act-comparative-record", "fact-operational-status-2026"]);
addIssueOrigins("issue-traffici", ["position-reprogramming", "position-external-causes"]);

selvaraOfflineStructuredKnowledge.legalIssues.push({
  localId: "issue-title-formation",
  title: "Formazione, condizioni di efficacia e allegati del titolo",
  normalizedIssue: "Ricostruire avviso, offerta, comparazione, aggiudicazione, garanzia, consegna e clausole del titolo per verificare condizioni di efficacia e obblighi incorporati.",
  areaOfLaw: "procedimento concessorio",
  priority: "HIGH",
  rationale: "Gli atti presupposti definiscono requisiti, prescrizioni, garanzia e contenuto del rapporto.",
  originatingItemLocalIds: [
    "act-public-notice", "position-application-offer", "act-comparative-record", "act-award",
    "act-concession", "fact-direct-operation-obligations", "fact-guarantee", "event-delivery",
  ],
  confidence: 95,
  referenceDateBasis: null,
});
selvaraOfflineStructuredKnowledge.researchQuestions.push({
  localId: "question-title-formation",
  legalIssueLocalId: "issue-title-formation",
  canonicalQuestion: "Quali effetti producono gli atti presupposti, le condizioni di efficacia e gli allegati sul contenuto e sulla gestione del rapporto concessorio?",
  priority: "HIGH",
  referenceDate: null,
  referenceDateBasis: unknownReferenceDate("La qualificazione richiede verifica coordinata degli atti e delle fonti applicabili."),
  requestedCapabilities: ["SEMANTIC_DISCOVERY", "KEYWORD_DISCOVERY"],
  mode: "PRIMARY",
});

const itemIdsByPage = new Map<number, string[]>();
for (const candidate of selvaraOfflineStructuredKnowledge.items) {
  for (const basisRef of candidate.basisRefs) {
    const match = basisRef.match(/PAGE_(\d+)$/);
    if (!match) continue;
    const pageNumber = Number(match[1]);
    itemIdsByPage.set(pageNumber, [...(itemIdsByPage.get(pageNumber) ?? []), candidate.localId]);
  }
}

const profilesByPage: Record<number, readonly string[]> = {
  1: ["OTHER"], 2: ["PROCEDURAL", "LEGAL"], 3: ["PROCEDURAL", "LEGAL"], 4: ["LEGAL", "ACCOUNTING", "TECHNICAL"],
  5: ["PROCEDURAL", "ENVIRONMENTAL"], 6: ["PROCEDURAL", "LEGAL"], 7: ["LEGAL", "ACCOUNTING"],
  8: ["LEGAL", "PROCEDURAL"], 9: ["LEGAL", "TECHNICAL"], 10: ["LEGAL", "TECHNICAL", "SAFETY"],
  11: ["LEGAL", "ACCOUNTING"], 12: ["PROCEDURAL", "EVIDENTIARY"], 13: ["TECHNICAL"], 14: ["TECHNICAL"],
  15: ["ACCOUNTING", "TECHNICAL"], 16: ["LEGAL", "SAFETY"], 17: ["ACCOUNTING"], 18: ["ACCOUNTING", "LEGAL"],
  19: ["SAFETY", "EVIDENTIARY"], 20: ["ACCOUNTING", "TECHNICAL"], 21: ["ACCOUNTING"], 22: ["TECHNICAL", "ACCOUNTING"],
  23: ["LEGAL", "TECHNICAL"], 24: ["ACCOUNTING"], 25: ["TECHNICAL", "SAFETY"], 26: ["TECHNICAL", "LEGAL"],
  27: ["TECHNICAL", "SAFETY"], 28: ["TECHNICAL", "SAFETY"], 29: ["TECHNICAL", "SAFETY"], 30: ["TECHNICAL", "SAFETY"],
  31: ["TECHNICAL", "ENVIRONMENTAL"], 32: ["SAFETY", "LEGAL"], 33: ["ENVIRONMENTAL", "EVIDENTIARY"],
  34: ["LEGAL", "SAFETY", "EVIDENTIARY"], 35: ["ACCOUNTING", "EVIDENTIARY"], 36: ["ACCOUNTING", "EVIDENTIARY"],
  37: ["EVIDENTIARY", "TECHNICAL"], 38: ["TECHNICAL", "EVIDENTIARY"], 39: ["LEGAL", "TECHNICAL"], 40: ["EVIDENTIARY"],
};

const inventoryTitle = (pageNumber: number) => {
  const lines = pageText(pageNumber).split("\n").filter(Boolean);
  return lines.find((line, index) => index > 0 && !/^(FASCICOLO|SELVARA \/|SEGNATURA|Rif\. interno|Data |Provenienza|Ambito )/.test(line))
    ?? `Pagina ${pageNumber}`;
};
const inventoryField = (pageNumber: number, prefix: string) => (
  pageText(pageNumber).split("\n").find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() ?? null
);

Object.assign(selvaraOfflineStructuredKnowledge, {
  documentInventory: selvaraOfflinePages.map((page) => {
    const relatedItemLocalIds = itemIdsByPage.get(page.pageNumber) ?? [];
    const classification = page.pageNumber === 1 ? "NOT_MATERIAL" : "MATERIAL";
    return {
      localId: `document-page-${page.pageNumber}`,
      basisRefs: [page.reference],
      documentType: inventoryTitle(page.pageNumber),
      documentDate: inventoryField(page.pageNumber, "Data "),
      issuer: inventoryField(page.pageNumber, "DA: ") ?? inventoryField(page.pageNumber, "Provenienza "),
      recipients: [inventoryField(page.pageNumber, "A: ")].filter((value): value is string => value !== null),
      proceduralPhase: inventoryField(page.pageNumber, "FASE: "),
      subject: inventoryTitle(page.pageNumber),
      summary: page.pageNumber === 1
        ? "Copertina e indice di acquisizione: verificati per integrita del corpus, senza autonoma portata materiale."
        : `Documento materiale esaminato e collegato agli elementi ${relatedItemLocalIds.join(", ")}.`,
      referencedActs: [],
      attachments: [],
      materialProfiles: [...profilesByPage[page.pageNumber]],
      classification,
      rationale: page.pageNumber === 1
        ? "Documento di indice privo di autonomi fatti, obblighi o provvedimenti."
        : "Il documento contiene fatti, atti, allegazioni, scadenze o profili tecnici rilevanti per il fascicolo.",
      relatedItemLocalIds,
    };
  }),
});
