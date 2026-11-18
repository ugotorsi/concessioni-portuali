import type { ActivitySpec } from "@/server/fascicolo-operational-activities/model";

export interface ActivityProposalIdentity {
  proposalType: string;
  title: string;
  proposedPayload?: unknown;
  originatingIssueSemanticKeys?: readonly string[];
}

export function matchProposalActivity(
  proposal: ActivityProposalIdentity,
  spec: ActivitySpec,
  specs: readonly ActivitySpec[],
): "STABLE_CODE" | "UNIQUE_LEGACY_TITLE" | null {
  if (proposal.proposalType !== "ACTIVITY"
    || !proposal.originatingIssueSemanticKeys?.includes(spec.issueSemanticKey)) return null;
  const payload = proposal.proposedPayload;
  const code = payload && typeof payload === "object" && !Array.isArray(payload)
    ? Reflect.get(payload, "activityCode") : null;
  if (typeof code === "string") return code === spec.activityCode ? "STABLE_CODE" : null;
  return proposal.title === spec.title
    && specs.filter((item) => item.issueSemanticKey === spec.issueSemanticKey && item.title === spec.title).length === 1
    ? "UNIQUE_LEGACY_TITLE" : null;
}
