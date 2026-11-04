import type { StructuredKnowledgeReadItem } from "@/server/queries/fascicolo-knowledge";

/**
 * Date-driven coordination of the port-concession regime (art. 18 L. 84/1994, cod. nav.,
 * D.I. 202/2022, D.M. 110/2023, ART delibere 57/2018 and 242/2025). Every temporal rule
 * below is taken from the official transitional provisions:
 * - D.I. 202/2022, art. 10 c.1-2 (titles granted before 15/01/2023: only arts 6-9; ISTAT fee revaluation);
 * - ART 242/2025, Allegato A, misure 1.2 (i)-(iii) and 16.1 (in force from 01/03/2026);
 * - L. 118/2022, art. 5 (new text of art. 18 L. 84/1994 in force from 27/08/2022).
 */

export type PortRegimeSourceStatus =
  | "FULLY_APPLICABLE"
  | "PARTIALLY_APPLICABLE"
  | "PREVIOUS_TEXT_APPLICABLE"
  | "NOT_APPLICABLE_RATIONE_TEMPORIS"
  | "SUPERSEDED"
  | "APPLICABILITY_TO_VERIFY"
  | "DATE_TO_VERIFY";

export interface PortRegimeSource {
  sourceId: string;
  citation: string;
  status: PortRegimeSourceStatus;
  reasoning: string;
  operativeConsequences: readonly string[];
  officialUrl: string;
}

export interface PortRegimeDate {
  label: string;
  date: string | null;
  basis: string;
  pages: readonly number[];
}

export interface PortRegimeCoordination {
  grantDate: PortRegimeDate;
  procedureStartDate: PortRegimeDate;
  postReformEvents: readonly { text: string; date: string; pages: readonly number[] }[];
  analysisDate: string;
  sources: readonly PortRegimeSource[];
  conclusion: string;
  limits: readonly string[];
}

export const PORT_REGIME_DATES = {
  L118_2022_ART18: "2022-08-27",
  DI_202_2022: "2023-01-15",
  DM_110_2023_PUBLICATION: "2023-04-21",
  ART_57_2018_ADOPTION: "2018-05-30",
  ART_242_2025: "2026-03-01",
} as const;

const NORMATTIVA = "https://www.normattiva.it/uri-res/N2Ls?";
const ART_242_URL = "https://www.autorita-trasporti.it/wp-content/uploads/2025/12/All.-A-delibera-n.-242_2025_signed.pdf";
const ART_57_URL = "https://www.autorita-trasporti.it/wp-content/uploads/2018/06/All.-A-delibera-n.-57_2018.pdf";
const DI_202_URL = `${NORMATTIVA}urn:nir:ministero.infrastrutture.e.trasporti:decreto:2022-12-28;202`;
const ART_242_EXISTING_MEASURES = "3.7 (vigilanza e notifica ad ART delle istanze di revisione), 3.13 (quote di capacità in caso di cambio di controllo), 3.18 (monitoraggio annuale di investimenti, traffici e occupazione), 3.19 (revisione per nuove infrastrutture pubbliche), 3.20 (parere vincolante ART sulle estensioni di durata), 4 (contabilità regolatoria), 5 (analisi annuale dei mercati) e 15 (obblighi informativi)";

const PORT_CONTEXT = /art\.?\s*18\b[^.]{0,40}\b84\b|l\.?\s*84\/1994|autorit[àa] di sistema portuale|\badsp\b|concession\w*[^.]{0,40}(?:portual|porto)|\b(?:area|aree|ambito|zona|terminal|demanio|banchin\w*) portual/i;
const GRANT_ANCHOR = /(?:rilasciat\w*|stipulat\w*|sottoscritt\w*|emess\w*|adottat\w*)\s+(?:in data\s+|il\s+|l'\s*)?(\d{1,2}\/\d{1,2}\/\d{4})|concession\w*\s+(?:demanial\w*\s+(?:marittim\w*\s+)?)?(?:n\.?|numero)\s*[\w/.-]+\s+del\s+(\d{1,2}\/\d{1,2}\/\d{4})/i;

/** Removes abbreviation dots and Italian thousand separators so that sentence-bounded patterns work. */
function normalizeForMatching(text: string): string {
  return text
    .replace(/\b(artt?|nn?|prot|lett|cod|nav|c|L|D|I|M)\./g, "$1")
    .replace(/(\d)\.(?=\d{3}\b)/g, "$1");
}
const GRANT_PATTERN = /(?:atto di |titolo |provvedimento di )?concession\w*[^.]{0,80}(?:rilasciat|stipulat|sottoscritt|n\.|numero|prot)|atto concessorio|licenza di concessione/i;
const POST_REFORM_EVENT = /subingress|cession\w* (?:della concessione|di quote|del controllo)|trasferiment\w* (?:di quote|del controllo|della concessione)|cambio di controllo|modific\w* (?:del titolo|del contenuto|della concessione|dell'oggetto)|variazion\w* (?:dell'area|dell'estensione|delle opere)|estension\w* della durata|revision\w* (?:del PEF|del piano|della concessione|del programma)|affid\w*[^.]{0,30}(?:a terz|ad altr)/i;
const DATE_TOKEN = String.raw`(?:\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[°º]?\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4})`;
const PROCEDURE_DATE_ANCHORS = [
  new RegExp(String.raw`avviso\s+(?:pubblico|di|per)[^\n]{0,100}?\b(?:del|in data|pubblicat\w*\s+(?:il|in data))\s+(${DATE_TOKEN})`, "gi"),
  new RegExp(String.raw`procedur\w*\s+(?:comparativ\w*|selettiv\w*|ad evidenza|di affidamento)[^\n]{0,150}?\b(?:avviat\w*|indett\w*|pubblicat\w*)\s+(?:il|in data)\s+(${DATE_TOKEN})`, "gi"),
  new RegExp(String.raw`istanz\w*\s+di\s+(?:concession\w*|rilascio)[^\n]{0,100}?\b(?:presentat\w*|depositat\w*)\s+(?:il|in data)\s+(${DATE_TOKEN})`, "gi"),
];

function italianDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function isoDay(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function pagesOf(item: StructuredKnowledgeReadItem): number[] {
  return [...new Set(item.evidence.map((evidence) => evidence.pageNumber))].sort((left, right) => left - right);
}

function uniqueDatedCandidate(candidates: readonly { date: string; pages: number[] }[]): { date: string; pages: number[] } | null {
  const dates = [...new Set(candidates.map((candidate) => candidate.date))];
  if (dates.length !== 1) return null;
  return {
    date: dates[0],
    pages: [...new Set(candidates.flatMap((candidate) => candidate.pages))].sort((left, right) => left - right),
  };
}

function structuredGrantDates(items: readonly StructuredKnowledgeReadItem[]): { date: string; pages: number[] }[] {
  return items.flatMap((item) => {
    if (item.kind !== "LEGAL_ACT" || !item.payload || typeof item.payload !== "object" || Array.isArray(item.payload)) return [];
    const payload = item.payload as Record<string, unknown>;
    const label = `${typeof payload.actType === "string" ? payload.actType : ""} ${typeof payload.title === "string" ? payload.title : item.normalizedText}`;
    if (!/concession|titolo demanial|atto demanial/i.test(label) || /avviso|istanz|indizion|decadenz|revoc|riesame/i.test(label)) return [];
    const date = payload.date && typeof payload.date === "object" && !Array.isArray(payload.date) ? payload.date as Record<string, unknown> : null;
    return date?.precision === "EXACT" && typeof date.from === "string" && /^\d{4}-\d{2}-\d{2}/.test(date.from)
      ? [{ date: date.from.slice(0, 10), pages: pagesOf(item) }]
      : [];
  });
}

export function isPortConcessionMatter(input: {
  tipologia?: string | null;
  knowledgeItems: readonly StructuredKnowledgeReadItem[];
  issueTexts: readonly string[];
}): boolean {
  if (input.tipologia && (/portual/i.test(input.tipologia) || PORT_CONTEXT.test(normalizeForMatching(input.tipologia)))) return true;
  return [...input.issueTexts, ...input.knowledgeItems.map((item) => item.normalizedText)]
    .some((text) => PORT_CONTEXT.test(normalizeForMatching(text)));
}

function anchoredGrantDates(
  items: readonly StructuredKnowledgeReadItem[],
  extractIsoDates: (text: string) => string[],
): { date: string; pages: number[] }[] {
  return items
    .filter((item) => GRANT_PATTERN.test(item.normalizedText) && !/avviso|istanz|indizion|aggiudicazion|verbale|commission|decadenz|revoc|riesame|diffid/i.test(item.normalizedText))
    .flatMap((item) => {
      const match = GRANT_ANCHOR.exec(item.normalizedText);
      const raw = match?.[1] ?? match?.[2];
      const date = raw ? extractIsoDates(raw)[0] : undefined;
      return date ? [{ date, pages: pagesOf(item) }] : [];
    });
}

function anchoredProcedureDates(
  items: readonly StructuredKnowledgeReadItem[],
  extractIsoDates: (text: string) => string[],
): { date: string; pages: number[] }[] {
  return items.flatMap((item) => PROCEDURE_DATE_ANCHORS.flatMap((pattern) =>
    [...normalizeForMatching(item.normalizedText).matchAll(pattern)].flatMap((match) => {
      const date = extractIsoDates(match[1])[0];
      return date ? [{ date, pages: pagesOf(item) }] : [];
    })));
}

export function buildPortRegimeCoordination(input: {
  knowledgeItems: readonly StructuredKnowledgeReadItem[];
  analysisDate: string;
  registryGrant: { numeroAtto: string; dataRilascio: string } | null;
  extractIsoDates: (text: string) => string[];
}): PortRegimeCoordination {
  const items = input.knowledgeItems.filter((item) => item.status !== "REJECTED");
  const structuredGrants = structuredGrantDates(items);
  const documentGrantCandidates = structuredGrants.length ? structuredGrants : anchoredGrantDates(items, input.extractIsoDates);
  const documentGrant = uniqueDatedCandidate(documentGrantCandidates);
  const ambiguousGrant = new Set(documentGrantCandidates.map((candidate) => candidate.date)).size > 1;
  const registryDate = isoDay(input.registryGrant?.dataRilascio);
  const grantDate: PortRegimeDate = registryDate
    ? { label: "Rilascio del titolo", date: registryDate, basis: `Registro concessioni (atto ${input.registryGrant!.numeroAtto})`, pages: [] }
    : documentGrant
      ? { label: "Rilascio del titolo", date: documentGrant.date, basis: "Data indicata nei documenti, da confermare: il titolo non è collegato nel registro concessioni", pages: documentGrant.pages }
      : { label: "Rilascio del titolo", date: null, basis: ambiguousGrant ? "Date di titoli discordanti: individuare il titolo pertinente" : "Data del titolo non individuata nei documenti", pages: [] };
  const procedureCandidates = anchoredProcedureDates(items, input.extractIsoDates);
  const procedure = uniqueDatedCandidate(procedureCandidates);
  const ambiguousProcedure = new Set(procedureCandidates.map((candidate) => candidate.date)).size > 1;
  const procedureStartDate: PortRegimeDate = procedure
    ? { label: "Avvio della procedura di rilascio", date: procedure.date, basis: "Data indicata in un avviso, istanza o atto di indizione: verificarne il collegamento al titolo", pages: procedure.pages }
    : { label: "Avvio della procedura di rilascio", date: null, basis: ambiguousProcedure ? "Più date di avvio possibili: individuare la procedura pertinente" : "Atto di avvio della procedura non individuato", pages: [] };
  const postReformEvents = items
    .filter((item) => POST_REFORM_EVENT.test(item.normalizedText))
    .flatMap((item) => input.extractIsoDates(item.normalizedText)
      .filter((date) => date >= PORT_REGIME_DATES.ART_242_2025 && date <= input.analysisDate)
      .map((date) => ({ text: item.normalizedText, date, pages: pagesOf(item) })))
    .sort((left, right) => left.date.localeCompare(right.date));

  const grant = grantDate.date && grantDate.date <= input.analysisDate ? grantDate.date : null;
  const inconsistentChronology = Boolean(procedureStartDate.date && grant && procedureStartDate.date > grant);
  const start = procedureStartDate.date && procedureStartDate.date <= input.analysisDate && !inconsistentChronology
    ? procedureStartDate.date
    : null;
  const sources: PortRegimeSource[] = [];

  sources.push(!start && !grant
    ? {
      sourceId: "L84_ART18",
      citation: "Art. 18 L. 28 gennaio 1994, n. 84",
      status: "DATE_TO_VERIFY",
      reasoning: "Senza date attendibili del titolo e della procedura di rilascio non è possibile coordinare il testo previgente con quello introdotto dall'art. 5 della L. 118/2022.",
      operativeConsequences: ["Individuare avviso, istanza o atto di concessione e la relativa data."],
      officialUrl: `${NORMATTIVA}urn:nir:stato:legge:1994-01-28;84~art18`,
    }
    : {
      sourceId: "L84_ART18",
      citation: "Art. 18 L. 28 gennaio 1994, n. 84",
      status: grant && grant < PORT_REGIME_DATES.L118_2022_ART18
        ? "PREVIOUS_TEXT_APPLICABLE"
        : start && start >= PORT_REGIME_DATES.L118_2022_ART18 && grant && !inconsistentChronology
          ? "FULLY_APPLICABLE"
          : "APPLICABILITY_TO_VERIFY",
      reasoning: grant && grant < PORT_REGIME_DATES.L118_2022_ART18
        ? `Il titolo del ${italianDate(grant)} è anteriore al 27/08/2022: per il suo rilascio va consultato il testo allora vigente. L'art. 18, comma 3, salva contenuti e pattuizioni dei titoli in essere; per vigilanza e condotte successive va verificata separatamente la disciplina applicabile alla loro data.`
        : start && start >= PORT_REGIME_DATES.L118_2022_ART18 && grant
          ? `La procedura indicata (${italianDate(start)}) e il titolo (${italianDate(grant)}) sono successivi al 27/08/2022: valutare il testo dell'art. 18 modificato dalla L. 118/2022, verificando ambito e singoli atti.`
          : `Non è possibile attribuire automaticamente il rilascio a un solo testo: ${start ? `la data indicata per l'avvio è ${italianDate(start)}` : "l'avvio della procedura non è documentato"}${grant ? ` e il titolo risulta del ${italianDate(grant)}` : " e la data del titolo non è accertata"}. Verificare la successione degli atti e le disposizioni transitorie, senza assumere la data del titolo come data di avvio.`,
      operativeConsequences: [
        "Se applicabile alla fattispecie e alla data dell'atto, verificare esercizio diretto e autorizzazione per l'affidamento di attività del ciclo operativo a imprese ex art. 16 (comma 9).",
        "Verificare, rispetto al titolo e al testo applicabile, accertamenti annuali e attuazione degli investimenti (comma 10).",
        "Valutare la decadenza del comma 11 solo con prova dei presupposti, assenza di giustificato motivo e contraddittorio.",
      ],
      officialUrl: `${NORMATTIVA}urn:nir:stato:legge:1994-01-28;84~art18${grant ? `!vig=${grant}` : ""}`,
    });

  sources.push(input.analysisDate < PORT_REGIME_DATES.DI_202_2022
    ? {
      sourceId: "DI_202_2022",
      citation: "D.I. 28 dicembre 2022, n. 202 (regolamento concessioni aree e banchine portuali)",
      status: "NOT_APPLICABLE_RATIONE_TEMPORIS",
      reasoning: "Il regolamento non era ancora in vigore alla data dell'analisi; decorre dal 15/01/2023.",
      operativeConsequences: [],
      officialUrl: DI_202_URL,
    }
    : !grant
    ? {
      sourceId: "DI_202_2022",
      citation: "D.I. 28 dicembre 2022, n. 202 (regolamento concessioni aree e banchine portuali)",
      status: "DATE_TO_VERIFY",
      reasoning: "L'art. 10, comma 1, distingue i titoli rilasciati prima o dopo il 15/01/2023: occorre la data del titolo.",
      operativeConsequences: ["Accertare la data di rilascio del titolo."],
      officialUrl: DI_202_URL,
    }
    : grant >= PORT_REGIME_DATES.DI_202_2022
      ? {
        sourceId: "DI_202_2022",
        citation: "D.I. 28 dicembre 2022, n. 202 (regolamento concessioni aree e banchine portuali)",
        status: "FULLY_APPLICABLE",
        reasoning: [
          `Titolo rilasciato il ${italianDate(grant)}, dopo l'entrata in vigore del regolamento (15/01/2023): non opera l'esclusione transitoria dell'art. 10, comma 1, che riguarda i soli titoli anteriori.`,
          start && start < PORT_REGIME_DATES.DI_202_2022
            ? `La procedura di rilascio risulta avviata il ${italianDate(start)}, prima del 15/01/2023: per gli atti della procedura compiuti prima di tale data verificare la disciplina allora vigente; il regolamento non si applica retroattivamente a quegli atti.`
            : "Per il rilascio vanno verificati gli atti della procedura rispetto agli artt. 2-5 del regolamento alla data di ciascun atto.",
          "Per le vicende successive (modifiche ex art. 6, vicende soggettive ex art. 7, avvicendamento ex art. 8, verifiche annuali ex art. 9) si applica il testo vigente alla data della singola vicenda; le condotte del concessionario si valutano alla data in cui sono poste in essere, anche alla luce del titolo e del regolamento dell'Autorità di sistema portuale, da adeguare entro dodici mesi (art. 10, comma 3).",
          "Per quanto non disciplinato si applicano gli artt. 36-49 e 54 cod. nav. (art. 10, comma 4).",
        ].join(" "),
        operativeConsequences: [
          "Verificare rispetto al regolamento durata, PEF, garanzie e canoni stabiliti nel titolo, distinguendo gli atti della procedura di rilascio per data.",
          "Art. 6: variazioni dell'area, delle opere o delle modalità di esercizio (art. 24 reg. nav. mar.) ed estensione della durata non superiore a cinque anni per il recupero di investimenti.",
          "Art. 7: autorizzazione preventiva per trasferimenti di quote che modificano il controllo (art. 2359 c.c.).",
          "Art. 9: verifica annuale dei requisiti e dell'attuazione del programma di investimenti, con comunicazione al Ministero.",
          "Verificare se e quando il regolamento dell'Autorità di sistema portuale è stato adeguato (art. 10, comma 3) prima di applicarne le clausole alle condotte contestate.",
        ],
        officialUrl: `${DI_202_URL}!vig=${grant}`,
      }
      : {
        sourceId: "DI_202_2022",
        citation: "D.I. 28 dicembre 2022, n. 202 (regolamento concessioni aree e banchine portuali)",
        status: "PARTIALLY_APPLICABLE",
        reasoning: `Titolo rilasciato il ${italianDate(grant)}, prima del 15/01/2023: ai sensi dell'art. 10, comma 1, si applicano soltanto gli artt. 6 (modifica del contenuto), 7 (vicende soggettive), 8 (avvicendamento) e 9 (verifiche annuali); i canoni sono rivalutati annualmente su base ISTAT (art. 10, comma 2).`,
        operativeConsequences: [
          "Non applicare al titolo i criteri di rilascio, durata e canone del regolamento.",
          "Applicare artt. 6-9 a modifiche, vicende soggettive, avvicendamento e verifiche successive.",
        ],
        officialUrl: DI_202_URL,
      });

  sources.push({
    sourceId: "DM_110_2023",
    citation: "D.M. 21 aprile 2023, n. 110 (linee guida applicative del D.I. 202/2022)",
    status: input.analysisDate < PORT_REGIME_DATES.DM_110_2023_PUBLICATION
      ? "NOT_APPLICABLE_RATIONE_TEMPORIS"
      : "APPLICABILITY_TO_VERIFY",
    reasoning: input.analysisDate < PORT_REGIME_DATES.DM_110_2023_PUBLICATION
      ? "Il decreto e la pubblicazione sul sito MIT sono successivi alla data dell'analisi."
      : "Il MIT indica la pubblicazione del decreto il 21/04/2023; la G.U. del 12/05/2023 contiene l'avviso di avvenuta pubblicazione, non la data da assumere automaticamente come efficacia. L'art. 2 del decreto richiede alle AdSP di conformare le valutazioni per selezione e rilascio; verificare decorrenza, singolo atto successivo e limiti dell'art. 10 D.I. 202/2022. Un titolo anteriore non esclude da solo la rilevanza di eventuali valutazioni successive.",
    operativeConsequences: input.analysisDate < PORT_REGIME_DATES.DM_110_2023_PUBLICATION
      ? []
      : ["Verificare se le linee guida riguardino la valutazione concreta, inclusi durata, PEF o estensione, senza attribuire loro effetti retroattivi o obblighi non accertati."],
    officialUrl: "https://www.mit.gov.it/normativa/decreto-ministeriale-n-110-del-21-04-2023",
  });

  sources.push({
    sourceId: "ART_57_2018",
    citation: "Delibera ART n. 57/2018, Allegato A (misure di regolazione sull'accesso alle infrastrutture portuali)",
    status: input.analysisDate < PORT_REGIME_DATES.ART_57_2018_ADOPTION
      ? "NOT_APPLICABLE_RATIONE_TEMPORIS"
      : start && start >= PORT_REGIME_DATES.ART_242_2025
        ? "SUPERSEDED"
        : start ? "APPLICABILITY_TO_VERIFY" : "DATE_TO_VERIFY",
    reasoning: input.analysisDate < PORT_REGIME_DATES.ART_57_2018_ADOPTION
      ? "La delibera non era stata ancora adottata alla data dell'analisi."
      : start && start >= PORT_REGIME_DATES.ART_242_2025
        ? "Per la procedura successiva al 01/03/2026 verificare la revisione delle misure con delibera 242/2025 e il suo ambito applicativo; le regole precedenti restano rilevanti per gli atti storici."
        : `${start ? `La data indicata per l'avvio è ${italianDate(start)}.` : "La data della procedura di rilascio non è documentata; non può essere sostituita con quella del titolo."} La delibera 57/2018 è stata adottata il 30/05/2018 e le misure decorrono dalla pubblicazione sul sito ART (misura 6.1): verificarne la data e l'ambito, incluse le esclusioni della misura 1.2. La modifica PEF della delibera 89/2024 riguarda le procedure avviate dopo il 26/06/2024.`,
    operativeConsequences: input.analysisDate < PORT_REGIME_DATES.ART_57_2018_ADOPTION
      ? []
      : ["Se applicabile al titolo, verificare la predeterminazione negli atti di concessione di penali, sanzioni e cause di decadenza o revoca (misura 2.10)."],
    officialUrl: ART_57_URL,
  });

  const art242NotYet = input.analysisDate < PORT_REGIME_DATES.ART_242_2025;
  sources.push(art242NotYet
    ? {
      sourceId: "ART_242_2025",
      citation: "Delibera ART n. 242/2025, Allegato A",
      status: "NOT_APPLICABLE_RATIONE_TEMPORIS",
      reasoning: "Alla data dell'analisi le misure non sono ancora in vigore (misura 16.1: dal 01/03/2026).",
      operativeConsequences: [],
      officialUrl: ART_242_URL,
    }
    : !grant
      ? {
        sourceId: "ART_242_2025",
        citation: "Delibera ART n. 242/2025, Allegato A",
        status: "DATE_TO_VERIFY",
        reasoning: "La misura 1.2 distingue concessioni non ancora rilasciate (i), revisioni o vicende soggettive di titoli anteriori (ii) e titoli in essere (iii): occorre la data del titolo.",
        operativeConsequences: ["Accertare la data del titolo prima di applicare le misure."],
        officialUrl: ART_242_URL,
      }
      : grant >= PORT_REGIME_DATES.ART_242_2025
        ? {
          sourceId: "ART_242_2025",
          citation: "Delibera ART n. 242/2025, Allegato A",
          status: "FULLY_APPLICABLE",
          reasoning: `Titolo rilasciato il ${italianDate(grant)}, non ancora rilasciato al 01/03/2026: la misura 1.2, punto i, contempla l'atto di regolazione, da applicare verificando ambito e presupposti delle singole misure.`,
          operativeConsequences: ["Verificare ambito, procedura, PEF, penali, contabilità regolatoria e obblighi informativi pertinenti prima di individuare adempimenti."],
          officialUrl: ART_242_URL,
        }
        : {
          sourceId: "ART_242_2025",
          citation: "Delibera ART n. 242/2025, Allegato A",
          status: "APPLICABILITY_TO_VERIFY",
          reasoning: `Il titolo risulta rilasciato il ${italianDate(grant)}, ma ciò non dimostra che fosse in essere il 01/03/2026. Solo se tale presupposto è accertato il punto iii della misura 1.2 riguarda le misure ${ART_242_EXISTING_MEASURES}; il punto ii riguarda aggiornamenti o revisioni che modificano il contenuto del titolo o vicende soggettive da verificare. La delibera non qualifica retroattivamente il rilascio.${postReformEvents.length ? ` I documenti segnalano possibili vicende successive (${postReformEvents.map((event) => italianDate(event.date)).join(", ")}): una domanda non prova da sola una modifica o un trasferimento perfezionati.` : ""}`,
          operativeConsequences: [
            "Accertare durata, eventuali cessazioni e vigenza del titolo al 01/03/2026 prima di applicare il punto iii.",
            "Per le misure pertinenti verificare i rispettivi presupposti, destinatari e termini; la misura 3.18 prevede penali nella misura in cui definite in sede di bando.",
            ...(postReformEvents.length ? ["Istruire le istanze e verificare se e quando sia intervenuta una modifica o vicenda soggettiva rilevante ai sensi del punto ii."] : []),
          ],
          officialUrl: ART_242_URL,
        });

  const limits = [
    ...(registryDate ? [] : ["Il titolo concessorio non è collegato nel registro: le date derivano dai documenti e vanno confermate."]),
    ...(grant ? [] : ["Data del titolo non accertata: la matrice resta provvisoria."]),
    ...(grantDate.date && grantDate.date > input.analysisDate ? ["La data indicata per il titolo è successiva alla data dell'analisi e non è stata utilizzata per determinare il regime storico."] : []),
    ...(procedureStartDate.date && procedureStartDate.date > input.analysisDate ? ["La data indicata per l'avvio è successiva alla data dell'analisi e non è stata utilizzata."] : []),
    ...(inconsistentChronology ? ["La data indicata per l'avvio è successiva al rilascio del titolo: verificare il collegamento degli atti prima di usarla."] : []),
    ...(ambiguousGrant && !registryDate ? ["Sono indicate più date di titolo: nessuna è stata scelta automaticamente."] : []),
    ...(ambiguousProcedure ? ["Sono indicate più date di avvio: nessuna è stata scelta automaticamente."] : []),
    ...(registryDate && documentGrant && registryDate !== documentGrant.date ? ["La data del titolo nel registro e quella indicata nei documenti sono diverse: verificarne il collegamento."] : []),
    "Le delibere ART e le linee guida non sostituiscono la verifica della clausola del titolo e del bando: obblighi, penali e cause di decadenza vanno letti nel testo dell'atto.",
  ];
  const applicable = sources.filter((source) => ["FULLY_APPLICABLE", "PARTIALLY_APPLICABLE", "PREVIOUS_TEXT_APPLICABLE"].includes(source.status));
  const conclusion = !grant && !start
    ? "Il regime applicabile non può essere coordinato finché non sono accertate le date della procedura e del titolo."
    : [
      grant ? `Titolo del ${italianDate(grant)}${start && start !== grant ? `, procedura avviata il ${italianDate(start)}` : ""}.` : `Procedura avviata il ${italianDate(start!)}; data del titolo da accertare.`,
      applicable.length
        ? `Fonti da considerare: ${applicable.map((source) => `${source.citation} (${STATUS_LABELS[source.status].toLowerCase()})`).join("; ")}.`
        : "L'applicabilità delle fonti richiede ulteriori verifiche documentali.",
      "Il rilascio si valuta con le regole vigenti alla procedura e al titolo; vigilanza, contestazioni e decadenza con le regole vigenti alla data di ciascuna condotta e di ciascun atto; le misure ART 242/2025 operano solo dal 01/03/2026 e, per i titoli in essere, nei limiti della misura 1.2.",
    ].join(" ");
  return { grantDate, procedureStartDate, postReformEvents, analysisDate: input.analysisDate, sources, conclusion, limits };
}

export const STATUS_LABELS: Readonly<Record<PortRegimeSourceStatus, string>> = {
  FULLY_APPLICABLE: "Applicabile al titolo, per singolo istituto e data",
  PARTIALLY_APPLICABLE: "Applicabile in parte",
  PREVIOUS_TEXT_APPLICABLE: "Testo previgente",
  NOT_APPLICABLE_RATIONE_TEMPORIS: "Non applicabile ratione temporis",
  SUPERSEDED: "Sostituita",
  APPLICABILITY_TO_VERIFY: "Presupposti da verificare",
  DATE_TO_VERIFY: "Data da accertare",
};
