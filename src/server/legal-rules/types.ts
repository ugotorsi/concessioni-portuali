export const ORCHESTRATION_DISCLAIMER =
  "Output tecnico di supporto istruttorio: non costituisce decisione amministrativa; verifica umana obbligatoria.";

export interface RuleResolutionInput {
  enteId?: string | null;
  portCode?: string;
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

export interface ApplicableRuleResult {
  id: string;
  ruleCode: string;
  title: string;
  summary: string;
  category: string;
  priority: number;
  outputSeverity: string;
  outcomeTitle: string;
  outcomeSummary: string;
  source: {
    id: string;
    sourceKey: string;
    title: string;
    sourceType: string;
    filePath: string | null;
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
  disclaimer: string;
  humanReviewRequired: true;
  evaluatedAt: string;
  totalRulesEvaluated: number;
  matchedRules: ApplicableRuleResult[];
  relatedDocumentGaps: ApplicableGapResult[];
}
