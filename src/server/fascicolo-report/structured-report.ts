import { createHash } from "node:crypto";

import {
  hasProfessionalSourceClassification,
  isProfessionallyUsableSource,
  SOURCE_REVIEW_POLICY,
  UNREVIEWED_SOURCE_NOTICE,
} from "@/lib/professional-research-sources";
import { stableStringify } from "@/server/audit/hash";
import { detectActPhase, type ActPhaseDetection } from "@/server/fascicolo-acts/templates";
import type { StructuredKnowledgeReadItem, StructuredKnowledgeReadModel } from "@/server/queries/fascicolo-knowledge";

import { buildLegalApplication, extractIsoDates, type StructuredReportLegalApplication } from "./legal-application";
import { assessIssueProfile, LEGAL_ELEMENT_STATUS_LABELS, type LegalIssueProfileAssessment } from "./legal-issue-profiles";
import { buildPortRegimeCoordination, isPortConcessionMatter, type PortRegimeCoordination } from "./port-regime";

export type { StructuredReportLegalApplication } from "./legal-application";
export type { PortRegimeCoordination } from "./port-regime";

export const STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION = "STRUCTURED_FASCICOLO_REPORT_V1" as const;

type JsonRecord = Readonly<Record<string, unknown>>;
type Direction = "SUPPORTS" | "OPPOSES" | "NEUTRAL" | "INCONCLUSIVE" | "UNASSESSED";

export interface StructuredReportResearchResultInput {
  resultId: string;
  missionId?: string;
  title: string;
  sourceUrl: string | null;
  provider: string | null;
  supportDirection: Direction;
  classificationSource?: "PROVIDER_OUTPUT" | "SYNTHETIC_TEST" | "HUMAN_REVIEW" | "AI_CLASSIFIER";
  classificationReviewAuditId?: string | null;
  classificationReviewStatus: "AI_PROPOSED" | "HUMAN_CONFIRMED" | "REJECTED";
  classificationRationale: string | null;
  relevantPassage?: string | null;
  sourceAssessment: {
    assessmentId: string;
    chainFingerprint: string;
    isCurrent: boolean;
    usable: boolean;
    citationAnchors: readonly JsonRecord[];
    blockingReasons: readonly string[];
    manualReviewRequired: boolean;
    manualReviewReason: string | null;
  } | null;
}

export interface StructuredReportMissionInput {
  missionId: string;
  mode?: string;
  missionFingerprint: string | null;
  knowledgeRevisionId: string | null;
  researchQuestionSemanticKey: string | null;
  lifecycleStatus: "CURRENT" | "HISTORICAL";
  status: string;
  question: string;
  coverageStatus: string;
  sourceGaps: readonly string[];
  results: readonly StructuredReportResearchResultInput[];
}

export interface StructuredReportAuthority {
  resultId: string;
  title: string;
  sourceUrl: string | null;
  provider: string | null;
  assessmentId: string;
  sourceChainFingerprint: string;
  citationAnchors: readonly JsonRecord[];
  classificationReviewAuditId?: string;
  rationale: string | null;
}

export interface StructuredReportQuestion {
  knowledgeItemId: string;
  semanticKey: string;
  text: string;
  reviewStatus: "AI_PROPOSED" | "HUMAN_CONFIRMED";
  missionId: string | null;
  missionStatus: string;
  coverageStatus: string;
  favorableAuthorities: readonly StructuredReportAuthority[];
  contraryAuthorities: readonly StructuredReportAuthority[];
  nonUsableResults: readonly {
    resultId: string;
    missionId?: string;
    title: string;
    sourceUrl?: string | null;
    direction: Direction;
    rationale?: string | null;
    reasons: readonly string[];
  }[];
  gaps: readonly string[];
  limitations: readonly string[];
}

export interface StructuredReportOperationalStep {
  /** Stable semantic identity; archived reports without it retain their legacy title identity. */
  activityCode?: string;
  documentCode?: string;
  necessity?: "REQUIRED" | "CONDITIONAL" | "NOT_JUSTIFIED";
  title: string;
  action: string;
  office: string;
  requiredDocuments: readonly string[];
  completionGate: string;
  draftTitle?: string;
  draftTemplate?: string;
  additionalDrafts?: readonly { documentCode: string; title: string; template: string }[];
}

export interface StructuredReportOperationalAlternative {
  title: string;
  whenApplicable: string;
  practicalRoute: string;
  riskOrLimit: string;
}

export interface StructuredReportOperationalPlan {
  issueSemanticKey: string;
  issueText: string;
  sourceDocumentRefs: readonly string[];
  outstandingEvidence: readonly string[];
  legalSourceStatus: "VERIFIED_SOURCES_ATTACHED" | "LEGAL_RESEARCH_REQUIRED";
  professionalStatus: "PRELIMINARY_NOT_APPROVED";
  recommendedNextStep: string;
  steps: readonly StructuredReportOperationalStep[];
  alternatives: readonly StructuredReportOperationalAlternative[];
  deadlineReview: string;
}

export interface StructuredReportProceduralContext {
  stato: string;
  tipologia: string;
  origineProcedimento: string;
  dataAvvio: string | null;
  dataProvvedimentoFinale: string | null;
  comunicazioneAvvioInviata: boolean;
  contestazioneFormaleInviata: boolean;
  memorieRicevute: boolean;
  audizioneSvolta: boolean;
  controdeduzioniValutate: boolean;
  checklistContraddittorioCompleta: boolean;
  finalAct: {
    numeroAtto: string;
    dataAtto: string;
    motivazioneSintetica: string;
  } | null;
  concessione: {
    numeroAtto: string;
    stato: string;
    dataRilascio: string;
  } | null;
  documentTitles: readonly string[];
}

export interface StructuredReportRegulatoryApplicability {
  measure: string;
  effectiveFrom: string;
  trigger: string;
  applicability: string;
  authorityAction: string;
  deadline: string;
  officialSourceUrl: string;
}

export interface StructuredFascicoloReportPayload {
  contractVersion: typeof STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION;
  /** Absent in older snapshots whose source classifications cannot be assumed confirmed. */
  sourceReviewPolicy?: typeof SOURCE_REVIEW_POLICY;
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId: string;
  knowledgeContractVersion: string;
  corpusFingerprint: string;
  knowledgeStateFingerprint: string;
  researchStateFingerprint: string;
  sourceStateFingerprint: string;
  /** Authoritative metadata used when the immutable report version was generated. */
  proceduralContext?: StructuredReportProceduralContext;
  documentedFramework: {
    partyRoles: readonly StructuredKnowledgeReadItem[];
    facts: readonly StructuredKnowledgeReadItem[];
    timeline: readonly StructuredKnowledgeReadItem[];
    legalActs: readonly StructuredKnowledgeReadItem[];
    measures: readonly StructuredKnowledgeReadItem[];
    contradictions: StructuredKnowledgeReadModel["contradictions"];
  };
  legalIssues: readonly {
    knowledgeItemId: string;
    semanticKey: string;
    text: string;
    reviewStatus: "AI_PROPOSED" | "HUMAN_CONFIRMED";
    originatingItemIds: readonly string[];
    questions: readonly StructuredReportQuestion[];
  }[];
  unassignedQuestions: readonly StructuredReportQuestion[];
  gaps: readonly StructuredKnowledgeReadItem[];
  deadlineCandidates: readonly StructuredKnowledgeReadItem[];
  /** Additive, read-only guidance. Older archived V1 reports may omit this field. */
  operationalPlans?: readonly StructuredReportOperationalPlan[];
  /** Additive applicability matrix. Older archived V1 reports may omit this field. */
  regulatoryApplicability?: readonly StructuredReportRegulatoryApplicability[];
  /** Additive fact-to-law application with temporal reasoning. Older archived V1 reports may omit this field. */
  legalApplication?: readonly StructuredReportLegalApplication[];
  /** Additive date-driven coordination of the port-concession regime. Older reports may omit it. */
  portRegime?: PortRegimeCoordination | null;
  limitations: readonly string[];
}

export interface BuiltStructuredFascicoloReport {
  reportFingerprint: string;
  payload: StructuredFascicoloReportPayload;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function byId<T extends { id?: string; resultId?: string; missionId?: string; semanticKey?: string }>(left: T, right: T): number {
  return String(left.id ?? left.resultId ?? left.missionId ?? left.semanticKey)
    .localeCompare(String(right.id ?? right.resultId ?? right.missionId ?? right.semanticKey));
}

function normalizedItem(item: StructuredKnowledgeReadItem): StructuredKnowledgeReadItem {
  return { ...item, evidence: [...item.evidence].sort((left, right) => (
    `${left.documentoId}:${left.pageNumber}:${left.textSha256}`.localeCompare(`${right.documentoId}:${right.pageNumber}:${right.textSha256}`)
  )) };
}

function visibleItems(items: readonly StructuredKnowledgeReadItem[]): readonly StructuredKnowledgeReadItem[] {
  return items.filter((item) => item.status !== "REJECTED").map(normalizedItem).sort(byId);
}

function authority(result: StructuredReportResearchResultInput): StructuredReportAuthority {
  if (!isProfessionallyUsableSource(result)) throw new Error("SOURCE_CLASSIFICATION_NOT_READY");
  const assessment = result.sourceAssessment!;
  return {
    resultId: result.resultId,
    title: result.title,
    sourceUrl: result.sourceUrl,
    provider: result.provider,
    assessmentId: assessment.assessmentId,
    sourceChainFingerprint: assessment.chainFingerprint,
    citationAnchors: [...assessment.citationAnchors],
    classificationReviewAuditId: result.classificationReviewAuditId!,
    rationale: result.classificationRationale,
  };
}

function nonUsableReasons(result: StructuredReportResearchResultInput): readonly string[] {
  const assessment = result.sourceAssessment;
  const reasons = assessment?.blockingReasons ?? [];
  return [...new Set([
    ...reasons,
    ...(!assessment?.isCurrent ? ["MISSING_CURRENT_SOURCE_ASSESSMENT"] : []),
    ...(assessment && !assessment.usable && !assessment.blockingReasons.length ? ["SOURCE_NOT_USABLE"] : []),
    ...(assessment?.manualReviewRequired ? ["MANUAL_REVIEW_REQUIRED"] : []),
    ...(result.classificationReviewStatus === "REJECTED" ? ["CLASSIFICATION_REJECTED"] : []),
    ...(result.classificationReviewStatus === "AI_PROPOSED" ? ["CLASSIFICATION_NOT_HUMAN_CONFIRMED"] : []),
    ...(result.classificationReviewStatus === "HUMAN_CONFIRMED" && !hasProfessionalSourceClassification(result)
      ? ["CLASSIFICATION_ATTESTATION_REQUIRED"] : []),
    ...(!["SUPPORTS", "OPPOSES"].includes(result.supportDirection) ? ["DIRECTION_NOT_DECISIVE"] : []),
    ...(assessment?.citationAnchors.length ? [] : ["CITATION_ANCHOR_REQUIRED"]),
  ])].sort();
}

function projectQuestion(
  item: StructuredKnowledgeReadItem,
  missionsByQuestion: ReadonlyMap<string, StructuredReportMissionInput>,
): StructuredReportQuestion {
  const mission = missionsByQuestion.get(item.semanticKey) ?? null;
  const results = [...(mission?.results ?? [])].sort(byId);
  const favorableAuthorities = results.filter((result) => isProfessionallyUsableSource(result) && result.supportDirection === "SUPPORTS").map(authority);
  const contraryAuthorities = results.filter((result) => isProfessionallyUsableSource(result) && result.supportDirection === "OPPOSES").map(authority);
  const nonUsableResults = results.filter((result) => !isProfessionallyUsableSource(result))
    .map((result) => ({
      resultId: result.resultId, missionId: result.missionId, title: result.title, sourceUrl: result.sourceUrl,
      direction: result.supportDirection,
      rationale: result.relevantPassage ?? result.classificationRationale,
      reasons: nonUsableReasons(result),
    }));
  const gaps = [...new Set([
    ...(mission?.sourceGaps ?? []),
    ...(mission ? [] : ["CURRENT_RESEARCH_MISSION_MISSING"]),
    ...(favorableAuthorities.length + contraryAuthorities.length ? [] : ["NO_USABLE_SOURCE"]),
  ])].sort();
  const limitations = [...new Set([
    ...(item.status === "AI_PROPOSED" ? ["QUESTION_NOT_HUMAN_CONFIRMED"] : []),
    ...(mission?.status === "COMPLETED" ? [] : ["RESEARCH_NOT_COMPLETED"]),
    ...(favorableAuthorities.length > 0 && contraryAuthorities.length === 0 ? ["NO_USABLE_CONTRARY_AUTHORITY"] : []),
    ...(results.some((result) => result.classificationReviewStatus !== "REJECTED"
      && !hasProfessionalSourceClassification(result)) ? [UNREVIEWED_SOURCE_NOTICE] : []),
  ])].sort();
  return {
    knowledgeItemId: item.id,
    semanticKey: item.semanticKey,
    text: item.normalizedText,
    reviewStatus: item.status as "AI_PROPOSED" | "HUMAN_CONFIRMED",
    missionId: mission?.missionId ?? null,
    missionStatus: mission?.status ?? "NOT_STARTED",
    coverageStatus: mission?.coverageStatus ?? "NO_RESULTS",
    favorableAuthorities,
    contraryAuthorities,
    nonUsableResults,
    gaps,
    limitations,
  };
}

const DEFAULT_DECISION_OPTIONS = "Scegliere fra archiviazione, regolarizzazione con prescrizioni, penali se predeterminate nel titolo, ripristino o decadenza.";

const PROFILE_DECISION_OPTIONS: Record<string, string> = {
  THIRD_PARTY_USE: "Valutare archiviazione, eventuale autorizzazione preventiva per l'affidamento futuro se consentita dalla disciplina applicabile, oppure cessazione dell'uso non autorizzato ove ne ricorrano i presupposti. Non presumere che l'autorizzazione sani automaticamente la condotta pregressa. Valutare la decadenza solo dopo avere individuato e verificato la specifica fattispecie: l'art. 47, lett. e), cod. nav. richiede sostituzione abusiva nel godimento, distinta dal solo affidamento di attività; verificare anche l'art. 18, comma 11, L. 84/1994.",
  INVESTMENT_DEFAULT: "Valutare archiviazione per giustificato motivo, eventuale diffida, revisione del programma o del PEF, penali e decadenza. Prima di attribuire obblighi di notifica ad ART o applicare penali, verificare ambito e presupposti delle misure pertinenti, il bando e il titolo.",
  UNAUTHORIZED_OCCUPATION: "Scegliere fra archiviazione, variazione assentita del titolo se compatibile (art. 24 reg. nav. mar.), ingiunzione di sgombero e rimessa in pristino (art. 54 cod. nav., potere autonomo dalla decadenza), decadenza solo per inosservanza grave degli obblighi del titolo, e segnalazione all'autorità giudiziaria se ne ricorrono i presupposti.",
  FEE_PAYMENT: "Scegliere fra messa in mora e recupero del credito con interessi, imputazione dei versamenti, rateizzazione se ammessa dall'ente, escussione della garanzia se prevista dal titolo, e decadenza (art. 47, lett. d, cod. nav.) solo se è raggiunto il numero di rate omesse fissato dall'atto di concessione.",
};

function decisionDraft(issueText: string): string {
  return [
    `Oggetto: schema di decisione sulla seguente questione — ${issueText}.`,
    "Autorità e competenza da verificare: [ORGANO COMPETENTE E FONDAMENTO]. Responsabile: [RESPONSABILE].",
    "Fatti e documenti: [FATTI ACCERTATI, ALLEGAZIONI, ELEMENTI CONTRARI E RIFERIMENTI DOCUMENTALI].",
    "Disciplina applicabile: [FONTI UFFICIALI, VERSIONI E DATE RILEVANTI, PRESUPPOSTI VERIFICATI].",
    "Istruttoria e partecipazione: [GARANZIE APPLICABILI, EVENTUALI OSSERVAZIONI E LORO VALUTAZIONE].",
    "Motivazione: [VALUTAZIONE DELLE ALTERNATIVE E DELLE RAGIONI FAVOREVOLI E CONTRARIE].",
    "Esito proposto: [DECISIONE MOTIVATA E CONSEGUENZE EFFETTIVAMENTE DOVUTE]. Data e sottoscrizione: [DA INSERIRE DOPO VERIFICA].",
    "Bozza soggetta ad approvazione umana; nessuna firma, protocollazione o comunicazione automatica.",
  ].join("\n\n");
}

function profileOperationalSteps(
  issueText: string,
  profile: LegalIssueProfileAssessment,
): StructuredReportOperationalStep[] {
  const subject = issueText.length > 90 ? `${issueText.slice(0, 87).trimEnd()}…` : issueText;
  const substantive = profile.elements.filter((element) => element.elementId !== "contraddittorio");
  const contraddittorio = profile.elements.find((element) => element.elementId === "contraddittorio");
  const open = substantive.filter((element) => element.status !== "PROVEN");
  const coreMet = substantive.filter((element) => element.core)
    .every((element) => element.status === "PROVEN" || element.status === "INDICATED");
  const contrary = substantive.filter((element) => element.status === "CONTRARY_EVIDENCE");
  const bases = [...new Set(substantive.flatMap((element) => element.legalBasis.split(/;\s*/)).map((basis) => basis.trim()).filter(Boolean))];
  const contested = contraddittorio?.status === "PROVEN";
  const decisionOptions = PROFILE_DECISION_OPTIONS[profile.profileId] ?? DEFAULT_DECISION_OPTIONS;
  return [
    {
      activityCode: `PROFILE:${profile.profileId}:EVIDENCE`,
      necessity: "REQUIRED",
      title: `1. ${subject}: completare la prova dei requisiti`,
      action: open.length
        ? `Requisiti ancora da provare o confermare: ${open.map((element) =>
          `${element.requirement} (${element.legalBasis}) — ${LEGAL_ELEMENT_STATUS_LABELS[element.status].toLowerCase()}: ${element.reasoning}`).join(" ")}`
        : "Tutti i requisiti della fattispecie risultano provati e confermati dal professionista: verificare soltanto che le prove siano aggiornate alla data della decisione.",
      office: "Responsabile del procedimento e ufficio demanio dell'ente concedente, con ufficio tecnico per sopralluoghi e verifiche",
      requiredDocuments: open.length
        ? open.map((element) => `${element.requirement}: ${element.status === "NOT_PROVEN" ? element.reasoning.replace(/^Nessun riscontro documentale\.\s*/, "") : "conferma professionale delle evidenze indicate"}`)
        : ["Evidenze già confermate, aggiornate alla data della decisione"],
      completionGate: `Ogni requisito essenziale (${substantive.filter((element) => element.core).map((element) => element.requirement.toLowerCase()).join("; ")}) è provato oppure motivatamente escluso`,
    },
    {
      activityCode: `PROFILE:${profile.profileId}:QUALIFICATION`,
      necessity: "REQUIRED",
      title: `2. ${subject}: qualificazione giuridica`,
      action: profile.qualification,
      office: "Ufficio legale o concessioni dell'ente concedente; il professionista valida la qualificazione",
      requiredDocuments: [...bases.map((basis) => `Testo vigente alla data dei fatti: ${basis}`), "Titolo concessorio e programma di attività con prescrizioni pertinenti"],
      completionGate: contrary.length
        ? `Gli elementi contrari o giustificativi (${contrary.map((element) => element.requirement.toLowerCase()).join("; ")}) sono stati valutati espressamente`
        : "Qualificazione motivata e validata dal professionista",
    },
    {
      activityCode: `PROFILE:${profile.profileId}:${contested ? "ASSESS_DEFENSE" : "CONTESTATION"}`,
      necessity: contested ? "REQUIRED" : coreMet ? "CONDITIONAL" : "NOT_JUSTIFIED",
      title: `3. ${subject}: ${contested ? "valutare le deduzioni del concessionario" : "contestazione degli addebiti"}`,
      action: contested
        ? `Contestazione già registrata. ${contraddittorio?.reasoning ?? ""} Valutare ogni deduzione rispetto ai singoli requisiti prima di qualsiasi misura.`
        : coreMet
          ? `Predisporre la contestazione degli addebiti indicando per ciascuno fatti e pagine di riscontro, norme violate (${bases.join("; ")}) e termine per le deduzioni ai sensi dell'art. 47, ultimo comma, cod. nav. e degli artt. 7 e 10 L. 241/1990.`
          : "Non avviare la contestazione finché i requisiti essenziali indicati al punto 1 non sono documentati: una contestazione priva di prova espone l'atto ad annullamento per difetto di istruttoria.",
      office: "Responsabile del procedimento dell'autorità concedente competente",
      requiredDocuments: ["Relazione istruttoria con le prove del punto 1", "Bozza di contestazione dalla sezione Atti", "Prova della notificazione e del termine assegnato"],
      completionGate: contested
        ? "Ogni deduzione ha ricevuto una valutazione espressa"
        : "Contestazione notificata con termine per le deduzioni, oppure motivata decisione di non procedere",
      ...(contested || !coreMet ? {} : {
        documentCode: "CONTESTAZIONE_ADDEBITI",
        draftTitle: "Contestazione degli addebiti",
        draftTemplate: [
          `Oggetto: contestazione degli addebiti — ${subject}.`,
          `Elementi risultanti dal fascicolo (da confermare prima della notifica):\n${substantive
            .filter((element) => element.status === "PROVEN" || element.status === "INDICATED")
            .map((element) => `- ${element.requirement} (${element.legalBasis}): ${element.reasoning}`)
            .join("\n")}`,
          `Qualificazione proposta: ${profile.qualification}`,
          `Norme: ${bases.join("; ")}, nel testo vigente alla data delle condotte.`,
          "Termine per le deduzioni e per chiedere l'audizione: [TERMINE DA VERIFICARE] giorni (art. 47, ultimo comma, cod. nav.; artt. 7 e 10 L. 241/1990).",
          "Organo competente: [ORGANO DA VERIFICARE]. Responsabile del procedimento: [RESPONSABILE].",
          "Bozza soggetta ad approvazione umana; nessuna notifica automatica.",
        ].join("\n\n"),
      }),
    },
    {
      activityCode: `PROFILE:${profile.profileId}:DECISION`,
      necessity: "REQUIRED",
      title: `4. ${subject}: decisione motivata e proporzionata`,
      action: `${decisionOptions} Motivare su ciascun requisito, sulle deduzioni e sulla proporzionalità rispetto a gravità e durata della condotta.`,
      office: "Organo dell'ente concedente competente per il provvedimento",
      requiredDocuments: ["Esito motivato per ciascun requisito", "Valutazione delle deduzioni", "Schema di provvedimento e piano di verifica degli adempimenti"],
      completionGate: "Autorizzazione umana all'adozione dopo verifica di competenza, motivazione e garanzie",
      documentCode: "SCHEMA_DECISIONE",
      draftTitle: "Schema di decisione motivata",
      draftTemplate: decisionDraft(issueText),
    },
  ];
}

function buildOperationalPlans(
  issues: StructuredFascicoloReportPayload["legalIssues"],
  knowledge: StructuredKnowledgeReadModel,
  proceduralContext?: StructuredReportProceduralContext,
  portMatter = false,
  detectedPhase?: ActPhaseDetection,
): readonly StructuredReportOperationalPlan[] {
  const phase = detectedPhase ?? detectActPhase({
    proceduralContext,
    documentedFramework: {
      partyRoles: knowledge.partyRoles,
      facts: knowledge.facts,
      timeline: knowledge.events,
      legalActs: knowledge.legalActs,
      measures: knowledge.measures,
      contradictions: knowledge.contradictions,
    },
  });
  const evidenceItems = [
    ...knowledge.facts, ...knowledge.legalActs, ...knowledge.measures,
    ...knowledge.events, ...knowledge.gaps, ...knowledge.deadlineCandidates,
  ].filter((item) => item.status !== "REJECTED");
  return issues.map((issue) => {
    const originIds = new Set(issue.originatingItemIds);
    const related = evidenceItems.filter((item) => originIds.has(item.id));
    const sourceDocumentRefs = [...new Set(related.flatMap((item) =>
      item.evidence
        .map((evidence) => evidence.basisRef)
        .filter((basisRef): basisRef is string => basisRef !== null)))].sort();
    const outstandingEvidence = knowledge.gaps.filter((item) =>
      item.status !== "REJECTED" && originIds.has(item.id))
      .map((item) => item.normalizedText).sort();
    const sourceReady = issue.questions.length > 0 && issue.questions.every((question) =>
      question.missionStatus === "COMPLETED"
      && question.favorableAuthorities.length + question.contraryAuthorities.length > 0);
    const caseText = [issue.text, ...related.map((item) => item.normalizedText)].join(" ");
    const concernsInstallation = /container|manufatt|prefabbricat|installazion/i.test(caseText)
      && /concession|demanial|portual/i.test(caseText);
    const proceedingConcluded = phase.phase === "POST_DECISION";
    const reviewPending = phase.reviewPending;
    const finalActLabel = proceduralContext?.finalAct
      ? `${proceduralContext.finalAct.numeroAtto} del ${proceduralContext.finalAct.dataAtto}`
      : "provvedimento finale";
    const postDecisionSteps: StructuredReportOperationalStep[] = [
      ...(reviewPending ? [{
        activityCode: "PORT:POST:REVIEW",
        documentCode: "RISCONTRO_RIESAME",
        necessity: "REQUIRED" as const,
        title: "1. Istruire l'istanza di riesame come procedimento distinto",
        action: `Confrontare i motivi dell'istanza con ${finalActLabel}, distinguendo fatti nuovi, errori prospettati, documenti già valutati e interesse pubblico attuale. Non riavviare né duplicare il procedimento concluso.`,
        office: "Responsabile del riesame o dell'autotutela, con supporto dell'ufficio legale e dell'ufficio concessioni",
        requiredDocuments: ["Istanza di riesame con allegati e protocollo", "Provvedimento finale e prova della comunicazione", "Indice degli atti istruttori, memorie e audizioni", "Matrice motivi del riesame - motivazione dell'atto - prova disponibile"],
        completionGate: "Ogni motivo ha ricevuto una valutazione espressa; competenza, termine, interesse pubblico e affidamento sono stati verificati",
        draftTitle: "Riscontro motivato all'istanza di riesame",
        draftTemplate: "Oggetto: istanza di riesame relativa a [TITOLO/ATTO]. Esaminata l'istanza prot. [PROTOCOLLO], l'Autorità ricostruisce separatamente ciascun motivo, i fatti nuovi e gli atti già valutati; verifica competenza, disciplina applicabile nel tempo, interesse pubblico attuale e affidamento; determina [ESITO MOTIVATO]. Campi da completare: [ORGANO COMPETENTE], [TERMINE], [MOTIVI], [DOCUMENTI], [ESITO]. Bozza soggetta ad approvazione umana; nessun invio automatico.",
      }] : []),
      {
        activityCode: "PORT:POST:FINAL_ACT_REVIEW",
        documentCode: "NOTA_TENUTA_PROVVEDIMENTO",
        necessity: "REQUIRED",
        title: reviewPending ? "2. Verificare la tenuta del provvedimento finale" : "1. Verificare la tenuta del provvedimento finale",
        action: `Riesaminare ${finalActLabel} rispetto a competenza, successione temporale delle fonti, prova dei singoli addebiti, trattamento delle regolarizzazioni, contraddittorio, proporzionalità e motivazione. Separare penali, decadenza e obblighi regolatori.`,
        office: "Ufficio concessioni con supporto legale e tecnico-contabile",
        requiredDocuments: ["Provvedimento finale e fascicolo istruttorio completo", "Titolo concessorio con PI, PEF e allegati", "Memorie, verbali di audizione e valutazione delle controdeduzioni", "Riconciliazione canoni e rettifiche contabili", "Fonti vigenti alle date dei fatti e del provvedimento"],
        completionGate: "Nota di tenuta con esito separato per ciascun addebito e valutazione delle ragioni favorevoli e contrarie all'Autorità",
        draftTitle: "Nota interna sulla tenuta del provvedimento",
        draftTemplate: "La nota verifica: (1) competenza; (2) disciplina ratione temporis; (3) fatti provati, allegazioni e lacune; (4) difese e controdeduzioni; (5) regolarizzazioni; (6) proporzionalità; (7) distinzione tra penali e decadenza; (8) motivazione. Per ogni punto indicare [ELEMENTI FAVOREVOLI], [ELEMENTI CONTRARI], [RISCHIO], [CONCLUSIONE]. Bozza soggetta ad approvazione umana.",
      },
      {
        activityCode: "PORT:POST:FOLLOW_UP",
        documentCode: "VERBALE_RICONSEGNA",
        necessity: "CONDITIONAL",
        title: reviewPending ? "3. Governare esecuzione, contenzioso e obblighi residui" : "2. Governare esecuzione, contenzioso e obblighi residui",
        action: "Programmare soltanto gli adempimenti conseguenti all'atto efficace: riconsegna e inventario, controlli tecnici, tutela patrimoniale, riconciliazione canoni, conservazione della prova e comunicazioni regolatorie effettivamente dovute.",
        office: "Ufficio demanio, area tecnica, ragioneria e ufficio legale secondo competenza",
        requiredDocuments: ["Planimetria e inventario aggiornati", "Verbali e documentazione fotografica", "Situazione contabile riconciliata", "Calendario di riconsegna e adempimenti", "Eventuali atti giudiziari o precontenziosi"],
        completionGate: "Ogni adempimento ha responsabile, data, dipendenze, documento di esito e verifica di chiusura",
        draftTitle: "Convocazione e verbale di riconsegna",
        draftTemplate: "Oggetto: riconsegna del compendio [IDENTIFICAZIONE]. Convocazione per il [DATA] alle [ORA] presso [LUOGO]. Il verbale rileva perimetro, opere, beni, stato manutentivo, utenze, chiavi, obblighi patrimoniali e riserve. Allegati: [PLANIMETRIA], [INVENTARIO], [FOTOGRAFIE], [LETTURE]. Bozza soggetta ad approvazione umana; nessuna firma, protocollazione o notifica automatica.",
      },
    ];
    const preDecisionSteps: StructuredReportOperationalStep[] = [
      {
        activityCode: "PORT:FACTS",
        necessity: "REQUIRED",
        title: "1. Accertare i fatti e gli obblighi concessori",
        action: "L'ente concedente deve confrontare titolo e prescrizioni con lo stato dei luoghi e l'uso effettivo, distinguendo elementi provati, indizi, atti mancanti ed eventuali autorizzazioni successive. Verificare chi sia l'autorità competente per ciascun potere.",
        office: "Responsabile del procedimento e ufficio demanio dell'ente concedente; ufficio tecnico e autorità marittima secondo le competenze accertate",
        requiredDocuments: concernsInstallation
          ? ["Titolo concessorio integrale con allegati, planimetrie e modifiche", "Verbale di sopralluogo, rilievi, fotografie, dimensioni e destinazione effettiva del manufatto", "Autorizzazioni e assensi eventualmente rilasciati, anche tecnico-edilizi", "Comunicazioni e precedenti controlli dell'amministrazione"]
          : ["Titolo e prescrizioni vigenti con eventuali modifiche", "Verbali, comunicazioni e riscontri documentali", "Autorizzazioni, pagamenti e atti di controllo pertinenti alla specifica criticità"],
        completionGate: "Fatti, titoli, soggetti, competenza e possibili violazioni verificati con istruttoria documentata",
      },
      {
        activityCode: "PORT:QUALIFICATION",
        necessity: "REQUIRED",
        title: "2. Qualificare le violazioni e valutare i procedimenti conseguenti",
        action: concernsInstallation
          ? "Verificare separatamente se ricorrono i presupposti di decadenza ex art. 47 cod. nav. (in particolare lett. f per inadempimento di obblighi, lett. c solo se vi e mutamento sostanziale non autorizzato dello scopo) e di intervento sulle innovazioni abusive ex art. 54 cod. nav. Accertare l'autorità competente, incluse le distinte competenze degli artt. 48 e 54, e la normativa applicabile nel tempo."
          : "Esaminare le ipotesi di decadenza ex art. 47 cod. nav. pertinenti alla violazione, eventuali obblighi di ripristino e altri poteri tipizzati. Separare presupposti, competenze e conseguenze di ogni procedimento; non presupporre che la decadenza sia automatica.",
        office: "Autorità concedente per l'eventuale decadenza (art. 48 cod. nav.); autorità marittima competente per gli eventuali poteri di cui all'art. 54",
        requiredDocuments: ["Prescrizioni e obblighi del titolo e loro contestazioni", "Testi normativi applicabili alla data dei fatti", "Precedenti amministrativi e fonti giurisprudenziali verificabili", "Documenti idonei a dimostrare gravità, durata e conseguenze della condotta"],
        completionGate: "Distinta qualificazione giuridica dei possibili procedimenti, verificata da un professionista",
      },
      {
        activityCode: "PORT:PARTICIPATION",
        necessity: "CONDITIONAL",
        title: proceduralContext?.contestazioneFormaleInviata
          ? "3. Valutare il contraddittorio già avviato"
          : "3. Garantire contestazione e contraddittorio",
        action: proceduralContext?.contestazioneFormaleInviata
          ? "La contestazione risulta già inviata: verificare ricezione, garanzie applicabili e valutazione delle eventuali deduzioni senza duplicarla."
          : "Se sussistono presupposti sufficienti, predisporre gli atti di avvio e di contestazione di competenza dell'ente; garantire accesso, partecipazione e valutazione delle deduzioni. Per la decadenza rispettare il termine assegnato alle deduzioni dall'art. 47 cod. nav. e verificare le altre garanzie applicabili.",
        office: "Responsabile del procedimento dell'autorità effettivamente competente",
        requiredDocuments: ["Relazione istruttoria e atti probatori", "Bozza di contestazione e comunicazioni procedimentali", "Deduzioni, osservazioni e documenti del concessionario", "Verifica delle notificazioni e dei termini concretamente applicabili"],
        completionGate: "Contraddittorio effettivo e documentato; nessun provvedimento anticipato prima dell'istruttoria dovuta",
        ...(proceduralContext?.contestazioneFormaleInviata ? {} : {
          documentCode: "COMUNICAZIONE_ISTRUTTORIA",
          draftTitle: "Schema di comunicazione istruttoria",
          draftTemplate: `Oggetto: comunicazione istruttoria relativa a ${issue.text}.\n\nPredisporre solo se l'iniziativa è giustificata e non già eseguita. Indicare [FATTI E DOCUMENTI], [FONDAMENTO NORMATIVO VIGENTE], [AUTORITÀ COMPETENTE], [DESTINATARI], [GARANZIE E TERMINI VERIFICATI].\n\nBozza soggetta ad approvazione umana; nessun invio automatico.`,
        }),
      },
      {
        activityCode: "PORT:DECISION",
        necessity: "REQUIRED",
        title: "4. Motivare la decisione e controllarne gli effetti",
        action: "Concludere con decisione motivata sui presupposti, sulle osservazioni e sulla proporzionalità: archiviazione, eventuale misura ripristinatoria, decadenza o altra misura consentita. Distinguere poteri e autorità, pianificare l'esecuzione e documentare i successivi controlli senza automatismi.",
        office: "Organo dell'ente concedente o diversa autorità individuata dalla legge per ciascun provvedimento",
        requiredDocuments: ["Esito dell'istruttoria con confronto fra alternative", "Valutazione delle deduzioni e della proporzionalità", "Schema di provvedimento e modalità di comunicazione", "Piano di verifica degli adempimenti e degli eventuali obblighi di ripristino"],
        completionGate: "Motivazione, competenza, garanzie e verifiche professionali completate; autorizzazione umana all'adozione",
        documentCode: "SCHEMA_DECISIONE",
        draftTitle: "Schema di decisione motivata",
        draftTemplate: decisionDraft(issue.text),
      },
    ];
    const genericPreDecisionSteps: StructuredReportOperationalStep[] = [
      {
        activityCode: "GENERAL:FACTS",
        necessity: "REQUIRED",
        title: "1. Accertare fatti e documenti",
        action: "Ricostruire i fatti rilevanti e distinguere documenti acquisiti, elementi da verificare e possibili circostanze contrarie.",
        office: "Responsabile del procedimento e uffici competenti da verificare",
        requiredDocuments: ["Istanza o atto di avvio", "Documenti e riscontri pertinenti alla questione"],
        completionGate: "Fatti, documenti e lacune sono identificati e valutati dal professionista",
      },
      {
        activityCode: "GENERAL:LEGAL",
        necessity: "REQUIRED",
        title: "2. Verificare disciplina e competenza",
        action: "Individuare le fonti e la loro applicabilità temporale, i presupposti e l'autorità competente; valutare anche gli argomenti contrari.",
        office: "Ufficio competente e supporto giuridico",
        requiredDocuments: ["Fonti ufficiali vigenti alle date rilevanti", "Atti e prescrizioni pertinenti"],
        completionGate: "Disciplina, competenza e presupposti sono verificati e motivati",
      },
      {
        activityCode: "GENERAL:PARTICIPATION",
        necessity: "CONDITIONAL",
        title: "3. Valutare partecipazione e contraddittorio",
        action: "Accertare se e quali garanzie partecipative siano applicabili, evitando comunicazioni o termini non verificati.",
        office: "Responsabile del procedimento",
        requiredDocuments: ["Comunicazioni, eventuali memorie e prove della loro ricezione"],
        completionGate: "Le garanzie applicabili e le eventuali osservazioni sono verificate e documentate",
        documentCode: "COMUNICAZIONE_ISTRUTTORIA",
        draftTitle: "Schema di comunicazione istruttoria",
        draftTemplate: `Oggetto: eventuale comunicazione istruttoria relativa a ${issue.text}.\n\nPrima dell'utilizzo verificare se la comunicazione sia dovuta e non sia già stata effettuata. Indicare [DESTINATARI], [FATTI E DOCUMENTI], [FONDAMENTO NORMATIVO], [AUTORITÀ COMPETENTE], [GARANZIE E TERMINI APPLICABILI].\n\nBozza soggetta ad approvazione umana; nessun invio automatico.`,
      },
      {
        activityCode: "GENERAL:DECISION",
        necessity: "REQUIRED",
        title: "4. Motivare la decisione e i controlli",
        action: "Valutare le alternative consentite, motivare la decisione e individuare soltanto gli adempimenti effettivamente dovuti.",
        office: "Organo competente da verificare",
        requiredDocuments: ["Istruttoria e valutazione delle osservazioni", "Schema di decisione e riscontri pertinenti"],
        completionGate: "Competenza, motivazione, garanzie e conseguenze sono verificate dal professionista",
        documentCode: "SCHEMA_DECISIONE",
        draftTitle: "Schema di decisione motivata",
        draftTemplate: decisionDraft(issue.text),
      },
    ];
    const genericPostDecisionSteps: StructuredReportOperationalStep[] = [
      ...(reviewPending ? [{
        activityCode: "GENERAL:POST:REVIEW",
        necessity: "REQUIRED" as const,
        title: "1. Istruire l'eventuale riesame",
        action: "Esaminare separatamente i motivi dell'istanza, l'atto finale, la competenza e la disciplina applicabile.",
        office: "Ufficio competente per il riesame da verificare",
        requiredDocuments: ["Istanza e allegati", "Provvedimento finale e atti istruttori"],
        completionGate: "Ogni motivo è valutato e l'esito è motivato",
        documentCode: "RISCONTRO_RIESAME",
        draftTitle: "Schema di riscontro all'istanza di riesame",
        draftTemplate: `Oggetto: istanza di riesame relativa a ${issue.text}.\n\nIndicare [ISTANZA E PROTOCOLLO], [ATTO OGGETTO DI RIESAME], [ORGANO COMPETENTE], [MOTIVI E DOCUMENTI], [DISCIPLINA E TERMINI VERIFICATI], [VALUTAZIONE DEI MOTIVI E DEGLI ELEMENTI CONTRARI], [ESITO MOTIVATO].\n\nBozza soggetta ad approvazione umana; nessun invio automatico.`,
      }] : []),
      {
        activityCode: "GENERAL:POST:FINAL_ACT_REVIEW",
        necessity: "REQUIRED",
        title: "Verificare il provvedimento finale",
        action: "Controllare competenza, motivazione, disciplina temporale, partecipazione ed eventuali elementi contrari.",
        office: "Ufficio competente e supporto giuridico",
        requiredDocuments: ["Provvedimento finale", "Fascicolo istruttorio e comunicazioni"],
        completionGate: "La verifica motivata del provvedimento è documentata",
        documentCode: "NOTA_VERIFICA_PROVVEDIMENTO",
        draftTitle: "Nota di verifica del provvedimento",
        draftTemplate: `Oggetto: verifica del provvedimento relativo a ${issue.text}.\n\nEsaminare [ATTO E DOCUMENTI], [COMPETENZA], [FONTI E DATE], [FATTI E PRESUPPOSTI], [PARTECIPAZIONE], [ELEMENTI FAVOREVOLI E CONTRARI], [RISCHI E CONCLUSIONI MOTIVATE].\n\nNota preliminare soggetta a verifica professionale.`,
      },
      {
        activityCode: "GENERAL:POST:FOLLOW_UP",
        necessity: "CONDITIONAL",
        title: "Verificare gli adempimenti successivi",
        action: "Individuare gli effetti e gli eventuali adempimenti effettivamente dovuti, senza presumere nuove iniziative.",
        office: "Uffici competenti da verificare",
        requiredDocuments: ["Provvedimento efficace e documenti sui suoi effetti"],
        completionGate: "Gli adempimenti dovuti e i relativi esiti sono verificati",
      },
    ];
    const profile = !portMatter || proceedingConcluded ? null : assessIssueProfile({
      issueText: issue.text,
      relatedItems: related,
      analysisDate: new Date(knowledge.revision.createdAt).toISOString().slice(0, 10),
      procedural: proceduralContext ? {
        contestazioneFormaleInviata: proceduralContext.contestazioneFormaleInviata ?? false,
        memorieRicevute: proceduralContext.memorieRicevute ?? false,
        controdeduzioniValutate: proceduralContext.controdeduzioniValutate ?? false,
      } : null,
    });
    const steps = proceedingConcluded
      ? portMatter ? postDecisionSteps : genericPostDecisionSteps
      : portMatter ? profile ? profileOperationalSteps(issue.text, profile) : preDecisionSteps : genericPreDecisionSteps;
    const alternatives: StructuredReportOperationalAlternative[] = !portMatter ? [
      {
        title: "Valutare le opzioni consentite dalla disciplina applicabile",
        whenApplicable: "Dopo verifica delle fonti, della competenza e dei fatti",
        practicalRoute: "Confrontare gli esiti consentiti e motivare la scelta senza attivarli automaticamente.",
        riskOrLimit: "Non presumere poteri, obblighi o termini non accertati.",
      },
      {
        title: "Escludere motivatamente iniziative non giustificate",
        whenApplicable: "Quando non risultano i presupposti della specifica iniziativa",
        practicalRoute: "Documentare gli elementi considerati e le ragioni dell'esclusione.",
        riskOrLimit: "Rivalutare la conclusione se emergono fatti o fonti nuovi.",
      },
    ] : concernsInstallation ? [
      {
        title: "Valutare il procedimento di decadenza (art. 47 cod. nav.)",
        whenApplicable: "Se la violazione degli obblighi concessori risulta comprovata (lett. f), oppure se e accertato un mutamento sostanziale non autorizzato dello scopo (lett. c), verificando ogni requisito della fattispecie",
        practicalRoute: "Istruire la contestazione, identificare l'autorità concedente competente ex art. 48, fissare il termine per le deduzioni, valutarle e motivare l'eventuale decadenza tenendo conto della proporzionalità.",
        riskOrLimit: "La presenza del container, da sola, non prova il mutamento sostanziale né rende automatica la decadenza. Considerare eventuali precedenti autorizzazioni o conoscenza dell'amministrazione.",
      },
      {
        title: "Valutare rimozione e ripristino per innovazione abusiva (art. 54 cod. nav.)",
        whenApplicable: "Solo quando risultano gli elementi di occupazione abusiva o di innovazione non autorizzata su demanio marittimo e il potere compete all'autorità individuata dalla legge",
        practicalRoute: "Verificare titoli e opere, trasmettere gli accertamenti all'autorità marittima competente se diversa dal concedente e valutare l'ingiunzione con termine e gli eventuali adempimenti esecutivi previsti.",
        riskOrLimit: "Il procedimento ripristinatorio e distinto dalla decadenza. Competenza, presupposti ed esecuzione non vanno presunti.",
      },
      {
        title: "Valutare prescrizioni, adeguamento o modifica autorizzabile",
        whenApplicable: "Se la disciplina e le circostanze accertate consentono legittimamente una soluzione meno incisiva, senza eludere obblighi o procedimenti dovuti",
        practicalRoute: "Definire gli adeguamenti necessari, verificare con gli uffici le autorizzazioni richieste e motivare le ragioni della scelta, indicando condizioni e controlli.",
        riskOrLimit: "Un'istanza del concessionario non sana automaticamente opere preesistenti, ne impedisce per se l'esercizio dei poteri dell'amministrazione.",
      },
      {
        title: "Archiviare la contestazione o escludere specifiche misure",
        whenApplicable: "Quando il titolo e gli atti dimostrano conformità oppure l'istruttoria non prova i presupposti della singola fattispecie",
        practicalRoute: "Dare conto dei documenti esaminati, delle deduzioni e delle ragioni per cui la decadenza, il ripristino o altri provvedimenti non risultano giuridicamente giustificati.",
        riskOrLimit: "L'archiviazione richiede istruttoria e motivazione; non equivale a convalidare opere non valutate.",
      },
      {
        title: "Verificare ulteriori illeciti e segnalazioni di competenza",
        whenApplicable: "Soltanto se emergono specifici fatti riconducibili ad ulteriori disposizioni sanzionatorie o penali",
        practicalRoute: "Qualificare gli elementi accertati, distinguere il procedimento concessorio da quelli di altre autorità e valutare i doveri di comunicazione previsti dalla legge.",
        riskOrLimit: "Non presumere responsabilità penali, sanzioni o obblighi di denuncia sulla base del solo rapporto preliminare.",
      },
    ] : [
      {
        title: "Valutare contestazione e decadenza della concessione",
        whenApplicable: "Se emergono elementi concreti di una fattispecie prevista dall'art. 47 cod. nav. e sono identificati titolo, obblighi e competenza",
        practicalRoute: "Completare gli accertamenti, individuare la specifica lettera dell'art. 47, contestare i fatti, acquisire le deduzioni e motivare l'eventuale decisione dell'ente concedente.",
        riskOrLimit: "La decadenza non è conseguenza automatica di qualsiasi irregolarità; distinguere tipicità, prova, partecipazione e proporzionalità.",
      },
      {
        title: "Valutare il ripristino o altri interventi",
        whenApplicable: "Se i fatti integrano presupposti di occupazione o innovazione abusiva o altra violazione con poteri amministrativi specifici",
        practicalRoute: "Verificare l'autorità competente e le norme applicabili, istruire separatamente il ripristino o le altre misure consentite.",
        riskOrLimit: "Non estendere i poteri dell'ente oltre le competenze stabilite dalla legge.",
      },
      {
        title: "Valutare adeguamento con prescrizioni e controllo",
        whenApplicable: "Quando i presupposti normativi consentono all'amministrazione una soluzione diversa da decadenza o ripristino",
        practicalRoute: "Motivare la misura, definire prescrizioni verificabili e controllare il loro adempimento senza presupporre una sanatoria.",
        riskOrLimit: "La misura alternativa non può sostituire illegittimamente provvedimenti dovuti.",
      },
      {
        title: "Archiviare motivatamente l'ipotesi di violazione",
        whenApplicable: "Se la violazione non risulta accertata o non ricorrono i presupposti del provvedimento prospettato",
        practicalRoute: "Registrare i controlli eseguiti, i riscontri e la motivazione dell'esclusione di ulteriori misure.",
        riskOrLimit: "L'archiviazione non deve precludere accertamenti futuri su fatti nuovi.",
      },
    ];
    return {
      issueSemanticKey: issue.semanticKey,
      issueText: issue.text,
      sourceDocumentRefs,
      outstandingEvidence,
      legalSourceStatus: sourceReady ? "VERIFIED_SOURCES_ATTACHED" : "LEGAL_RESEARCH_REQUIRED",
      professionalStatus: "PRELIMINARY_NOT_APPROVED",
      recommendedNextStep: !portMatter
        ? proceedingConcluded
          ? "Verificare l'atto finale e l'eventuale riesame senza riavviare automaticamente il procedimento."
          : "Accertare fatti, documenti, disciplina applicabile e competenza prima di scegliere iniziative."
        : proceedingConcluded
        ? `Il procedimento risulta concluso${proceduralContext?.finalAct ? ` con l'atto ${proceduralContext.finalAct.numeroAtto}` : ""}: priorità a tenuta dell'atto, riesame, contenzioso, esecuzione e obblighi residui. Non proporre un nuovo avvio per i medesimi fatti.`
        : "Priorita per l'ente concedente: accertare gli obblighi violati e valutare tutti i procedimenti conseguenti, inclusi decadenza e ripristino quando ne ricorrano i presupposti; nessuna misura e automatica.",
      steps,
      alternatives,
      deadlineReview: "Verificare espressamente scadenze, notifiche e termini applicabili: nessuna data processuale è determinata da questo piano.",
    };
  });
}

const ART_242_SOURCE_URL = "https://www.autorita-trasporti.it/wp-content/uploads/2025/12/All.-A-delibera-n.-242_2025_signed.pdf";

function buildRegulatoryApplicability(
  analysisDate: string,
  context?: StructuredReportProceduralContext,
  documentedGrantDate?: string | null,
): readonly StructuredReportRegulatoryApplicability[] {
  const grantDate = context?.concessione?.dataRilascio.slice(0, 10) ?? documentedGrantDate ?? null;
  if (!grantDate || grantDate > analysisDate || analysisDate < "2026-03-01") return [];
  const preExisting = grantDate < "2026-03-01";
  const basis = context?.concessione ? "" : " Data del titolo ricavata dai documenti: confermarla collegando la concessione nel registro.";
  const applicability = (preExisting
    ? "La data del titolo non prova che fosse in essere il 1 marzo 2026. Solo accertata tale condizione verificare le misure elencate al punto iii; per aggiornamenti o revisioni valutare i presupposti del punto ii, senza presumere il perfezionamento di un'istanza. Nessuna qualificazione retroattiva delle condotte anteriori."
    : "Titolo rilasciato non prima dell'entrata in vigore: verificare l'ambito della misura 1.2, punto i, e i presupposti di ciascun adempimento.") + basis;
  const row = (
    measure: string,
    trigger: string,
    authorityAction: string,
    deadline: string,
  ): StructuredReportRegulatoryApplicability => ({
    measure,
    effectiveFrom: "1 marzo 2026",
    trigger,
    applicability,
    authorityAction: `Se la misura e i suoi presupposti sono applicabili: ${authorityAction}`,
    deadline: `${deadline} Non è una scadenza verificata del fascicolo.`,
    officialSourceUrl: ART_242_SOURCE_URL,
  });
  return [
    row("3.7", "Istanza rilevante di revisione o aggiornamento di concessione, PI o PEF.", "Vigilare sul titolo e notificare l'istanza ad ART; distinguere revisione, differimento investimenti, modifica del titolo ed estensione della durata.", "Alla ricezione o emersione dell'istanza rilevante."),
    row("3.13", "Rilascio o cambio di controllo del concessionario e condizioni concorrenziali.", "Valutare capacità e relazioni societarie; informare annualmente ART sull'applicazione della misura.", "Cadenza annuale; verificare le istruzioni operative ART."),
    row("3.18", "Monitoraggio di investimenti, obiettivi di traffico e livelli occupazionali.", "Svolgere il monitoraggio annuale e comunicarne gli esiti ad ART; valutare le penali nella misura in cui sono definite in sede di bando.", "Cadenza annuale."),
    row("3.19", "Nuove infrastrutture pubbliche che incidono sull'equilibrio concorrenziale originario.", "Valutare revisione di concessione e PEF oppure, nei casi rilevanti, revoca e nuova gara con comunicazione ad ART.", "Prima della decisione sulla revisione o sulla diversa misura."),
    row("3.20", "Istanza di estensione della durata ai sensi del D.M. 202/2022 e del D.M. 110/2023.", "Notificare l'istanza documentata ad ART e acquisire il parere vincolante sulla coerenza con il PEF.", "Parere ART entro 30 giorni dalla ricezione di tutte le informazioni necessarie."),
    row("4", "Concessione vigente di area o banchina portuale.", "Acquisire e verificare la contabilità separata secondo gli schemi regolatori.", "Coordinare con la trasmissione annuale della misura 15."),
    row("5", "Analisi annuale della struttura dei mercati portuali.", "Predisporre l'ASM, distinguendo anche i terminal industriali, e trasmetterla ad ART.", "1 marzo dell'anno successivo a quello di riferimento."),
    row("15", "Concessione vigente e obblighi informativi ART.", "Trasmettere dati generali, determinazione canoni, PEF, contabilità regolatoria e dati di performance nei formati ART.", "Prima applicazione 15.2(a): 31 marzo 2026; dati annuali: 30 giugno."),
  ];
}

export function buildStructuredFascicoloReport(input: {
  tenantId: string;
  procedimentoId: string;
  knowledge: StructuredKnowledgeReadModel;
  missions: readonly StructuredReportMissionInput[];
  proceduralContext?: StructuredReportProceduralContext;
}): BuiltStructuredFascicoloReport {
  const currentMissions = input.missions.filter((mission) => mission.lifecycleStatus === "CURRENT"
    && mission.knowledgeRevisionId === input.knowledge.revision.id
    && mission.researchQuestionSemanticKey !== null).sort(byId);
  const groupedMissions = new Map<string, StructuredReportMissionInput[]>();
  for (const mission of currentMissions) {
    const current = groupedMissions.get(mission.researchQuestionSemanticKey!) ?? [];
    current.push(mission);
    groupedMissions.set(mission.researchQuestionSemanticKey!, current);
  }
  const missionsByQuestion = new Map([...groupedMissions].map(([semanticKey, questionMissions]) => {
    const primary = questionMissions.find((mission) => mission.mode !== "ADVERSE_SEARCH") ?? questionMissions[0];
    const results = [...new Map(questionMissions.flatMap((mission) => mission.results.map((result) => ({
      ...result, missionId: mission.missionId,
    })))
      .map((result) => [result.resultId, result])).values()].sort(byId);
    return [semanticKey, {
      ...primary,
      status: questionMissions.every((mission) => mission.status === "COMPLETED") ? "COMPLETED" : primary.status,
      sourceGaps: [...new Set(questionMissions.flatMap((mission) => mission.sourceGaps))].sort(),
      results,
    }];
  }));
  const questions = visibleItems(input.knowledge.researchQuestions).map((item) => projectQuestion(item, missionsByQuestion));
  const questionById = new Map(input.knowledge.researchQuestions.map((item) => [item.id, item]));
  const legalIssues = input.knowledge.legalIssues.filter((item) => item.status !== "REJECTED").sort(byId).map((issue) => ({
    knowledgeItemId: issue.id,
    semanticKey: issue.semanticKey,
    text: issue.normalizedText,
    reviewStatus: issue.status as "AI_PROPOSED" | "HUMAN_CONFIRMED",
    originatingItemIds: [...issue.originatingItemIds].sort(),
    questions: questions.filter((question) => questionById.get(question.knowledgeItemId)?.legalIssueId === issue.id),
  }));
  const assignedQuestionIds = new Set(legalIssues.flatMap((issue) => issue.questions.map((question) => question.knowledgeItemId)));
  const knowledgeState = [
    ...input.knowledge.partyRoles, ...input.knowledge.facts, ...input.knowledge.events,
    ...input.knowledge.legalActs, ...input.knowledge.measures, ...input.knowledge.contradictions,
    ...input.knowledge.gaps, ...input.knowledge.deadlineCandidates, ...input.knowledge.legalIssues,
    ...input.knowledge.researchQuestions,
  ].filter((item) => item.status !== "REJECTED").map(normalizedItem).sort(byId);
  const researchState = currentMissions.map((mission) => ({
    missionId: mission.missionId,
    missionFingerprint: mission.missionFingerprint,
    mode: mission.mode ?? "PRIMARY",
    questionSemanticKey: mission.researchQuestionSemanticKey,
    status: mission.status,
    coverageStatus: mission.coverageStatus,
    results: [...mission.results].sort(byId).map((result) => ({
      resultId: result.resultId,
      title: result.title,
      sourceUrl: result.sourceUrl,
      provider: result.provider,
      relevantPassage: result.relevantPassage ?? null,
      direction: result.supportDirection,
      classificationSource: result.classificationSource ?? null,
      classificationReviewAuditId: result.classificationReviewAuditId ?? null,
      reviewStatus: result.classificationReviewStatus,
      rationale: result.classificationRationale,
    })),
  }));
  const sourceState = currentMissions.flatMap((mission) => mission.results.map((result) => ({
    resultId: result.resultId,
    assessment: result.sourceAssessment,
  }))).sort(byId);
  const applicationItems = [...new Map([
    ...input.knowledge.facts, ...input.knowledge.events, ...input.knowledge.legalActs,
    ...input.knowledge.measures, ...input.knowledge.timeline,
  ].map((item) => [item.id, normalizedItem(item)])).values()].sort(byId);
  const analysisDate = new Date(input.knowledge.revision.createdAt).toISOString().slice(0, 10);
  const portRegime = isPortConcessionMatter({
    tipologia: input.proceduralContext?.tipologia,
    knowledgeItems: [...applicationItems, ...visibleItems(input.knowledge.gaps)],
    issueTexts: [...legalIssues.map((issue) => issue.text), ...questions.map((question) => question.text)],
  }) ? buildPortRegimeCoordination({
      knowledgeItems: applicationItems,
      analysisDate,
      registryGrant: input.proceduralContext?.concessione ?? null,
      extractIsoDates,
    }) : null;
  const phase = detectActPhase({
    proceduralContext: input.proceduralContext,
    documentedFramework: {
      partyRoles: input.knowledge.partyRoles,
      facts: input.knowledge.facts,
      timeline: input.knowledge.events,
      legalActs: input.knowledge.legalActs,
      measures: input.knowledge.measures,
      contradictions: input.knowledge.contradictions,
    },
  });
  const payload: StructuredFascicoloReportPayload = {
    contractVersion: STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION,
    ...(questions.some((question) => question.favorableAuthorities.length + question.contraryAuthorities.length > 0)
      ? { sourceReviewPolicy: SOURCE_REVIEW_POLICY } : {}),
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    knowledgeRevisionId: input.knowledge.revision.id,
    knowledgeContractVersion: input.knowledge.revision.contractVersion,
    corpusFingerprint: input.knowledge.revision.corpusFingerprint,
    knowledgeStateFingerprint: fingerprint(knowledgeState),
    researchStateFingerprint: fingerprint(researchState),
    sourceStateFingerprint: fingerprint(sourceState),
    proceduralContext: input.proceduralContext,
    documentedFramework: {
      partyRoles: visibleItems(input.knowledge.partyRoles),
      facts: visibleItems(input.knowledge.facts),
      timeline: visibleItems(input.knowledge.timeline),
      legalActs: visibleItems(input.knowledge.legalActs),
      measures: visibleItems(input.knowledge.measures),
      contradictions: input.knowledge.contradictions.filter((item) => item.status !== "REJECTED").sort(byId),
    },
    legalIssues,
    unassignedQuestions: questions.filter((question) => !assignedQuestionIds.has(question.knowledgeItemId)),
    gaps: visibleItems(input.knowledge.gaps),
    deadlineCandidates: visibleItems(input.knowledge.deadlineCandidates),
    operationalPlans: buildOperationalPlans(legalIssues, input.knowledge, input.proceduralContext, portRegime !== null, phase),
    regulatoryApplicability: portRegime ? buildRegulatoryApplicability(analysisDate, input.proceduralContext, portRegime.grantDate.date) : [],
    portRegime,
    legalApplication: buildLegalApplication({
      issues: legalIssues.map((issue) => {
        const toAuthority = (authority: StructuredReportAuthority) => ({
          title: authority.title, sourceUrl: authority.sourceUrl, rationale: authority.rationale,
        });
        const dedupe = (values: ReturnType<typeof toAuthority>[]) =>
          [...new Map(values.map((value) => [`${value.title}|${value.sourceUrl ?? ""}`, value])).values()];
        return {
          semanticKey: issue.semanticKey,
          text: issue.text,
          originatingItemIds: issue.originatingItemIds,
          favorableAuthorities: dedupe(issue.questions.flatMap((question) => question.favorableAuthorities.map(toAuthority))),
          contraryAuthorities: dedupe(issue.questions.flatMap((question) => question.contraryAuthorities.map(toAuthority))),
        };
      }),
      knowledgeItems: applicationItems,
      analysisDate,
      context: input.proceduralContext,
      documentedGrantDate: portRegime?.grantDate.date ?? null,
      portMatter: portRegime !== null,
      portRegime,
      documentaryPhase: { concluded: phase.phase === "POST_DECISION", reviewPending: phase.reviewPending },
    }),
    limitations: [...new Set([
      ...input.knowledge.revision.warnings,
      ...(input.knowledge.deadlineCandidates.length ? ["DEADLINE_CANDIDATES_ARE_NOT_OPERATIONAL_DEADLINES"] : []),
      ...(questions.length ? [] : ["NO_CURRENT_RESEARCH_QUESTIONS"]),
    ])].sort(),
  };
  return { reportFingerprint: fingerprint(payload), payload };
}
