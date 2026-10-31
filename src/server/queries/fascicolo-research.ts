import type {
  FascicoloResearchModel,
  FascicoloResearchSource,
  ResearchSourceUsability,
  ResearchSupportDirection,
} from "@/components/procedimenti/FascicoloResearch";
import type { FascicoloAutomaticWorkflowReadModel } from "@/server/queries/fascicolo-automatic-workflow";

type WorkflowMission = FascicoloAutomaticWorkflowReadModel["missions"][number];
type HistoricalWorkflowMission = FascicoloAutomaticWorkflowReadModel["historicalMissions"][number];
type AnyWorkflowMission = WorkflowMission | HistoricalWorkflowMission;
type WorkflowResult = WorkflowMission["results"][number];

export type FascicoloResearchWorkflowProjection = Readonly<{
  missions: readonly Pick<
    AnyWorkflowMission,
    | "missionId"
    | "question"
    | "referenceDate"
    | "updatedAt"
    | "researchQuestionSemanticKey"
    | "lifecycleStatus"
    | "status"
    | "coverageStatus"
    | "coveredElementKeys"
    | "coverageGaps"
    | "results"
  >[];
  historicalMissions?: readonly Pick<
    AnyWorkflowMission,
    | "missionId"
    | "question"
    | "referenceDate"
    | "updatedAt"
    | "researchQuestionSemanticKey"
    | "lifecycleStatus"
    | "status"
    | "coverageStatus"
    | "coveredElementKeys"
    | "coverageGaps"
    | "results"
  >[];
  missionReadTruncation?: FascicoloAutomaticWorkflowReadModel["missionReadTruncation"];
}>;

function missionStatus(status: AnyWorkflowMission["status"]): string {
  if (status === "COMPLETED") return "Completata";
  if (status === "DEFERRED") return "Differita";
  if (status === "REJECTED") return "Respinta";
  if (status === "BUDGET_EXHAUSTED") return "Budget esaurito";
  if (status === "IN_PROGRESS") return "In corso";
  return "Da eseguire";
}

function coverageStatus(status: AnyWorkflowMission["coverageStatus"]): string {
  if (status === "COVERED") return "Copertura completa rispetto al perimetro registrato.";
  if (status === "CONFLICTING") return "Copertura con autorità in conflitto; è necessaria una valutazione professionale.";
  if (status === "RESULTS_UNASSESSED") return "Risultati conservati, ma non ancora valutati.";
  if (status === "PARTIAL") return "Copertura parziale; restano verifiche o aspetti scoperti.";
  return "Ricerca non ancora svolta.";
}

function sourceDirection(direction: WorkflowResult["supportDirection"]): ResearchSupportDirection {
  return direction;
}

function sourceUsability(result: WorkflowResult): ResearchSourceUsability {
  if (result.usable) return "USABLE";
  if (
    result.retrievalState === "BLOCKED"
    || result.identityVerification === "MISMATCH"
    || result.contentVerification === "MISMATCH"
    || result.temporalStatus === "NOT_APPLICABLE"
  ) return "NOT_USABLE";
  return "TO_VERIFY";
}

function sourceType(sourceFamily: string | null): string | null {
  if (sourceFamily === "ITALIAN_CASE_LAW") return "Giurisprudenza";
  if (sourceFamily === "ITALIAN_LEGISLATION") return "Normativa";
  if (sourceFamily === "EU_CASE_LAW") return "Giurisprudenza UE";
  if (sourceFamily === "EU_LEGISLATION") return "Normativa UE";
  return sourceFamily;
}

function citationReferences(anchors: readonly Readonly<Record<string, unknown>>[]): readonly string[] {
  return anchors.flatMap((anchor) => {
    const parts = [
      typeof anchor.page === "number" ? `pagina ${anchor.page}` : null,
      typeof anchor.paragraph === "string" && anchor.paragraph.trim()
        ? `paragrafo ${anchor.paragraph.trim()}`
        : null,
      typeof anchor.section === "string" && anchor.section.trim()
        ? `sezione ${anchor.section.trim()}`
        : null,
      typeof anchor.anchor === "string" && anchor.anchor.trim()
        ? anchor.anchor.trim()
        : null,
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? [parts.join(", ")] : [];
  });
}

function verificationStatus(
  result: WorkflowResult,
  lifecycleStatus: AnyWorkflowMission["lifecycleStatus"],
  latestAssessmentUsability: ResearchSourceUsability,
): string {
  if (lifecycleStatus === "HISTORICAL") {
    const recorded = latestAssessmentUsability === "USABLE"
      ? "utilizzabile"
      : latestAssessmentUsability === "NOT_USABLE"
        ? "non utilizzabile"
        : "da verificare";
    return `Risultato storico: ultima valutazione registrata ${recorded}. Non costituisce necessariamente la valutazione esistente alla data della missione; la validità attuale richiede una nuova verifica professionale.`;
  }
  if (result.usable) {
    return "Fonte verificata e utilizzabile nel perimetro registrato; resta necessaria la valutazione professionale.";
  }
  const stages = [
    `identità ${result.identityVerification}`,
    `contenuto ${result.contentVerification}`,
    `validità temporale ${result.temporalStatus}`,
    result.manualReviewRequired ? "revisione professionale richiesta" : null,
  ].filter((stage): stage is string => stage !== null);
  return `Risultato candidato, non ancora utilizzabile · ${stages.join(" · ")}.`;
}

function resultSource(
  mission: Pick<AnyWorkflowMission, "missionId" | "lifecycleStatus">,
  result: WorkflowResult,
): FascicoloResearchSource {
  const references = citationReferences(result.citationAnchors);
  const latestAssessmentUsability = sourceUsability(result);
  const lifecycleStatus = mission.lifecycleStatus ?? "CURRENT";
  const note = [
    result.relevantPassage,
    references.length > 0 ? `Riferimenti documentali: ${references.join(" · ")}.` : null,
    result.classificationRationale,
  ].filter((part): part is string => Boolean(part));
  return {
    id: `risultato-${lifecycleStatus.toLocaleLowerCase("it")}-${mission.missionId}-${result.resultId}`,
    questionId: mission.missionId,
    missionId: mission.missionId,
    resultId: result.resultId,
    lifecycleStatus,
    authority: result.authority,
    sourceType: sourceType(result.sourceFamily),
    identifier: result.officialIdentifier ?? result.candidateId,
    date: result.documentDate,
    title: result.title,
    origin: result.provider
      ? `Ricerca ${lifecycleStatus === "HISTORICAL" ? "storica" : "corrente"} archiviata · ${result.provider}`
      : `Ricerca ${lifecycleStatus === "HISTORICAL" ? "storica" : "corrente"} archiviata`,
    href: result.sourceUrl,
    verificationStatus: verificationStatus(result, lifecycleStatus, latestAssessmentUsability),
    note: note.join(" "),
    direction: sourceDirection(result.supportDirection),
    usability: lifecycleStatus === "HISTORICAL" ? "TO_VERIFY" : latestAssessmentUsability,
    latestAssessmentUsability: lifecycleStatus === "HISTORICAL" ? latestAssessmentUsability : undefined,
  };
}

export function buildFascicoloResearchModel(
  workflow: FascicoloResearchWorkflowProjection | null,
  supplementalSources: readonly FascicoloResearchSource[] = [],
): FascicoloResearchModel {
  const currentMissions = workflow?.missions ?? [];
  const historicalMissions = workflow?.historicalMissions ?? [];
  const missions = [...currentMissions, ...historicalMissions];
  const persistedSources = missions.flatMap((mission) => (
    mission.results.map((result) => resultSource(mission, result))
  ));
  return {
    questions: missions.map((mission) => ({
      id: mission.missionId,
      semanticKey: mission.researchQuestionSemanticKey,
      text: mission.question,
      status: missionStatus(mission.status),
      referenceDate: mission.referenceDate.toLocaleDateString("it-IT"),
      coverage: coverageStatus(mission.coverageStatus),
      coveredAspects: mission.coveredElementKeys,
      gaps: mission.coverageGaps.map((gap) => gap.key),
      needsFurtherResearch: mission.coverageStatus !== "COVERED",
      lifecycleStatus: mission.lifecycleStatus ?? "CURRENT",
      versions: (mission.lifecycleStatus ?? "CURRENT") === "CURRENT"
        ? historicalMissions
          .filter((historical) => (
            historical.researchQuestionSemanticKey !== null
            && historical.researchQuestionSemanticKey === mission.researchQuestionSemanticKey
          ))
          .map((historical) => ({
            id: historical.missionId,
            date: historical.updatedAt.toLocaleDateString("it-IT"),
            status: missionStatus(historical.status),
            change: `${historical.results.length} risultati nella missione storica ${historical.missionId}.`,
          }))
        : [],
    })),
    sources: [...persistedSources, ...supplementalSources],
    missionReadTruncation: workflow?.missionReadTruncation,
  };
}
