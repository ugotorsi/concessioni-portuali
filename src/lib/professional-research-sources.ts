import type {
  StructuredFascicoloReportPayload,
  StructuredReportResearchResultInput,
} from "@/server/fascicolo-report/structured-report";

export const SOURCE_REVIEW_POLICY = "PROFESSIONAL_CLASSIFICATION_REQUIRED_V1" as const;
export const UNREVIEWED_SOURCE_NOTICE =
  "La pertinenza e l'orientamento delle fonti individuate richiedono una valutazione motivata del professionista.";
export const LEGACY_SOURCE_NOTICE =
  "In questa versione del rapporto non è attestata la valutazione professionale della pertinenza delle fonti. Verificare le fonti e aggiornare il rapporto prima di usarle nelle conclusioni.";

type Classification = Pick<
  StructuredReportResearchResultInput,
  "classificationSource" | "classificationReviewAuditId" | "classificationReviewStatus" | "classificationRationale"
>;

export function hasProfessionalSourceClassification(result: Classification): boolean {
  return result.classificationReviewStatus === "HUMAN_CONFIRMED"
    && result.classificationSource === "HUMAN_REVIEW"
    && Boolean(result.classificationReviewAuditId)
    && (result.classificationRationale?.trim().length ?? 0) >= 20;
}

export function isProfessionallyUsableSource(result: Pick<
  StructuredReportResearchResultInput,
  "classificationSource" | "classificationReviewAuditId" | "classificationReviewStatus" | "classificationRationale" | "sourceAssessment" | "supportDirection"
>): boolean {
  const assessment = result.sourceAssessment;
  return hasProfessionalSourceClassification(result)
    && (result.supportDirection === "SUPPORTS" || result.supportDirection === "OPPOSES")
    && assessment?.isCurrent === true
    && assessment.usable
    && !assessment.manualReviewRequired
    && assessment.blockingReasons.length === 0
    && assessment.citationAnchors.length > 0;
}

export function projectProfessionalResearch(payload: StructuredFascicoloReportPayload) {
  const applications = payload.legalApplication ?? [];
  if (payload.sourceReviewPolicy === SOURCE_REVIEW_POLICY) {
    return { authoritiesAttested: true, legacyWarning: null, applications };
  }

  const issueKeys = new Set(payload.legalIssues
    .filter((issue) => issue.questions.some((question) =>
      question.favorableAuthorities.length + question.contraryAuthorities.length > 0))
    .map((issue) => issue.semanticKey));
  const unassignedSources = payload.unassignedQuestions.some((question) =>
    question.favorableAuthorities.length + question.contraryAuthorities.length > 0);
  let hasUnattestedSources = issueKeys.size > 0 || unassignedSources;
  const safeApplications = applications.map((application) => {
    const affected = issueKeys.has(application.issueSemanticKey)
      || application.favorableAuthorities.length + application.contraryAuthorities.length > 0
      || application.conclusionStatus === "GROUNDED_ON_VERIFIED_AUTHORITIES";
    if (!affected) return application;
    hasUnattestedSources = true;
    return {
      ...application,
      favorableAuthorities: [],
      contraryAuthorities: [],
      favorableArguments: [],
      contraryArguments: [],
      conclusionStatus: "SOURCES_TO_VERIFY" as const,
      conclusion: "La conclusione basata sulle fonti di questa versione è sospesa: verificarne la pertinenza e aggiornare il rapporto.",
    };
  });
  return {
    authoritiesAttested: false,
    legacyWarning: hasUnattestedSources ? LEGACY_SOURCE_NOTICE : null,
    applications: safeApplications,
  };
}
