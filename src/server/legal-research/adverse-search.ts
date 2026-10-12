import { createHash } from "node:crypto";
import { z } from "zod";
import type { ResearchMission } from "./bridge";
import type { OfficialSourceEvidence, VerifiedDocumentEvidence } from "./assisted-verification";

const text = z.string().trim().min(1).max(8_000);
const reason = z.string().trim().min(20).max(8_000);
const date = z.string().datetime({ precision: 3 });
const family = z.enum(["ITALIAN_LEGISLATION", "EU_LEGISLATION", "CASSAZIONE", "CORTE_COSTITUZIONALE", "GIURISPRUDENZA_DI_MERITO", "GIUSTIZIA_AMMINISTRATIVA", "CJEU", "CNF", "ECHR", "OTHER"]);
export const adverseSearchSchema = z.object({
  missionId: text,
  legalPropositionId: text,
  temporalScope: z.object({ from: date, through: date, referenceDate: date }).strict(),
  jurisdictions: z.array(family).min(1).max(10),
  examinedDocuments: z.array(z.object({
    evidenceSourceId: text, documentId: text, fileVersionId: text,
    legalSourceId: text, legalExpressionVersionId: text,
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).min(1).max(100),
  researchSteps: z.array(z.object({
    method: z.enum(["DOCUMENT_READING", "OFFICIAL_SEARCH", "CITATION_FOLLOW_UP"]),
    queryOrActivity: reason,
    performedAt: date,
    evidence: z.array(z.object({ evidenceSourceId: text, locator: text }).strict()).min(1).max(100),
  }).strict()).min(1).max(100),
  candidates: z.array(z.object({
    authorityId: text, evidenceSourceId: text,
    outcome: z.enum(["NOT_ADVERSE", "EXCLUDED", "INCONCLUSIVE"]),
    rationale: reason,
  }).strict()).min(1).max(100),
  limitations: reason,
  unresolvedGaps: z.array(text).max(100),
  sufficiencyRationale: reason,
  outcome: z.enum(["NO_ADVERSE_FOUND_IN_REVIEWED_SCOPE", "INCONCLUSIVE"]),
}).strict();
export const adverseSearchReviewSchema = z.object({
  reviewedByActorId: text,
  reviewedAt: date,
  basisFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type AdverseSearch = z.infer<typeof adverseSearchSchema>;
export type AdverseSearchReview = z.infer<typeof adverseSearchReviewSchema>;
export type AdverseSearchState = "NOT_PERFORMED_OR_INSUFFICIENT" | "INCONCLUSIVE" | "COMPLETED_NO_ADVERSE_FOUND" | "CONFIRMED_ADVERSE";

export function adverseSearchBasis(search: AdverseSearch, sources: readonly OfficialSourceEvidence[]): string {
  return createHash("sha256").update(JSON.stringify({ search, sources })).digest("hex");
}

export function evaluateAdverseSearch(input: Readonly<{
  mission: ResearchMission;
  sources: readonly OfficialSourceEvidence[];
  verifiedDocuments: readonly VerifiedDocumentEvidence[];
  adverseAuthorityVerified: boolean;
  singleDecisionInconclusive?: boolean;
  search?: AdverseSearch;
  review?: AdverseSearchReview;
}>): Readonly<{ state: AdverseSearchState; completed: boolean }> {
  if (input.adverseAuthorityVerified) return { state: "CONFIRMED_ADVERSE", completed: true };
  const parsed = adverseSearchSchema.safeParse(input.search);
  const insufficient = { state: "NOT_PERFORMED_OR_INSUFFICIENT", completed: false } as const;
  if (!parsed.success) return input.singleDecisionInconclusive ? { state: "INCONCLUSIVE", completed: false } : insufficient;
  const search = parsed.data;
  const scope = search.temporalScope;
  const documents = search.examinedDocuments;
  const sourceFor = (id: string) => input.sources.find(source => source.evidenceSourceId === id);
  const evidenceIds = new Set(documents.map(document => document.evidenceSourceId));
  const requiredFamilies = new Set([...input.mission.preferredSourceFamilies, ...input.mission.missingSourceFamilies]);
  if (search.missionId !== input.mission.missionId
    || input.mission.legalPropositionIds.length !== 1
    || !input.mission.legalPropositionIds.includes(search.legalPropositionId)
    || scope.referenceDate !== input.mission.referenceDate
    || scope.from > scope.referenceDate || scope.through < scope.referenceDate
    || evidenceIds.size !== documents.length
    || new Set(search.jurisdictions).size !== search.jurisdictions.length
    || new Set(input.sources.map(source => source.evidenceSourceId)).size !== input.sources.length
    || [...requiredFamilies].some(required => !search.jurisdictions.includes(required))
    || input.sources.some(source => source.sourceFamily && search.jurisdictions.includes(source.sourceFamily) && !evidenceIds.has(source.evidenceSourceId))
    || search.jurisdictions.some(jurisdiction => !documents.some(document => sourceFor(document.evidenceSourceId)?.sourceFamily === jurisdiction))
    || documents.some(document => {
      const source = sourceFor(document.evidenceSourceId);
      return !source || source.legalSourceId !== document.legalSourceId
        || source.legalExpressionVersionId !== document.legalExpressionVersionId
        || source.fullText.documentId !== document.documentId || source.fullText.fileVersionId !== document.fileVersionId
        || source.fullText.contentSha256 !== document.contentSha256
        || !input.verifiedDocuments.some(verified => verified.evidenceSourceId === document.evidenceSourceId
          && verified.documentId === document.documentId && verified.fileVersionId === document.fileVersionId
          && verified.contentSha256 === document.contentSha256);
    })
    || search.researchSteps.some(step => step.evidence.some(evidence => !evidenceIds.has(evidence.evidenceSourceId)))
    || documents.some(document => !search.researchSteps.some(step => step.evidence.some(evidence => evidence.evidenceSourceId === document.evidenceSourceId)))
    || search.candidates.some(candidate => !evidenceIds.has(candidate.evidenceSourceId) || sourceFor(candidate.evidenceSourceId)?.authorityId !== candidate.authorityId)
    || documents.some(document => !search.candidates.some(candidate => candidate.evidenceSourceId === document.evidenceSourceId))) return insufficient;
  if (search.outcome === "INCONCLUSIVE" || search.candidates.some(candidate => candidate.outcome === "INCONCLUSIVE")) {
    return { state: "INCONCLUSIVE", completed: false };
  }
  const review = adverseSearchReviewSchema.safeParse(input.review);
  if (search.unresolvedGaps.length || !review.success
    || review.data.basisFingerprint !== adverseSearchBasis(search, input.sources)
    || search.researchSteps.some(step => step.performedAt > review.data.reviewedAt)) return insufficient;
  return { state: "COMPLETED_NO_ADVERSE_FOUND", completed: true };
}