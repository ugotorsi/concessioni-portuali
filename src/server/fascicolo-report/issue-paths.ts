import type { LegalElementAssessment, LegalIssueProfileAssessment } from "./legal-issue-profiles";
import { LEGAL_ELEMENT_STATUS_LABELS } from "./legal-issue-profiles";
import type { StructuredReportOperationalStep } from "./structured-report";

/**
 * Issue-specific operational paths. Each profile starts from the concrete verification that the
 * documents still require (instead of a fixed accertamento → qualificazione → contestazione →
 * decisione template), keeps incompatible remedies as alternatives and declares the activities
 * that several issues have in common so that they are performed once.
 */

export const SHARED_ADMIN_ACTS_CODE = "SHARED:ADMIN_ACTS_CHECK";

export interface SharedActivityNeed {
  activityCode: typeof SHARED_ADMIN_ACTS_CODE;
  issueSemanticKey: string;
  issueText: string;
  item: string;
}

export interface IssuePath {
  steps: StructuredReportOperationalStep[];
  sharedNeeds: SharedActivityNeed[];
}

export interface IssuePathInput {
  issueSemanticKey: string;
  issueText: string;
  profile: LegalIssueProfileAssessment;
  /** Normalized texts of the knowledge items linked to the issue. */
  caseTexts: readonly string[];
  contested: boolean;
  decisionOptions: string;
  decisionDraft: string;
}

const HUMAN_NOTICE = "Bozza soggetta ad approvazione umana: nessuna firma, protocollazione, notifica o invio automatici.";
const documented = (element: LegalElementAssessment | undefined) => element?.status === "PROVEN" || element?.status === "INDICATED";
const lower = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

function shortSubject(issueText: string): string {
  return issueText.length > 90 ? `${issueText.slice(0, 87).trimEnd()}…` : issueText;
}

function sentencesOf(texts: readonly string[]): string[] {
  return texts.flatMap((text) => text
    .replace(/\b(artt?|nn?|lett|cod|nav|pag)\./gi, "$1")
    .split(/(?<=[.;])\s+(?=[A-ZÀ-ÖØ-Ý«"(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean));
}

function elementSummary(element: LegalElementAssessment): string {
  return `${element.requirement} — ${LEGAL_ELEMENT_STATUS_LABELS[element.status].toLowerCase()}: ${element.reasoning}`;
}

const INTERVENTION_CODE = /\b([A-Z]{1,2}\d{1,2})\b/g;
const EXECUTION_STATE = /intervent|investiment|install|realizz|consegn|collaud|esecuz|eseguit|ultimat|incomplet|ordinat|punti luce|lavori|messa in esercizio|avanzamento|cronoprogramma|programma di attivit/i;

/** Interventions of the activity programme mentioned in the documents (e.g. I1, I4, M2), with the sentences that describe them. */
export function documentedInterventions(caseTexts: readonly string[]): ReadonlyArray<{ code: string; evidence: readonly string[] }> {
  const byCode = new Map<string, string[]>();
  for (const sentence of sentencesOf(caseTexts)) {
    if (!EXECUTION_STATE.test(sentence)) continue;
    for (const [, code] of sentence.matchAll(INTERVENTION_CODE)) {
      const list = byCode.get(code) ?? [];
      const clipped = sentence.length > 240 ? `${sentence.slice(0, 237).trimEnd()}…` : sentence;
      if (!list.includes(clipped)) list.push(clipped);
      byCode.set(code, list);
    }
  }
  return [...byCode].sort(([left], [right]) => left.localeCompare(right)).map(([code, evidence]) => ({ code, evidence }));
}

export type ConductState = "ONGOING" | "CEASED" | "MIXED" | "UNKNOWN";

const CEASED = /\b(?:rimoss|sgomberat|ripristinat|cessat|liberat|restituit)\w*/i;
const ONGOING = /\b(?:tuttora|ancora (?:present|occupat|in essere|depositat|in uso|utilizzat)|persist\w*|perman\w*|non (?:ancora |è stat[oa] |sono stat[ei] )?(?:rimoss|sgomberat|ripristinat|liberat)\w*)/i;

/** Whether the documented occupations are still in place or have ceased. */
export function occupationConductState(caseTexts: readonly string[]): ConductState {
  let ongoing = false;
  let ceased = false;
  for (const sentence of sentencesOf(caseTexts)) {
    if (!/occup|manufatt|container|deposit|stoccagg|mezzi|materiali|area/i.test(sentence)) continue;
    if (ONGOING.test(sentence)) ongoing = true;
    else if (CEASED.test(sentence)) ceased = true;
  }
  return ongoing && ceased ? "MIXED" : ongoing ? "ONGOING" : ceased ? "CEASED" : "UNKNOWN";
}

function contestationStep(input: IssuePathInput, substantive: readonly LegalElementAssessment[], bases: readonly string[], coreMet: boolean, notJustifiedReason: string): StructuredReportOperationalStep {
  const subject = shortSubject(input.issueText);
  const contraddittorio = input.profile.elements.find((element) => element.elementId === "contraddittorio");
  if (input.contested) {
    return {
      activityCode: `PROFILE:${input.profile.profileId}:ASSESS_DEFENSE`,
      necessity: "REQUIRED",
      title: `${subject}: valutare le deduzioni del concessionario`,
      action: `Contestazione già registrata. ${contraddittorio?.reasoning ?? ""} Valutare ogni deduzione rispetto ai singoli requisiti prima di qualsiasi misura.`,
      office: "Responsabile del procedimento dell'autorità concedente competente",
      requiredDocuments: ["Contestazione notificata e prova della ricezione", "Deduzioni, memorie e verbale dell'eventuale audizione"],
      completionGate: "Ogni deduzione ha ricevuto una valutazione espressa",
    };
  }
  return {
    activityCode: `PROFILE:${input.profile.profileId}:CONTESTATION`,
    necessity: coreMet ? "CONDITIONAL" : "NOT_JUSTIFIED",
    title: `${subject}: contestazione degli addebiti`,
    action: coreMet
      ? `Predisporre la contestazione solo se la qualificazione è validata, indicando per ciascun addebito fatti e pagine di riscontro, norme violate (${bases.join("; ")}) e termine per le deduzioni ai sensi dell'art. 47, ultimo comma, cod. nav. e degli artt. 7 e 10 L. 241/1990.`
      : `Non avviare la contestazione allo stato: ${notJustifiedReason} Una contestazione priva di prova espone l'atto ad annullamento per difetto di istruttoria.`,
    office: "Responsabile del procedimento dell'autorità concedente competente",
    requiredDocuments: ["Relazione istruttoria con le prove dei requisiti", "Prova della notificazione e del termine assegnato"],
    completionGate: "Contestazione notificata con termine per le deduzioni, oppure motivata decisione di non procedere",
    ...(coreMet ? {
      documentCode: "CONTESTAZIONE_ADDEBITI",
      draftTitle: "Contestazione degli addebiti",
      draftTemplate: [
        `Oggetto: contestazione degli addebiti — ${subject}.`,
        `Elementi risultanti dal fascicolo (da confermare prima della notifica):\n${substantive
          .filter((element) => documented(element))
          .map((element) => `- ${element.requirement} (${element.legalBasis}): ${element.reasoning}`)
          .join("\n")}`,
        `Qualificazione proposta: ${input.profile.qualification}`,
        `Norme: ${bases.join("; ")}, nel testo vigente alla data delle condotte.`,
        "Termine per le deduzioni e per chiedere l'audizione: [TERMINE DA VERIFICARE] giorni (art. 47, ultimo comma, cod. nav.; artt. 7 e 10 L. 241/1990).",
        "Organo competente: [ORGANO DA VERIFICARE]. Responsabile del procedimento: [RESPONSABILE].",
        "Bozza soggetta ad approvazione umana; nessuna notifica automatica.",
      ].join("\n\n"),
    } : {}),
  };
}

function qualificationStep(input: IssuePathInput, title: string, bases: readonly string[], contrary: readonly LegalElementAssessment[], extraDocuments: readonly string[] = []): StructuredReportOperationalStep {
  return {
    activityCode: `PROFILE:${input.profile.profileId}:QUALIFICATION`,
    necessity: "REQUIRED",
    title: `${shortSubject(input.issueText)}: ${title}`,
    action: input.profile.qualification,
    office: "Ufficio legale o concessioni dell'ente concedente; il professionista valida la qualificazione",
    requiredDocuments: [...bases.map((basis) => `Testo vigente alla data dei fatti: ${basis}`), ...extraDocuments],
    completionGate: contrary.length
      ? `Gli elementi contrari o giustificativi (${contrary.map((element) => lower(element.requirement)).join("; ")}) sono stati valutati espressamente`
      : "Qualificazione motivata e validata dal professionista, con indicazione dei requisiti provati, non dimostrati e determinanti",
  };
}

function decisionStep(input: IssuePathInput, coreMet: boolean): StructuredReportOperationalStep {
  return {
    activityCode: `PROFILE:${input.profile.profileId}:DECISION`,
    necessity: coreMet || input.contested ? "REQUIRED" : "CONDITIONAL",
    title: `${shortSubject(input.issueText)}: decisione motivata e proporzionata`,
    action: coreMet || input.contested
      ? `${input.decisionOptions} Motivare su ciascun requisito, sulle deduzioni e sulla proporzionalità rispetto a gravità e durata della condotta.`
      : `Decisione da assumere solo dopo le verifiche precedenti; se i presupposti non risultano, concludere con archiviazione motivata. ${input.decisionOptions}`,
    office: "Organo dell'ente concedente competente per il provvedimento",
    requiredDocuments: ["Esito motivato per ciascun requisito", "Valutazione delle deduzioni, se acquisite", "Schema di provvedimento e piano di verifica degli adempimenti"],
    completionGate: "Autorizzazione umana all'adozione dopo verifica di competenza, motivazione e garanzie",
    documentCode: "SCHEMA_DECISIONE",
    draftTitle: "Schema di decisione motivata",
    draftTemplate: input.decisionDraft,
  };
}

function thirdPartyPath(input: IssuePathInput, ctx: PathContext): IssuePath {
  const { byId, bases, contrary, coreMet, subject } = ctx;
  const use = byId.get("third-party-use");
  const authorization = byId.get("no-authorization");
  const nature = byId.get("activity-nature");
  const steps: StructuredReportOperationalStep[] = [];
  if (use?.status !== "PROVEN" || nature?.status !== "PROVEN") {
    steps.push({
      activityCode: "PROFILE:THIRD_PARTY_USE:EVIDENCE",
      necessity: "REQUIRED",
      title: `${subject}: accertare la natura del rapporto con il terzo`,
      action: [
        "Prima di ogni qualificazione stabilire se il terzo riceve un servizio dal concessionario, gestisce un'attività affidata (art. 45-bis cod. nav.; art. 18, comma 9, L. 84/1994) o è sostituito nel godimento del bene (art. 46 cod. nav.).",
        use ? elementSummary(use) : "",
        nature ? elementSummary(nature) : "",
      ].filter(Boolean).join(" "),
      office: "Responsabile del procedimento e ufficio demanio dell'ente concedente",
      requiredDocuments: [
        "Contratto con il terzo e relativi allegati (oggetto, superfici, durata, corrispettivo, personale e attrezzature)",
        "Confronto fra oggetto del contratto, oggetto della concessione e programma di attività",
        "Verbale di sopralluogo sull'uso effettivo delle aree",
      ],
      completionGate: "Natura del rapporto, attività affidata, superfici e durata accertate con documenti verificati",
      documentCode: "RICHIESTA_DOCUMENTI_RAPPORTO_TERZO",
      draftTitle: "Richiesta di documenti e chiarimenti sul rapporto con il terzo",
      draftTemplate: [
        `Oggetto: richiesta di documenti e chiarimenti — ${subject}.`,
        "Destinatario: [CONCESSIONARIO], [DOMICILIO DIGITALE].",
        "Nell'ambito dell'istruttoria, ai sensi dell'art. 6, comma 1, lett. b), L. 241/1990, si chiede di trasmettere entro [TERMINE DA VERIFICARE]:",
        "1. copia integrale del contratto con [TERZO] e degli eventuali atti modificativi;\n2. descrizione delle attività svolte dal terzo, delle superfici utilizzate, del personale e delle attrezzature impiegati;\n3. indicazione di eventuali istanze o autorizzazioni dell'ente concedente relative al rapporto, con estremi di protocollo.",
        "La richiesta non costituisce contestazione di addebiti e non anticipa la qualificazione giuridica del rapporto.",
        "Responsabile del procedimento: [RESPONSABILE] – [UNITÀ ORGANIZZATIVA].",
        HUMAN_NOTICE,
      ].join("\n\n"),
    });
  }
  const sharedNeeds: SharedActivityNeed[] = authorization?.status === "PROVEN" ? [] : [{
    activityCode: SHARED_ADMIN_ACTS_CODE,
    issueSemanticKey: input.issueSemanticKey,
    issueText: input.issueText,
    item: authorization?.status === "CONTRARY_EVIDENCE"
      ? "oggetto, durata e limiti dell'atto di assenso che risulta dai documenti per il rapporto con il terzo"
      : "esistenza o meno di autorizzazioni all'affidamento o al subingresso (artt. 45-bis e 46 cod. nav.; art. 18, comma 9, L. 84/1994): il mancato reperimento nel fascicolo non prova che non siano state rilasciate",
  }];
  steps.push(qualificationStep(input, "qualificare il rapporto (affidamento, subingresso o servizio)", bases, contrary,
    ["Titolo concessorio e programma di attività con prescrizioni pertinenti", "Esito della verifica presso l'ufficio demanio sugli atti di assenso"]));
  steps.push(contestationStep(input, ctx.substantive, bases, coreMet,
    "l'uso da parte del terzo o l'assenza di autorizzazione non sono accertati; prima verificare il rapporto e gli atti di assenso."));
  steps.push(decisionStep(input, coreMet));
  return { steps, sharedNeeds };
}

function investmentPath(input: IssuePathInput, ctx: PathContext): IssuePath {
  const { byId, bases, contrary, coreMet, subject } = ctx;
  const interventions = documentedInterventions(input.caseTexts);
  const codes = interventions.map((entry) => entry.code);
  const justification = byId.get("no-justification");
  const obligation = byId.get("obligation");
  const performance = byId.get("non-performance");
  const pending = input.profile.pendingDeadline ?? null;
  const steps: StructuredReportOperationalStep[] = [];
  const perIntervention = interventions.length
    ? interventions.map((entry) => `${entry.code}: ${entry.evidence.join(" ")}`).join(" | ")
    : "Gli interventi non sono individuati singolarmente nei documenti collegati.";
  if (pending) {
    steps.push({
      activityCode: "PROFILE:INVESTMENT_DEFAULT:MONITORING",
      necessity: "REQUIRED",
      title: `${subject}: monitorare lo stato di avanzamento fino al ${pending}`,
      action: `Il termine documentato non è scaduto: programmare la verifica annuale dello stato di avanzamento (art. 18, comma 10, L. 84/1994; art. 9 D.I. 202/2022). Situazione documentata per intervento: ${perIntervention}`,
      office: "Ufficio concessioni e ufficio tecnico dell'ente concedente",
      requiredDocuments: ["Cronoprogramma del programma di attività", "Ultimo stato di avanzamento per ciascun intervento"],
      completionGate: "Verifica annuale programmata o eseguita con esito documentato",
    });
  } else if (obligation?.status !== "PROVEN" || performance?.status !== "PROVEN") {
    steps.push({
      activityCode: "PROFILE:INVESTMENT_DEFAULT:EVIDENCE",
      necessity: "REQUIRED",
      title: `${subject}: ricostruire per ciascun intervento${codes.length ? ` (${codes.join(", ")})` : ""} termine, esecuzione e verbali`,
      action: [
        `Per ogni intervento separare obbligo e termine del programma, stato di esecuzione alla scadenza e verbali di verifica. Situazione documentata: ${perIntervention}`,
        obligation ? elementSummary(obligation) : "",
        performance ? elementSummary(performance) : "",
      ].filter(Boolean).join(" "),
      office: "Ufficio concessioni e ufficio tecnico dell'ente concedente",
      requiredDocuments: [
        "Programma di attività e cronoprogramma con il termine di ciascun intervento",
        "Verbale della verifica annuale o di sopralluogo per ciascun intervento",
        "Stati di avanzamento, certificati di collaudo o di messa in esercizio",
      ],
      completionGate: "Per ogni intervento sono documentati termine, stato di esecuzione alla scadenza e fonte del dato",
      documentCode: "RICHIESTA_STATO_INTERVENTI",
      draftTitle: "Richiesta di aggiornamento sullo stato degli interventi",
      draftTemplate: [
        `Oggetto: richiesta di aggiornamento sullo stato degli interventi del programma di attività — ${subject}.`,
        "Destinatario: [CONCESSIONARIO], [DOMICILIO DIGITALE].",
        `Si chiede di trasmettere entro [TERMINE DA VERIFICARE], per ciascun intervento${codes.length ? ` (${codes.join(", ")})` : ""}: stato di esecuzione, verbali di collaudo o di messa in esercizio, eventuali cause del ritardo e relative evidenze, istanze di proroga o di revisione del programma già presentate.`,
        "La richiesta ha finalità istruttoria (art. 6, comma 1, lett. b), L. 241/1990; art. 18, comma 10, L. 84/1994) e non costituisce contestazione.",
        "Responsabile del procedimento: [RESPONSABILE] – [UNITÀ ORGANIZZATIVA].",
        HUMAN_NOTICE,
      ].join("\n\n"),
    });
  }
  if (!pending && justification?.status !== "PROVEN") {
    steps.push({
      activityCode: "PROFILE:INVESTMENT_DEFAULT:JUSTIFICATION",
      necessity: justification?.status === "CONTRARY_EVIDENCE" ? "REQUIRED" : "CONDITIONAL",
      title: `${subject}: istruire le possibili cause giustificative del ritardo`,
      action: `${justification ? elementSummary(justification) : ""} L'art. 18, comma 11, L. 84/1994 esclude la decadenza in presenza di giustificato motivo; per le lett. a) e b) dell'art. 47 cod. nav. è possibile la proroga.`.trim(),
      office: "Ufficio concessioni con l'ufficio tecnico e gli enti competenti per autorizzazioni e pareri",
      requiredDocuments: ["Istanze di proroga o di revisione del programma", "Stato delle autorizzazioni e dei pareri di altre amministrazioni (es. titolo allo scarico, approvazione del progetto)", "Corrispondenza sul ritardo"],
      completionGate: "Ogni causa giustificativa allegata è valutata come fondata o infondata, con motivazione",
    });
  }
  const sharedNeedsList: SharedActivityNeed[] = pending ? [] : [{
    activityCode: SHARED_ADMIN_ACTS_CODE,
    issueSemanticKey: input.issueSemanticKey,
    issueText: input.issueText,
    item: "atti dell'ente concedente che abbiano prorogato o modificato i termini degli interventi o approvato revisioni del programma e del PEF",
  }];
  steps.push(qualificationStep(input, pending ? "verificare l'assenza di inadempimento attuale" : "qualificare l'esito per singolo intervento", bases, contrary,
    ["Titolo concessorio e programma di attività con il cronoprogramma"]));
  const remedyJustified = !pending && documented(obligation) && documented(performance);
  steps.push({
    activityCode: "PROFILE:INVESTMENT_DEFAULT:REMEDY",
    necessity: remedyJustified ? "CONDITIONAL" : "NOT_JUSTIFIED",
    title: `${subject}: scegliere il rimedio per gli interventi in ritardo`,
    action: remedyJustified
      ? "Rimedi alternativi, da scegliere per ciascun intervento dopo la qualificazione: diffida ad adempiere con termine; proroga (art. 47, comma 2, cod. nav., per le lett. a e b); revisione autorizzata del programma o del PEF; penali solo se predeterminate nel titolo. Le alternative non sono cumulative."
      : pending
        ? "Nessun rimedio è pertinente prima della scadenza del termine documentato."
        : "Il rimedio non è ancora individuabile: obbligo e mancata esecuzione alla scadenza non sono entrambi documentati.",
    office: "Ufficio concessioni dell'ente concedente",
    requiredDocuments: ["Qualificazione validata per ciascun intervento", "Clausole del titolo su penali e garanzie"],
    completionGate: "Rimedio scelto e motivato per ciascun intervento, oppure esclusione motivata",
    ...(remedyJustified ? {
      documentCode: "DIFFIDA_INTERVENTI",
      draftTitle: "Diffida a completare gli interventi",
      draftTemplate: [
        `Oggetto: diffida a completare gli interventi del programma di attività — ${subject}.`,
        "Destinatario: [CONCESSIONARIO], [DOMICILIO DIGITALE].",
        `Interventi interessati, con termine originario e stato documentato:\n${interventions.length ? interventions.map((entry) => `- ${entry.code}: [TERMINE DEL PROGRAMMA] – ${entry.evidence[0]}`).join("\n") : "- [INTERVENTO]: [TERMINE DEL PROGRAMMA] – [STATO DOCUMENTATO]"}`,
        "Si invita a completare gli interventi entro [TERMINE DA VERIFICARE] e a comunicare eventuali cause non imputabili con la relativa documentazione.",
        "La diffida non costituisce contestazione ai fini della decadenza e non pregiudica la valutazione di proroghe o revisioni del programma.",
        HUMAN_NOTICE,
      ].join("\n\n"),
    } : {}),
  });
  steps.push(contestationStep(input, ctx.substantive, bases, coreMet && !pending,
    pending ? `il termine documentato (${pending}) non è scaduto.` : "obbligo, mancata esecuzione e assenza di giustificato motivo non sono tutti accertati."));
  steps.push(decisionStep(input, coreMet && !pending));
  return { steps, sharedNeeds: sharedNeedsList };
}

function occupationPath(input: IssuePathInput, ctx: PathContext): IssuePath {
  const { byId, bases, contrary, coreMet, subject } = ctx;
  const state = occupationConductState(input.caseTexts);
  const finding = byId.get("material-finding");
  const outside = byId.get("outside-title");
  const title = byId.get("no-title");
  const steps: StructuredReportOperationalStep[] = [];
  const stateLabel: Record<ConductState, string> = {
    ONGOING: "i documenti indicano occupazioni ancora in essere",
    CEASED: "i documenti indicano che le occupazioni sono cessate",
    MIXED: "i documenti indicano alcune occupazioni ancora in essere e altre cessate",
    UNKNOWN: "i documenti non chiariscono se le occupazioni siano ancora in essere",
  };
  if (finding?.status !== "PROVEN" || outside?.status !== "PROVEN" || state === "UNKNOWN" || state === "MIXED") {
    steps.push({
      activityCode: "PROFILE:UNAUTHORIZED_OCCUPATION:EVIDENCE",
      necessity: "REQUIRED",
      title: `${subject}: accertare con sopralluogo quali occupazioni sono in essere e quali cessate`,
      action: [
        `Allo stato ${stateLabel[state]}. Rilevare per ciascuna area superficie, opere o materiali, localizzazione rispetto alla planimetria del titolo e data dell'ultima constatazione.`,
        finding ? elementSummary(finding) : "",
        outside ? elementSummary(outside) : "",
      ].filter(Boolean).join(" "),
      office: "Ufficio tecnico e ufficio demanio dell'ente concedente; autorità marittima per i profili di sicurezza",
      requiredDocuments: ["Planimetria allegata al titolo", "Verbale di sopralluogo con rilievo fotografico datato", "Precedenti verbali o segnalazioni"],
      completionGate: "Ogni occupazione è localizzata rispetto al titolo e qualificata come in essere o cessata alla data del sopralluogo",
      documentCode: "VERBALE_SOPRALLUOGO",
      draftTitle: "Verbale di sopralluogo e accertamento",
      draftTemplate: [
        `Verbale di sopralluogo n. [NUMERO] del [DATA] — ${subject}.`,
        "Presenti: [FUNZIONARI E QUALIFICA]; per il concessionario: [PRESENTI O ASSENZA].",
        "Per ciascuna area: [IDENTIFICAZIONE] – superficie [MQ] – opere o materiali [DESCRIZIONE] – posizione rispetto alla planimetria del titolo [DENTRO/FUORI] – stato [IN ESSERE/CESSATA] – fotografie [RIFERIMENTI].",
        "Il verbale distingue i fatti constatati dalle valutazioni giuridiche, riservate all'istruttoria.",
        HUMAN_NOTICE,
      ].join("\n\n"),
    });
  }
  const sharedNeedsList: SharedActivityNeed[] = title?.status === "PROVEN" ? [] : [{
    activityCode: SHARED_ADMIN_ACTS_CODE,
    issueSemanticKey: input.issueSemanticKey,
    issueText: input.issueText,
    item: "autorizzazioni temporanee, variazioni del contenuto della concessione (art. 24 reg. nav. mar.) o altri assensi per le aree occupate",
  }];
  steps.push(qualificationStep(input, "qualificare separatamente le condotte in essere e quelle cessate", bases, contrary,
    ["Esito del sopralluogo e della verifica degli assensi"]));
  const restorationJustified = documented(finding) && documented(title) && state !== "CEASED";
  steps.push({
    activityCode: "PROFILE:UNAUTHORIZED_OCCUPATION:RESTORATION",
    necessity: restorationJustified ? "CONDITIONAL" : "NOT_JUSTIFIED",
    title: `${subject}: valutare sgombero e rimessa in pristino delle occupazioni in essere`,
    action: restorationJustified
      ? "Per le sole occupazioni ancora in essere e prive di titolo l'autorità competente può ingiungere la rimessa in pristino (art. 54 cod. nav.), potere autonomo dalla decadenza; verificare la competenza prima dell'atto."
      : state === "CEASED"
        ? "Le occupazioni risultano cessate: l'ingiunzione di sgombero non è pertinente; valutare soltanto il rilievo della condotta pregressa (eventuali indennità dovute secondo la disciplina applicabile e incidenza sulla valutazione degli obblighi del titolo)."
        : "Non pertinente finché occupazione e assenza di titolo non sono accertate.",
    office: "Autorità competente ai sensi dell'art. 54 cod. nav.",
    requiredDocuments: ["Verbale di sopralluogo", "Esito della verifica degli assensi"],
    completionGate: "Misura ripristinatoria adottata o esclusa con motivazione per ciascuna occupazione in essere",
    ...(restorationJustified ? {
      documentCode: "INGIUNZIONE_RIPRISTINO",
      draftTitle: "Ingiunzione di sgombero e rimessa in pristino",
      draftTemplate: [
        `Oggetto: occupazione di aree demaniali non assentite — ${subject}.`,
        "Accertamenti: [VERBALE, DATA, AREE, SUPERFICI E OPERE ANCORA IN ESSERE].",
        "Competenza e presupposti dell'art. 54 cod. nav.: [VERIFICA DOCUMENTATA].",
        "Si ingiunge di sgomberare le aree e di rimettere le cose in pristino entro [TERMINE DA VERIFICARE]; in caso di inottemperanza: [CONSEGUENZE VERIFICATE].",
        "Restano impregiudicate le valutazioni sul rapporto concessorio, oggetto di procedimento distinto.",
        HUMAN_NOTICE,
      ].join("\n\n"),
    } : {}),
  });
  steps.push(contestationStep(input, ctx.substantive, bases, coreMet,
    "occupazione, localizzazione fuori dal titolo e assenza di assenso non sono tutte accertate."));
  steps.push(decisionStep(input, coreMet));
  return { steps, sharedNeeds: sharedNeedsList };
}

function feePath(input: IssuePathInput, ctx: PathContext): IssuePath {
  const { byId, bases, contrary, coreMet, subject } = ctx;
  const due = byId.get("fee-due");
  const unpaid = byId.get("non-payment");
  const threshold = byId.get("rate-threshold");
  const imputation = byId.get("imputation");
  const steps: StructuredReportOperationalStep[] = [];
  if (due?.status !== "PROVEN" || unpaid?.status !== "PROVEN" || documented(imputation)) {
    steps.push({
      activityCode: "PROFILE:FEE_PAYMENT:EVIDENCE",
      necessity: "REQUIRED",
      title: `${subject}: ricostruire rate, importi, pagamenti, imputazioni e saldo`,
      action: [
        "Predisporre il prospetto per rata: scadenza, importo dovuto, versamenti con data e causale, imputazione (art. 1193 c.c.), saldo e interessi; solo dopo valutare recupero o decadenza.",
        due ? elementSummary(due) : "",
        unpaid ? elementSummary(unpaid) : "",
        imputation && documented(imputation) ? elementSummary(imputation) : "",
      ].filter(Boolean).join(" "),
      office: "Ufficio concessioni con la ragioneria dell'ente concedente",
      requiredDocuments: ["Clausola del titolo su importo, rate e scadenze", "Estratto contabile dei versamenti con causali", "Eventuali proposte di rateizzazione o compensazione e relativi riscontri"],
      completionGate: "Saldo per rata ricostruito e verificato dalla ragioneria",
      documentCode: "PROSPETTO_RICONCILIAZIONE_CANONI",
      draftTitle: "Prospetto di riconciliazione dei canoni",
      draftTemplate: [
        `Prospetto di riconciliazione dei canoni — ${subject}.`,
        "Per ciascuna rata: n. [RATA] – scadenza [DATA] – dovuto [IMPORTO] – versato [IMPORTO, DATA, CAUSALE] – imputazione [CRITERIO] – residuo [IMPORTO].",
        "Totale dovuto: [IMPORTO]. Totale versato: [IMPORTO]. Saldo: [IMPORTO]. Rate interamente insolute: [NUMERO]. Soglia di decadenza prevista dal titolo: [NUMERO O ASSENTE].",
        "Documento interno di istruttoria, da verificare con la ragioneria.",
      ].join("\n\n"),
    });
  }
  steps.push(qualificationStep(input, "qualificare il credito e la rilevanza delle rate insolute", bases, contrary,
    ["Prospetto di riconciliazione verificato"]));
  const recoveryJustified = documented(due) && documented(unpaid);
  steps.push({
    activityCode: "PROFILE:FEE_PAYMENT:RECOVERY",
    necessity: recoveryJustified ? "CONDITIONAL" : "NOT_JUSTIFIED",
    title: `${subject}: messa in mora e recupero del saldo`,
    action: recoveryJustified
      ? "Dopo la verifica del saldo, intimare il pagamento delle somme residue con interessi nei limiti di legge; valutare rateizzazione se ammessa dall'ente ed escussione della garanzia se prevista dal titolo."
      : "Il recupero non è ancora pertinente: importo dovuto e mancato pagamento non sono entrambi documentati.",
    office: "Ufficio concessioni e ragioneria",
    requiredDocuments: ["Prospetto di riconciliazione verificato", "Clausole del titolo su garanzie e interessi"],
    completionGate: "Somme intimate e riscontro del concessionario registrato, oppure esclusione motivata",
    ...(recoveryJustified ? {
      documentCode: "MESSA_IN_MORA_CANONI",
      draftTitle: "Messa in mora per canoni non versati",
      draftTemplate: [
        `Oggetto: canoni demaniali non versati — ${subject}.`,
        "Destinatario: [CONCESSIONARIO], [DOMICILIO DIGITALE].",
        "Dal prospetto di riconciliazione risultano non versate le seguenti somme: [RATE, IMPORTI E SCADENZE].",
        "Si invita al pagamento entro [TERMINE DA VERIFICARE] con le modalità [MODALITÀ]; gli interessi sono dovuti nei limiti di [FONDAMENTO VERIFICATO].",
        "L'atto non costituisce contestazione ai fini della decadenza.",
        HUMAN_NOTICE,
      ].join("\n\n"),
    } : {}),
  });
  steps.push(contestationStep(input, ctx.substantive, bases, coreMet,
    threshold?.status === "CONTRARY_EVIDENCE"
      ? "le rate insolute risultano inferiori alla soglia fissata dal titolo (art. 47, lett. d, cod. nav.)."
      : "il raggiungimento del numero di rate omesse fissato dal titolo (art. 47, lett. d, cod. nav.) non è accertato."));
  steps.push(decisionStep(input, coreMet));
  return { steps, sharedNeeds: [] };
}

interface PathContext {
  subject: string;
  substantive: readonly LegalElementAssessment[];
  byId: ReadonlyMap<string, LegalElementAssessment>;
  bases: readonly string[];
  contrary: readonly LegalElementAssessment[];
  coreMet: boolean;
}

export function buildIssuePath(input: IssuePathInput): IssuePath {
  const substantive = input.profile.elements.filter((element) => element.elementId !== "contraddittorio");
  const ctx: PathContext = {
    subject: shortSubject(input.issueText),
    substantive,
    byId: new Map(substantive.map((element) => [element.elementId, element])),
    bases: [...new Set(substantive.flatMap((element) => element.legalBasis.split(/;\s*/)).map((basis) => basis.trim()).filter(Boolean))],
    contrary: substantive.filter((element) => element.status === "CONTRARY_EVIDENCE"),
    coreMet: substantive.filter((element) => element.core).every((element) => documented(element)),
  };
  switch (input.profile.profileId) {
    case "THIRD_PARTY_USE": return thirdPartyPath(input, ctx);
    case "INVESTMENT_DEFAULT": return investmentPath(input, ctx);
    case "UNAUTHORIZED_OCCUPATION": return occupationPath(input, ctx);
    case "FEE_PAYMENT": return feePath(input, ctx);
  }
}

/**
 * Builds the single shared verification of administrative acts, hosted by one deterministic issue
 * (the smallest semantic key among those that need it) and referenced by the others.
 */
export function sharedAdminActsStep(needs: readonly SharedActivityNeed[]): { hostIssueSemanticKey: string; step: StructuredReportOperationalStep } | null {
  if (!needs.length) return null;
  const ordered = [...needs].sort((left, right) => left.issueSemanticKey.localeCompare(right.issueSemanticKey));
  const host = ordered[0].issueSemanticKey;
  const issues = [...new Map(ordered.map((need) => [need.issueSemanticKey, need.issueText])).values()];
  return {
    hostIssueSemanticKey: host,
    step: {
      activityCode: SHARED_ADMIN_ACTS_CODE,
      necessity: "REQUIRED",
      title: issues.length > 1
        ? `Attività comune a ${issues.length} problematiche: verificare presso l'ufficio demanio gli atti di assenso, proroga e variazione`
        : "Verificare presso l'ufficio demanio gli atti di assenso, proroga e variazione",
      action: `Una sola verifica documentale per tutte le problematiche interessate. Accertare: ${ordered.map((need) => `${need.item} (${need.issueText})`).join("; ")}. L'assenza di un atto dal fascicolo non prova che non sia stato rilasciato: occorre il riscontro scritto dell'ufficio.`,
      office: "Ufficio demanio e protocollo dell'ente concedente",
      requiredDocuments: ["Riscontro scritto dell'ufficio demanio con gli estremi degli atti rinvenuti o l'attestazione che non risultano", "Copia degli atti rinvenuti"],
      completionGate: "Per ciascuna problematica è documentato se gli atti esistono, con estremi e contenuto, oppure che non risultano agli atti dell'ufficio",
      documentCode: "NOTA_VERIFICA_ATTI_ASSENSO",
      draftTitle: "Nota interna di verifica degli atti di assenso",
      draftTemplate: [
        "Oggetto: richiesta interna di verifica degli atti di assenso, proroga e variazione relativi alla concessione [CONCESSIONE].",
        "Destinatario: ufficio demanio – [UNITÀ ORGANIZZATIVA].",
        `Si chiede di verificare negli archivi e nel protocollo dell'ente e di comunicare per iscritto, con estremi e copia degli atti eventualmente rinvenuti:\n${ordered.map((need, index) => `${index + 1}. ${need.item};`).join("\n")}`,
        "Se nessun atto risulta, indicare gli archivi consultati e la data della verifica.",
        "Nota interna: nessun invio automatico.",
      ].join("\n\n"),
      sharedIssueSemanticKeys: [...new Set(ordered.map((need) => need.issueSemanticKey))],
    },
  };
}
