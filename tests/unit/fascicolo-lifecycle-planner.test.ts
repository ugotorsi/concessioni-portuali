import { describe, expect, it } from "vitest";

import {
  FascicoloChangeValidationError,
  fingerprintFascicoloChange,
} from "@/server/fascicolo-lifecycle/change";
import { planFascicoloReevaluation } from "@/server/fascicolo-lifecycle/planner";

const stateA = "a".repeat(64);
const stateB = "b".repeat(64);

function documentChange(overrides: Record<string, unknown> = {}) {
  return {
    kind: "DOCUMENT_CHANGED",
    triggeredAt: "2026-09-19T10:00:00.000Z",
    origin: "NEUTRAL_INTAKE",
    stateFingerprint: stateA,
    procedimentoId: "procedimento-1",
    documentId: "document-1",
    documentVersionId: "version-1",
    changeType: "CREATED",
    legalEvidenceKind: "NONE",
    ...overrides,
  };
}

function families(input: unknown) {
  return planFascicoloReevaluation(input).items.map((item) => item.family);
}

describe("Fascicolo lifecycle change and pure planner", () => {
  it("produces the same fingerprint for the same causal state regardless of detection time", () => {
    const first = documentChange();
    const second = documentChange({ triggeredAt: "2026-09-20T12:30:00.000Z" });

    expect(fingerprintFascicoloChange(first)).toBe(fingerprintFascicoloChange(first));
    expect(fingerprintFascicoloChange(second)).toBe(fingerprintFascicoloChange(first));
  });

  it("changes the fingerprint when relevant state changes", () => {
    expect(fingerprintFascicoloChange(documentChange({ stateFingerprint: stateB })))
      .not.toBe(fingerprintFascicoloChange(documentChange()));
  });

  it("plans only document-related families when no legal evidence changed", () => {
    expect(families(documentChange())).toEqual([
      "REQUIREMENTS",
      "OBSERVATIONS",
      "TRUSTED_REVIEW_FRESHNESS",
      "REPORT_FRESHNESS",
    ]);
  });

  it("does not make a changed issue trigger indiscriminate legal research", () => {
    expect(families({
      kind: "CRITICITA_CHANGED",
      triggeredAt: "2026-09-19T10:00:00.000Z",
      origin: "USER_ACTION",
      stateFingerprint: stateA,
      criticitaId: "criticita-1",
      concessioneId: "concessione-1",
      procedimentoId: "procedimento-1",
      linkedLegalDependencyChanged: false,
    })).toEqual(["TRUSTED_REVIEW_FRESHNESS", "REPORT_FRESHNESS"]);
  });

  it("plans temporal and legal reevaluation for a changed normative source", () => {
    expect(families({
      kind: "LEGAL_SOURCE_CHANGED",
      triggeredAt: "2026-09-19T10:00:00.000Z",
      origin: "LEGAL_SOURCE_MONITOR",
      stateFingerprint: stateA,
      legalSourceId: "source-1",
      legalExpressionVersionId: "expression-2",
      linkedProcedimentoIds: ["procedimento-2", "procedimento-1"],
      changeType: "TEMPORAL_METADATA",
    })).toEqual([
      "LEGAL_APPLICABILITY",
      "TEMPORAL_ASSESSMENT",
      "TRUSTED_REVIEW_FRESHNESS",
      "REPORT_FRESHNESS",
    ]);
  });

  it("does not use a case-law decision date as the legal assessment target", () => {
    const plan = planFascicoloReevaluation({
      kind: "CASE_LAW_CHANGED",
      triggeredAt: "2026-09-19T10:00:00.000Z",
      origin: "CASE_LAW_MONITOR",
      stateFingerprint: stateA,
      legalSourceId: "decision-1",
      linkedProcedimentoIds: ["procedimento-1"],
      decisionDate: "2026-05-10T00:00:00.000Z",
      changeType: "NEW_DECISION",
      requiresFurtherResearch: false,
    });

    expect(plan.legalAssessment).toEqual({
      target: { kind: "UNDETERMINED" },
      requiresTargetResolution: true,
    });
    expect(plan.triggeredAt).toBe("2026-09-19T10:00:00.000Z");
  });

  it("plans threshold reevaluation without creating an alert or Criticita instruction", () => {
    const plan = planFascicoloReevaluation({
      kind: "TIME_THRESHOLD_REACHED",
      triggeredAt: "2026-09-19T10:00:00.000Z",
      origin: "WATCHDOG",
      stateFingerprint: stateA,
      subjectType: "REQUIREMENT",
      subjectId: "requirement-1",
      procedimentoId: "procedimento-1",
      threshold: "MISSING_DOCUMENT_DUE",
      thresholdAt: "2026-09-19T00:00:00.000Z",
    });

    expect(plan.items.map((item) => item.family)).toEqual([
      "REQUIREMENTS",
      "TRUSTED_REVIEW_FRESHNESS",
      "REPORT_FRESHNESS",
    ]);
    expect(JSON.stringify(plan)).not.toMatch(/criticita|notification|alert/i);
  });

  it("returns exactly the same immutable plan for the same input", () => {
    const first = planFascicoloReevaluation(documentChange());
    const second = planFascicoloReevaluation(documentChange());

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.items)).toBe(true);
  });

  it.each([
    null,
    {},
    documentChange({ stateFingerprint: "not-a-hash" }),
    documentChange({ triggeredAt: "not-a-date" }),
    documentChange({ unknown: true }),
    { ...documentChange(), legalAssessmentTarget: { kind: "INTERVAL", from: null, to: null } },
  ])("fails closed for invalid input", (input) => {
    expect(() => planFascicoloReevaluation(input)).toThrow(FascicoloChangeValidationError);
  });
});