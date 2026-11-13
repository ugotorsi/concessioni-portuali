import { describe, expect, it } from "vitest";

import { ACT_DRAFT_SCHEMA_VERSION, bodySha256, projectActDrafts, type ActDraftVersion } from "@/server/fascicolo-acts/model";
import {
  applyActivityCommand,
  stableActivityKey,
  type ActivityRecord,
  type ActivitySpec,
} from "@/server/fascicolo-operational-activities/model";
import { matchProposalActivity } from "@/server/fascicolo-operational-proposals/activity-matching";
import { FASCICOLO_OPERATIONAL_PROPOSAL_POLICY_VERSION, type OperationalProposalCandidate } from "@/server/fascicolo-operational-proposals/contracts";
import { previewOperationalProposalReconciliation } from "@/server/fascicolo-operational-proposals/preview";
import type { OperationalProposalRecord, OperationalProposalStatus } from "@/server/fascicolo-operational-proposals/repository";

const tenantId = "tenant-a";
const procedimentoId = "procedure-a";
const reportFingerprint = "a".repeat(64);
const issueA = "b".repeat(64);
const issueB = "c".repeat(64);
const now = new Date("2026-11-03T10:00:00Z");

function activity(code: string, issueSemanticKey = issueA): ActivitySpec {
  return {
    activityKey: stableActivityKey(procedimentoId, issueSemanticKey, code),
    issueSemanticKey,
    issueText: `Problematica ${issueSemanticKey[0]}`,
    activityCode: code,
    title: `Attività ${code}`,
    action: "Esaminare i documenti.",
    office: "Ufficio da verificare",
    requiredDocuments: ["Documento pertinente"],
    completionGate: "Riscontro verificato",
    necessity: "REQUIRED",
    legalSummary: "Conclusione preliminare.",
    legalSourceStatus: "LEGAL_RESEARCH_REQUIRED",
    alternatives: [],
    documents: [{ templateKey: `REPORT_PLAN:${code}`, title: "Atto", legacyTemplateKeys: ["PLAN:Atto"] }],
    fingerprint: "d".repeat(64),
  };
}

function candidate(fingerprint: string, spec: ActivitySpec, overrides: Partial<OperationalProposalCandidate> = {}): OperationalProposalCandidate {
  return {
    tenantId,
    procedimentoId,
    knowledgeRevisionId: "revision-a",
    structuredReportId: "report-a",
    structuredReportFingerprint: reportFingerprint,
    policyVersion: FASCICOLO_OPERATIONAL_PROPOSAL_POLICY_VERSION,
    proposalType: "ACTIVITY",
    title: spec.title,
    description: spec.action,
    proposedPayload: { activityCode: spec.activityCode },
    originatingKnowledgeItemIds: ["origin-a"],
    originatingIssueSemanticKeys: [spec.issueSemanticKey],
    originatingQuestionSemanticKeys: [],
    relevantResultIds: [],
    rationale: "Valutare presupposti e documenti.",
    confidence: null,
    warningCodes: [],
    proposalFingerprint: fingerprint.repeat(64),
    ...overrides,
  };
}

function existing(
  item: OperationalProposalCandidate,
  id: string,
  status: OperationalProposalStatus = "PROPOSED",
  extra: Partial<OperationalProposalRecord> = {},
): OperationalProposalRecord {
  return {
    ...item,
    id,
    status,
    approvedPayload: null,
    reviewVersion: 0,
    reviewedAt: null,
    reviewedByActorId: null,
    reviewedByEmail: null,
    reviewedByRole: null,
    reviewNote: null,
    materializedAt: null,
    materializedEntityType: null,
    materializedEntityId: null,
    supersededAt: null,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function sharedRecord(primary: ActivitySpec, target: ActivitySpec): ActivityRecord {
  const metadata = applyActivityCommand({
    procedimentoId,
    spec: primary,
    specs: [primary, target],
    current: undefined,
    records: [],
    drafts: [],
    documentIds: new Set(),
    documentVersions: new Map(),
    corpus: { fingerprint: "e".repeat(64), analysisCurrent: true },
    command: { kind: "APPROVE", note: "Valutazione professionale.", confirmed: true },
    requestId: "00000000-0000-4000-8000-000000000001",
    requestFingerprint: "f".repeat(64),
    today: "2026-11-03",
  });
  const version = {
    ...metadata,
    sharedActivities: [{ activityKey: target.activityKey, specFingerprint: target.fingerprint }],
    savedAt: now,
    savedBy: "operator@example.test",
    auditHash: "f".repeat(64),
  };
  return { activityKey: primary.activityKey, current: version, history: [version] };
}

function legacyDraft(index: number, spec: ActivitySpec): ActDraftVersion {
  const body = "Testo della bozza precedente.";
  return {
    schema: ACT_DRAFT_SCHEMA_VERSION,
    procedimentoId,
    draftKey: `legacy-${index}`,
    version: 1,
    templateKey: "PLAN:Atto",
    issueSemanticKey: spec.issueSemanticKey,
    title: "Atto",
    body,
    bodySha256: bodySha256(body),
    status: "BOZZA",
    assignee: null,
    dueDate: null,
    progress: 0,
    dependencies: [],
    attachments: [],
    changeNote: null,
    savedAt: now,
    savedBy: "operator@example.test",
    auditHash: "f".repeat(64),
  };
}

describe("read-only operational proposal reconciliation preview", () => {
  it("distinguishes preserved, stale, restored, historical and new records without mutating input", () => {
    const first = activity("A");
    const second = activity("B", issueB);
    const newCandidate = candidate("3", first);
    const trulyNew = candidate("9", second);
    const proposals = [
      existing(candidate("1", first), "retained"),
      existing(candidate("2", first), "reactivated", "STALE", { supersededAt: now }),
      existing(candidate("4", first), "old-pending"),
      existing(candidate("5", first), "old-approved", "APPROVED", { reviewVersion: 1 }),
      existing(candidate("6", first), "rejected", "REJECTED", { reviewVersion: 1 }),
      existing(candidate("7", first), "restored-approval", "APPROVED", { reviewVersion: 1, supersededAt: now }),
      existing(candidate("8", first), "reviewed-stale", "STALE", { reviewVersion: 1, supersededAt: now }),
    ];
    const candidates = [
      candidate("1", first), candidate("2", first), newCandidate, trulyNew,
      candidate("7", first), candidate("8", first),
      candidate("a", second, { proposalType: "NOTE", proposedPayload: {}, title: "Nota" }),
    ];
    const before = JSON.stringify({ proposals, candidates });
    const preview = previewOperationalProposalReconciliation({
      tenantId, procedimentoId, reportFingerprint, proposals, candidates, specs: [first, second], activities: [], drafts: [],
    });

    expect(preview.retained.map((item) => item.id)).toEqual(["retained"]);
    expect(preview.reactivated.map((item) => item.id)).toEqual(["reactivated"]);
    expect(preview.superseded.map((item) => item.id)).toEqual(["old-pending"]);
    expect(preview.approvalsNeedingReview.map((item) => item.id)).toEqual(["old-approved"]);
    expect(preview.restoredApprovals.map((item) => item.id)).toEqual(["restored-approval"]);
    expect(preview.historical.map((item) => item.id)).toEqual(["rejected", "reviewed-stale"]);
    expect(preview.newProposals.map((item) => [item.candidate.proposalFingerprint[0], item.activityClassification]))
      .toEqual([["3", "EXISTING"], ["9", "NEW"], ["a", "NOT_ACTIVITY"]]);
    expect(preview.possibleConsolidations[0].proposalIds).toContain("old-pending");
    expect(preview.possibleConsolidations[0].proposalIds).toContain("old-approved");
    expect(JSON.stringify({ proposals, candidates })).toBe(before);
  });

  it("does not claim a new activity or a proven merge when legacy identity is unclear", () => {
    const spec = activity("A");
    const legacy = existing(candidate("1", spec, { proposedPayload: {}, title: spec.title }), "legacy");
    const preview = previewOperationalProposalReconciliation({
      tenantId, procedimentoId, reportFingerprint, proposals: [legacy], candidates: [candidate("2", spec)],
      specs: [spec], activities: [], drafts: [],
    });
    expect(matchProposalActivity(legacy, spec, [spec])).toBe("UNIQUE_LEGACY_TITLE");
    expect(preview.newProposals[0].activityClassification).toBe("UNDETERMINED");
    expect(preview.unmappedActivities.map((item) => item.id)).toEqual(["legacy"]);
    expect(preview.possibleConsolidations).toHaveLength(0);
  });

  it("shows only explicitly shared activities and treats multiple legacy drafts as ambiguous", () => {
    const first = activity("A");
    const second = activity("B", issueB);
    const records = [sharedRecord(first, second)];
    const drafts = projectActDrafts(Array.from({ length: 5 }, (_, index) => legacyDraft(index, first)));
    const preview = previewOperationalProposalReconciliation({
      tenantId, procedimentoId, reportFingerprint, proposals: [], candidates: [],
      specs: [first, second], activities: records, drafts,
    });
    expect(preview.sharedActivities).toHaveLength(1);
    expect(preview.sharedActivities[0].target?.activityKey).toBe(second.activityKey);
    expect(preview.draftMatches).toHaveLength(5);
    expect(preview.draftMatches.every((item) => item.match === "LEGACY_REVIEW" && item.ambiguous)).toBe(true);
    expect(drafts).toHaveLength(5);
  });

  it("rejects cross-procedure data and changes its baseline when a review changes", () => {
    const spec = activity("A");
    const first = existing(candidate("1", spec), "first");
    const second = existing(candidate("2", spec), "second");
    const base = { tenantId, procedimentoId, reportFingerprint, candidates: [], specs: [spec], activities: [], drafts: [] };
    const fingerprint = previewOperationalProposalReconciliation({ ...base, proposals: [first, second] }).baselineFingerprint;
    expect(previewOperationalProposalReconciliation({ ...base, proposals: [second, first] }).baselineFingerprint).toBe(fingerprint);
    expect(previewOperationalProposalReconciliation({
      ...base, proposals: [{ ...first, status: "APPROVED", reviewVersion: 1 }, second],
    }).baselineFingerprint).not.toBe(fingerprint);
    expect(() => previewOperationalProposalReconciliation({
      ...base, proposals: [{ ...first, procedimentoId: "other-procedure" }],
    })).toThrow("OPERATIONAL_PROPOSAL_PREVIEW_SCOPE_MISMATCH");
  });
});
