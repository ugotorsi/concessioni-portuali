import type { StructuredKnowledgeReadItem } from "@/server/queries/fascicolo-knowledge";

/**
 * Element-by-element assessment of the typical port-concession issues. Each element is a
 * requirement of the legal provision (fattispecie); evidence is searched sentence by sentence
 * in the knowledge items linked to the issue, honouring negations, and never inferred.
 */

export type LegalElementStatus = "PROVEN" | "INDICATED" | "NOT_PROVEN" | "CONTRARY_EVIDENCE";

export interface LegalElementEvidence {
  text: string;
  pages: readonly number[];
  humanConfirmed: boolean;
}

export interface LegalElementAssessment {
  elementId: string;
  requirement: string;
  legalBasis: string;
  core: boolean;
  status: LegalElementStatus;
  evidence: readonly LegalElementEvidence[];
  reasoning: string;
}

export interface LegalIssueProfileAssessment {
  profileId: IssueProfileId;
  label: string;
  elements: readonly LegalElementAssessment[];
  qualification: string;
  ruleIds: readonly string[];
}

export type IssueProfileId = "THIRD_PARTY_USE" | "INVESTMENT_DEFAULT" | "UNAUTHORIZED_OCCUPATION" | "FEE_PAYMENT";

export interface ProfileProceduralState {
  contestazioneFormaleInviata: boolean;
  memorieRicevute: boolean;
  controdeduzioniValutate: boolean;
}

interface ElementSpec {
  id: string;
  requirement: string;
  legalBasis: string;
  core: boolean;
  supports?: RegExp;
  /** Evidence that the element is not met (e.g. a documented authorization). */
  contrary?: RegExp;
  /** When false, contrary evidence is ignored in negated sentences. */
  contraryInNegatedSentences?: boolean;
  missing: string;
  procedural?: boolean;
}

interface ProfileSpec {
  id: IssueProfileId;
  label: string;
  trigger: RegExp;
  ruleIds: readonly string[];
  elements: readonly ElementSpec[];
  qualify: (met: (id: string) => boolean, status: (id: string) => LegalElementStatus) => string;
}

const NEGATION = /\b(?:non|senza|manca\w*|mancan\w*|privo|priva|assenza|assente|nessun\w*|né)\b/i;

const CONTRADDITTORIO: ElementSpec = {
  id: "contraddittorio",
  requirement: "Contestazione specifica e termine per le deduzioni prima di qualsiasi misura",
  legalBasis: "Art. 47, ultimo comma, cod. nav.; artt. 7, 10 e 10-bis L. 241/1990; art. 18, comma 11, L. 84/1994",
  core: false,
  procedural: true,
  missing: "Predisporre la contestazione degli addebiti con termine per le deduzioni.",
};

function strength(status: (id: string) => LegalElementStatus, ids: readonly string[]): string {
  return ids.every((id) => status(id) === "PROVEN") ? "provata" : "indiziaria (elementi non ancora confermati dal professionista)";
}

const PROFILES: readonly ProfileSpec[] = [
  {
    id: "THIRD_PARTY_USE",
    label: "Uso del bene in concessione da parte di soggetto diverso dal concessionario",
    trigger: /terz\w* operator|uso da parte di terz|affid\w*[^.]{0,40}(?:a terz|ad altr)|sub-?concession|subingress|sostituzion\w* (?:di altri|nel godimento)/i,
    ruleIds: ["L84_ART18", "COD_NAV_45BIS", "COD_NAV_46", "COD_NAV_47", "L84_ART16", "L241_PARTECIPAZIONE"],
    elements: [
      {
        id: "third-party-use",
        requirement: "Godimento o gestione stabile di parte del bene da parte di un soggetto diverso dal concessionario",
        legalBasis: "Art. 18, comma 9, L. 84/1994 (esercizio diretto); art. 47, lett. e), cod. nav.",
        core: true,
        supports: /attribuisce stabilmente|propri[oa] personale|(?:terz\w*|altra societ\w*|societ[àa] [A-Z]\w+|operatore)[^.]{0,80}(?:utilizz|occup|gestis|gestion|detien|custodi|attrezzatur)|(?:contratto|accordo)[^.]{0,60}(?:locazion|comodat|affid|sub)/i,
        missing: "Acquisire contratto, verbali di sopralluogo e prove dell'uso effettivo da parte del terzo.",
      },
      {
        id: "no-authorization",
        requirement: "Assenza di autorizzazione dell'autorità concedente all'affidamento o al subingresso",
        legalBasis: "Artt. 45-bis e 46 cod. nav.; art. 18, comma 9, ultimo periodo, L. 84/1994",
        core: true,
        supports: /(?:non (?:è|e'|risulta|sono|risultano) (?:allegat|presente|rilasciat|stat)\w*|senza|manca\w*|privo|privi|assenza)[^.]{0,80}(?:assenso|autorizzazion|nulla ?osta|atti? dell'AdSP)/i,
        contrary: /(?:autorizzazion|assenso|nulla ?osta)\w*[^.]{0,60}(?:rilasciat|concess|accordat|\bprot\b|\bn\b\s*\d|\bdel \d{1,2}\/\d{1,2}\/\d{4}|in data)|(?:presente|agli atti|risulta|allegat\w*)[^.]{0,30}(?:l'|un'|la |una )?(?:autorizzazion|assenso|nulla ?osta)/i,
        contraryInNegatedSentences: false,
        missing: "Chiedere all'ufficio demanio conferma scritta dell'esistenza o meno di autorizzazioni ex artt. 45-bis/46 cod. nav. o art. 18, comma 9.",
      },
      {
        id: "activity-nature",
        requirement: "Natura dell'attività affidata (oggetto principale della concessione oppure attività secondaria o del ciclo operativo) e sua durata",
        legalBasis: "Art. 45-bis cod. nav. (primo e secondo periodo); art. 18, comma 9, ultimo periodo, L. 84/1994",
        core: false,
        supports: /attivit\w* (?:principal|secondari|accessori)|ciclo operativo|magazzin|deposit\w* (?:merci|di)|movimentazion|stoccaggi|durata[^.]{0,30}(?:contratto|affidament)/i,
        missing: "Confrontare l'oggetto del contratto con l'oggetto della concessione e con il programma di attività.",
      },
      CONTRADDITTORIO,
    ],
    qualify: (met, status) => {
      if (!met("third-party-use")) {
        return "Il godimento del bene da parte di un terzo non risulta documentato: la questione resta un'ipotesi da verificare con sopralluogo e acquisizione del contratto; nessuna misura è allo stato fondata.";
      }
      if (!met("no-authorization")) {
        return status("no-authorization") === "CONTRARY_EVIDENCE"
          ? "Risulta un atto di assenso o autorizzazione: occorre verificarne oggetto, durata e limiti; se l'uso del terzo vi rientra, l'addebito non sussiste."
          : "L'uso da parte del terzo è documentato, ma non è accertata l'assenza di autorizzazione: prima di qualificare la condotta occorre verificare presso l'autorità concedente gli atti ex artt. 45-bis e 46 cod. nav. e art. 18, comma 9, L. 84/1994.";
      }
      return [
        `Gli elementi documentati integrano, in forma ${strength(status, ["third-party-use", "no-authorization"])}, un godimento di parte del bene da parte di soggetto diverso dal concessionario in assenza di autorizzazione.`,
        "La condotta rileva come violazione dell'obbligo di esercizio diretto dell'attività (art. 18, comma 9, L. 84/1994) e può configurare l'abusiva sostituzione di altri nel godimento della concessione (art. 47, lett. e, cod. nav.), che è causa tipica di decadenza; in ambito portuale concorre la decadenza speciale dell'art. 18, comma 11, per inosservanza degli obblighi «senza giustificato motivo».",
        met("activity-nature")
          ? "La natura dell'attività affidata è documentata e va confrontata con l'oggetto del titolo: se si tratta di attività secondaria o di segmento del ciclo operativo affidabile a impresa autorizzata ex art. 16, la regolarizzazione mediante autorizzazione (art. 45-bis, secondo periodo; art. 18, comma 9, ultimo periodo) è il rimedio proporzionato da valutare prima della decadenza; se riguarda l'oggetto principale, l'autorizzazione è ammessa solo in casi eccezionali e per periodi determinati (art. 45-bis, primo periodo)."
          : "Va accertato se l'attività affidata sia principale o secondaria e per quale durata: da ciò dipende se sia possibile una regolarizzazione (art. 45-bis; art. 18, comma 9, ultimo periodo) o se residui soltanto il procedimento di decadenza.",
        "La decadenza non è automatica: richiede contestazione, termine per le deduzioni, valutazione di eventuali giustificazioni e proporzionalità rispetto alla gravità e alla durata dell'uso non autorizzato.",
      ].join(" ");
    },
  },
  {
    id: "INVESTMENT_DEFAULT",
    label: "Mancata o ritardata esecuzione degli investimenti del programma di attività",
    trigger: /investiment|programma di attivit|cronoprogramma|opere? (?:previst|prescritt)|\bPEF\b|piano economico/i,
    ruleIds: ["L84_ART18", "COD_NAV_47", "DM_202_2022", "ART_242_2025", "L241_PARTECIPAZIONE"],
    elements: [
      {
        id: "obligation",
        requirement: "Obbligo di investimento o di esecuzione di opere con termine determinato nel titolo o nel programma di attività",
        legalBasis: "Art. 18, comma 8, lett. a), L. 84/1994; titolo concessorio; art. 47, lett. a), cod. nav.",
        core: true,
        supports: /(?:investiment|opere?|intervent|lavori)[^.]{0,100}(?:entro|termine|scadenz|cronoprogramma|programma|anno|\d{4})|(?:entro|termine)[^.]{0,60}(?:investiment|opere|intervent|lavori)|programma di attivit\w*[^.]{0,160}\bentro\b/i,
        missing: "Individuare nel titolo e nel programma di attività l'obbligo specifico e il relativo termine.",
      },
      {
        id: "non-performance",
        requirement: "Mancata, ritardata o incompleta esecuzione accertata alla scadenza",
        legalBasis: "Art. 18, commi 10 e 11, L. 84/1994; art. 9 D.I. 202/2022",
        core: true,
        supports: /ritard|non (?:ancora )?(?:realizzat|eseguit|completat|avviat|ultimat)|mancat\w* (?:esecuzion|realizzazion|avvio|completament)|incomplet|sospes|parzialment\w* (?:eseguit|realizzat)|stato di avanzamento[^.]{0,40}(?:\d+ ?%)/i,
        missing: "Acquisire il verbale della verifica annuale o di sopralluogo sullo stato di avanzamento.",
      },
      {
        id: "no-justification",
        requirement: "Assenza di giustificato motivo (cause non imputabili, ritardi autorizzativi, forza maggiore)",
        legalBasis: "Art. 18, comma 11, L. 84/1994; art. 47, comma 2, cod. nav. (proroga per le lett. a e b)",
        core: true,
        supports: /senza (?:giustificat|alcun motiv)|imputabil\w* (?:al|alla) concessionari|nessuna (?:giustificazion|causa)/i,
        contrary: /in attesa di (?:autorizzazion|parere|approvazion|titol)|ritard\w*[^.]{0,30}(?:dell'amministrazion|dell'AdSP|nel rilascio|autorizzativ)|non imputabil|forza maggiore|richiesta di proroga|istanza di (?:proroga|revisione)|autorizzazion\w*[^.]{0,30}non (?:ancora )?rilasciat|titolo allo scarico|progetto[^.]{0,30}(?:non )?approvat/i,
        contraryInNegatedSentences: true,
        missing: "Verificare istanze di proroga o revisione, ritardi di altre amministrazioni e cause non imputabili prima di contestare.",
      },
      CONTRADDITTORIO,
    ],
    qualify: (met, status) => {
      if (!met("obligation")) return "L'obbligo di investimento con termine determinato non è documentato: senza la clausola del titolo o del programma non è possibile qualificare un inadempimento.";
      if (!met("non-performance")) return "L'obbligo è documentato, ma lo stato di esecuzione alla scadenza non risulta accertato: occorre la verifica annuale (art. 18, comma 10; art. 9 D.I. 202/2022) prima di ogni contestazione.";
      const justification = status("no-justification") === "CONTRARY_EVIDENCE"
        ? "I documenti segnalano possibili cause giustificative (ritardi autorizzativi, approvazioni mancanti o istanze di proroga): l'art. 18, comma 11, ammette la decadenza solo «senza giustificato motivo», sicché tali cause vanno istruite e valutate prima di qualsiasi misura; per le lett. a) e b) dell'art. 47 l'amministrazione può accordare una proroga."
        : met("no-justification")
          ? "L'assenza di giustificato motivo risulta dai documenti, ma va confermata nel contraddittorio."
          : "Non risulta ancora accertata l'assenza di giustificato motivo, requisito espresso dell'art. 18, comma 11: va verificata nel contraddittorio.";
      return [
        `Obbligo e inadempimento risultano in forma ${strength(status, ["obligation", "non-performance"])}.`,
        justification,
        "Il rimedio va graduato: verifica annuale e diffida ad adempiere, eventuale revisione del programma o del PEF (da notificare ad ART se successiva al 01/03/2026, misura 3.7), penali solo se predeterminate nel bando o nel titolo (misura 2.10 della delibera 57/2018; misura 3.18 della delibera 242/2025), decadenza come extrema ratio.",
      ].join(" ");
    },
  },
  {
    id: "UNAUTHORIZED_OCCUPATION",
    label: "Occupazioni o opere eccedenti il titolo o in aree non assentite",
    trigger: /occupazion|area di sicurezza|aree? estern|manufatt|abusiv|innovazion|eccedent|container|prefabbricat/i,
    ruleIds: ["COD_NAV_54", "L84_ART18", "COD_NAV_47", "L241_PARTECIPAZIONE"],
    elements: [
      {
        id: "material-finding",
        requirement: "Occupazione o opera materialmente accertata (sopralluogo, verbale, rilievo fotografico)",
        legalBasis: "Art. 54 cod. nav.",
        core: true,
        supports: /(?:verbale|sopralluogo|accertat|rilevat|fotograf|ispezion)[^.]{0,100}(?:occup|manufatt|container|deposit|stoccagg|mezzi|materiali)|(?:occup|manufatt|container|deposit|stoccagg)[^.]{0,100}(?:verbale|sopralluogo|accertat|rilevat|fotograf)/i,
        missing: "Disporre o acquisire il verbale di sopralluogo con planimetria e rilievo fotografico.",
      },
      {
        id: "outside-title",
        requirement: "Localizzazione fuori dal perimetro concesso o in aree vincolate (es. aree di sicurezza)",
        legalBasis: "Art. 18, comma 9, L. 84/1994 (divieto di attività in spazi diversi da quelli assegnati); art. 54 cod. nav.",
        core: true,
        supports: /(?:fuori|estern\w*|eccedent\w*|oltre|esterna)[^.]{0,50}(?:perimetr|area|concession|confin)|area di sicurezza|aree? non (?:concess|assentit)/i,
        missing: "Sovrapporre i rilievi alla planimetria allegata al titolo.",
      },
      {
        id: "no-title",
        requirement: "Assenza di titolo, autorizzazione o assenso per l'area occupata",
        legalBasis: "Art. 54 cod. nav.; art. 24 reg. nav. mar. (variazioni del contenuto della concessione)",
        core: true,
        supports: /(?:senza|privo|privi|assenza|non (?:autorizzat|assentit|concess))[^.]{0,60}(?:titolo|autorizzazion|assenso|concession)/i,
        contrary: /(?:autorizzazion|assenso|variazion\w* (?:autorizzat|assentit))[^.]{0,50}(?:rilasciat|concess|accordat|\bn\b\s*\d|\bprot\b)/i,
        contraryInNegatedSentences: false,
        missing: "Verificare l'esistenza di autorizzazioni temporanee o variazioni assentite.",
      },
      {
        id: "safety",
        requirement: "Incidenza su sicurezza, vie di fuga o operatività portuale",
        legalBasis: "Ordinanze dell'Autorità marittima e dell'AdSP; art. 54 cod. nav.",
        core: false,
        supports: /sicurezza|antincendi|vie di fuga|rischi|interferenz|operativit\w* (?:portual|della banchina)/i,
        missing: "Acquisire valutazione dell'ufficio sicurezza e della Capitaneria.",
      },
      CONTRADDITTORIO,
    ],
    qualify: (met, status) => {
      if (!met("material-finding")) return "L'occupazione non risulta accertata con atto di sopralluogo: occorre un accertamento formale prima di qualsiasi ingiunzione.";
      return [
        `L'occupazione risulta accertata in forma ${strength(status, ["material-finding"])}${met("outside-title") ? " ed è localizzata fuori dal perimetro del titolo o in area vincolata" : "; la localizzazione rispetto al perimetro concesso va ancora verificata"}.`,
        met("no-title")
          ? "In assenza di titolo per l'area, l'autorità competente può ingiungere la rimessa in pristino ai sensi dell'art. 54 cod. nav., potere autonomo e distinto dalla decadenza; l'uso di spazi diversi da quelli assegnati viola anche l'art. 18, comma 9, L. 84/1994 e può essere contestato come inosservanza degli obblighi (art. 47, lett. f, cod. nav.)."
          : status("no-title") === "CONTRARY_EVIDENCE"
            ? "Risulta un possibile titolo o assenso per l'area: verificarne oggetto e durata prima di procedere."
            : "Va accertata l'assenza di titolo o di variazione assentita per l'area occupata.",
        met("safety") ? "L'incidenza sulla sicurezza giustifica misure urgenti di sgombero coordinate con l'Autorità marittima, indipendentemente dall'esito del procedimento concessorio." : "",
        "Eventuali profili penali (art. 1161 cod. nav.) spettano all'autorità giudiziaria: il fascicolo deve limitarsi alla segnalazione dei fatti accertati.",
      ].filter(Boolean).join(" ");
    },
  },
  {
    id: "FEE_PAYMENT",
    label: "Canoni demaniali: omesso o parziale pagamento",
    trigger: /canon|pagament|\brat[ae]\b|bonific|morosit|rateizz|compensaz/i,
    ruleIds: ["COD_NAV_47", "DM_202_2022", "L241_PARTECIPAZIONE"],
    elements: [
      {
        id: "fee-due",
        requirement: "Canone determinato nel titolo con importo e scadenze",
        legalBasis: "Titolo concessorio; art. 47, lett. d), cod. nav.",
        core: true,
        supports: /canon\w*[^.]{0,100}(?:€|euro|annu|rat[ae]|scadenz|import)|rat[ae] (?:contrattual|annual|semestral|trimestral)\w*[^.]{0,60}(?:€|euro|scadenz)/i,
        missing: "Acquisire la clausola del titolo su importo, rate e scadenze del canone.",
      },
      {
        id: "non-payment",
        requirement: "Omesso o parziale pagamento accertato",
        legalBasis: "Art. 47, lett. d), cod. nav.",
        core: true,
        supports: /(?:omess|parzial|mancat|insolut|residu|non (?:versat|pagat|corrispost))\w*[^.]{0,60}(?:pagament|canon|rat|import|versament)|(?:pagament|versament)\w*[^.]{0,30}(?:parzial|omess|insufficient)|(?:acconto|in parte)[^.]{0,60}\brat[ae]\b|(?:\brat[ae]\b|canon\w*|euro|€|import\w*|somm\w*)[^.]{0,80}(?:non (?:\w+ )?(?:versat|pagat|corrispost)|insolut|(?:solo )?in acconto|in parte|parzialmente)/i,
        missing: "Acquisire l'estratto contabile delle somme dovute e versate.",
      },
      {
        id: "rate-threshold",
        requirement: "Raggiungimento del numero di rate omesse fissato dall'atto di concessione come causa di decadenza",
        legalBasis: "Art. 47, lett. d), cod. nav.",
        core: true,
        supports: /numero di rate|(?:due|tre|\d+) rate[^.]{0,40}(?:omess|non pagat|insolut|scadut)|decadenz\w*[^.]{0,60}(?:rat[ae]|canon)/i,
        missing: "Verificare nel titolo il numero di rate la cui omissione determina la decadenza e confrontarlo con le rate effettivamente insolute.",
      },
      {
        id: "imputation",
        requirement: "Pagamenti non imputati, proposte di rateizzazione o compensazione",
        legalBasis: "Artt. 1193 e 1241 ss. c.c.",
        core: false,
        supports: /bonific\w*[^.]{0,60}(?:non imputat|senza causale|non attribuit|qualificat\w* come acconto)|compensaz|rateizz|imputazion/i,
        missing: "Ricostruire i versamenti e la relativa imputazione.",
      },
      CONTRADDITTORIO,
    ],
    qualify: (met, status) => {
      if (!met("fee-due")) return "Importo e scadenze del canone non risultano dal fascicolo: il credito non è ancora quantificabile.";
      if (!met("non-payment")) return "Il canone è documentato ma l'inadempimento non è accertato: occorre l'estratto contabile.";
      return [
        `L'omesso o parziale pagamento risulta in forma ${strength(status, ["fee-due", "non-payment"])}.`,
        met("rate-threshold")
          ? "La soglia di rate prevista dal titolo appare raggiunta: la decadenza ex art. 47, lett. d), è astrattamente configurabile, previa contestazione e valutazione delle deduzioni."
          : "La decadenza ex art. 47, lett. d), presuppone l'omissione del numero di rate fissato «a questo effetto» dall'atto di concessione: finché tale soglia non è verificata nel titolo, il rimedio proprio è il recupero del credito con interessi, non la decadenza.",
        met("imputation")
          ? "I versamenti non imputati vanno attribuiti secondo l'art. 1193 c.c.; una proposta di rateizzazione o compensazione non accettata non estingue il debito, e la compensazione opera solo nei presupposti degli artt. 1241 ss. c.c."
          : "",
        "Solo se il titolo è anteriore al 15/01/2023 il canone è soggetto alla rivalutazione annuale ISTAT prevista dall'art. 10, comma 2, D.I. 202/2022; per i titoli successivi valgono importo e aggiornamento fissati nel titolo secondo il regolamento.",
      ].filter(Boolean).join(" ");
    },
  },
];

const ABBREVIATION_DOT = /\b(artt?|nn?|prot|lett|cod|nav|civ|proc|amm|cfr|pagg?|co|c|L|D|I|M|P|R|G|U|dott|avv|ing|sig|soc|s\.r\.l|s\.p\.a)\./gi;

function sentences(text: string): string[] {
  return text
    .replace(ABBREVIATION_DOT, "$1")
    .replace(/(\d)\.(?=\d{3}\b)/g, "$1")
    .split(/(?<=[.;])\s+(?=[A-ZÀ-ÖØ-Ý«"(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function pagesOf(item: StructuredKnowledgeReadItem): number[] {
  return [...new Set(item.evidence.map((evidence) => evidence.pageNumber))].sort((left, right) => left - right);
}

function evidenceFor(items: readonly StructuredKnowledgeReadItem[], pattern: RegExp, accept: (sentence: string) => boolean): LegalElementEvidence[] {
  const found = new Map<string, LegalElementEvidence>();
  for (const item of items) {
    if (sentences(item.normalizedText).some((sentence) => pattern.test(sentence) && accept(sentence))) {
      found.set(item.normalizedText, { text: item.normalizedText, pages: pagesOf(item), humanConfirmed: item.status === "HUMAN_CONFIRMED" });
    }
  }
  return [...found.values()];
}

export function selectIssueProfile(issueText: string, caseText: string): ProfileSpec | null {
  return PROFILES.find((profile) => profile.trigger.test(issueText))
    ?? PROFILES.find((profile) => profile.trigger.test(caseText))
    ?? null;
}

export function assessIssueProfile(input: {
  issueText: string;
  relatedItems: readonly StructuredKnowledgeReadItem[];
  procedural: ProfileProceduralState | null;
  /** ISO date of the analysis; obligations whose documented deadline is later cannot be breached yet. */
  analysisDate?: string;
}): LegalIssueProfileAssessment | null {
  const caseText = input.relatedItems.map((item) => item.normalizedText).join(" \n ");
  const profile = selectIssueProfile(input.issueText, caseText);
  if (!profile) return null;
  const elements = profile.elements.map((spec): LegalElementAssessment => {
    if (spec.procedural) {
      const contested = input.procedural?.contestazioneFormaleInviata ?? false;
      return {
        elementId: spec.id,
        requirement: spec.requirement,
        legalBasis: spec.legalBasis,
        core: spec.core,
        status: contested ? "PROVEN" : "NOT_PROVEN",
        evidence: [],
        reasoning: contested
          ? `Contestazione formale registrata${input.procedural?.memorieRicevute ? "; memorie ricevute" : ""}${input.procedural?.controdeduzioniValutate ? "; controdeduzioni valutate" : "; valutazione delle deduzioni ancora da documentare"}.`
          : `Nessuna contestazione formale registrata nel fascicolo. ${spec.missing}`,
      };
    }
    const contrary = spec.contrary
      ? evidenceFor(input.relatedItems, spec.contrary, (sentence) => spec.contraryInNegatedSentences !== false || !NEGATION.test(sentence))
      : [];
    const supporting = spec.supports ? evidenceFor(input.relatedItems, spec.supports, () => true) : [];
    const status: LegalElementStatus = contrary.length
      ? "CONTRARY_EVIDENCE"
      : supporting.length
        ? supporting.some((evidence) => evidence.humanConfirmed) ? "PROVEN" : "INDICATED"
        : "NOT_PROVEN";
    const evidence = status === "CONTRARY_EVIDENCE" ? contrary : supporting;
    const where = (list: readonly LegalElementEvidence[]) => {
      const pages = [...new Set(list.flatMap((entry) => entry.pages))].sort((left, right) => left - right);
      return pages.length ? ` (pag. ${pages.join(", ")})` : "";
    };
    return {
      elementId: spec.id,
      requirement: spec.requirement,
      legalBasis: spec.legalBasis,
      core: spec.core,
      status,
      evidence,
      reasoning: status === "PROVEN"
        ? `Elemento documentato e confermato dal professionista${where(evidence)}.`
        : status === "INDICATED"
          ? `Elemento risultante dai documenti${where(evidence)}, non ancora confermato dal professionista.`
          : status === "CONTRARY_EVIDENCE"
            ? `I documenti contengono elementi contrari o giustificativi${where(evidence)} da valutare prima di ritenere integrato il requisito.`
            : `Nessun riscontro documentale. ${spec.missing}`,
    };
  });
  const byId = new Map(elements.map((element) => [element.elementId, element]));
  let pendingDeadline: string | null = null;
  if (profile.id === "INVESTMENT_DEFAULT" && input.analysisDate) {
    const deadlines = (byId.get("obligation")?.evidence ?? []).flatMap((entry) =>
      [...entry.text.matchAll(/\bentro (?:il |la data del )?(\d{1,2})\/(\d{1,2})\/(\d{4})/gi)]
        .map(([, day, month, year]) => `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`));
    const performance = byId.get("non-performance");
    if (deadlines.length > 0 && deadlines.every((deadline) => deadline > input.analysisDate!) && performance) {
      pendingDeadline = deadlines.sort().at(-1)!.split("-").reverse().join("/");
      byId.set("non-performance", {
        ...performance,
        status: "NOT_PROVEN",
        evidence: [],
        reasoning: `Il termine documentato (${pendingDeadline}) non è ancora scaduto alla data dell'analisi: l'inadempimento non è configurabile; resta possibile solo il monitoraggio dello stato di avanzamento (art. 18, comma 10, L. 84/1994; art. 9 D.I. 202/2022).`,
      });
    }
  }
  const finalElements = elements.map((element) => byId.get(element.elementId)!);
  const status = (id: string) => byId.get(id)?.status ?? "NOT_PROVEN";
  const met = (id: string) => ["PROVEN", "INDICATED"].includes(status(id));
  return {
    profileId: profile.id,
    label: profile.label,
    elements: finalElements,
    qualification: pendingDeadline
      ? `L'obbligo di investimento è documentato con termine al ${pendingDeadline}, non ancora scaduto: nessun inadempimento è allo stato configurabile e non sono pertinenti diffide, penali o decadenza. Resta la vigilanza tramite verifica annuale dello stato di avanzamento (art. 18, comma 10, L. 84/1994; art. 9 D.I. 202/2022) e, per i titoli soggetti alla delibera ART 242/2025, il monitoraggio della misura 3.18.`
      : profile.qualify(met, status),
    ruleIds: profile.ruleIds,
  };
}

export const LEGAL_ELEMENT_STATUS_LABELS: Readonly<Record<LegalElementStatus, string>> = {
  PROVEN: "Provato",
  INDICATED: "Risulta dai documenti, da confermare",
  NOT_PROVEN: "Non provato",
  CONTRARY_EVIDENCE: "Elementi contrari o giustificativi",
};
