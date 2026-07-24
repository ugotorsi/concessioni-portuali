export const ORCHESTRATION_DISCLAIMER =
  "Output di supporto istruttorio: non costituisce decisione amministrativa. Verifica professionale richiesta. La valutazione dipende da completezza documentale e vigenza delle fonti.";

export type ResolutionConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export type SourceExclusionReason =
  | "NOT_CURRENT"
  | "AUTHORITY_MISMATCH"
  | "PORT_MISMATCH"
  | "PORT_AREA_MISMATCH"
  | "EFFECTIVE_FROM_FUTURE"
  | "EFFECTIVE_TO_EXPIRED"
  | "STATUS_HISTORICAL"
  | "STATUS_SUPERSEDED"
  | "STATUS_PARTIALLY_SUPERSEDED"
  | "STATUS_PENDING_VALIDITY"
  | "STATUS_DRAFT_OR_ONGOING"
  | "STATUS_CASE_SPECIFIC"
  | "STATUS_MISSING_SOURCE"
  | "NOT_CONFORMATIVE_SUPPORT";

export interface RuleResolutionInput {
  enteId?: string | null;
  referenceDate?: string;
  authorityKey?: string;
  authorityId?: string;
  portKey?: string;
  portId?: string;
  portArea?: string;
  domain?: string;
  institution?: string;
  procedureType?: string;
  titleType?: string;
  includeHistorical?: boolean;
  includePending?: boolean;
  concessionVertical?: string;
  concessionObjectType?: string;
  attivita?: string;
  awardingProcedureType?: string;
  feeRegime?: string;
  comparativeProcedureStatus?: string;
  rilevanzaArt47?: boolean;
  letteraArt47?: string;
  hasMorosita?: boolean;
  polizzaValida?: boolean;
}

export interface EvaluatedSourceResult {
  id: string;
  stableKey: string;
  title: string;
  documentType: string;
  legalRank: string | null;
  territorialScope: string | null;
  sourceNumber: string | null;
  sourceDate: string | null;
  issuingBody: string | null;
  status: string;
  role: string;
  confidence: ResolutionConfidence;
  humanReviewRequired: true;
  isConformative: boolean;
  isExtractable: boolean;
  relativePath: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  applicable: boolean;
  exclusionReasons: SourceExclusionReason[];
}

export interface PotentialConflictResult {
  code: string;
  message: string;
  sourceStableKeys: string[];
}

export interface MissingSourceResult {
  code: string;
  message: string;
  humanReviewRequired: true;
}

export interface ApplicableRuleResult {
  id: string;
  ruleId: string;
  title: string;
  summary: string;
  category: string;
  priority: number;
  outputSeverity: string;
  outcomeTitle: string;
  outcomeSummary: string;
  source: {
    id: string;
    stableKey: string;
    title: string;
    documentType: string;
    relativePath: string | null;
  };
  matchedCriteria: string[];
  disclaimer: string;
  humanReviewRequired: true;
}

export interface ApplicableGapResult {
  id: string;
  gapKey: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  requiredDocumentTypes: string[];
  linkedRuleCode: string | null;
  humanReviewRequired: true;
}

export interface RuleResolutionResult {
  applicableSources: EvaluatedSourceResult[];
  applicableRules: ApplicableRuleResult[];
  excludedByTerritory: EvaluatedSourceResult[];
  excludedByDate: EvaluatedSourceResult[];
  historicalSources: EvaluatedSourceResult[];
  supersededSources: EvaluatedSourceResult[];
  partiallySupersededSources: EvaluatedSourceResult[];
  pendingValiditySources: EvaluatedSourceResult[];
  draftOrOngoingSources: EvaluatedSourceResult[];
  caseSpecificSources: EvaluatedSourceResult[];
  potentialConflicts: PotentialConflictResult[];
  missingSources: MissingSourceResult[];
  knownGaps: ApplicableGapResult[];
  reasoningTrace: string[];
  overallConfidence: ResolutionConfidence;
  disclaimer: string;
  humanReviewRequired: true;
  professionalReviewBadge: "Verifica professionale richiesta";
  evaluatedAt: string;
  totalRulesEvaluated: number;
}
