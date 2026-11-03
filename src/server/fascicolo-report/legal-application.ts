import type { StructuredKnowledgeReadItem } from "@/server/queries/fascicolo-knowledge";

/**
 * Deterministic fact-to-law application. Rules are a curated catalogue of official
 * provisions with explicit temporal anchors; the case law used is only the verified,
 * citation-anchored authority already attached to the report questions.
 */

type TemporalAnchor = "CONDUCT" | "ACT" | "GRANT" | "ONGOING_OBLIGATION";

export type LegalRuleTemporalStatus =
  | "APPLICABLE"
  | "APPLICABLE_PREVIOUS_VERSION"
  | "NOT_APPLICABLE_RATIONE_TEMPORIS"
  | "PROSPECTIVE_ONLY"
  | "DATE_TO_VERIFY";

export interface StructuredReportLegalRuleApplication {
  ruleId: string;
  citation: string;
  subject: string;
  temporalAnchor: TemporalAnchor;
  referenceDate: string | null;
  temporalStatus: LegalRuleTemporalStatus;
  temporalReasoning: string;
  applicationToFacts: string;
  officialUrl: string;
}

export interface StructuredReportLegalApplicationAuthority {
  title: string;
  sourceUrl: string | null;
  rationale: string | null;
}

export interface StructuredReportLegalApplication {
  issueSemanticKey: string;
  issueText: string;
  relevantDates: readonly { label: string; date: string; basis: string }[];
  facts: readonly { text: string; humanConfirmed: boolean; pages: readonly number[] }[];
  rules: readonly StructuredReportLegalRuleApplication[];
  favorableAuthorities: readonly StructuredReportLegalApplicationAuthority[];
  contraryAuthorities: readonly StructuredReportLegalApplicationAuthority[];
  favorableArguments: readonly string[];
  contraryArguments: readonly string[];
  conclusionStatus: "GROUNDED_ON_VERIFIED_AUTHORITIES" | "NORMATIVE_ONLY_PRELIMINARY";
  conclusion: string;
  consequences: readonly string[];
}

export interface LegalApplicationContext {
  stato: string;
  dataAvvio: string | null;
  dataProvvedimentoFinale: string | null;
  finalAct: { numeroAtto: string; dataAtto: string } | null;
  concessione: { numeroAtto: string; dataRilascio: string } | null;
  documentTitles: readonly string[];
}

export interface LegalApplicationIssueInput {
  semanticKey: string;
  text: string;
  originatingItemIds: readonly string[];
  favorableAuthorities: readonly StructuredReportLegalApplicationAuthority[];
  contraryAuthorities: readonly StructuredReportLegalApplicationAuthority[];
}

interface RuleVersion {
  from: string;
  label: string;
}

interface CatalogRule {
  id: string;
  citation: string;
  subject: string;
  anchor: TemporalAnchor;
  trigger: RegExp;
  /** Precise ISO start of effect when known; otherwise only the adoption year is catalogued. */
  effectiveFrom: string | null;
  effectiveFromYear: number;
  versions?: readonly RuleVersion[];
  normattivaUrn?: string;
  officialUrl?: string;
  application: string;
  favorable: string;
  contrary: string;
}

const NORMATTIVA = "https://www.normattiva.it/uri-res/N2Ls?";

const CATALOG: readonly CatalogRule[] = [
  {
    id: "COD_NAV_47",
    citation: "Art. 47 cod. nav. (R.D. 30 marzo 1942, n. 327)",
    subject: "Decadenza dalla concessione demaniale",
    anchor: "CONDUCT",
    trigger: /decadenz|inadempi|obblig\w* (?:del )?(?:titolo|concession)|mutamento\w* (?:sostanzial\w* )?(?:dello )?scopo|mancato (?:uso|pagamento)|canon/i,
    effectiveFrom: "1942-04-21",
    effectiveFromYear: 1942,
    normattivaUrn: "urn:nir:stato:regio.decreto:1942-03-30;327~art47",
    application: "La decadenza richiede la prova di una delle fattispecie tipiche (in particolare lett. f per inadempimento degli obblighi del titolo; lett. c per mutamento sostanziale non autorizzato dello scopo), la previa fissazione di un termine per le deduzioni e una decisione motivata dell'autorità concedente (art. 48 cod. nav.).",
    favorable: "Se l'inadempimento di obblighi espressi del titolo è documentato e persistente, la fattispecie tipica dell'art. 47 offre base legale alla decadenza.",
    contrary: "La decadenza non è automatica: difetti di tipicità, di prova, di contraddittorio o di proporzionalità, ovvero la regolarizzazione o la tolleranza dell'amministrazione, possono renderla illegittima.",
  },
  {
    id: "COD_NAV_54",
    citation: "Art. 54 cod. nav. (R.D. 30 marzo 1942, n. 327)",
    subject: "Occupazioni e innovazioni abusive su demanio marittimo",
    anchor: "CONDUCT",
    trigger: /abusiv|innovazion|manufatt|container|prefabbricat|opere? non autorizzat|occupazion\w* (?:senza titolo|eccedent)/i,
    effectiveFrom: "1942-04-21",
    effectiveFromYear: 1942,
    normattivaUrn: "urn:nir:stato:regio.decreto:1942-03-30;327~art54",
    application: "Il potere di ingiunzione al ripristino è distinto dalla decadenza e spetta all'autorità individuata dalla norma; occorre accertare l'opera, l'assenza di assenso e l'eccedenza rispetto al titolo.",
    favorable: "La prova di un'opera non assentita sul demanio fonda il potere ripristinatorio indipendentemente dalla sorte della concessione.",
    contrary: "Assensi pregressi, conoscenza e tolleranza documentata dell'amministrazione o la natura amovibile e assentita del manufatto escludono o limitano il potere ripristinatorio.",
  },
  {
    id: "L84_ART18",
    citation: "Art. 18 L. 28 gennaio 1994, n. 84",
    subject: "Concessione di aree e banchine portuali",
    anchor: "GRANT",
    trigger: /concession\w*[^.]{0,60}(?:area|aree|banchin|portual|terminal)|art\.?\s*18\b|programma di (?:attivit|investiment)|\bPEF\b|piano economico/i,
    effectiveFrom: null,
    effectiveFromYear: 1994,
    versions: [{ from: "2022-08-27", label: "testo modificato dall'art. 5 della L. 5 agosto 2022, n. 118" }],
    normattivaUrn: "urn:nir:stato:legge:1994-01-28;84~art18",
    application: "Il rapporto concessorio portuale va letto alla luce dei requisiti e degli impegni del titolo (programma di attività e investimenti, PEF, traffici e occupazione) e dei poteri di vigilanza dell'Autorità di sistema portuale.",
    favorable: "Il mancato rispetto degli impegni del programma di attività e degli obblighi del titolo è rilevante ai fini della vigilanza e delle misure previste dal titolo e dalla legge.",
    contrary: "Gli scostamenti dal programma devono essere valutati alla luce di cause non imputabili, revisioni autorizzate del PEF e clausole del titolo; la versione dell'art. 18 applicabile dipende dalla data dell'atto.",
  },
  {
    id: "L84_ART16",
    citation: "Art. 16 L. 28 gennaio 1994, n. 84",
    subject: "Operazioni e servizi portuali",
    anchor: "CONDUCT",
    trigger: /operazion\w* portual|serviz\w* portual|art\.?\s*16\b|autorizzazion\w* (?:all'esercizio|alle operazioni)/i,
    effectiveFrom: null,
    effectiveFromYear: 1994,
    normattivaUrn: "urn:nir:stato:legge:1994-01-28;84~art16",
    application: "Verificare se l'attività svolta richieda l'autorizzazione all'esercizio di operazioni o servizi portuali e se questa fosse in essere alla data dei fatti.",
    favorable: "L'esercizio di operazioni portuali in assenza di autorizzazione è autonomamente rilevante rispetto al rapporto concessorio.",
    contrary: "Se l'attività è accessoria all'uso del bene in concessione o è coperta da autorizzazione, l'art. 16 non fonda ulteriori addebiti.",
  },
  {
    id: "L241_PARTECIPAZIONE",
    citation: "Artt. 7, 10 e 10-bis L. 7 agosto 1990, n. 241",
    subject: "Comunicazione di avvio, partecipazione e preavviso di rigetto",
    anchor: "ACT",
    trigger: /contestazion|avvio del procedimento|contraddittorio|deduzion|memori|audizion|controdeduzion/i,
    effectiveFrom: null,
    effectiveFromYear: 1990,
    normattivaUrn: "urn:nir:stato:legge:1990-08-07;241~art10",
    application: "Le garanzie partecipative si applicano secondo la disciplina vigente alla data di ciascun atto procedimentale (tempus regit actum); occorre provare comunicazione, termine e valutazione espressa delle deduzioni.",
    favorable: "Un contraddittorio documentato, con valutazione puntuale delle memorie, rafforza la tenuta del provvedimento.",
    contrary: "L'omessa o generica valutazione delle deduzioni è un vizio frequentemente dedotto in giudizio; l'art. 21-octies, comma 2, opera solo nei limiti di legge.",
  },
  {
    id: "L241_ART21_NONIES",
    citation: "Artt. 21-quinquies e 21-nonies L. 7 agosto 1990, n. 241",
    subject: "Revoca e annullamento d'ufficio (autotutela)",
    anchor: "ACT",
    trigger: /riesame|autotutela|annullament\w* d'ufficio|revoca/i,
    effectiveFrom: null,
    effectiveFromYear: 2005,
    versions: [{ from: "2021-07-31", label: "termine massimo di dodici mesi per l'annullamento d'ufficio dei provvedimenti autorizzatori o attributivi di vantaggi (in precedenza diciotto mesi)" }],
    normattivaUrn: "urn:nir:stato:legge:1990-08-07;241~art21nonies",
    application: "L'istanza di riesame non obbliga di per sé l'amministrazione a riaprire il procedimento: occorre valutare illegittimità, interesse pubblico attuale, affidamento dei destinatari e termine ragionevole; la revoca richiede sopravvenuti motivi di interesse pubblico o mutamento della situazione di fatto.",
    favorable: "Fatti nuovi o errori manifesti documentati possono giustificare un riesame motivato.",
    contrary: "In assenza di elementi nuovi, la riproposizione di difese già valutate non impone l'autotutela; il decorso del termine e l'affidamento limitano l'annullamento d'ufficio.",
  },
  {
    id: "DM_202_2022",
    citation: "D.M. 28 dicembre 2022, n. 202",
    subject: "Regolamento per il rilascio delle concessioni di aree e banchine portuali",
    anchor: "GRANT",
    trigger: /rilascio|istanz\w* di concession|procedur\w* (?:comparativ|selettiv|ad evidenza)|durata|rinnovo|estension\w* della durata/i,
    effectiveFrom: "2023-01-15",
    effectiveFromYear: 2023,
    normattivaUrn: "urn:nir:ministero.infrastrutture.e.trasporti:decreto:2022-12-28;202",
    application: "Il regolamento disciplina le procedure di rilascio, durata ed estensione delle concessioni ex art. 18; si applica alle procedure e alle istanze successive alla sua entrata in vigore.",
    favorable: "Per istanze presentate dal 15 gennaio 2023 il regolamento fissa criteri di trasparenza, valutazione del PEF e durata vincolanti per l'Autorità.",
    contrary: "Non disciplina retroattivamente titoli rilasciati prima della sua entrata in vigore, salvo che per istanze successive di modifica o estensione.",
  },
  {
    id: "DM_110_2023",
    citation: "D.M. 21 aprile 2023, n. 110 (Linee guida)",
    subject: "Linee guida applicative del regolamento sulle concessioni portuali",
    anchor: "GRANT",
    trigger: /rilascio|istanz\w* di concession|durata|rinnovo|estension\w* della durata|\bPEF\b|piano economico/i,
    effectiveFrom: "2023-05-12",
    effectiveFromYear: 2023,
    officialUrl: "https://www.gazzettaufficiale.it/atto/vediMenuHTML?atto.dataPubblicazioneGazzetta=2023-05-12&atto.codiceRedazionale=23A02826&tipoSerie=serie_generale&tipoVigenza=originario",
    application: "Le linee guida orientano l'applicazione del D.M. 202/2022 (durata, estensione, valutazione del PEF e degli investimenti); rilevano per atti adottati dopo la pubblicazione.",
    favorable: "Offrono parametri motivazionali per valutare durata ed estensione in relazione agli investimenti.",
    contrary: "Sono atti di indirizzo: non integrano fattispecie sanzionatorie né si applicano a rilasci anteriori.",
  },
  {
    id: "ART_57_2018",
    citation: "Delibera ART n. 57/2018, Allegato A (come modificato dalla delibera n. 89/2024)",
    subject: "Accesso equo e non discriminatorio alle infrastrutture portuali",
    anchor: "GRANT",
    trigger: /rilascio|procedur\w* (?:comparativ|selettiv|di gara)|\bPEF\b|piano economico|accesso (?:equo|alle infrastrutture)|\bART\b|Autorit[aà] di regolazione/i,
    effectiveFrom: null,
    effectiveFromYear: 2018,
    officialUrl: "https://www.autorita-trasporti.it/delibere/delibera-n-57-2018/",
    application: "Le prime misure di regolazione ART disciplinano trasparenza e criteri delle procedure di rilascio; la delibera 89/2024 ha introdotto lo schema di PEF per i partecipanti alle procedure; la delibera 242/2025 ne ha poi rivisto la disciplina.",
    favorable: "Per procedure di rilascio successive, la conformità alle misure ART è parametro di legittimità del procedimento.",
    contrary: "Lo schema di PEF della delibera 89/2024 riguarda le procedure successive alla sua adozione: non vincola retroattivamente PEF già approvati.",
  },
  {
    id: "ART_242_2025",
    citation: "Delibera ART n. 242/2025, Allegato A",
    subject: "Revisione delle misure di regolazione in ambito portuale",
    anchor: "ONGOING_OBLIGATION",
    trigger: /concession\w*[^.]{0,60}(?:area|aree|banchin|portual|terminal)|\bPEF\b|piano economico|estension\w* della durata|revisione|contabilit\w* (?:separata|regolatoria)|\bART\b/i,
    effectiveFrom: "2026-03-01",
    effectiveFromYear: 2026,
    officialUrl: "https://www.autorita-trasporti.it/wp-content/uploads/2025/12/All.-A-delibera-n.-242_2025_signed.pdf",
    application: "Per le concessioni preesistenti le misure si applicano dal 1° marzo 2026 nei limiti della misura 1.2, punto iii: obblighi informativi, contabilità separata, monitoraggio e notifiche ad ART per istanze di revisione o estensione successive.",
    favorable: "Dal 1° marzo 2026 l'Autorità di sistema portuale deve esercitare vigilanza e comunicazioni ad ART secondo le misure applicabili.",
    contrary: "La delibera non qualifica retroattivamente condotte anteriori al 1° marzo 2026 né altera atti già adottati prima di tale data.",
  },
];

const MONTHS: Readonly<Record<string, string>> = {
  gennaio: "01", febbraio: "02", marzo: "03", aprile: "04", maggio: "05", giugno: "06",
  luglio: "07", agosto: "08", settembre: "09", ottobre: "10", novembre: "11", dicembre: "12",
};

function validIso(year: string, month: string, day: string): string | null {
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function extractIsoDates(text: string): string[] {
  const dates: string[] = [];
  for (const match of text.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g)) {
    const iso = validIso(match[3], match[2], match[1]);
    if (iso) dates.push(iso);
  }
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const iso = validIso(match[1], match[2], match[3]);
    if (iso) dates.push(iso);
  }
  for (const match of text.matchAll(/\b(\d{1,2})(?:°|º)?\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b/gi)) {
    const iso = validIso(match[3], MONTHS[match[2].toLowerCase()], match[1]);
    if (iso) dates.push(iso);
  }
  return [...new Set(dates)].sort();
}

function isoDay(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function italianDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function ruleUrl(rule: CatalogRule, referenceDate: string | null): string {
  if (rule.normattivaUrn) return `${NORMATTIVA}${rule.normattivaUrn}${referenceDate ? `!vig=${referenceDate}` : ""}`;
  return rule.officialUrl!;
}

function assessTemporal(rule: CatalogRule, referenceDate: string | null, analysisDate: string): {
  status: LegalRuleTemporalStatus;
  reasoning: string;
} {
  if (!referenceDate) {
    return {
      status: "DATE_TO_VERIFY",
      reasoning: "La data rilevante non risulta dai documenti: individuarla prima di applicare la norma nella versione vigente.",
    };
  }
  const refLabel = italianDate(referenceDate);
  const startsAfter = rule.effectiveFrom
    ? referenceDate < rule.effectiveFrom
    : Number(referenceDate.slice(0, 4)) < rule.effectiveFromYear;
  if (rule.anchor === "ONGOING_OBLIGATION") {
    if (rule.effectiveFrom && analysisDate < rule.effectiveFrom) {
      return { status: "PROSPECTIVE_ONLY", reasoning: `Misure non ancora efficaci alla data dell'analisi; efficaci dal ${italianDate(rule.effectiveFrom)}.` };
    }
    return startsAfter
      ? {
        status: "PROSPECTIVE_ONLY",
        reasoning: `I fatti o il titolo (${refLabel}) sono anteriori al ${italianDate(rule.effectiveFrom!)}: le misure si applicano soltanto agli adempimenti e alle istanze successivi a tale data, senza effetti retroattivi.`,
      }
      : { status: "APPLICABLE", reasoning: `Alla data rilevante (${refLabel}) le misure risultano efficaci.` };
  }
  if (startsAfter) {
    const start = rule.effectiveFrom ? italianDate(rule.effectiveFrom) : String(rule.effectiveFromYear);
    return {
      status: rule.effectiveFrom ? "NOT_APPLICABLE_RATIONE_TEMPORIS" : "DATE_TO_VERIFY",
      reasoning: `La data rilevante (${refLabel}) precede l'efficacia della disciplina (${start}).`,
    };
  }
  if (!rule.effectiveFrom && Number(referenceDate.slice(0, 4)) === rule.effectiveFromYear) {
    return { status: "DATE_TO_VERIFY", reasoning: `La data rilevante (${refLabel}) cade nell'anno di adozione: verificare la decorrenza esatta.` };
  }
  const laterVersions = (rule.versions ?? []).filter((version) => referenceDate < version.from);
  if (laterVersions.length > 0) {
    return {
      status: "APPLICABLE_PREVIOUS_VERSION",
      reasoning: `Alla data rilevante (${refLabel}) si applica il testo anteriore a: ${laterVersions.map((version) => `${version.label} (dal ${italianDate(version.from)})`).join("; ")}.`,
    };
  }
  const anchorLabel: Record<TemporalAnchor, string> = {
    CONDUCT: "data della condotta",
    ACT: "data dell'atto (tempus regit actum)",
    GRANT: "data del titolo o della procedura di rilascio",
    ONGOING_OBLIGATION: "data dell'adempimento",
  };
  return { status: "APPLICABLE", reasoning: `Disciplina vigente alla ${anchorLabel[rule.anchor]} (${refLabel}), nella versione allora in vigore.` };
}

function firstDate(texts: readonly string[], pattern?: RegExp): string | null {
  const dates = texts.filter((text) => !pattern || pattern.test(text)).flatMap(extractIsoDates);
  return dates.length ? dates.sort()[0] : null;
}

export function buildLegalApplication(input: {
  issues: readonly LegalApplicationIssueInput[];
  knowledgeItems: readonly StructuredKnowledgeReadItem[];
  analysisDate: string;
  context?: LegalApplicationContext;
}): readonly StructuredReportLegalApplication[] {
  const items = input.knowledgeItems.filter((item) => item.status !== "REJECTED");
  const allTexts = items.map((item) => item.normalizedText);
  const concluded = input.context
    ? ["CONCLUSO", "ARCHIVIATO"].includes(input.context.stato)
      || input.context.dataProvvedimentoFinale !== null
      || input.context.finalAct !== null
    : false;
  const reviewPending = input.context?.documentTitles.some((title) => /riesame|autotutela/i.test(title)) ?? false;
  const grantDate = isoDay(input.context?.concessione?.dataRilascio)
    ?? firstDate(allTexts, /concession\w*[^.]{0,40}(?:n\.|numero|rilasciat|del)/i);
  const decisionDate = isoDay(input.context?.finalAct?.dataAtto) ?? isoDay(input.context?.dataProvvedimentoFinale)
    ?? (concluded ? firstDate(allTexts, /provvediment\w* (?:finale|di decadenza)|decret\w*|determinazion\w*/i) : null);

  return input.issues.map((issue) => {
    const originIds = new Set(issue.originatingItemIds);
    const related = items.filter((item) => originIds.has(item.id));
    const caseText = [issue.text, ...related.map((item) => item.normalizedText)].join(" \n ");
    const conductDate = firstDate(related.filter((item) => ["FACT", "EVENT"].includes(item.kind)).map((item) => item.normalizedText))
      ?? firstDate(related.map((item) => item.normalizedText)) ?? firstDate([issue.text]);
    const actDate = decisionDate ?? isoDay(input.context?.dataAvvio) ?? input.analysisDate;
    const relevantDates = [
      ...(conductDate ? [{ label: "Fatti contestati", date: conductDate, basis: "Data più risalente dei fatti documentati per la questione" }] : []),
      ...(grantDate ? [{ label: "Titolo concessorio", date: grantDate, basis: input.context?.concessione ? "Dato del registro concessioni" : "Data ricavata dai documenti del fascicolo" }] : []),
      ...(decisionDate ? [{ label: "Provvedimento finale", date: decisionDate, basis: "Data dell'atto conclusivo" }] : []),
      { label: "Analisi", date: input.analysisDate, basis: "Revisione del quadro documentale utilizzata" },
    ];
    const rules = CATALOG.filter((rule) => rule.trigger.test(caseText)).map((rule) => {
      const referenceDate = rule.anchor === "CONDUCT" ? conductDate
        : rule.anchor === "GRANT" ? grantDate
          : rule.anchor === "ACT" ? actDate
            : grantDate ?? conductDate;
      const temporal = assessTemporal(rule, referenceDate, input.analysisDate);
      return {
        ruleId: rule.id,
        citation: rule.citation,
        subject: rule.subject,
        temporalAnchor: rule.anchor,
        referenceDate,
        temporalStatus: temporal.status,
        temporalReasoning: temporal.reasoning,
        applicationToFacts: rule.application,
        officialUrl: ruleUrl(rule, rule.normattivaUrn && referenceDate && temporal.status !== "NOT_APPLICABLE_RATIONE_TEMPORIS" ? referenceDate : null),
      } satisfies StructuredReportLegalRuleApplication;
    });
    const operative = rules.filter((rule) => ["APPLICABLE", "APPLICABLE_PREVIOUS_VERSION"].includes(rule.temporalStatus));
    const catalogById = new Map(CATALOG.map((rule) => [rule.id, rule]));
    const favorableArguments = [
      ...operative.map((rule) => `${rule.citation}: ${catalogById.get(rule.ruleId)!.favorable}`),
      ...issue.favorableAuthorities.map((authority) => `${authority.title}${authority.rationale ? `: ${authority.rationale}` : ""}`),
    ];
    const contraryArguments = [
      ...rules.map((rule) => `${rule.citation}: ${catalogById.get(rule.ruleId)!.contrary}`),
      ...issue.contraryAuthorities.map((authority) => `${authority.title}${authority.rationale ? `: ${authority.rationale}` : ""}`),
    ];
    const grounded = issue.favorableAuthorities.length + issue.contraryAuthorities.length > 0;
    const excluded = rules.filter((rule) => ["NOT_APPLICABLE_RATIONE_TEMPORIS", "PROSPECTIVE_ONLY"].includes(rule.temporalStatus));
    const undetermined = rules.filter((rule) => rule.temporalStatus === "DATE_TO_VERIFY");
    const conclusion = [
      operative.length
        ? `La questione va decisa alla luce di ${operative.map((rule) => rule.citation).join("; ")}, nella versione vigente alla data rilevante per ciascuna disposizione.`
        : "Dai documenti non emerge una disposizione del catalogo verificato sicuramente applicabile: la qualificazione richiede l'individuazione professionale della norma.",
      excluded.length ? `Non sono applicabili retroattivamente ai fatti: ${excluded.map((rule) => rule.citation).join("; ")}; ne restano gli effetti per gli adempimenti successivi.` : "",
      undetermined.length ? `Per ${undetermined.map((rule) => rule.citation).join("; ")} occorre prima accertare la data rilevante.` : "",
      grounded
        ? `L'orientamento è confrontato con ${issue.favorableAuthorities.length ? "fonti verificate favorevoli" : "nessuna fonte favorevole verificata"} e ${issue.contraryAuthorities.length ? "fonti verificate contrarie" : "nessuna fonte contraria verificata"}: la conclusione resta subordinata alla verifica professionale.`
        : "Non risultano ancora pronunce verificate pertinenti: la conclusione è preliminare e fondata sul solo dato normativo.",
    ].filter(Boolean).join(" ");
    const consequences = concluded ? [
      ...(reviewPending ? ["Istanza di riesame: istruirla come procedimento distinto, valutando motivi nuovi, interesse pubblico attuale, affidamento e termine dell'annullamento d'ufficio (art. 21-nonies L. 241/1990)."] : []),
      "Il provvedimento finale è impugnabile davanti al TAR entro 60 giorni dalla notificazione o piena conoscenza (art. 29 c.p.a.) o con ricorso straordinario al Presidente della Repubblica entro 120 giorni (art. 9 d.P.R. 24 novembre 1971, n. 1199): verificare notifiche e pendenze prima di ogni ulteriore atto.",
      "Esecuzione: programmare solo gli adempimenti conseguenti all'atto efficace (riconsegna, verifiche tecniche, posizioni contabili), senza riavviare il procedimento concluso.",
    ] : [
      "Prima di qualsiasi provvedimento: contestazione specifica, termine per le deduzioni e valutazione espressa delle stesse.",
      "Distinguere il procedimento concessorio (decadenza, autorità concedente) da quello ripristinatorio (art. 54 cod. nav.) e da eventuali profili sanzionatori di altre autorità.",
    ];
    return {
      issueSemanticKey: issue.semanticKey,
      issueText: issue.text,
      relevantDates,
      facts: related.filter((item) => ["FACT", "EVENT", "LEGAL_ACT", "MEASURE"].includes(item.kind)).map((item) => ({
        text: item.normalizedText,
        humanConfirmed: item.status === "HUMAN_CONFIRMED",
        pages: [...new Set(item.evidence.map((evidence) => evidence.pageNumber))].sort((left, right) => left - right),
      })),
      rules,
      favorableAuthorities: issue.favorableAuthorities,
      contraryAuthorities: issue.contraryAuthorities,
      favorableArguments,
      contraryArguments,
      conclusionStatus: grounded ? "GROUNDED_ON_VERIFIED_AUTHORITIES" : "NORMATIVE_ONLY_PRELIMINARY",
      conclusion,
      consequences,
    };
  });
}
