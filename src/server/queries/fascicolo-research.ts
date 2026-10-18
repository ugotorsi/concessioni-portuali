import type {
  FascicoloResearchModel,
  FascicoloResearchSource,
  ResearchSourceUsability,
  ResearchSupportDirection,
} from "@/components/procedimenti/FascicoloResearch";
import type { FascicoloAutomaticWorkflowReadModel } from "@/server/queries/fascicolo-automatic-workflow";

type WorkflowMission = FascicoloAutomaticWorkflowReadModel["missions"][number];
type WorkflowResult = WorkflowMission["results"][number];

export type FascicoloResearchWorkflowProjection = Readonly<{
  missions: readonly Pick<
    WorkflowMission,
    | "missionId"
    | "question"
    | "referenceDate"
    | "status"
    | "coverageStatus"
    | "coveredElementKeys"
    | "coverageGaps"
    | "historicalResultCount"
    | "results"
  >[];
}>;

function missionStatus(status: WorkflowMission["status"]): string {
  if (status === "COMPLETED") return "Completata";
  if (status === "DEFERRED") return "Differita";
  if (status === "REJECTED") return "Respinta";
  if (status === "BUDGET_EXHAUSTED") return "Budget esaurito";
  if (status === "IN_PROGRESS") return "In corso";
  return "Da eseguire";
}

function coverageStatus(status: WorkflowMission["coverageStatus"]): string {
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

function verificationStatus(result: WorkflowResult): string {
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

function resultSource(mission: Pick<WorkflowMission, "missionId">, result: WorkflowResult): FascicoloResearchSource {
  const references = citationReferences(result.citationAnchors);
  const note = [
    result.relevantPassage,
    references.length > 0 ? `Riferimenti documentali: ${references.join(" · ")}.` : null,
    result.classificationRationale,
  ].filter((part): part is string => Boolean(part));
  return {
    id: `risultato-${result.resultId}`,
    questionId: mission.missionId,
    authority: result.authority,
    sourceType: sourceType(result.sourceFamily),
    identifier: result.officialIdentifier ?? result.candidateId,
    date: result.documentDate,
    title: result.title,
    origin: result.provider ? `Ricerca archiviata · ${result.provider}` : "Ricerca archiviata",
    href: result.sourceUrl,
    verificationStatus: verificationStatus(result),
    note: note.join(" "),
    direction: sourceDirection(result.supportDirection),
    usability: sourceUsability(result),
  };
}

function deduplicateSources(sources: readonly FascicoloResearchSource[]): FascicoloResearchSource[] {
  const unique = new Map<string, FascicoloResearchSource>();
  for (const source of sources) {
    const key = source.identifier?.trim().toLocaleLowerCase("it")
      || source.href?.trim().toLocaleLowerCase("it")
      || `${source.title ?? ""}:${source.authority ?? ""}`.toLocaleLowerCase("it");
    const previous = unique.get(key);
    if (!previous || (previous.usability !== "USABLE" && source.usability === "USABLE")) {
      unique.set(key, previous ? {
        ...source,
        questionId: source.questionId ?? previous.questionId,
      } : source);
    }
  }
  return [...unique.values()];
}

export function buildFascicoloResearchModel(
  workflow: FascicoloResearchWorkflowProjection | null,
  supplementalSources: readonly FascicoloResearchSource[] = [],
): FascicoloResearchModel {
  const missions = workflow?.missions ?? [];
  return {
    questions: missions.map((mission) => ({
      id: mission.missionId,
      text: mission.question,
      status: missionStatus(mission.status),
      referenceDate: mission.referenceDate.toLocaleDateString("it-IT"),
      coverage: coverageStatus(mission.coverageStatus),
      coveredAspects: mission.coveredElementKeys,
      gaps: mission.coverageGaps.map((gap) => gap.key),
      needsFurtherResearch: mission.coverageStatus !== "COVERED",
      versions: mission.historicalResultCount > 0 ? [{
        id: `${mission.missionId}-historical-results`,
        status: "Versioni precedenti conservate",
        change: `${mission.historicalResultCount} risultati collegati a missioni storiche.`,
      }] : [],
    })),
    sources: deduplicateSources([
      ...missions.flatMap((mission) => mission.results.map((result) => resultSource(mission, result))),
      ...supplementalSources,
    ]),
  };
}
