import { verifyResearchEvidence, type OfficialSourceEvidence } from "@/server/legal-research/assisted-verification";
import type { AdverseSearch } from "@/server/legal-research/adverse-search";
import type { ResearchMission } from "@/server/legal-research/bridge";

export function syntheticAdverseSearch(mission: ResearchMission, sources: readonly OfficialSourceEvidence[]): AdverseSearch {
  return {
    missionId: mission.missionId,
    legalPropositionId: mission.legalPropositionIds[0],
    temporalScope: { from: "1900-01-01T00:00:00.000Z", through: mission.referenceDate, referenceDate: mission.referenceDate },
    jurisdictions: [...new Set(sources.map(source => source.sourceFamily!))],
    examinedDocuments: sources.map(source => ({
      evidenceSourceId: source.evidenceSourceId, documentId: source.fullText.documentId!, fileVersionId: source.fullText.fileVersionId!,
      legalSourceId: source.legalSourceId, legalExpressionVersionId: source.legalExpressionVersionId,
      contentSha256: source.fullText.contentSha256!,
    })),
    researchSteps: sources.map(source => ({ method: "DOCUMENT_READING", queryOrActivity: "Synthetic reading for contrary authority; not an actual legal search.", performedAt: source.reviewerAttestation.reviewedAt,
      evidence: [{ evidenceSourceId: source.evidenceSourceId, locator: "Synthetic paragraph 42" }] })),
    candidates: sources.map(source => ({ authorityId: source.authorityId, evidenceSourceId: source.evidenceSourceId, outcome: "NOT_ADVERSE", rationale: "Synthetic candidate assessed only for this offline test." })),
    limitations: "Synthetic documents only; no claims about real authorities.",
    unresolvedGaps: [],
    sufficiencyRationale: "Synthetic coverage of all required families and documents for this test only.",
    outcome: "NO_ADVERSE_FOUND_IN_REVIEWED_SCOPE",
  };
}

export function syntheticDocumentReceipts(sources: readonly OfficialSourceEvidence[]) {
  return sources.flatMap((source) => source.fullText.documentId && source.fullText.fileVersionId
    && source.fullText.contentSha256 && source.fullText.available ? [{
      evidenceSourceId: source.evidenceSourceId,
      documentId: source.fullText.documentId,
      fileVersionId: source.fullText.fileVersionId,
      contentSha256: source.fullText.contentSha256,
    }] : []);
}

export function verifyWithSyntheticDocuments(input: Parameters<typeof verifyResearchEvidence>[0]) {
  return verifyResearchEvidence({ ...input, verifiedDocuments: syntheticDocumentReceipts(input.sources) });
}