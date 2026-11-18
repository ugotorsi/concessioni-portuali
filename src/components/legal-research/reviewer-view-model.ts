import type {
  AssistedVerificationPreClaimStatus,
  AssistedVerificationResult,
  AssistedVerificationSnapshot,
} from "@/server/legal-research/assisted-verification";
import type { ResearchSourceFamily } from "@/server/legal-research/bridge";

export type ReviewerVerification = Readonly<{
  recordId: string;
  snapshot: AssistedVerificationSnapshot;
  result: AssistedVerificationResult;
  preClaimStatus: AssistedVerificationPreClaimStatus;
  fingerprint: string;
  recordedByActorId: string;
  createdAt: string;
}>;

export type ReviewerRequirement = Readonly<{
  id: "FULL_TEXT" | "CITATION" | "SUGGESTIONS" | "HUMAN_REVIEW" | "ADVERSE_SEARCH" | "ADVERSE_AUTHORITY" | "GAPS" | "PRE_CLAIM";
  label: string;
  satisfied: boolean;
  detail: string;
}>;

export type InitialSourceDraft = Readonly<{
  evidenceSourceId: string;
  authorityId: string;
  legalSourceId: string;
  legalExpressionVersionId: string;
  officialIdentifier: string;
  sourceUrl: string;
  sourceFamily: ResearchSourceFamily | "";
  courtOrBody: string;
  documentType: string;
  contentSha256: string;
  documentId?: string;
  fileVersionId?: string;
  termsOfUseBasis: string;
  verificationRationale: string;
}>;

export type InitialVerificationDraft = Readonly<{
  missionId: string;
  recordId?: string | null;
  source: InitialSourceDraft;
  includeCitationRelation: boolean;
  targetSource: InitialSourceDraft;
  citationParagraph: string;
}>;

function completeSource(source: InitialSourceDraft): boolean {
  return Object.entries(source).filter(([key]) => key !== "documentId" && key !== "fileVersionId")
    .every(([, value]) => value?.trim())
    && /^[a-f0-9]{64}$/i.test(source.contentSha256)
    && source.termsOfUseBasis.trim().length >= 20
    && source.verificationRationale.trim().length >= 20;
}

export function buildInitialVerificationCommand(input: InitialVerificationDraft): unknown | null {
  if (!input.missionId.trim() || !completeSource(input.source)) return null;
  if (input.includeCitationRelation
    && (!completeSource(input.targetSource)
      || !input.citationParagraph.trim()
      || input.source.authorityId.trim() === input.targetSource.authorityId.trim())) return null;
  return {
    missionId: input.missionId.trim(),
    recordId: input.recordId ?? null,
    sources: [input.source, ...(input.includeCitationRelation ? [input.targetSource] : [])],
    ...(input.includeCitationRelation ? {
      citationRelation: {
        sourceAuthorityId: input.source.authorityId,
        targetAuthorityId: input.targetSource.authorityId,
        evidenceSourceId: input.source.evidenceSourceId,
        locator: { paragraph: input.citationParagraph },
      },
    } : {}),
  };
}

export function reviewerRequirements(
  verification: ReviewerVerification,
): readonly ReviewerRequirement[] {
  const { result, snapshot, preClaimStatus } = verification;
  return [
    {
      id: "FULL_TEXT",
      label: "Testo integrale ufficiale",
      satisfied: result.verifiedFullTexts.length > 0,
      detail: `${result.verifiedFullTexts.length} fonte/i verificata/e`,
    },
    {
      id: "CITATION",
      label: "Relazione citazionale documentata",
      satisfied: result.citationObservations.length > 0,
      detail: `${result.citationObservations.length} osservazione/i`,
    },
    {
      id: "SUGGESTIONS",
      label: "Azioni di ricerca documentate",
      satisfied: result.legalResearchSuggestions.length > 0,
      detail: `${result.legalResearchSuggestions.length} suggerimento/i`,
    },
    {
      id: "HUMAN_REVIEW",
      label: "Revisione giuridica esplicita",
      satisfied: Boolean(snapshot.adverseReview),
      detail: snapshot.adverseReview?.decision ?? "Non registrata",
    },
    {
      id: "ADVERSE_SEARCH",
      label: "Ricerca di autorita' contrarie",
      satisfied: result.adverseSearchCompleted ?? result.adverseAuthorityVerified,
      detail: ({
        NOT_PERFORMED_OR_INSUFFICIENT: "Non svolta o documentazione insufficiente",
        INCONCLUSIVE: "Ricerca inconcludente",
        COMPLETED_NO_ADVERSE_FOUND: "Nessuna autorita' contraria trovata nel perimetro revisionato",
        CONFIRMED_ADVERSE: "Autorita' contraria confermata",
      })[result.adverseSearchState ?? (result.adverseAuthorityVerified ? "CONFIRMED_ADVERSE" : "NOT_PERFORMED_OR_INSUFFICIENT")],
    },
    {
      id: "ADVERSE_AUTHORITY",
      label: "Autorita' contraria verificata",
      satisfied: result.adverseAuthorityVerified,
      detail: result.adverseAuthorityVerified ? "Presente" : "Nessuna autorita' contraria verificata",
    },
    {
      id: "GAPS",
      label: "Gap probatori risolti",
      satisfied: result.evidenceGaps.length === 0,
      detail: `${result.evidenceGaps.length} gap residuo/i`,
    },
    {
      id: "PRE_CLAIM",
      label: "Gate pre-claim complessivo",
      satisfied: preClaimStatus.satisfied,
      detail: preClaimStatus.satisfied
        ? "Requisiti soddisfatti"
        : `${preClaimStatus.unmetRequirements.length} requisito/i non soddisfatto/i`,
    },
  ];
}

export function canSubmitLegalReview(
  verification: ReviewerVerification,
  input: Readonly<{
    legalPropositionId: string;
    evidenceSourceId: string;
    rationale: string;
  }>,
): boolean {
  const relation = verification.snapshot.citationRelation;
  return Boolean(
    input.legalPropositionId.trim()
    && input.rationale.trim()
    && input.evidenceSourceId.trim()
    && relation?.documented
    && relation.locator
    && relation.evidenceSourceId === input.evidenceSourceId
    && verification.result.verifiedFullTexts.some((source) => (
      source.evidenceSourceId === input.evidenceSourceId
    )),
  );
}