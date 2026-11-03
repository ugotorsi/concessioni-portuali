import type {
  StructuredFascicoloReportPayload,
  StructuredReportProceduralContext,
} from "@/server/fascicolo-report/structured-report";

export type ActPhase = "INITIAL" | "INSTRUCTION" | "DECISION" | "POST_DECISION";

export const ACT_PHASE_LABELS: Record<ActPhase, string> = {
  INITIAL: "Avvio e accertamento",
  INSTRUCTION: "Istruttoria e contraddittorio",
  DECISION: "Decisione",
  POST_DECISION: "Fase successiva al provvedimento finale",
};

export interface ActTemplate {
  templateKey: string;
  title: string;
  legalBasis: string;
  phases: readonly ActPhase[];
  body: string;
  source: "CATALOG" | "REPORT_PLAN";
  issueSemanticKey: string | null;
  /**
   * Issue profile and fact elements that make the template pertinent: it is recommended only when the
   * report assesses that profile with every listed element documented (proven or indicated).
   */
  requires?: { readonly profile: string; readonly elements: readonly string[] };
}

export interface ActTemplateContext {
  procedimentoLabel: string;
  responsabile: string | null;
  unitaOrganizzativa: string | null;
}

export interface ActPhaseDetection {
  phase: ActPhase;
  reviewPending: boolean;
  /** Phase resulting from authoritative procedimento metadata only. */
  authoritativePhase: ActPhase;
  /** True when document evidence shows a later phase than the authoritative metadata. */
  documentaryAhead: boolean;
  /** Knowledge texts (with evidence) supporting the documentary phase or the review signal. */
  documentarySignals: readonly string[];
}

export interface ActTemplateCatalog extends ActPhaseDetection {
  recommended: readonly ActTemplate[];
  others: readonly ActTemplate[];
}

const HUMAN_APPROVAL_NOTICE = "Bozza soggetta ad approvazione umana: nessuna firma, protocollazione, notifica o invio automatici.";

const CATALOG: readonly ActTemplate[] = [
  {
    templateKey: "CATALOG:COMUNICAZIONE_AVVIO",
    title: "Comunicazione di avvio del procedimento",
    legalBasis: "Artt. 7 e 8 L. 241/1990",
    phases: ["INITIAL"],
    source: "CATALOG",
    issueSemanticKey: null,
    body: [
      "Oggetto: comunicazione di avvio del procedimento relativo a [OGGETTO DEL PROCEDIMENTO] – concessione demaniale n. [CONCESSIONE].",
      "Destinatario: [CONCESSIONARIO], [DOMICILIO DIGITALE].",
      "Ai sensi degli artt. 7 e 8 della L. 7 agosto 1990, n. 241, si comunica l'avvio del procedimento indicato in oggetto.",
      "Amministrazione competente: [ENTE]. Ufficio competente: [UNITÀ ORGANIZZATIVA]. Responsabile del procedimento: [RESPONSABILE].",
      "Oggetto e presupposti: [SINTESI DEI FATTI ACCERTATI CON RIFERIMENTO AI DOCUMENTI].",
      "Termine di conclusione: [TERMINE] decorrente dalla ricezione della presente; in caso di inerzia sono esperibili i rimedi di legge, compreso il potere sostitutivo di cui all'art. 2, comma 9-bis, L. 241/1990.",
      "Gli atti possono essere consultati presso [UFFICIO E MODALITÀ DI ACCESSO]. Entro [TERMINE PER MEMORIE] giorni è possibile presentare memorie scritte e documenti, che l'Amministrazione ha l'obbligo di valutare ove pertinenti (art. 10 L. 241/1990).",
      HUMAN_APPROVAL_NOTICE,
    ].join("\n\n"),
  },
  {
    templateKey: "CATALOG:RICHIESTA_INTEGRAZIONE",
    title: "Richiesta di integrazione documentale",
    legalBasis: "Art. 6, comma 1, lett. b), L. 241/1990",
    phases: ["INITIAL", "INSTRUCTION"],
    source: "CATALOG",
    issueSemanticKey: null,
    body: [
      "Oggetto: richiesta di integrazione documentale – procedimento [PROCEDIMENTO].",
      "Nell'ambito dell'istruttoria, ai sensi dell'art. 6, comma 1, lett. b), L. 241/1990, si chiede di trasmettere entro [TERMINE] giorni:",
      "1. [DOCUMENTO MANCANTE E RAGIONE DELLA RICHIESTA];\n2. [DOCUMENTO MANCANTE E RAGIONE DELLA RICHIESTA];\n3. [DOCUMENTO MANCANTE E RAGIONE DELLA RICHIESTA].",
      "La richiesta è limitata agli atti non già in possesso dell'Amministrazione (art. 18 L. 241/1990). In mancanza, l'istruttoria proseguirà sulla base degli atti disponibili.",
      "Responsabile del procedimento: [RESPONSABILE] – [UNITÀ ORGANIZZATIVA].",
      HUMAN_APPROVAL_NOTICE,
    ].join("\n\n"),
  },
  {
    templateKey: "CATALOG:VERBALE_SOPRALLUOGO",
    title: "Verbale di sopralluogo e accertamento",
    legalBasis: "Artt. 47 e 54 cod. nav.; art. 6 L. 241/1990",
    phases: ["INITIAL", "INSTRUCTION"],
    source: "CATALOG",
    issueSemanticKey: null,
    body: [
      "Verbale di sopralluogo n. [NUMERO] del [DATA], ore [ORA], presso [LUOGO / IDENTIFICATIVI CATASTALI E DEMANIALI].",
      "Presenti: [FUNZIONARI E QUALIFICA]; per il concessionario: [PRESENTI O ASSENZA].",
      "Titolo verificato: concessione n. [CONCESSIONE] e relativi allegati (planimetrie, prescrizioni).",
      "Rilievi: perimetro e superfici occupate; opere e manufatti presenti con dimensioni, materiali e destinazione effettiva; difformità rispetto al titolo; stato manutentivo; uso effettivo del bene.",
      "Documentazione fotografica: [ELENCO FOTO CON DATA E ORIENTAMENTO].",
      "Dichiarazioni del concessionario: [DICHIARAZIONI].",
      "Il verbale distingue i fatti constatati direttamente dalle valutazioni giuridiche, che restano riservate all'istruttoria.",
      HUMAN_APPROVAL_NOTICE,
    ].join("\n\n"),
  },
  {
    templateKey: "CATALOG:CONTESTAZIONE_DECADENZA",
    title: "Contestazione degli addebiti e termine per deduzioni (decadenza)",
    legalBasis: "Art. 47 cod. nav.; artt. 7, 8 e 10 L. 241/1990",
    phases: ["INITIAL", "INSTRUCTION"],
    source: "CATALOG",
    issueSemanticKey: null,
    body: [
      "Oggetto: contestazione di inadempimenti e avvio del procedimento di decadenza – concessione n. [CONCESSIONE].",
      "Fatti contestati, ciascuno con data, documento di riferimento e obbligo violato:\n1. [FATTO] – [DOCUMENTO E PAGINA] – [OBBLIGO DEL TITOLO O DI LEGGE];\n2. [FATTO] – [DOCUMENTO E PAGINA] – [OBBLIGO DEL TITOLO O DI LEGGE].",
      "Qualificazione: le condotte sono valutate ai sensi dell'art. 47 cod. nav., lettera [LETTERA], nella versione vigente alla data delle condotte; eventuali innovazioni non autorizzate sono valutate separatamente ai sensi dell'art. 54 cod. nav.",
      "Ai sensi dell'art. 47 cod. nav., prima della dichiarazione di decadenza, si assegna il termine di [TERMINE] giorni per presentare deduzioni, memorie e documenti e per chiedere di essere sentiti.",
      "Si avverte che l'Amministrazione valuterà regolarizzazioni sopravvenute, proporzionalità della misura e alternative meno incisive (penali, diffida ad adempiere).",
      "Responsabile del procedimento: [RESPONSABILE] – [UNITÀ ORGANIZZATIVA].",
      HUMAN_APPROVAL_NOTICE,
    ].join("\n\n"),
  },
  {
    templateKey: "CATALOG:INGIUNZIONE_ART54",
    title: "Ingiunzione di rimessa in pristino per innovazioni non autorizzate",
    legalBasis: "Art. 54 cod. nav.",
    phases: ["INSTRUCTION", "DECISION"],
    source: "CATALOG",
    issueSemanticKey: null,
    body: [
      "Oggetto: opere e innovazioni non autorizzate su area demaniale – concessione n. [CONCESSIONE].",
      "Accertato con verbale n. [NUMERO] del [DATA] che sono state eseguite le seguenti opere non autorizzate: [DESCRIZIONE OPERE, DIMENSIONI, UBICAZIONE].",
      "Verificata la competenza dell'autorità che adotta l'atto ai sensi dell'art. 54 cod. nav. e valutate le deduzioni presentate in data [DATA],",
      "si ingiunge di rimettere le cose in pristino entro [TERMINE] giorni, con l'avvertenza che in mancanza si provvederà d'ufficio a spese dell'interessato.",
      "Restano impregiudicate le valutazioni sulla decadenza ai sensi dell'art. 47 cod. nav., oggetto di procedimento distinto.",
      HUMAN_APPROVAL_NOTICE,
    ].join("\n\n"),
  },
  {
    templateKey: "CATALOG:PREAVVISO_RIGETTO",
    title: "Comunicazione dei motivi ostativi all'accoglimento dell'istanza",
    legalBasis: "Art. 10-bis L. 241/1990",
    phases: ["INSTRUCTION"],
    source: "CATALOG",
    issueSemanticKey: null,
    body: [
      "Oggetto: comunicazione dei motivi ostativi all'accoglimento dell'istanza prot. [PROTOCOLLO] del [DATA].",
      "Ai sensi dell'art. 10-bis L. 241/1990 si comunicano i motivi che ostano all'accoglimento:\n1. [MOTIVO, CON RIFERIMENTO NORMATIVO E DOCUMENTALE];\n2. [MOTIVO, CON RIFERIMENTO NORMATIVO E DOCUMENTALE].",
      "Entro dieci giorni dal ricevimento è possibile presentare osservazioni scritte, eventualmente corredate da documenti. La comunicazione sospende i termini di conclusione del procedimento, che ricominciano a decorrere dieci giorni dopo la presentazione delle osservazioni o, in mancanza, dalla scadenza del termine.",
      "Nel provvedimento finale l'Amministrazione darà conto delle ragioni dell'eventuale mancato accoglimento delle osservazioni.",
      HUMAN_APPROVAL_NOTICE,
    ].join("\n\n"),
  },
  {
    templateKey: "CATALOG:VALUTAZIONE_CONTRODEDUZIONI",
    title: "Nota istruttoria di valutazione delle controdeduzioni",
    legalBasis: "Art. 10 L. 241/1990",
    phases: ["INSTRUCTION", "DECISION"],
    source: "CATALOG",
    issueSemanticKey: null,
    body: [
      "Nota istruttoria – procedimento [PROCEDIMENTO].",
      "Per ciascuna deduzione presentata in data [DATA]:\n- sintesi della deduzione;\n- documenti prodotti;\n- valutazione dell'Amministrazione (accolta / parzialmente accolta / non accolta) con motivazione puntuale;\n- incidenza sull'addebito e sulla misura proposta.",
      "Esito dell'audizione del [DATA], se svolta: [SINTESI].",
      "Proposta di esito istruttorio: [ARCHIVIAZIONE / DIFFIDA / PENALE / DECADENZA], con motivazione sulla proporzionalità.",
      HUMAN_APPROVAL_NOTICE,
    ].join("\n\n"),
  },
  {
    templateKey: "CATALOG:PROVVEDIMENTO_FINALE",
    title: "Schema di provvedimento conclusivo",
    legalBasis: "Artt. 3 e 21-bis L. 241/1990; art. 47 cod. nav.",
    phases: ["DECISION"],
    source: "CATALOG",
    issueSemanticKey: null,
    body: [
      "IL [ORGANO COMPETENTE]",
      "Visti: il codice della navigazione, in particolare l'art. 47; la L. 28 gennaio 1994, n. 84; la L. 7 agosto 1990, n. 241; la concessione n. [CONCESSIONE]; [ALTRI ATTI].",
      "Premesso che: [RICOSTRUZIONE CRONOLOGICA DEI FATTI CON RIFERIMENTI DOCUMENTALI].",
      "Considerato che: con nota [PROTOCOLLO] del [DATA] sono stati contestati gli addebiti; il concessionario ha presentato deduzioni in data [DATA], valutate come segue: [VALUTAZIONE]; la disciplina applicabile ratione temporis è [DISCIPLINA]; la misura è proporzionata perché [MOTIVAZIONE].",
      "DETERMINA\n1. [DISPOSITIVO];\n2. [ADEMPIMENTI CONSEGUENTI E TERMINI];\n3. [COMUNICAZIONI].",
      "Avverso il presente provvedimento è ammesso ricorso al TAR competente entro 60 giorni dalla comunicazione (art. 29 c.p.a.) o ricorso straordinario al Presidente della Repubblica entro 120 giorni (art. 9 d.P.R. 1199/1971). L'atto diviene efficace con la comunicazione al destinatario (art. 21-bis L. 241/1990).",
      HUMAN_APPROVAL_NOTICE,
    ].join("\n\n"),
  },
  {
    templateKey: "CATALOG:MESSA_IN_MORA_CANONE",
    title: "Messa in mora per canone demaniale non versato o versato in parte",
    legalBasis: "Titolo concessorio; art. 1219 c.c.; art. 47, lett. d), cod. nav. (solo se raggiunta la soglia di rate del titolo)",
    phases: ["INITIAL", "INSTRUCTION"],
    source: "CATALOG",
    issueSemanticKey: null,
    requires: { profile: "FEE_PAYMENT", elements: ["non-payment"] },
    body: [
      "Oggetto: canone demaniale – concessione n. [CONCESSIONE] – messa in mora.",
      "Destinatario: [CONCESSIONARIO], [DOMICILIO DIGITALE].",
      "Dalla documentazione contabile risulta quanto segue:\n- rata: [RATA E SCADENZA DA TITOLO]; importo dovuto: [IMPORTO DOVUTO];\n- versamenti ricevuti: [DATA, IMPORTO E CAUSALE DI CIASCUN VERSAMENTO];\n- residuo: [IMPORTO RESIDUO], oltre interessi nella misura di legge.",
      "Imputazione dei versamenti: [IMPUTAZIONE AI SENSI DELL'ART. 1193 C.C. O DICHIARATA DAL DEBITORE].",
      "Si invita al versamento del residuo entro [TERMINE] giorni dal ricevimento, con l'avvertenza che in mancanza si procederà al recupero coattivo [ED ESCUSSIONE DELLA GARANZIA, SE PREVISTA DAL TITOLO].",
      "[SOLO SE VERIFICATO NEL TITOLO: si rappresenta che l'omesso pagamento di [NUMERO] rate costituisce causa di decadenza ai sensi dell'art. 47, lett. d), cod. nav. e della clausola [CLAUSOLA] del titolo.]",
      "Responsabile del procedimento: [RESPONSABILE] – [UNITÀ ORGANIZZATIVA].",
      HUMAN_APPROVAL_NOTICE,
    ].join("\n\n"),
  },
  {
    templateKey: "CATALOG:DIFFIDA_ADEMPIERE_INVESTIMENTI",
    title: "Diffida ad adempiere agli obblighi di investimento del programma di attività",
    legalBasis: "Art. 18, commi 10 e 11, L. 84/1994; art. 9 D.I. 202/2022; titolo concessorio",
    phases: ["INITIAL", "INSTRUCTION"],
    source: "CATALOG",
    issueSemanticKey: null,
    requires: { profile: "INVESTMENT_DEFAULT", elements: ["obligation", "non-performance"] },
    body: [
      "Oggetto: concessione n. [CONCESSIONE] – stato di attuazione del programma di attività e degli investimenti – diffida ad adempiere.",
      "Obblighi del titolo e del programma: [INTERVENTO, CLAUSOLA, TERMINE PREVISTO].",
      "Esito della verifica del [DATA VERIFICA] (art. 18, comma 10, L. 84/1994; art. 9 D.I. 202/2022): [STATO DI AVANZAMENTO CON RIFERIMENTO AL VERBALE].",
      "Prima di valutare ulteriori misure, si invita il concessionario a:\n1. completare gli interventi indicati entro [TERMINE];\n2. comunicare eventuali cause non imputabili, ritardi autorizzativi o istanze di revisione del programma, con la relativa documentazione.",
      "Si rappresenta che la decadenza ai sensi dell'art. 18, comma 11, presuppone l'inosservanza degli obblighi «senza giustificato motivo» e che penali possono essere applicate solo se predeterminate nel titolo o nel bando.",
      "Responsabile del procedimento: [RESPONSABILE] – [UNITÀ ORGANIZZATIVA].",
      HUMAN_APPROVAL_NOTICE,
    ].join("\n\n"),
  },
  {
    templateKey: "CATALOG:RICHIESTA_CHIARIMENTI_USO_TERZI",
    title: "Richiesta di chiarimenti e invito a regolarizzare l'uso del bene da parte di terzi",
    legalBasis: "Art. 18, comma 9, L. 84/1994; artt. 45-bis e 46 cod. nav.; art. 6 L. 241/1990",
    phases: ["INITIAL", "INSTRUCTION"],
    source: "CATALOG",
    issueSemanticKey: null,
    requires: { profile: "THIRD_PARTY_USE", elements: ["third-party-use"] },
    body: [
      "Oggetto: concessione n. [CONCESSIONE] – utilizzo di [AREA O MANUFATTO] da parte di [SOGGETTO TERZO].",
      "Dai documenti acquisiti risulta che [SOGGETTO TERZO] utilizza [AREA O MANUFATTO] in forza di [CONTRATTO O TITOLO DICHIARATO] ([DOCUMENTO E PAGINA]).",
      "Non risulta agli atti un'autorizzazione dell'autorità concedente all'affidamento ad altri delle attività oggetto della concessione (art. 45-bis cod. nav.; art. 18, comma 9, ultimo periodo, L. 84/1994) né al subingresso (art. 46 cod. nav.).",
      "Si chiede di trasmettere entro [TERMINE] giorni: il contratto con il terzo, la descrizione delle attività svolte, la loro durata e il rapporto con l'oggetto del titolo, nonché ogni assenso eventualmente ottenuto.",
      "Si avverte che, all'esito, l'Amministrazione valuterà l'eventuale regolarizzazione o, in mancanza dei presupposti, la contestazione degli addebiti ai sensi dell'art. 47 cod. nav. e dell'art. 18, comma 11, L. 84/1994.",
      "Responsabile del procedimento: [RESPONSABILE] – [UNITÀ ORGANIZZATIVA].",
      HUMAN_APPROVAL_NOTICE,
    ].join("\n\n"),
  },
];

/** Templates whose act has already been performed according to the authoritative metadata. */
function alreadyPerformed(template: ActTemplate, context: StructuredReportProceduralContext | undefined): boolean {
  if (!context) return false;
  if (template.templateKey === "CATALOG:COMUNICAZIONE_AVVIO") return context.comunicazioneAvvioInviata;
  if (template.templateKey === "CATALOG:CONTESTAZIONE_DECADENZA") return context.contestazioneFormaleInviata;
  return false;
}

function concludedFromContext(context: StructuredReportProceduralContext | undefined): boolean {
  if (!context) return false;
  return ["CONCLUSO", "ARCHIVIATO"].includes(context.stato)
    || context.dataProvvedimentoFinale !== null
    || context.finalAct !== null;
}

const PHASE_ORDER: readonly ActPhase[] = ["INITIAL", "INSTRUCTION", "DECISION", "POST_DECISION"];

const DOCUMENTARY_PHASE_SIGNALS: ReadonlyArray<[ActPhase, RegExp]> = [
  ["POST_DECISION", /(?:decret\w*|provvediment\w*|determin\w*|ordinanz\w*)\s+(?:\S+\s+){0,4}?(?:di|della|dichiarativ\w* (?:della|di))\s+decadenz|(?:dichiarat\w*|pronunciat\w*|disposto|dispone|dichiara)\s+(?:\S+\s+){0,3}?(?:la\s+)?decadenz|provvedimento (?:finale|conclusivo)\s+(?:\S+\s+){0,3}?(?:adottat|emess|notificat|comunicat)|revoca(?:t\w*)? (?:della|la) concessione (?:è stata )?(?:disposta|adottata)/i],
  ["DECISION", /preavviso di rigetto|art\.?\s*10-?bis|controdeduzioni\s+(?:\S+\s+){0,3}?valutat|chiusura dell'istruttoria/i],
  ["INSTRUCTION", /comunicazione di avvio|avvio del procedimento|contestazion\w* (?:degli )?addebit|termine per (?:le )?deduzioni|memorie difensive|controdeduzion|audizion/i],
];

const REVIEW_SIGNAL = /riesame|autotutela/i;
const TENTATIVE_SIGNAL = /\b(?:propost\w*|schema|bozza|ipotes\w*|eventual\w*|possibil\w*|preannunci\w*|intendimento|ai fini (?:della|di una)|potrebbe|potrà)\b/i;

type PhasePayload = Pick<StructuredFascicoloReportPayload, "proceduralContext" | "operationalPlans">
  & Partial<Pick<StructuredFascicoloReportPayload, "documentedFramework" | "legalApplication" | "portRegime">>;

function documentaryEvidence(payload: PhasePayload | null): readonly string[] {
  const framework = payload?.documentedFramework;
  if (!framework) return [];
  return [...framework.legalActs, ...framework.timeline, ...framework.measures, ...framework.facts]
    .filter((item) => item.status !== "REJECTED" && item.evidence.length > 0)
    .map((item) => item.normalizedText);
}

export function detectActPhase(payload: PhasePayload | null): ActPhaseDetection {
  const context = payload?.proceduralContext;
  const evidenceTexts = documentaryEvidence(payload);
  const reviewSignals = evidenceTexts.filter((text) => REVIEW_SIGNAL.test(text));
  const reviewPending = (context?.documentTitles.some((title) => REVIEW_SIGNAL.test(title)) ?? false)
    || reviewSignals.length > 0;
  const postDecisionPlan = (payload?.operationalPlans ?? []).some((plan) =>
    plan.steps.some((step) => /tenuta del provvedimento finale/i.test(step.title)));

  let authoritativePhase: ActPhase = "INITIAL";
  if (concludedFromContext(context) || postDecisionPlan) authoritativePhase = "POST_DECISION";
  else if (context && (context.controdeduzioniValutate || context.checklistContraddittorioCompleta)) authoritativePhase = "DECISION";
  else if (context && (context.comunicazioneAvvioInviata || context.contestazioneFormaleInviata
    || context.memorieRicevute || context.audizioneSvolta)) authoritativePhase = "INSTRUCTION";

  let documentaryPhase: ActPhase = "INITIAL";
  const phaseSignals: string[] = [];
  for (const [phase, pattern] of DOCUMENTARY_PHASE_SIGNALS) {
    const matches = evidenceTexts.filter((text) =>
      pattern.test(text) && (phase !== "POST_DECISION" || !TENTATIVE_SIGNAL.test(text)));
    if (matches.length > 0) {
      documentaryPhase = phase;
      phaseSignals.push(...matches);
      break;
    }
  }
  const documentaryAhead = PHASE_ORDER.indexOf(documentaryPhase) > PHASE_ORDER.indexOf(authoritativePhase);
  const phase = documentaryAhead ? documentaryPhase : authoritativePhase;
  const documentarySignals = [...new Set([...(documentaryAhead ? phaseSignals : []), ...reviewSignals])].slice(0, 5);
  return { phase, reviewPending, authoritativePhase, documentaryAhead, documentarySignals };
}

export function fillTemplatePlaceholders(
  body: string,
  payload: Pick<StructuredFascicoloReportPayload, "proceduralContext"> | null,
  context: ActTemplateContext,
): string {
  const procedural = payload?.proceduralContext;
  const replacements: Array<[RegExp, string | null | undefined]> = [
    [/\[CONCESSIONE\]/g, procedural?.concessione?.numeroAtto],
    [/\[RESPONSABILE\]/g, context.responsabile],
    [/\[UNITÀ ORGANIZZATIVA\]/g, context.unitaOrganizzativa],
    [/\[PROCEDIMENTO\]/g, context.procedimentoLabel],
    [/\[TITOLO\/ATTO\]/g, procedural?.finalAct
      ? `provvedimento n. ${procedural.finalAct.numeroAtto} del ${procedural.finalAct.dataAtto}`
      : null],
  ];
  return replacements.reduce(
    (text, [pattern, value]) => value && value.trim() ? text.replace(pattern, value.trim()) : text,
    body,
  );
}

function planTemplates(payload: Pick<StructuredFascicoloReportPayload, "operationalPlans"> | null, phase: ActPhase): ActTemplate[] {
  const templates = new Map<string, ActTemplate>();
  for (const plan of payload?.operationalPlans ?? []) {
    for (const step of plan.steps) {
      if (!step.draftTemplate) continue;
      const title = step.draftTitle ?? step.title;
      const templateKey = `PLAN:${title}`;
      if (templates.has(templateKey)) continue;
      templates.set(templateKey, {
        templateKey,
        title,
        legalBasis: `Percorso operativo del rapporto professionale – ${plan.issueText}`,
        phases: [phase],
        body: step.draftTemplate,
        source: "REPORT_PLAN",
        issueSemanticKey: plan.issueSemanticKey,
      });
    }
  }
  return [...templates.values()];
}

export function buildActTemplateCatalog(input: {
  payload: PhasePayload | null;
  context: ActTemplateContext;
}): ActTemplateCatalog {
  const detection = detectActPhase(input.payload);
  const { phase } = detection;
  const fill = (template: ActTemplate): ActTemplate => ({
    ...template,
    body: fillTemplatePlaceholders(template.body, input.payload, input.context),
  });
  const applications = input.payload?.legalApplication ?? [];
  const documented = (status: string) => status === "PROVEN" || status === "INDICATED";
  const requirementMet = (requires: NonNullable<ActTemplate["requires"]>) => applications.some((entry) => {
    const analysis = entry.elementAnalysis;
    return analysis?.profileId === requires.profile && requires.elements.every((elementId) =>
      documented((analysis.elements ?? []).find((element) => element.elementId === elementId)?.status ?? "NOT_PROVEN"));
  });
  // Decadence is contestable only where a profile has all substantive core elements documented,
  // or where an unprofiled issue explicitly concerns a breach; legacy payloads keep the generic behaviour.
  const decadenceContestable = applications.length === 0 || applications.some((entry) => {
    const analysis = entry.elementAnalysis;
    if (!analysis) return /decadenz|inadempi|violazion|abusiv|omess|mancat\w* (?:pagament|esecuzion)/i.test(entry.issueText);
    return (analysis.elements ?? []).filter((element) => element.core).every((element) => documented(element.status));
  });
  const concessionMatter = applications.length === 0
    || Boolean(input.payload?.proceduralContext?.concessione)
    || Boolean(input.payload?.portRegime)
    || applications.some((entry) => /concession|demani|banchin|portual|canone/i.test(entry.issueText))
    || documentaryEvidence(input.payload).some((text) => /concession\w* demanial|demanio marittim|area demanial/i.test(text));
  const pertinent = (template: ActTemplate) =>
    template.phases.includes(phase)
    && concessionMatter
    && !alreadyPerformed(template, input.payload?.proceduralContext)
    && (template.templateKey !== "CATALOG:CONTESTAZIONE_DECADENZA" || decadenceContestable)
    && (!template.requires || requirementMet(template.requires));
  const fromPlans = planTemplates(input.payload, phase).map(fill);
  const catalog = CATALOG.map(fill);
  return {
    ...detection,
    recommended: [...fromPlans, ...catalog.filter(pertinent)],
    others: catalog.filter((template) => !pertinent(template)),
  };
}

export function findActTemplate(catalog: ActTemplateCatalog, templateKey: string): ActTemplate | null {
  return [...catalog.recommended, ...catalog.others].find((template) => template.templateKey === templateKey) ?? null;
}
