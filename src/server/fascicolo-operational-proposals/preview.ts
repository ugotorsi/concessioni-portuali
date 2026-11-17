import { actDraftMatchesTemplate, type ActDraft } from "@/server/fascicolo-acts/model";
import { activityForKey, type ActivityRecord, type ActivitySpec } from "@/server/fascicolo-operational-activities/model";

import { matchProposalActivity } from "./activity-matching";
import type { OperationalProposalCandidate } from "./contracts";
import { proposalReconciliationFingerprint, proposalReconciliationStates } from "./reconciliation-state";
import type { OperationalProposalRecord } from "./repository";

export interface PreviewNewProposal {
  candidate: OperationalProposalCandidate;
  activityKey: string | null;
  activityClassification: "NEW" | "EXISTING" | "UNDETERMINED" | "NOT_ACTIVITY";
  relatedProposalIds: readonly string[];
}

export interface OperationalProposalPreview {
  baselineFingerprint: string;
  retained: readonly OperationalProposalRecord[];
  reactivated: readonly OperationalProposalRecord[];
  superseded: readonly OperationalProposalRecord[];
  approvalsNeedingReview: readonly OperationalProposalRecord[];
  restoredApprovals: readonly OperationalProposalRecord[];
  historical: readonly OperationalProposalRecord[];
  newProposals: readonly PreviewNewProposal[];
  possibleConsolidations: readonly { activity: ActivitySpec; proposalIds: readonly string[] }[];
  unmappedActivities: readonly OperationalProposalRecord[];
  sharedActivities: readonly { primary: ActivityRecord; target: ActivitySpec | null; targetKey: string }[];
  draftMatches: readonly {
    activity: ActivitySpec;
    documentTitle: string;
    draft: ActDraft;
    match: "LINKED" | "STABLE_IDENTITY" | "LEGACY_REVIEW";
    ambiguous: boolean;
  }[];
}

export function previewOperationalProposalReconciliation(input: {
  tenantId: string;
  procedimentoId: string;
  reportFingerprint: string;
  candidates: readonly OperationalProposalCandidate[];
  proposals: readonly OperationalProposalRecord[];
  specs: readonly ActivitySpec[];
  activities: readonly ActivityRecord[];
  drafts: readonly ActDraft[];
}): OperationalProposalPreview {
  const { tenantId, procedimentoId, reportFingerprint, proposals, specs, activities, drafts } = input;
  if (input.candidates.some((item) => item.tenantId !== tenantId || item.procedimentoId !== procedimentoId
      || item.structuredReportFingerprint !== reportFingerprint)
    || proposals.some((item) => item.tenantId !== tenantId || item.procedimentoId !== procedimentoId)
    || activities.some((item) => item.current.procedimentoId !== procedimentoId)
    || drafts.some((item) => item.current.procedimentoId !== procedimentoId)) {
    throw new Error("OPERATIONAL_PROPOSAL_PREVIEW_SCOPE_MISMATCH");
  }

  const candidates = [...new Map(input.candidates.map((item) => [item.proposalFingerprint, item])).values()];
  const candidateFingerprints = new Set(candidates.map((item) => item.proposalFingerprint));
  const existingFingerprints = new Set(proposals.map((item) => item.proposalFingerprint));
  const same = (item: OperationalProposalRecord) => candidateFingerprints.has(item.proposalFingerprint);
  const approved = (item: OperationalProposalRecord) => ["APPROVED", "AMENDED_AND_APPROVED"].includes(item.status);
  const retained = proposals.filter((item) => same(item)
    && item.status !== "STALE" && !(approved(item) && item.supersededAt));
  const reactivated = proposals.filter((item) => same(item) && item.status === "STALE" && item.reviewVersion === 0);
  const superseded = proposals.filter((item) => !same(item) && item.status === "PROPOSED");
  const approvalsNeedingReview = proposals.filter((item) => !same(item) && approved(item));
  const restoredApprovals = proposals.filter((item) => same(item) && approved(item) && item.supersededAt !== null);
  const classifiedIds = new Set([
    ...retained, ...reactivated, ...superseded, ...approvalsNeedingReview, ...restoredApprovals,
  ].map((item) => item.id));
  const historical = proposals.filter((item) => !classifiedIds.has(item.id));

  const unmappedActivities = proposals.filter((proposal) => proposal.proposalType === "ACTIVITY"
    && !specs.some((spec) => matchProposalActivity(proposal, spec, specs) === "STABLE_CODE"));
  const newProposals = candidates.filter((candidate) => !existingFingerprints.has(candidate.proposalFingerprint))
    .map((candidate): PreviewNewProposal => {
      if (candidate.proposalType !== "ACTIVITY") {
        return { candidate, activityKey: null, activityClassification: "NOT_ACTIVITY", relatedProposalIds: [] };
      }
      const matchedSpecs = specs.filter((spec) => matchProposalActivity(candidate, spec, specs) === "STABLE_CODE");
      if (matchedSpecs.length !== 1) {
        return { candidate, activityKey: null, activityClassification: "UNDETERMINED", relatedProposalIds: [] };
      }
      const spec = matchedSpecs[0];
      const related = proposals.filter((proposal) => matchProposalActivity(proposal, spec, specs) === "STABLE_CODE");
      const hasUnknownPredecessor = unmappedActivities.some((proposal) =>
        proposal.originatingIssueSemanticKeys.length === 0
        || proposal.originatingIssueSemanticKeys.includes(spec.issueSemanticKey));
      const activityClassification = related.length || activityForKey(activities, spec.activityKey) ? "EXISTING"
        : hasUnknownPredecessor ? "UNDETERMINED" : "NEW";
      return {
        candidate,
        activityKey: spec.activityKey,
        activityClassification,
        relatedProposalIds: related.map((proposal) => proposal.id).sort(),
      };
    });

  const possibleConsolidations = specs.flatMap((activity) => {
    const proposalIds = proposals.filter((proposal) => matchProposalActivity(proposal, activity, specs) === "STABLE_CODE")
      .map((proposal) => proposal.id).sort();
    return proposalIds.length > 1 ? [{ activity, proposalIds }] : [];
  });
  const sharedActivities = activities.flatMap((primary) => primary.current.sharedActivities.map((shared) => ({
    primary,
    target: specs.find((spec) => spec.activityKey === shared.activityKey) ?? null,
    targetKey: shared.activityKey,
  })));
  const draftMatches = specs.flatMap((activity) => activity.documents.flatMap((document) => {
    const matches = drafts.filter((draft) => actDraftMatchesTemplate(draft, {
      templateKey: document.templateKey,
      issueSemanticKey: activity.issueSemanticKey,
      legacyTemplateKeys: document.legacyTemplateKeys,
    }));
    return matches.map((draft) => {
      const record = activityForKey(activities, activity.activityKey);
      const linked = record?.current.drafts.some((link) =>
        link.templateKey === document.templateKey && link.draftKey === draft.draftKey) ?? false;
      const legacy = draft.current.templateKey !== document.templateKey;
      const legacyOwners = specs.filter((spec) => spec.issueSemanticKey === activity.issueSemanticKey
        && spec.documents.some((item) => item.legacyTemplateKeys.includes(draft.current.templateKey)));
      return {
        activity,
        documentTitle: document.title,
        draft,
        match: linked ? "LINKED" as const : legacy ? "LEGACY_REVIEW" as const : "STABLE_IDENTITY" as const,
        ambiguous: legacy && (matches.length > 1 || legacyOwners.length > 1),
      };
    });
  }));
  const baselineFingerprint = proposalReconciliationFingerprint({
    tenantId,
    procedimentoId,
    reportFingerprint,
    candidateFingerprints: [...candidateFingerprints].sort(),
    states: proposalReconciliationStates(proposals),
  });

  return {
    baselineFingerprint, retained, reactivated, superseded, approvalsNeedingReview, restoredApprovals, historical,
    newProposals, possibleConsolidations, unmappedActivities, sharedActivities, draftMatches,
  };
}
