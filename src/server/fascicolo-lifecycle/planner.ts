import {
  fingerprintFascicoloChange,
  fingerprintFascicoloTimeThresholdChangeV2,
  parseFascicoloChange,
  parseFascicoloTimeThresholdChangeV2,
  type AnyFascicoloChange,
  type FascicoloChange,
  type LegalAssessmentTarget,
} from "./change";

export const REEVALUATION_FAMILIES = [
  "REQUIREMENTS",
  "OBSERVATIONS",
  "LEGAL_APPLICABILITY",
  "TEMPORAL_ASSESSMENT",
  "TRUSTED_REVIEW_FRESHNESS",
  "CASE_LAW_REVIEW",
  "RESEARCH_GAP",
  "REPORT_FRESHNESS",
] as const;

export type ReevaluationFamily = (typeof REEVALUATION_FAMILIES)[number];

export interface FascicoloReevaluationPlanItem {
  readonly family: ReevaluationFamily;
  readonly reason: string;
}

export interface FascicoloReevaluationPlan {
  readonly changeKind: FascicoloChange["kind"];
  readonly changeFingerprint: string;
  readonly triggeredAt: string;
  readonly legalAssessment: {
    readonly target: LegalAssessmentTarget;
    readonly requiresTargetResolution: boolean;
  };
  readonly linkedProcedimentoIds: readonly string[];
  readonly items: readonly FascicoloReevaluationPlanItem[];
}

const familyOrder = new Map(REEVALUATION_FAMILIES.map((family, index) => [family, index]));

function add(
  items: Map<ReevaluationFamily, FascicoloReevaluationPlanItem>,
  family: ReevaluationFamily,
  reason: string,
): void {
  if (!items.has(family)) items.set(family, { family, reason });
}

function linkedProcedimentoIds(change: AnyFascicoloChange): readonly string[] {
  switch (change.kind) {
    case "DOCUMENT_CHANGED":
    case "FASCICOLO_DATA_CHANGED":
    case "REQUIREMENT_EVIDENCE_CHANGED":
      return [change.procedimentoId];
    case "CONCESSIONE_CHANGED":
    case "LEGAL_SOURCE_CHANGED":
    case "CASE_LAW_CHANGED":
      return change.linkedProcedimentoIds;
    case "CRITICITA_CHANGED":
    case "TIME_THRESHOLD_REACHED":
      return change.procedimentoId === null ? [] : [change.procedimentoId];
  }
}

function planItems(change: AnyFascicoloChange): readonly FascicoloReevaluationPlanItem[] {
  const items = new Map<ReevaluationFamily, FascicoloReevaluationPlanItem>();
  const includeDerivedFascicoloOutputs = () => {
    add(items, "TRUSTED_REVIEW_FRESHNESS", "The authoritative fascicolo state may have changed.");
    add(items, "REPORT_FRESHNESS", "Existing reports may depend on the changed fascicolo state.");
  };

  switch (change.kind) {
    case "DOCUMENT_CHANGED":
      add(items, "REQUIREMENTS", "Document presence, version, metadata, or archive state changed.");
      add(items, "OBSERVATIONS", "Document-derived observations may have changed.");
      includeDerivedFascicoloOutputs();
      if (change.legalEvidenceKind === "LEGAL_SOURCE") {
        add(items, "LEGAL_APPLICABILITY", "The document contains changed normative evidence.");
        add(items, "TEMPORAL_ASSESSMENT", "Normative evidence requires a legal-time assessment.");
      } else if (change.legalEvidenceKind === "CASE_LAW") {
        add(items, "CASE_LAW_REVIEW", "The document contains changed case-law evidence.");
        add(items, "TEMPORAL_ASSESSMENT", "Case-law evidence requires temporal classification.");
      } else if (change.legalEvidenceKind === "UNRESOLVED") {
        add(items, "RESEARCH_GAP", "The document contains unresolved legal evidence.");
      }
      break;
    case "FASCICOLO_DATA_CHANGED":
      includeDerivedFascicoloOutputs();
      if (change.changedArea === "LEGAL_FACTS") {
        add(items, "LEGAL_APPLICABILITY", "Legally relevant fascicolo facts changed.");
        add(items, "TEMPORAL_ASSESSMENT", "The legal assessment target may need resolution.");
      } else if (change.changedArea === "DOCUMENT_CONTEXT") {
        add(items, "REQUIREMENTS", "Document requirement context changed.");
        add(items, "OBSERVATIONS", "Document observation context changed.");
      }
      break;
    case "CONCESSIONE_CHANGED":
      includeDerivedFascicoloOutputs();
      if (change.affectsRequirementScreening) {
        add(items, "REQUIREMENTS", "Concession facts used by requirement screening changed.");
      }
      if (change.affectsLegalContext) {
        add(items, "LEGAL_APPLICABILITY", "Concession facts used by legal applicability changed.");
        add(items, "TEMPORAL_ASSESSMENT", "Concession legal-time facts may have changed.");
      }
      break;
    case "CRITICITA_CHANGED":
      includeDerivedFascicoloOutputs();
      if (change.linkedLegalDependencyChanged) {
        add(items, "LEGAL_APPLICABILITY", "A linked legal dependency of the issue changed.");
      }
      break;
    case "REQUIREMENT_EVIDENCE_CHANGED":
      add(items, "REQUIREMENTS", "Requirement or supporting evidence state changed.");
      includeDerivedFascicoloOutputs();
      break;
    case "LEGAL_SOURCE_CHANGED":
      add(items, "LEGAL_APPLICABILITY", "A linked legal source changed.");
      add(items, "TEMPORAL_ASSESSMENT", "The source version or temporal metadata may have changed.");
      includeDerivedFascicoloOutputs();
      break;
    case "CASE_LAW_CHANGED":
      add(items, "CASE_LAW_REVIEW", "Linked case law changed.");
      add(items, "TEMPORAL_ASSESSMENT", "Decision date does not determine the legal assessment target.");
      includeDerivedFascicoloOutputs();
      if (change.requiresFurtherResearch) {
        add(items, "RESEARCH_GAP", "The case-law change leaves a qualified research gap.");
      }
      break;
    case "TIME_THRESHOLD_REACHED":
      if (change.threshold === "MISSING_DOCUMENT_DUE") {
        add(items, "REQUIREMENTS", "A document requirement time threshold was reached.");
      } else if (
        change.threshold === "DEADLINE_DUE"
        || change.threshold === "DEADLINE_OVERDUE"
        || change.threshold === "NEXT_REVIEW_DUE"
      ) {
        add(items, "OBSERVATIONS", "An operational time threshold was reached.");
      }
      includeDerivedFascicoloOutputs();
      break;
  }

  return [...items.values()].sort(
    (left, right) => familyOrder.get(left.family)! - familyOrder.get(right.family)!,
  );
}

export function planFascicoloReevaluation(input: unknown): FascicoloReevaluationPlan {
  const change = parseFascicoloChange(input);
  const items = planItems(change);
  const requiresTargetResolution = items.some((item) => item.family === "TEMPORAL_ASSESSMENT")
    && change.legalAssessmentTarget.kind === "UNDETERMINED";

  return Object.freeze({
    changeKind: change.kind,
    changeFingerprint: fingerprintFascicoloChange(change),
    triggeredAt: change.triggeredAt,
    legalAssessment: Object.freeze({
      target: change.legalAssessmentTarget,
      requiresTargetResolution,
    }),
    linkedProcedimentoIds: Object.freeze([...linkedProcedimentoIds(change)]),
    items: Object.freeze(items.map((item) => Object.freeze(item))),
  });
}

export function planFascicoloReevaluationV2(input: unknown): FascicoloReevaluationPlan {
  const change = parseFascicoloTimeThresholdChangeV2(input);
  const items = planItems(change);
  const requiresTargetResolution = items.some((item) => item.family === "TEMPORAL_ASSESSMENT")
    && change.legalAssessmentTarget.kind === "UNDETERMINED";

  return Object.freeze({
    changeKind: change.kind,
    changeFingerprint: fingerprintFascicoloTimeThresholdChangeV2(change),
    triggeredAt: change.triggeredAt,
    legalAssessment: Object.freeze({
      target: change.legalAssessmentTarget,
      requiresTargetResolution,
    }),
    linkedProcedimentoIds: Object.freeze([...linkedProcedimentoIds(change)]),
    items: Object.freeze(items.map((item) => Object.freeze(item))),
  });
}