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
  /** True when the item was not linked to the issue by extraction but found among related fascicolo facts. */
  linkedByTopic?: boolean;
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
  /** Documented deadline (dd/mm/yyyy) not yet expired at the analysis date, when it excludes any breach. */
  pendingDeadline?: string | null;
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
  rejectNegatedSupport?: boolean;
  rejectSupport?: RegExp;
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
const NEGATED_POSITIVE_SUPPORT = /\b(?:non|mai|nessun\w*|né|assente|manca(?:no)?)\b|\b(?:senza|privo|priva|privi|prive|assenza(?:\s+di)?)\s+(?:(?:di|un[oa]?|il|la|alcun\w*)\s+){0,3}(?:occup\w*|sopralluog\w*|verbale|investiment\w*|obblig\w*|rischi\w*|pericol\w*|interferenz\w*|canon\w*|pagament\w*|terz\w*|attivit\w*)\b/i;
const NEGATED_FACT_ASSERTION = /\bnon\s+(?:(?:si|vi)\s+)?(?:risultan\w*|emerg\w*|(?:è|e'|sono)\s+(?:vero|ver[ai]|accertat\w*|dimostrat\w*|provat\w*)|afferma\w*|sostien\w*)\b/i;

const CONTRADDITTORIO: ElementSpec = {
  id: "contraddittorio",
  requirement: "Contestazione specifica e termine per le deduzioni prima di qualsiasi misura",
  legalBasis: "Art. 47, ultimo comma, cod. nav.; artt. 7 e 10 L. 241/1990; art. 18, comma 11, L. 84/1994",
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
        legalBasis: "Art. 45-bis cod. nav.; art. 18, comma 9, L. 84/1994; artt. 46 e 47, lett. e), cod. nav. solo se ricorre sostituzione nel godimento",
        core: true,
        supports: /attribuisce stabilmente|propri[oa] personale|(?:terz\w*|altra societ\w*|societ[àa] [A-Z]\w+|operatore)[^.]{0,80}(?:utilizz|occup|gestis|gestion|detien|custodi|attrezzatur)|(?:contratto|accordo)[^.]{0,60}(?:locazion|comodat|affid|sub)/i,
        rejectNegatedSupport: true,
        missing: "Acquisire contratto, verbali di sopralluogo e prove dell'uso effettivo da parte del terzo.",
      },
      {
        id: "no-authorization",
        requirement: "Assenza di autorizzazione dell'autorità concedente all'affidamento o al subingresso",
        legalBasis: "Artt. 45-bis e 46 cod. nav.; art. 18, comma 9, ultimo periodo, L. 84/1994",
        core: true,
        supports: /(?:senza|privo|priva|privi|prive|in assenza di)\s+(?!(?:(?:il|la|un|una)\s+)?(?:document\w*|copia|att[oi]|evidenz\w*)\b)[^.]{0,40}(?:assenso|autorizzazion|nulla ?osta)|(?:nessun\w*[^.]{0,20})?(?:assenso|autorizzazion|nulla ?osta)[^.]{0,40}(?:non (?:è|e'|fu)(?: stata| stato)?|mai) rilasciat/i,
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
          : "L'uso da parte del terzo è documentato, ma non è accertata l'assenza di autorizzazione: il solo mancato reperimento del documento non dimostra che non sia stata rilasciata. Prima di qualificare la condotta verificare presso l'autorità concedente gli atti, la natura del rapporto e la disciplina applicabile.";
      }
      return [
        `Uso da parte di terzi e assenza di autorizzazione emergono in forma ${strength(status, ["third-party-use", "no-authorization"])}; la qualificazione del rapporto richiede la verifica del contratto, del titolo e dell'attività effettiva.`,
        "Gli istituti vanno distinti: l'art. 45-bis cod. nav. riguarda l'affidamento ad altri soggetti, previa autorizzazione, della gestione delle attività oggetto della concessione o di attività secondarie, senza che il concessionario perda la titolarità; l'art. 46 riguarda la sostituzione di altri nel godimento della concessione (subingresso), anch'essa soggetta ad autorizzazione; l'art. 47, lett. e), sanziona con la decadenza soltanto l'abusiva sostituzione nel godimento. Un incarico o un contratto con un terzo non integra di per sé la sostituzione: occorre accertare chi abbia la disponibilità del bene, chi sopporti gli obblighi del titolo e chi eserciti l'attività. Verificare anche la disciplina speciale portuale e le pattuizioni applicabili alle rispettive date.",
        met("activity-nature")
          ? "La natura dell'attività indicata va confrontata con il titolo e con i presupposti dell'eventuale autorizzazione, inclusa la disciplina speciale per le imprese portuali."
          : "Accertare l'attività effettivamente affidata, il suo rapporto con il titolo e la durata, prima di valutare eventuali rimedi.",
        "Dal 18/04/2001 l'art. 45-bis non richiede più, di per sé, casi eccezionali o periodi determinati, ma mantiene la previa autorizzazione; per fatti precedenti verificare il testo allora vigente. L'eventuale regolarizzazione non è automatica.",
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
        rejectNegatedSupport: true,
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
        "Il rimedio va graduato: verifica annuale e possibile diffida, eventuale revisione del programma o del PEF e valutazione delle penali e della decadenza. Prima di applicare le misure ART verificare ambito e presupposti: la misura 3.7 riguarda le istanze rilevanti e la misura 3.18 le penali definite in sede di bando; la misura 2.10 della delibera 57/2018 richiede la predeterminazione negli atti di concessione.",
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
        rejectNegatedSupport: true,
        missing: "Disporre o acquisire il verbale di sopralluogo con planimetria e rilievo fotografico.",
      },
      {
        id: "outside-title",
        requirement: "Localizzazione fuori dal perimetro concesso o in aree vincolate (es. aree di sicurezza)",
        legalBasis: "Art. 18, comma 9, L. 84/1994 (divieto di attività in spazi diversi da quelli assegnati); art. 54 cod. nav.",
        core: true,
        supports: /(?:fuori|estern\w*|eccedent\w*|oltre|esterna)[^.]{0,50}(?:perimetr|area|concession|confin)|(?:occup\w*|manufatt\w*|container)[^.]{0,80}(?:area|spazio)[^.]{0,30}(?:vincolat|vietat|interdett)|aree? non (?:concess|assentit)/i,
        rejectSupport: /\bnon\s+(?:(?:è|e'|sono|risulta|si trova|si trovano)\s+)?(?:fuori|estern\w*|eccedent\w*|oltre)\b/i,
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
        supports: /(?:rischi\w*|pericol\w*|ostacol\w*|compromett\w*|interferenz\w*|ostru\w*|imped\w*|blocc\w*)[^.]{0,80}(?:sicurezza|antincendi|vie di fuga|operativit\w* (?:portual|della banchina))|(?:sicurezza|antincendi|vie di fuga|operativit\w* (?:portual|della banchina))[^.]{0,80}(?:rischi\w*|pericol\w*|ostacol\w*|compromess\w*|interferenz\w*|ostru\w*|impedit\w*|blocc\w*)/i,
        rejectNegatedSupport: true,
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
        met("safety") ? "Il possibile impatto sulla sicurezza richiede una valutazione documentata, anche con l'Autorità marittima; urgenza, competenza e misure eventualmente necessarie devono essere verificate e motivate." : "",
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
        rejectNegatedSupport: true,
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
          ? "Il confronto preliminare tra titolo e dati contabili indica un possibile raggiungimento della soglia: verificare il riferimento allo stesso titolo, le condizioni della clausola e i pagamenti successivi. Solo se confermata, la decadenza ex art. 47, lett. d), è astrattamente configurabile, previa contestazione e valutazione delle deduzioni."
          : status("rate-threshold") === "CONTRARY_EVIDENCE"
            ? "Il dato contabile disponibile indica, alla data rilevata, un numero di rate insolute inferiore alla soglia del titolo; verificare eventuali omissioni successive e il riferimento alla stessa concessione prima di valutare la decadenza."
            : "La decadenza ex art. 47, lett. d), presuppone l'omissione del numero di rate fissato «a questo effetto» dall'atto di concessione: la sola menzione delle rate non consente di ritenere integrata la decadenza. Ricostruire il credito e valutare gli eventuali interessi dovuti prima di ogni iniziativa di recupero.",
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
    .split(/(?<=;)\s*|(?<=\.)\s+(?=[A-ZÀ-ÖØ-Ý«"(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function pagesOf(item: StructuredKnowledgeReadItem): number[] {
  return [...new Set(item.evidence.map((evidence) => evidence.pageNumber))].sort((left, right) => left - right);
}

const RATE_NUMBER = "(\\d{1,2}|zero|una|un|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)";
const RATE_WORDS: Readonly<Record<string, number>> = {
  zero: 0, un: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
};
const RATE_THRESHOLD = new RegExp(
  `\\b(?:decadenz\\w*|decade)\\b[^.]{0,120}\\b(?:omess[oa]|mancat[oa])\\s+(?:pagamento|versamento)\\s+(?:di|per)\\s+(?:almeno\\s+)?${RATE_NUMBER}\\s+rate\\b([^.;]*)`,
  "i",
);
const NEGATED_THRESHOLD_CLAUSE = /\b(?:non|senza|nessun\w*|né|assenza|assente|privo|priva|manca(?:no)?)\b/i;
const RATE_UNPAID = new RegExp(
  `\\brisultan[oa]\\s+(?:ancora\\s+)?${RATE_NUMBER}\\s+rate(?:\\s+(consecutiv\\w*))?(?:\\s+di\\s+canone)?\\s+(?:non\\s+pagat\\w*|insolut\\w*|omess\\w*)\\b`,
  "i",
);

function rateNumber(value: string): number | null {
  const result = RATE_WORDS[value.toLowerCase()] ?? Number(value);
  return Number.isInteger(result) && result >= 0 ? result : null;
}

function accountingDate(sentence: string, analysisDate: string): { iso: string; display: string } | null {
  const dates = [...sentence.matchAll(/\b(?:alla data del|al)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/gi)];
  if (dates.length !== 1) return null;
  const [, day, month, year] = dates[0];
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso || iso > analysisDate) return null;
  return { iso, display: `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}` };
}

function assessRateThreshold(
  spec: ElementSpec,
  items: readonly StructuredKnowledgeReadItem[],
  analysisDate: string | undefined,
): LegalElementAssessment {
  const unverified = (): LegalElementAssessment => ({
    elementId: spec.id, requirement: spec.requirement, legalBasis: spec.legalBasis, core: spec.core,
    status: "NOT_PROVEN", evidence: [], reasoning: `Il confronto fra soglia del titolo e rate insolute non è verificabile. ${spec.missing}`,
  });
  if (!analysisDate || items.some((item) => item.kind === "CONTRADICTION")) return unverified();
  const grants = items.filter((item) => {
    if (item.kind !== "LEGAL_ACT" || !item.evidence.length || !item.payload || typeof item.payload !== "object" || Array.isArray(item.payload)) return false;
    return typeof item.payload.actType === "string" && /concession/i.test(item.payload.actType);
  });
  if (grants.length !== 1) return unverified();
  const clauses = sentences(grants[0].normalizedText)
    .filter((sentence) => !NEGATED_THRESHOLD_CLAUSE.test(sentence))
    .map((sentence) => RATE_THRESHOLD.exec(sentence))
    .filter((match): match is RegExpExecArray => match !== null);
  if (clauses.length !== 1) return unverified();
  const threshold = rateNumber(clauses[0][1]);
  if (threshold === null || threshold < 1) return unverified();
  const consecutive = /\bconsecutiv\w*/i.test(clauses[0][2]);
  const counts = items
    .filter((item) => ["FACT", "EVENT"].includes(item.kind) && item.evidence.length > 0)
    .flatMap((item) => sentences(item.normalizedText).flatMap((sentence) => {
      if (/\bnon\s+risultan[oa]\b/i.test(sentence)) return [];
      const match = RATE_UNPAID.exec(sentence);
      const date = accountingDate(sentence, analysisDate);
      if (!match || !date || (consecutive && !match[2])) return [];
      const count = rateNumber(match[1]);
      return count === null ? [] : [{ item, count, date }];
    }));
  const distinctCounts = new Set(counts.map(({ count, date }) => `${count}:${date.iso}`));
  if (distinctCounts.size !== 1) return unverified();
  const [{ count, date }] = counts;
  const evidenceItems = [grants[0], ...counts.map((entry) => entry.item)];
  const evidence = [...new Map(evidenceItems.map((item) => [item.id, {
    text: item.normalizedText, pages: pagesOf(item), humanConfirmed: item.status === "HUMAN_CONFIRMED",
  }])).values()];
  return {
    elementId: spec.id, requirement: spec.requirement, legalBasis: spec.legalBasis, core: spec.core,
    status: count >= threshold ? "INDICATED" : "CONTRARY_EVIDENCE",
    evidence,
    reasoning: `Il titolo indica ${threshold} rate${consecutive ? " consecutive" : ""}; il dato contabile del ${date.display} riporta ${count} rate insolute. Il confronto è preliminare: verificare la stessa concessione, le altre condizioni della clausola e i pagamenti o le omissioni successivi.`,
  };
}

function evidenceFor(items: readonly StructuredKnowledgeReadItem[], pattern: RegExp, accept: (sentence: string) => boolean, linkedByTopic = false): LegalElementEvidence[] {
  const found = new Map<string, LegalElementEvidence>();
  for (const item of items) {
    if (sentences(item.normalizedText).some((sentence) => pattern.test(sentence) && accept(sentence))) {
      found.set(item.normalizedText, {
        text: item.normalizedText,
        pages: pagesOf(item),
        humanConfirmed: item.status === "HUMAN_CONFIRMED",
        ...(linkedByTopic ? { linkedByTopic: true } : {}),
      });
    }
  }
  return [...found.values()];
}

const ITALIAN_MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

function deadlinesIn(text: string): string[] {
  const numeric = [...text.matchAll(/\bentro (?:il |la data del )?(\d{1,2})[/.](\d{1,2})[/.](\d{4})/gi)]
    .map(([, day, month, year]) => `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`);
  const written = [...text.matchAll(/\bentro (?:il |la data del )?(\d{1,2})(?:°|º)? (gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre) (\d{4})/gi)]
    .map(([, day, month, year]) => `${year}-${String(ITALIAN_MONTHS.indexOf(month!.toLowerCase()) + 1).padStart(2, "0")}-${day!.padStart(2, "0")}`);
  return [...numeric, ...written];
}

/** Distinctive identifiers (I1, M4, C1, lotto 3…) shared by the issue and a fact are a stronger topical link than keywords. */
function distinctiveCodes(text: string): Set<string> {
  return new Set([...text.matchAll(/\b([A-Z]{1,3}\d{1,3})\b/g)].map((match) => match[1]!));
}

export function selectIssueProfile(issueText: string, caseText: string): ProfileSpec | null {
  return PROFILES.find((profile) => profile.trigger.test(issueText))
    ?? PROFILES.find((profile) => profile.trigger.test(caseText))
    ?? null;
}

export function assessIssueProfile(input: {
  issueText: string;
  relatedItems: readonly StructuredKnowledgeReadItem[];
  /**
   * Other Knowledge items of the same fascicolo. They are consulted only when the items linked to the issue
   * do not document an element, and only if topically related; the resulting evidence is never treated as confirmed.
   */
  fascicoloItems?: readonly StructuredKnowledgeReadItem[];
  procedural: ProfileProceduralState | null;
  /** ISO date of the analysis; obligations whose documented deadline is later cannot be breached yet. */
  analysisDate?: string;
}): LegalIssueProfileAssessment | null {
  const caseText = input.relatedItems.map((item) => item.normalizedText).join(" \n ");
  const profile = selectIssueProfile(input.issueText, caseText);
  if (!profile) return null;
  const relatedIds = new Set(input.relatedItems.map((item) => item.id));
  const issueCodes = distinctiveCodes([input.issueText, caseText].join(" "));
  const topicalItems = (input.fascicoloItems ?? []).filter((item) => {
    if (relatedIds.has(item.id)) return false;
    const codes = distinctiveCodes(item.normalizedText);
    const sharesCode = [...codes].some((code) => issueCodes.has(code));
    // Items naming other specific objects (e.g. another warehouse) are not evidence for this issue.
    const namesOtherObjects = codes.size > 0 && !sharesCode && issueCodes.size > 0;
    return !namesOtherObjects && (sharesCode || profile.trigger.test(item.normalizedText));
  });
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
    if (profile.id === "FEE_PAYMENT" && spec.id === "rate-threshold") {
      return assessRateThreshold(spec, input.relatedItems, input.analysisDate);
    }
    const acceptContrary = (sentence: string) => spec.contraryInNegatedSentences !== false || !NEGATION.test(sentence);
    const acceptSupport = (sentence: string) =>
      !NEGATED_FACT_ASSERTION.test(sentence)
      && (!spec.rejectNegatedSupport || !NEGATED_POSITIVE_SUPPORT.test(sentence))
      && (!spec.rejectSupport || !spec.rejectSupport.test(sentence));
    const linkedContrary = spec.contrary ? evidenceFor(input.relatedItems, spec.contrary, acceptContrary) : [];
    // Contrary or justifying elements anywhere in the related facts must not be ignored.
    const contrary = linkedContrary.length || !spec.contrary
      ? linkedContrary
      : evidenceFor(topicalItems, spec.contrary, acceptContrary, true);
    const linkedSupport = spec.supports ? evidenceFor(input.relatedItems, spec.supports, acceptSupport) : [];
    const supporting = linkedSupport.length || !spec.supports
      ? linkedSupport
      : evidenceFor(topicalItems, spec.supports, acceptSupport, true);
    const status: LegalElementStatus = contrary.length
      ? "CONTRARY_EVIDENCE"
      : supporting.length
        ? supporting.some((evidence) => evidence.humanConfirmed && !evidence.linkedByTopic) ? "PROVEN" : "INDICATED"
        : "NOT_PROVEN";
    const evidence = status === "CONTRARY_EVIDENCE" ? contrary : supporting;
    const topicNote = evidence.some((entry) => entry.linkedByTopic)
      ? " Il dato proviene da un altro passo del fascicolo che l'estrazione non aveva collegato a questa questione: il collegamento va confermato."
      : "";
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
      reasoning: (status === "PROVEN"
        ? `Elemento documentato e confermato dal professionista${where(evidence)}.`
        : status === "INDICATED"
          ? `Elemento risultante dai documenti${where(evidence)}, non ancora confermato dal professionista.`
          : status === "CONTRARY_EVIDENCE"
            ? `I documenti contengono elementi contrari o giustificativi${where(evidence)} da valutare prima di ritenere integrato il requisito.`
            : `Nessun riscontro documentale. ${spec.missing}`) + topicNote,
    };
  });
  const byId = new Map(elements.map((element) => [element.elementId, element]));
  let pendingDeadline: string | null = null;
  if (profile.id === "INVESTMENT_DEFAULT" && input.analysisDate) {
    const deadlines = (byId.get("obligation")?.evidence ?? []).flatMap((entry) => deadlinesIn(entry.text));
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
    ...(pendingDeadline ? { pendingDeadline } : {}),
  };
}

export const LEGAL_ELEMENT_STATUS_LABELS: Readonly<Record<LegalElementStatus, string>> = {
  PROVEN: "Provato",
  INDICATED: "Risulta dai documenti, da confermare",
  NOT_PROVEN: "Non provato",
  CONTRARY_EVIDENCE: "Elementi contrari o giustificativi",
};
