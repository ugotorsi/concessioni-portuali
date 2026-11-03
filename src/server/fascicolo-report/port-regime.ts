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
  DM_110_2023: "2023-05-12",
  ART_242_2025: "2026-03-01",
} as const;

const NORMATTIVA = "https://www.normattiva.it/uri-res/N2Ls?";
const ART_242_URL = "https://www.autorita-trasporti.it/wp-content/uploads/2025/12/All.-A-delibera-n.-242_2025_signed.pdf";
const ART_57_URL = "https://www.autorita-trasporti.it/wp-content/uploads/2018/06/All.-A-delibera-n.-57_2018.pdf";
const DI_202_URL = `${NORMATTIVA}urn:nir:ministero.infrastrutture.e.trasporti:decreto:2022-12-28;202`;
const ART_242_EXISTING_MEASURES = "3.7 (vigilanza e notifica ad ART delle istanze di revisione), 3.13 (quote di capacità in caso di cambio di controllo), 3.18 (monitoraggio annuale di investimenti, traffici e occupazione), 3.19 (revisione per nuove infrastrutture pubbliche), 3.20 (parere vincolante ART sulle estensioni di durata), 4 (contabilità regolatoria), 5 (analisi annuale dei mercati) e 15 (obblighi informativi)";

const PORT_CONTEXT = /art\.?\s*18\b[^.]{0,30}(?:84|legge)|l\.?\s*84\/1994|banchin|autorit[àa] di sistema portuale|\badsp\b|concession\w*[^.]{0,40}portual|\b(?:area|aree|ambito|zona|terminal|demanio) portual|terminal/i;
const GRANT_ANCHOR = /(?:rilasciat\w*|stipulat\w*|sottoscritt\w*|emess\w*|adottat\w*)\s+(?:in data\s+|il\s+|l'\s*)?(\d{1,2}\/\d{1,2}\/\d{4})|concession\w*\s+(?:demanial\w*\s+(?:marittim\w*\s+)?)?(?:n\.?|numero)\s*[\w/.-]+\s+del\s+(\d{1,2}\/\d{1,2}\/\d{4})/i;

/** Removes abbreviation dots and Italian thousand separators so that sentence-bounded patterns work. */
function normalizeForMatching(text: string): string {
  return text
    .replace(/\b(artt?|nn?|prot|lett|cod|nav|c|L|D|I|M)\./g, "$1")
    .replace(/(\d)\.(?=\d{3}\b)/g, "$1");
}
const GRANT_PATTERN = /(?:atto di |titolo |provvedimento di )?concession\w*[^.]{0,80}(?:rilasciat|stipulat|sottoscritt|n\.|numero|prot)|atto concessorio|licenza di concessione/i;
const PROCEDURE_PATTERN = /avviso (?:pubblico|di|per)|istanz\w* di (?:concession|rilascio)|indizion|procedura (?:comparativ|selettiv|ad evidenza|di affidamento)|pubblicazione dell'istanza/i;
const POST_REFORM_EVENT = /subingress|cession\w* (?:della concessione|di quote|del controllo)|trasferiment\w* (?:di quote|del controllo|della concessione)|cambio di controllo|modific\w* (?:del titolo|del contenuto|della concessione|dell'oggetto)|variazion\w* (?:dell'area|dell'estensione|delle opere)|estension\w* della durata|revision\w* (?:del PEF|del piano|della concessione|del programma)|affid\w*[^.]{0,30}(?:a terz|ad altr)/i;

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

function earliestDated(
  items: readonly StructuredKnowledgeReadItem[],
  pattern: RegExp,
  extractIsoDates: (text: string) => string[],
  exclude?: RegExp,
): { date: string; pages: number[] } | null {
  const candidates = items
    .filter((item) => pattern.test(item.normalizedText) && !(exclude?.test(item.normalizedText)))
    .flatMap((item) => extractIsoDates(item.normalizedText).map((date) => ({ date, pages: pagesOf(item) })))
    .sort((left, right) => left.date.localeCompare(right.date));
  return candidates[0] ?? null;
}

function structuredGrantDate(items: readonly StructuredKnowledgeReadItem[]): { date: string; pages: number[] } | null {
  const candidates = items.flatMap((item) => {
    if (item.kind !== "LEGAL_ACT" || !item.payload || typeof item.payload !== "object" || Array.isArray(item.payload)) return [];
    const payload = item.payload as Record<string, unknown>;
    const label = `${typeof payload.actType === "string" ? payload.actType : ""} ${typeof payload.title === "string" ? payload.title : item.normalizedText}`;
    if (!/concession|titolo demanial|atto demanial/i.test(label) || /avviso|istanz|indizion|decadenz|revoc|riesame/i.test(label)) return [];
    const date = payload.date && typeof payload.date === "object" && !Array.isArray(payload.date) ? payload.date as Record<string, unknown> : null;
    return date?.precision === "EXACT" && typeof date.from === "string" && /^\d{4}-\d{2}-\d{2}/.test(date.from)
      ? [{ date: date.from.slice(0, 10), pages: pagesOf(item) }]
      : [];
  }).sort((left, right) => left.date.localeCompare(right.date));
  return candidates[0] ?? null;
}

export function isPortConcessionMatter(input: {
  tipologia?: string | null;
  knowledgeItems: readonly StructuredKnowledgeReadItem[];
  issueTexts: readonly string[];
}): boolean {
  if (input.tipologia && /portual|banchin|art\.?\s*18/i.test(input.tipologia)) return true;
  return [...input.issueTexts, ...input.knowledgeItems.map((item) => item.normalizedText)]
    .some((text) => PORT_CONTEXT.test(normalizeForMatching(text)));
}

function anchoredGrantDate(
  items: readonly StructuredKnowledgeReadItem[],
  extractIsoDates: (text: string) => string[],
): { date: string; pages: number[] } | null {
  const candidates = items
    .filter((item) => GRANT_PATTERN.test(item.normalizedText) && !/avviso|istanz|indizion|aggiudicazion|verbale|commission|decadenz|revoc|riesame|diffid/i.test(item.normalizedText))
    .flatMap((item) => {
      const match = GRANT_ANCHOR.exec(item.normalizedText);
      const raw = match?.[1] ?? match?.[2];
      const date = raw ? extractIsoDates(raw)[0] : undefined;
      return date ? [{ date, pages: pagesOf(item) }] : [];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
  return candidates[0] ?? null;
}

export function buildPortRegimeCoordination(input: {
  knowledgeItems: readonly StructuredKnowledgeReadItem[];
  analysisDate: string;
  registryGrant: { numeroAtto: string; dataRilascio: string } | null;
  extractIsoDates: (text: string) => string[];
}): PortRegimeCoordination {
  const items = input.knowledgeItems.filter((item) => item.status !== "REJECTED");
  const documentGrant = structuredGrantDate(items)
    ?? anchoredGrantDate(items, input.extractIsoDates)
    ?? earliestDated(items, GRANT_PATTERN, input.extractIsoDates, /avviso|istanz|indizion|aggiudicazion|verbale|commission|avviat/i);
  const registryDate = isoDay(input.registryGrant?.dataRilascio);
  const grantDate: PortRegimeDate = registryDate
    ? { label: "Rilascio del titolo", date: registryDate, basis: `Registro concessioni (atto ${input.registryGrant!.numeroAtto})`, pages: [] }
    : documentGrant
      ? { label: "Rilascio del titolo", date: documentGrant.date, basis: "Data ricavata dai documenti: il titolo non è collegato nel registro concessioni", pages: documentGrant.pages }
      : { label: "Rilascio del titolo", date: null, basis: "Data del titolo non individuata nei documenti", pages: [] };
  const procedure = earliestDated(items, PROCEDURE_PATTERN, input.extractIsoDates);
  const procedureStartDate: PortRegimeDate = procedure
    ? { label: "Avvio della procedura di rilascio", date: procedure.date, basis: "Avviso, istanza o atto di indizione documentato", pages: procedure.pages }
    : { label: "Avvio della procedura di rilascio", date: null, basis: "Atto di avvio della procedura non individuato", pages: [] };
  const postReformEvents = items
    .filter((item) => POST_REFORM_EVENT.test(item.normalizedText))
    .flatMap((item) => input.extractIsoDates(item.normalizedText)
      .filter((date) => date >= PORT_REGIME_DATES.ART_242_2025 && date <= input.analysisDate)
      .map((date) => ({ text: item.normalizedText, date, pages: pagesOf(item) })))
    .sort((left, right) => left.date.localeCompare(right.date));

  const grant = grantDate.date;
  const start = procedureStartDate.date ?? grant;
  const startInferred = !procedureStartDate.date && Boolean(grant);
  const startCaveat = startInferred
    ? " La data di avvio della procedura non è documentata ed è stata assunta pari a quella del titolo: va confermata, perché una procedura avviata prima delle date di riforma può essere regolata dal testo previgente."
    : "";
  const procedurePhrase = (date: string) => startInferred
    ? `Il titolo (${italianDate(date)}; avvio della procedura non documentato)`
    : `La procedura (${italianDate(date)})`;
  const sources: PortRegimeSource[] = [];

  sources.push(!start
    ? {
      sourceId: "L84_ART18",
      citation: "Art. 18 L. 28 gennaio 1994, n. 84",
      status: "DATE_TO_VERIFY",
      reasoning: "Senza la data della procedura di rilascio non è possibile stabilire se il titolo sia stato rilasciato secondo il testo introdotto dall'art. 5 della L. 118/2022.",
      operativeConsequences: ["Individuare avviso, istanza o atto di concessione e la relativa data."],
      officialUrl: `${NORMATTIVA}urn:nir:stato:legge:1994-01-28;84~art18`,
    }
    : {
      sourceId: "L84_ART18",
      citation: "Art. 18 L. 28 gennaio 1994, n. 84",
      status: start >= PORT_REGIME_DATES.L118_2022_ART18 ? "FULLY_APPLICABLE" : "PREVIOUS_TEXT_APPLICABLE",
      reasoning: start >= PORT_REGIME_DATES.L118_2022_ART18
        ? `${procedurePhrase(start)} è successiv${startInferred ? "o" : "a"} al 27/08/2022: il rilascio è regolato dal testo dell'art. 18 modificato dall'art. 5 della L. 118/2022 (procedura a evidenza pubblica, requisiti del comma 8).${startCaveat}`
        : `${procedurePhrase(start)} è anteriore al 27/08/2022: il rilascio resta regolato dal testo previgente; i poteri di vigilanza e decadenza si esercitano invece secondo il testo vigente alla data delle condotte contestate.`,
      operativeConsequences: [
        "Comma 9: il concessionario deve esercitare direttamente l'attività; l'affidamento ad altre imprese portuali autorizzate ex art. 16 di attività del ciclo operativo richiede autorizzazione su motivata richiesta.",
        "Comma 10: accertamenti annuali sulla permanenza dei requisiti e sull'attuazione degli investimenti del programma di attività.",
        "Comma 11: decadenza per inosservanza degli obblighi o mancato raggiungimento degli obiettivi del programma «senza giustificato motivo», nel rispetto della L. 241/1990.",
      ],
      officialUrl: `${NORMATTIVA}urn:nir:stato:legge:1994-01-28;84~art18${start ? `!vig=${start}` : ""}`,
    });

  sources.push(!grant
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
        reasoning: `Titolo rilasciato il ${italianDate(grant)}, dopo l'entrata in vigore del regolamento (15/01/2023): il regolamento si applica integralmente (art. 10, comma 1, a contrario).`,
        operativeConsequences: [
          "Durata, PEF, garanzie e canoni del titolo vanno verificati rispetto al regolamento.",
          "Art. 6: variazioni dell'area, delle opere o delle modalità di esercizio (art. 24 reg. nav. mar.) ed estensione della durata non superiore a cinque anni per il recupero di investimenti.",
          "Art. 7: autorizzazione preventiva per trasferimenti di quote che modificano il controllo (art. 2359 c.c.).",
          "Art. 9: verifica annuale dei requisiti e dell'attuazione del programma di investimenti, con comunicazione al Ministero.",
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
    status: !start ? "DATE_TO_VERIFY" : start >= PORT_REGIME_DATES.DM_110_2023 ? "FULLY_APPLICABLE" : grant && grant >= PORT_REGIME_DATES.DM_110_2023 ? "PARTIALLY_APPLICABLE" : "NOT_APPLICABLE_RATIONE_TEMPORIS",
    reasoning: !start
      ? "Data della procedura non individuata."
      : start >= PORT_REGIME_DATES.DM_110_2023
        ? startInferred
          ? `Titolo rilasciato il ${italianDate(start)}, dopo la pubblicazione delle linee guida (G.U. 12/05/2023).${startCaveat}`
          : `Procedura avviata (${italianDate(start)}) dopo la pubblicazione delle linee guida (G.U. 12/05/2023).`
        : grant && grant >= PORT_REGIME_DATES.DM_110_2023
          ? `Procedura avviata il ${italianDate(start)}, prima della pubblicazione (12/05/2023), ma titolo rilasciato il ${italianDate(grant)}: le linee guida orientano soltanto le valutazioni compiute dopo la pubblicazione e non invalidano gli atti di procedura anteriori.`
          : `Procedura e titolo anteriori alla pubblicazione delle linee guida (12/05/2023).`,
    operativeConsequences: ["Atto di indirizzo: parametro motivazionale per durata, estensione e PEF, non fonte di obblighi sanzionabili autonomi."],
    officialUrl: "https://www.gazzettaufficiale.it/atto/vediMenuHTML?atto.dataPubblicazioneGazzetta=2023-05-12&atto.codiceRedazionale=23A02826&tipoSerie=serie_generale&tipoVigenza=originario",
  });

  sources.push({
    sourceId: "ART_57_2018",
    citation: "Delibera ART n. 57/2018, Allegato A (misure di regolazione sull'accesso alle infrastrutture portuali)",
    status: !start ? "DATE_TO_VERIFY" : start < "2018-01-01" ? "NOT_APPLICABLE_RATIONE_TEMPORIS" : start < "2018-06-01" ? "DATE_TO_VERIFY" : start < PORT_REGIME_DATES.ART_242_2025 ? "FULLY_APPLICABLE" : "SUPERSEDED",
    reasoning: !start
      ? "Data della procedura non individuata."
      : start < "2018-01-01"
        ? `Procedura (${italianDate(start)}) anteriore all'adozione della delibera (2018).`
        : start < "2018-06-01"
        ? "Procedura anteriore o contemporanea all'adozione della delibera (maggio 2018): verificarne la decorrenza."
        : start < PORT_REGIME_DATES.ART_242_2025
          ? `${startInferred ? `Il titolo (${italianDate(start)}) è stato rilasciato` : `La procedura di rilascio (${italianDate(start)}) si è svolta`} sotto le misure della delibera 57/2018 (avviso pubblico, criteri predeterminati, cause di decadenza e penali espressamente previste nel titolo: misure 2.7 e 2.10). Lo schema di PEF introdotto con la delibera 89/2024 riguarda solo le procedure successive alla sua adozione.`
          : "Per procedure avviate dal 01/03/2026 le misure sono sostituite dalla revisione approvata con delibera 242/2025.",
    operativeConsequences: start && start < PORT_REGIME_DATES.ART_242_2025 && start >= "2018-06-01"
      ? ["Verificare che bando e titolo predeterminino cause di decadenza e penali (misura 2.10): penali non predeterminate non possono essere applicate."]
      : [],
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
          reasoning: `Titolo rilasciato il ${italianDate(grant)}, dopo il 01/03/2026: si applica l'intero atto di regolazione (misura 1.2, punto i).`,
          operativeConsequences: ["Verificare procedura, PEF secondo l'Annesso 1, penali, contabilità regolatoria e obblighi informativi."],
          officialUrl: ART_242_URL,
        }
        : {
          sourceId: "ART_242_2025",
          citation: "Delibera ART n. 242/2025, Allegato A",
          status: "PARTIALLY_APPLICABLE",
          reasoning: `Titolo in essere al 01/03/2026 (rilasciato il ${italianDate(grant)}): la delibera non regola retroattivamente il rilascio; si applicano soltanto le misure ${ART_242_EXISTING_MEASURES} (misura 1.2, punto iii). L'intero atto si applica invece agli aggiornamenti o revisioni che modificano il contenuto della concessione e alle vicende soggettive successive (misura 1.2, punto ii).${postReformEvents.length ? ` Nei documenti risultano eventi successivi al 01/03/2026 potenzialmente riconducibili al punto ii (${postReformEvents.map((event) => italianDate(event.date)).join(", ")}).` : ""}`,
          operativeConsequences: [
            "Monitoraggio annuale di investimenti, traffici e occupazione con comunicazione degli esiti ad ART; penali solo se definite in sede di bando (misura 3.18).",
            "Notifica ad ART delle istanze di revisione o aggiornamento rilevanti (misura 3.7) e parere vincolante ART sulle estensioni di durata (misura 3.20).",
            "Contabilità regolatoria separata del concessionario (misura 4) e trasmissione dei dati ad ART (misura 15; prima applicazione 15.2.a entro il 31/03/2026).",
            ...(postReformEvents.length ? ["Per le modifiche o vicende soggettive successive al 01/03/2026 applicare l'intero atto di regolazione (misura 1.2, punto ii)."] : []),
          ],
          officialUrl: ART_242_URL,
        });

  const limits = [
    ...(registryDate ? [] : ["Il titolo concessorio non è collegato nel registro: le date derivano dai documenti e vanno confermate."]),
    ...(grant ? [] : ["Data del titolo non accertata: la matrice resta provvisoria."]),
    "Le delibere ART e le linee guida non sostituiscono la verifica della clausola del titolo e del bando: obblighi, penali e cause di decadenza vanno letti nel testo dell'atto.",
  ];
  const applicable = sources.filter((source) => ["FULLY_APPLICABLE", "PARTIALLY_APPLICABLE", "PREVIOUS_TEXT_APPLICABLE"].includes(source.status));
  const conclusion = !grant && !start
    ? "Il regime applicabile non può essere coordinato finché non sono accertate le date della procedura e del titolo."
    : [
      grant ? `Titolo del ${italianDate(grant)}${start && start !== grant ? `, procedura avviata il ${italianDate(start)}` : ""}.` : `Procedura avviata il ${italianDate(start!)}; data del titolo da accertare.`,
      `Fonti operative: ${applicable.map((source) => `${source.citation} (${STATUS_LABELS[source.status].toLowerCase()})`).join("; ")}.`,
      "Il rilascio si valuta con le regole vigenti alla procedura e al titolo; vigilanza, contestazioni e decadenza con le regole vigenti alla data di ciascuna condotta e di ciascun atto; le misure ART 242/2025 operano solo dal 01/03/2026 e, per i titoli in essere, nei limiti della misura 1.2.",
    ].join(" ");
  return { grantDate, procedureStartDate, postReformEvents, analysisDate: input.analysisDate, sources, conclusion, limits };
}

export const STATUS_LABELS: Readonly<Record<PortRegimeSourceStatus, string>> = {
  FULLY_APPLICABLE: "Applicabile integralmente",
  PARTIALLY_APPLICABLE: "Applicabile in parte",
  PREVIOUS_TEXT_APPLICABLE: "Testo previgente",
  NOT_APPLICABLE_RATIONE_TEMPORIS: "Non applicabile ratione temporis",
  SUPERSEDED: "Sostituita",
  DATE_TO_VERIFY: "Data da accertare",
};
