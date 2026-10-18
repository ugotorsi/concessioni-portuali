import { createHash } from "node:crypto";

import { stableStringify } from "@/server/audit/hash";
import type { StructuredKnowledgeReadItem, StructuredKnowledgeReadModel } from "@/server/queries/fascicolo-knowledge";

export const STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION = "STRUCTURED_FASCICOLO_REPORT_V1" as const;

type JsonRecord = Readonly<Record<string, unknown>>;
type Direction = "SUPPORTS" | "OPPOSES" | "NEUTRAL" | "INCONCLUSIVE" | "UNASSESSED";

export interface StructuredReportResearchResultInput {
  resultId: string;
  title: string;
  sourceUrl: string | null;
  provider: string | null;
  supportDirection: Direction;
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
  title: string;
  action: string;
  office: string;
  requiredDocuments: readonly string[];
  completionGate: string;
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

export interface StructuredFascicoloReportPayload {
  contractVersion: typeof STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION;
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId: string;
  knowledgeContractVersion: string;
  corpusFingerprint: string;
  knowledgeStateFingerprint: string;
  researchStateFingerprint: string;
  sourceStateFingerprint: string;
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
  const assessment = result.sourceAssessment!;
  return {
    resultId: result.resultId,
    title: result.title,
    sourceUrl: result.sourceUrl,
    provider: result.provider,
    assessmentId: assessment.assessmentId,
    sourceChainFingerprint: assessment.chainFingerprint,
    citationAnchors: [...assessment.citationAnchors],
    rationale: result.classificationRationale,
  };
}

function nonUsableReasons(result: StructuredReportResearchResultInput): readonly string[] {
  const reasons = result.sourceAssessment?.blockingReasons ?? ["MISSING_CURRENT_SOURCE_ASSESSMENT"];
  return [...new Set([
    ...reasons,
    ...(result.classificationReviewStatus === "REJECTED" ? ["CLASSIFICATION_REJECTED"] : []),
    ...(result.sourceAssessment?.citationAnchors.length ? [] : ["CITATION_ANCHOR_REQUIRED"]),
  ])].sort();
}

function projectQuestion(
  item: StructuredKnowledgeReadItem,
  missionsByQuestion: ReadonlyMap<string, StructuredReportMissionInput>,
): StructuredReportQuestion {
  const mission = missionsByQuestion.get(item.semanticKey) ?? null;
  const results = [...(mission?.results ?? [])].sort(byId);
  const usable = (result: StructuredReportResearchResultInput) => result.classificationReviewStatus !== "REJECTED"
    && result.sourceAssessment?.isCurrent === true
    && result.sourceAssessment.usable
    && result.sourceAssessment.citationAnchors.length > 0;
  const favorableAuthorities = results.filter((result) => usable(result) && result.supportDirection === "SUPPORTS").map(authority);
  const contraryAuthorities = results.filter((result) => usable(result) && result.supportDirection === "OPPOSES").map(authority);
  const nonUsableResults = results.filter((result) => !usable(result) || !["SUPPORTS", "OPPOSES"].includes(result.supportDirection))
    .map((result) => ({
      resultId: result.resultId, title: result.title, sourceUrl: result.sourceUrl,
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

function buildOperationalPlans(
  issues: StructuredFascicoloReportPayload["legalIssues"],
  knowledge: StructuredKnowledgeReadModel,
): readonly StructuredReportOperationalPlan[] {
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
    const steps: StructuredReportOperationalStep[] = [
      {
        title: "1. Verificare titolo, fatti e provenienza",
        action: "Confrontare gli atti effettivamente rilasciati con stato dei luoghi, destinazione e cronologia, distinguendo dati documentati da affermazioni ancora da confermare.",
        office: "Concessionario e ente che ha rilasciato il titolo, da identificare e verificare",
        requiredDocuments: concernsInstallation
          ? ["Concessione integrale, allegati, planimetrie e successive modifiche", "Verbale di sopralluogo, fotografie, dati dimensionali e uso del manufatto", "Eventuali assensi demaniali e documentazione tecnico-edilizia"]
          : ["Titolo o atto rilevante integrale e relativi allegati", "Comunicazioni e provvedimenti successivi", "Documentazione probatoria e cronologia verificabile"],
        completionGate: "Origine, titolarità, contenuto e completezza degli atti verificati da un professionista",
      },
      {
        title: "2. Qualificare la questione e controllare le fonti",
        action: concernsInstallation
          ? "Verificare se l'installazione e l'uso siano già assentiti, se costituiscano modifica della concessione o richiedano altri titoli; controllare la disciplina vigente alla data dei fatti, le competenze e le eventuali prescrizioni."
          : "Identificare competenza, disciplina applicabile alla data dei fatti, eventuale procedimento già avviato e rimedi astrattamente disponibili, confrontando fonti favorevoli e contrarie.",
        office: "Ente competente risultante dagli atti; altri uffici solo dopo verifica del relativo potere",
        requiredDocuments: ["Testi normativi vigenti nel periodo rilevante", "Giurisprudenza pertinente con identificazione e testo verificati", "Eventuali avvisi, contestazioni e comunicazioni ricevute"],
        completionGate: "Fonti controllate, alternative giuridiche valutate e termini procedimentali verificati",
      },
      {
        title: "3. Scegliere l'alternativa e predisporre l'atto",
        action: "Redigere una proposta motivata con presupposti, richieste, allegati, rischi e destinatario; nessuna istanza, difesa o comunicazione viene inviata automaticamente.",
        office: "Ufficio individuato mediante la verifica di competenza nel fascicolo",
        requiredDocuments: ["Dossier degli atti verificati", "Relazione tecnica, quando necessaria", "Bozza di istanza, memoria o altra iniziativa selezionata"],
        completionGate: "Scelta e testo approvati dal professionista prima di qualsiasi invio",
      },
    ];
    const alternatives: StructuredReportOperationalAlternative[] = concernsInstallation ? [
      {
        title: "Confermare il mantenimento dell'installazione",
        whenApplicable: "Solo se titolo, allegati e assensi effettivamente verificati coprono manufatto e destinazione d'uso",
        practicalRoute: "Acquisire gli atti autorizzativi, documentare la corrispondenza allo stato dei luoghi e predisporre un riscontro motivato all'ente, se richiesto.",
        riskOrLimit: "La mera presenza nel fascicolo di una concessione non dimostra l'autorizzazione del manufatto.",
      },
      {
        title: "Valutare una richiesta di assenso o modifica",
        whenApplicable: "Solo se la disciplina e l'ente competente consentono il percorso rispetto all'opera e all'uso concreti",
        practicalRoute: "Predisporre istanza con descrizione, tavole, relazione tecnica e confronto con il titolo; verificare separatamente gli ulteriori atti eventualmente necessari.",
        riskOrLimit: "Non presumere una sanatoria retroattiva né che la presentazione dell'istanza legittimi l'occupazione preesistente.",
      },
      {
        title: "Valutare adeguamento o ripristino",
        whenApplicable: "Se l'installazione risulta incompatibile e non emerge un percorso consentito di mantenimento",
        practicalRoute: "Verificare obblighi e tempi con professionista e autorità, pianificare eventuale rimozione o adeguamento documentando le operazioni.",
        riskOrLimit: "Costi, conseguenze del titolo e obblighi ripristinatori devono essere accertati prima di decidere.",
      },
      {
        title: "Esercitare difese procedimentali o giurisdizionali",
        whenApplicable: "Soltanto se esistono contestazioni o provvedimenti e previa verifica del loro contenuto e dei termini",
        practicalRoute: "Acquisire notifiche e fascicolo amministrativo; valutare osservazioni, accesso agli atti e tutela competente sulla base delle fonti verificate.",
        riskOrLimit: "Nessun termine di impugnazione o rimedio è qui considerato già accertato.",
      },
    ] : [
      {
        title: "Confermare la posizione documentata",
        whenApplicable: "Se gli atti e la disciplina verificata sostengono la situazione rappresentata",
        practicalRoute: "Completare l'istruttoria e predisporre una valutazione motivata con riferimenti documentali e fonti controllate.",
        riskOrLimit: "Non è una conclusione sulla fondatezza della posizione finché le verifiche non siano concluse.",
      },
      {
        title: "Richiedere chiarimenti, assenso o adeguamento",
        whenApplicable: "Se l'istruttoria evidenzia carenze e l'ordinamento prevede un percorso amministrativo utilizzabile",
        practicalRoute: "Identificare ente competente, procedimento, documenti e condizioni; predisporre la richiesta subordinata a revisione professionale.",
        riskOrLimit: "Non presupporre che regolarizzazione o modifica siano sempre ammissibili.",
      },
      {
        title: "Valutare osservazioni o rimedi",
        whenApplicable: "Se una comunicazione o un provvedimento produce effetti sulla posizione del cliente",
        practicalRoute: "Verificare atto, data di conoscenza, termini, contraddittorio e sede competente prima di redigere osservazioni o tutela.",
        riskOrLimit: "Termini, rimedi ed effetti richiedono verifica specifica e non sono determinati automaticamente.",
      },
    ];
    return {
      issueSemanticKey: issue.semanticKey,
      issueText: issue.text,
      sourceDocumentRefs,
      outstandingEvidence,
      legalSourceStatus: sourceReady ? "VERIFIED_SOURCES_ATTACHED" : "LEGAL_RESEARCH_REQUIRED",
      professionalStatus: "PRELIMINARY_NOT_APPROVED",
      recommendedNextStep: "Completare prima l'accertamento documentale; la scelta dell'alternativa richiede verifica delle fonti e approvazione professionale.",
      steps,
      alternatives,
      deadlineReview: "Verificare espressamente scadenze, notifiche e termini applicabili: nessuna data processuale è determinata da questo piano.",
    };
  });
}

export function buildStructuredFascicoloReport(input: {
  tenantId: string;
  procedimentoId: string;
  knowledge: StructuredKnowledgeReadModel;
  missions: readonly StructuredReportMissionInput[];
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
    const results = [...new Map(questionMissions.flatMap((mission) => mission.results)
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
      reviewStatus: result.classificationReviewStatus,
      rationale: result.classificationRationale,
    })),
  }));
  const sourceState = currentMissions.flatMap((mission) => mission.results.map((result) => ({
    resultId: result.resultId,
    assessment: result.sourceAssessment,
  }))).sort(byId);
  const payload: StructuredFascicoloReportPayload = {
    contractVersion: STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION,
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    knowledgeRevisionId: input.knowledge.revision.id,
    knowledgeContractVersion: input.knowledge.revision.contractVersion,
    corpusFingerprint: input.knowledge.revision.corpusFingerprint,
    knowledgeStateFingerprint: fingerprint(knowledgeState),
    researchStateFingerprint: fingerprint(researchState),
    sourceStateFingerprint: fingerprint(sourceState),
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
    operationalPlans: buildOperationalPlans(legalIssues, input.knowledge),
    limitations: [...new Set([
      ...input.knowledge.revision.warnings,
      ...(input.knowledge.deadlineCandidates.length ? ["DEADLINE_CANDIDATES_ARE_NOT_OPERATIONAL_DEADLINES"] : []),
      ...(questions.length ? [] : ["NO_CURRENT_RESEARCH_QUESTIONS"]),
    ])].sort(),
  };
  return { reportFingerprint: fingerprint(payload), payload };
}
