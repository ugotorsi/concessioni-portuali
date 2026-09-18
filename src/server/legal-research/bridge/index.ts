import { createHash } from "node:crypto";

import {
  citationObservationIdentity,
  type CitationObservation,
} from "@/server/legal-reasoning/authority-treatment";

export const RESEARCH_BRIDGE_VERSION = "RESEARCH_BRIDGE_V1" as const;

export type ResearchMode =
  | "DISCOVER_AUTHORITIES"
  | "SUPPORT_SEARCH"
  | "ADVERSE_SEARCH"
  | "DISTINGUISHING_SEARCH"
  | "CROSS_JURISDICTION_CHECK"
  | "CITATION_EXPANSION"
  | "SUBSEQUENT_TREATMENT_SEARCH"
  | "EXACT_SOURCE_RECOVERY"
  | "LEGAL_GAP_ANALYSIS"
  | "FACT_INVESTIGATION_SUGGESTION"
  | "STRATEGY_RESEARCH";

export type ResearchCapability =
  | "SEMANTIC_DISCOVERY"
  | "KEYWORD_DISCOVERY"
  | "EXACT_RETRIEVAL"
  | "FULL_TEXT_RETRIEVAL"
  | "CITATION_NETWORK"
  | "CROSS_JURISDICTION_DISCOVERY"
  | "ADVERSE_AUTHORITY_DISCOVERY";

export type ResearchSourceFamily =
  | "ITALIAN_LEGISLATION"
  | "EU_LEGISLATION"
  | "CASSAZIONE"
  | "CORTE_COSTITUZIONALE"
  | "GIURISPRUDENZA_DI_MERITO"
  | "GIUSTIZIA_AMMINISTRATIVA"
  | "CJEU"
  | "CNF"
  | "ECHR"
  | "OTHER";

export type ResearchMissionStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "BUDGET_EXHAUSTED"
  | "DEFERRED"
  | "REJECTED";

export type ResearchCaseReference = Readonly<{
  caseId: string;
  fascicoloReference?: string;
}>;

export type ResearchAuthorityReference = Readonly<{
  authorityReferenceId: string;
  citation?: string;
  officialIdentifier?: string;
}>;

export type ResearchOutputRequirements = Readonly<{
  authorityCandidates: boolean;
  citationObservations: boolean;
  legalResearchSuggestions: boolean;
  evidenceGaps: boolean;
  fullTextRequired: boolean;
}>;

export type ResearchBudget = Readonly<{
  maxTotalResearchCalls: number;
  maxMoonlitCalls: number;
  maxSimpliciterCalls: number;
  maxLegalDataHunterCalls: number;
}>;

export type ResearchExecutionPlan = Readonly<{
  requiredCapabilities: readonly ResearchCapability[];
  preferredToolIds?: readonly string[];
}>;

export type ResearchMissionInput = Readonly<{
  kind: "RESEARCH_MISSION";
  version: typeof RESEARCH_BRIDGE_VERSION;
  caseReference: ResearchCaseReference;
  legalIssueIds: readonly string[];
  legalPropositionIds: readonly string[];
  conclusionIds?: readonly string[];
  referenceDate: string;
  mode: ResearchMode;
  researchQuestion: string;
  knownAuthorities: readonly ResearchAuthorityReference[];
  excludedAuthorities: readonly ResearchAuthorityReference[];
  preferredSourceFamilies: readonly ResearchSourceFamily[];
  missingSourceFamilies: readonly ResearchSourceFamily[];
  knownCounterArguments: readonly string[];
  knownEvidenceGaps: readonly ResearchGap[];
  requiredOutput: ResearchOutputRequirements;
  budget: ResearchBudget;
  status: ResearchMissionStatus;
  executionPlan?: ResearchExecutionPlan;
}>;

export type ResearchMission = ResearchMissionInput & Readonly<{ missionId: string }>;

export type ResearchGapKind =
  | "NO_ADVERSE_AUTHORITY_CHECK"
  | "NO_CASSATION_CHECK"
  | "NO_EU_CHECK"
  | "FULL_TEXT_NOT_VERIFIED"
  | "OFFICIAL_IDENTITY_NOT_VERIFIED"
  | "TEMPORAL_VALIDITY_NOT_RESOLVED"
  | "OPEN_COUNTERARGUMENT"
  | "INSUFFICIENT_SOURCE_FAMILY_DIVERSITY"
  | "MISSING_FACT_EVIDENCE"
  | "MISSING_DOCUMENT"
  | "UNRESOLVED_AUTHORITY_TREATMENT";

export type ResearchGap = Readonly<{
  gapId: string;
  kind: ResearchGapKind;
  targetId?: string;
  sourceFamily?: ResearchSourceFamily;
}>;

export type NextResearchAction = Readonly<{
  gapId: string;
  mode: ResearchMode;
  targetId?: string;
  sourceFamilies: readonly ResearchSourceFamily[];
}>;

export type ResearchToolRole =
  | "LEGAL_RESEARCH_STRATEGIST"
  | "CITATION_AUTHORITY_INTELLIGENCE"
  | "BROAD_DISCOVERY"
  | "OTHER";

export type ResearchOperationType =
  | "SEMANTIC_SEARCH"
  | "KEYWORD_SEARCH"
  | "EXACT_RETRIEVAL"
  | "FULL_TEXT_RETRIEVAL"
  | "CITATION_SEARCH"
  | "CROSS_JURISDICTION_SEARCH"
  | "ADVERSE_AUTHORITY_SEARCH";

export type ResearchToolExecution = Readonly<{
  executionRecordId: string;
  toolId: string;
  providerId?: string;
  role: ResearchToolRole;
  operationType: ResearchOperationType;
  researchQuery: string;
  sourceFamiliesRequested: readonly ResearchSourceFamily[];
  resultIdentifiersUsed: readonly string[];
  resultCount: number;
  callsConsumed: number;
  errorState?: Readonly<{ code: string; retryable: boolean }>;
}>;

export type AuthoritySupportDirection = "SUPPORT" | "AGAINST" | "QUALIFIES" | "UNKNOWN";
export type CandidateVerificationState =
  | "OFFICIAL_VERIFICATION_REQUIRED"
  | "OFFICIAL_VERIFICATION_PENDING"
  | "OFFICIAL_VERIFICATION_FAILED";

export type AuthorityCandidateInput = Readonly<{
  kind: "AUTHORITY_CANDIDATE";
  executionRecordId: string;
  toolId: string;
  providerId?: string;
  courtOrBody?: string;
  documentType?: string;
  number?: string;
  year?: number;
  documentDate?: string;
  ecli?: string;
  celex?: string;
  officialIdentifier?: string;
  title?: string;
  sourceUrl?: string;
  providerDocumentId?: string;
  relevantPassage?: string;
  summary?: string;
  legalPropositionId?: string;
  supportDirection: AuthoritySupportDirection;
  sourceFamily: ResearchSourceFamily;
  retrievalMethod: ResearchOperationType;
  fullTextAvailable: boolean;
  verificationState: CandidateVerificationState;
}>;

export type AuthorityCandidate = AuthorityCandidateInput & Readonly<{ candidateId: string }>;

export type LegalResearchSuggestionKind =
  | "MISSING_LEGAL_PROPOSITION"
  | "MISSING_FACTUAL_EVIDENCE"
  | "MISSING_ADMINISTRATIVE_DOCUMENT"
  | "MISSING_SOURCE_FAMILY"
  | "ALTERNATIVE_LEGAL_QUALIFICATION"
  | "POSSIBLE_COUNTERARGUMENT"
  | "HUMAN_LEGAL_JUDGMENT_QUESTION";

export type LegalResearchSuggestion = Readonly<{
  suggestionId: string;
  kind: LegalResearchSuggestionKind;
  targetId?: string;
  description: string;
}>;

export type HumanDecisionReason =
  | "PROCEDURAL_STRATEGY_CHOICE"
  | "CONFLICTING_HIGH_AUTHORITY_SOURCES"
  | "INSUFFICIENT_FACTUAL_RECORD"
  | "IRREVERSIBLE_ACTION"
  | "UNRESOLVED_LEGAL_CONFLICT"
  | "PROFESSIONAL_JUDGMENT_REQUIRED";

export type HumanDecisionEscalation = Readonly<{
  escalationId: string;
  reason: HumanDecisionReason;
  relatedSuggestionIds: readonly string[];
  question?: string;
  state: "HUMAN_DECISION_REQUIRED";
}>;

export type SuggestedFollowUpMission = Readonly<{
  suggestionId: string;
  parentMissionId: string;
  mode: ResearchMode;
  legalIssueIds: readonly string[];
  legalPropositionIds: readonly string[];
  sourceFamilies: readonly ResearchSourceFamily[];
  originatingGapIds: readonly string[];
}>;

export type ResearchCompletionState =
  | "COMPLETE"
  | "PARTIAL"
  | "BUDGET_EXHAUSTED"
  | "FAILED"
  | "HUMAN_DECISION_REQUIRED";

export type ResearchEvidenceBundle = Readonly<{
  kind: "RESEARCH_EVIDENCE_BUNDLE";
  version: typeof RESEARCH_BRIDGE_VERSION;
  missionId: string;
  executionId: string;
  startedAt?: string;
  completedAt?: string;
  researchToolExecutions: readonly ResearchToolExecution[];
  authorityCandidates: readonly AuthorityCandidate[];
  citationObservations: readonly CitationObservation[];
  legalResearchSuggestions: readonly LegalResearchSuggestion[];
  evidenceGaps: readonly ResearchGap[];
  conflicts: readonly string[];
  unresolvedQuestions: readonly string[];
  suggestedFollowUpMissions: readonly SuggestedFollowUpMission[];
  humanDecisionEscalations: readonly HumanDecisionEscalation[];
  completionState: ResearchCompletionState;
}>;

export type ResearchBridgeValidationErrorCode =
  | "BUDGET_EXCEEDED"
  | "BUDGET_EXHAUSTION_NOT_DECLARED"
  | "CANDIDATE_IDENTITY_INSUFFICIENT"
  | "CANDIDATE_IDENTITY_MISMATCH"
  | "CANONICAL_AUTHORITY_FIELD_FORBIDDEN"
  | "CITATION_IDENTITY_MISMATCH"
  | "CITATION_SHAPE_INVALID"
  | "CREDENTIAL_FIELD_FORBIDDEN"
  | "DUPLICATE_AUTHORITY_REFERENCE"
  | "DUPLICATE_CANDIDATE_ID"
  | "DUPLICATE_CITATION_OBSERVATION"
  | "DUPLICATE_ENTITY_ID"
  | "DUPLICATE_VALUE"
  | "EXECUTION_PROVENANCE_INVALID"
  | "FOLLOW_UP_MISSION_MISMATCH"
  | "HUMAN_ESCALATION_INVALID"
  | "INVALID_BUDGET"
  | "INVALID_CASE_REFERENCE"
  | "INVALID_DATE"
  | "INVALID_ID"
  | "INVALID_MISSION_REFERENCE"
  | "INVALID_RESEARCH_QUESTION"
  | "PROFILE_FIELD_FORBIDDEN"
  | "UNKNOWN_EXECUTION_REFERENCE";

export type ResearchBridgeValidationError = Readonly<{
  code: ResearchBridgeValidationErrorCode;
  path: string;
  entityId?: string;
  referencedId?: string;
}>;

const credentialFieldNames = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "bearer",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "oauthtoken",
  "oauthtokens",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "token",
]);
const canonicalCandidateFields = new Set([
  "canonicalKey",
  "legalExpressionVersionId",
  "legalSourceId",
  "temporalAssessment",
]);
const profileFieldNames = new Set([
  "accountprofile",
  "clientprofile",
  "inferredattribute",
  "inferredattributes",
  "personalprofile",
  "profileattribute",
  "profileattributes",
  "restrictedinference",
  "sensitiveinference",
  "userprofile",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function deterministicIdentity(prefix: string, value: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
  return `${prefix}:${digest}`;
}

function validId(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256;
}

function validDate(value: string | undefined): value is string {
  return validId(value) && !Number.isNaN(Date.parse(value));
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function unsafePaths(
  value: unknown,
  basePath = "",
): Array<{ path: string; kind: "CANONICAL" | "CREDENTIAL" | "PROFILE" }> {
  if (!value || typeof value !== "object") return [];
  const output: Array<{ path: string; kind: "CANONICAL" | "CREDENTIAL" | "PROFILE" }> = [];
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const path = basePath ? `${basePath}.${key}` : key;
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (credentialFieldNames.has(normalizedKey)) output.push({ path, kind: "CREDENTIAL" });
    if (profileFieldNames.has(normalizedKey)) output.push({ path, kind: "PROFILE" });
    if (basePath.startsWith("authorityCandidates") && canonicalCandidateFields.has(key)) {
      output.push({ path, kind: "CANONICAL" });
    }
    output.push(...unsafePaths(item, path));
  }
  return output;
}

function error(
  code: ResearchBridgeValidationErrorCode,
  path: string,
  entityId?: string,
  referencedId?: string,
): ResearchBridgeValidationError {
  return {
    code,
    path,
    ...(entityId ? { entityId } : {}),
    ...(referencedId ? { referencedId } : {}),
  };
}

function sortErrors(errors: ResearchBridgeValidationError[]): readonly ResearchBridgeValidationError[] {
  return errors.sort((left, right) => {
    const leftKey = `${left.path}\u0000${left.code}\u0000${left.entityId ?? ""}\u0000${left.referencedId ?? ""}`;
    const rightKey = `${right.path}\u0000${right.code}\u0000${right.entityId ?? ""}\u0000${right.referencedId ?? ""}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

export function researchMissionIdentity(input: ResearchMissionInput): string {
  const { status: _status, ...identityInput } = input;
  return deterministicIdentity("research-mission", identityInput);
}

export function createResearchMission(input: ResearchMissionInput): ResearchMission {
  return { ...input, missionId: researchMissionIdentity(input) };
}

export function authorityCandidateIdentity(input: AuthorityCandidateInput): string {
  return deterministicIdentity("authority-candidate", input);
}

export function createAuthorityCandidate(input: AuthorityCandidateInput): AuthorityCandidate {
  return { ...input, candidateId: authorityCandidateIdentity(input) };
}

function candidateInput(candidate: AuthorityCandidate): AuthorityCandidateInput {
  const { candidateId: _candidateId, ...input } = candidate;
  return input;
}

function missionInput(mission: ResearchMission): ResearchMissionInput {
  const { missionId: _missionId, ...input } = mission;
  return input;
}

export function validateResearchMission(mission: ResearchMission): readonly ResearchBridgeValidationError[] {
  const errors: ResearchBridgeValidationError[] = [];
  if (!validId(mission.missionId) || mission.missionId !== researchMissionIdentity(missionInput(mission))) {
    errors.push(error("INVALID_ID", "missionId", mission.missionId));
  }
  if (!validId(mission.caseReference.caseId)
    || (mission.caseReference.fascicoloReference !== undefined
      && !validId(mission.caseReference.fascicoloReference))) {
    errors.push(error("INVALID_CASE_REFERENCE", "caseReference", mission.missionId));
  }
  if (!validDate(mission.referenceDate)) {
    errors.push(error("INVALID_DATE", "referenceDate", mission.missionId));
  }
  if (!mission.researchQuestion.trim()) {
    errors.push(error("INVALID_RESEARCH_QUESTION", "researchQuestion", mission.missionId));
  }
  const idLists: Array<[string, readonly string[]]> = [
    ["legalIssueIds", mission.legalIssueIds],
    ["legalPropositionIds", mission.legalPropositionIds],
    ["conclusionIds", mission.conclusionIds ?? []],
  ];
  for (const [path, values] of idLists) {
    if (values.some((value) => !validId(value))) errors.push(error("INVALID_ID", path, mission.missionId));
    for (const duplicate of duplicateValues(values)) {
      errors.push(error("DUPLICATE_VALUE", path, mission.missionId, duplicate));
    }
  }
  if (mission.knownEvidenceGaps.some((gap) => !validId(gap.gapId))) {
    errors.push(error("INVALID_ID", "knownEvidenceGaps", mission.missionId));
  }
  for (const duplicate of duplicateValues(mission.knownEvidenceGaps.map((gap) => gap.gapId))) {
    errors.push(error("DUPLICATE_ENTITY_ID", "knownEvidenceGaps", mission.missionId, duplicate));
  }
  const knownIds = mission.knownAuthorities.map((item) => item.authorityReferenceId);
  const excludedIds = mission.excludedAuthorities.map((item) => item.authorityReferenceId);
  if ([...knownIds, ...excludedIds].some((id) => !validId(id))) {
    errors.push(error("INVALID_ID", "knownAuthorities,excludedAuthorities", mission.missionId));
  }
  for (const duplicate of duplicateValues(knownIds)) {
    errors.push(error("DUPLICATE_AUTHORITY_REFERENCE", "knownAuthorities", mission.missionId, duplicate));
  }
  for (const duplicate of duplicateValues(excludedIds)) {
    errors.push(error("DUPLICATE_AUTHORITY_REFERENCE", "excludedAuthorities", mission.missionId, duplicate));
  }
  for (const conflict of knownIds.filter((id) => excludedIds.includes(id))) {
    errors.push(error("DUPLICATE_AUTHORITY_REFERENCE", "knownAuthorities,excludedAuthorities", mission.missionId, conflict));
  }
  const budgets = Object.values(mission.budget);
  if (budgets.some((value) => !Number.isInteger(value) || value < 0)
    || mission.budget.maxMoonlitCalls > mission.budget.maxTotalResearchCalls
    || mission.budget.maxSimpliciterCalls > mission.budget.maxTotalResearchCalls
    || mission.budget.maxLegalDataHunterCalls > mission.budget.maxTotalResearchCalls) {
    errors.push(error("INVALID_BUDGET", "budget", mission.missionId));
  }
  for (const unsafe of unsafePaths(mission)) {
    errors.push(error(
      unsafe.kind === "PROFILE" ? "PROFILE_FIELD_FORBIDDEN" : "CREDENTIAL_FIELD_FORBIDDEN",
      unsafe.path,
      mission.missionId,
    ));
  }
  return sortErrors(errors);
}

export type ResearchBudgetState = Readonly<{
  totalCalls: number;
  moonlitCalls: number;
  simpliciterCalls: number;
  legalDataHunterCalls: number;
  exhausted: boolean;
  exceeded: boolean;
}>;

export function assessResearchBudget(
  budget: ResearchBudget,
  executions: readonly ResearchToolExecution[],
): ResearchBudgetState {
  const calls = (toolId: string) => executions
    .filter((execution) => execution.toolId.trim().toUpperCase() === toolId)
    .reduce((sum, execution) => sum + execution.callsConsumed, 0);
  const totalCalls = executions.reduce((sum, execution) => sum + execution.callsConsumed, 0);
  const moonlitCalls = calls("MOONLIT");
  const simpliciterCalls = calls("SIMPLICITER");
  const legalDataHunterCalls = calls("LEGAL_DATA_HUNTER");
  const values: Array<[number, number]> = [
    [totalCalls, budget.maxTotalResearchCalls],
    [moonlitCalls, budget.maxMoonlitCalls],
    [simpliciterCalls, budget.maxSimpliciterCalls],
    [legalDataHunterCalls, budget.maxLegalDataHunterCalls],
  ];
  return {
    totalCalls,
    moonlitCalls,
    simpliciterCalls,
    legalDataHunterCalls,
    exhausted: values.some(([used, maximum]) => used >= maximum),
    exceeded: values.some(([used, maximum]) => used > maximum),
  };
}

const nextModes: Readonly<Record<ResearchGapKind, readonly ResearchMode[]>> = {
  NO_ADVERSE_AUTHORITY_CHECK: ["ADVERSE_SEARCH"],
  NO_CASSATION_CHECK: ["DISCOVER_AUTHORITIES"],
  NO_EU_CHECK: ["CROSS_JURISDICTION_CHECK"],
  FULL_TEXT_NOT_VERIFIED: ["EXACT_SOURCE_RECOVERY"],
  OFFICIAL_IDENTITY_NOT_VERIFIED: ["EXACT_SOURCE_RECOVERY"],
  TEMPORAL_VALIDITY_NOT_RESOLVED: ["SUBSEQUENT_TREATMENT_SEARCH"],
  OPEN_COUNTERARGUMENT: ["ADVERSE_SEARCH"],
  INSUFFICIENT_SOURCE_FAMILY_DIVERSITY: ["DISCOVER_AUTHORITIES"],
  MISSING_FACT_EVIDENCE: ["FACT_INVESTIGATION_SUGGESTION"],
  MISSING_DOCUMENT: ["FACT_INVESTIGATION_SUGGESTION"],
  UNRESOLVED_AUTHORITY_TREATMENT: ["CITATION_EXPANSION", "SUBSEQUENT_TREATMENT_SEARCH"],
};

export function suggestNextResearchActions(gaps: readonly ResearchGap[]): readonly NextResearchAction[] {
  return gaps.flatMap((gap) => nextModes[gap.kind].map((mode) => ({
    gapId: gap.gapId,
    mode,
    ...(gap.targetId ? { targetId: gap.targetId } : {}),
    sourceFamilies: gap.sourceFamily ? [gap.sourceFamily] : [],
  }))).sort((left, right) => {
    const leftKey = `${left.gapId}\u0000${left.mode}`;
    const rightKey = `${right.gapId}\u0000${right.mode}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function validCandidateIdentity(candidate: AuthorityCandidate): boolean {
  return Boolean(
    candidate.ecli?.trim()
    || candidate.celex?.trim()
    || candidate.officialIdentifier?.trim()
    || candidate.providerDocumentId?.trim()
    || (candidate.courtOrBody?.trim() && candidate.documentType?.trim()
      && candidate.number?.trim() && Number.isInteger(candidate.year)),
  );
}

function validCitationObservation(observation: CitationObservation): boolean {
  const locator = observation.provenance.locator;
  const validLocator = !locator || (
    (locator.page === undefined || (Number.isInteger(locator.page) && locator.page >= 1))
    && (locator.span === undefined || (
      Number.isInteger(locator.span.start)
      && Number.isInteger(locator.span.end)
      && locator.span.start >= 0
      && locator.span.end >= locator.span.start
    ))
  );
  return observation.kind === "CITATION_OBSERVATION"
    && observation.relation === "CITES"
    && validId(observation.sourceAuthorityId)
    && validId(observation.targetAuthorityId)
    && observation.sourceAuthorityId !== observation.targetAuthorityId
    && validId(observation.provenance.evidenceSourceId)
    && validLocator;
}

function validateEntityIds(
  errors: ResearchBridgeValidationError[],
  path: string,
  values: readonly Readonly<{ id: string }>[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!validId(value.id)) errors.push(error("INVALID_ID", path, value.id));
    if (seen.has(value.id)) errors.push(error("DUPLICATE_ENTITY_ID", path, value.id));
    seen.add(value.id);
  }
}

export function validateResearchEvidenceBundle(
  mission: ResearchMission,
  bundle: ResearchEvidenceBundle,
): readonly ResearchBridgeValidationError[] {
  const errors: ResearchBridgeValidationError[] = [];
  if (!validId(bundle.executionId)) errors.push(error("INVALID_ID", "executionId", bundle.executionId));
  if (bundle.missionId !== mission.missionId) {
    errors.push(error("INVALID_MISSION_REFERENCE", "missionId", bundle.executionId, bundle.missionId));
  }
  if (bundle.startedAt !== undefined && !validDate(bundle.startedAt)) {
    errors.push(error("INVALID_DATE", "startedAt", bundle.executionId));
  }
  if (bundle.completedAt !== undefined && !validDate(bundle.completedAt)) {
    errors.push(error("INVALID_DATE", "completedAt", bundle.executionId));
  }
  const executionIds = new Set<string>();
  for (const execution of bundle.researchToolExecutions) {
    if (!validId(execution.executionRecordId) || !validId(execution.toolId)
      || !execution.researchQuery.trim() || !Number.isInteger(execution.resultCount)
      || execution.resultCount < 0 || !Number.isInteger(execution.callsConsumed)
      || execution.callsConsumed < 0) {
      errors.push(error("EXECUTION_PROVENANCE_INVALID", "researchToolExecutions", execution.executionRecordId));
    }
    if (executionIds.has(execution.executionRecordId)) {
      errors.push(error("DUPLICATE_ENTITY_ID", "researchToolExecutions", execution.executionRecordId));
    }
    executionIds.add(execution.executionRecordId);
  }
  const candidateIds = new Set<string>();
  for (const candidate of bundle.authorityCandidates) {
    if (candidateIds.has(candidate.candidateId)) {
      errors.push(error("DUPLICATE_CANDIDATE_ID", "authorityCandidates", candidate.candidateId));
    }
    candidateIds.add(candidate.candidateId);
    if (candidate.candidateId !== authorityCandidateIdentity(candidateInput(candidate))) {
      errors.push(error("CANDIDATE_IDENTITY_MISMATCH", "authorityCandidates.candidateId", candidate.candidateId));
    }
    if (!validCandidateIdentity(candidate)) {
      errors.push(error("CANDIDATE_IDENTITY_INSUFFICIENT", "authorityCandidates", candidate.candidateId));
    }
    if (!executionIds.has(candidate.executionRecordId)) {
      errors.push(error("UNKNOWN_EXECUTION_REFERENCE", "authorityCandidates.executionRecordId", candidate.candidateId, candidate.executionRecordId));
    }
  }
  const observationIds = new Set<string>();
  for (const observation of bundle.citationObservations) {
    if (observationIds.has(observation.id)) {
      errors.push(error("DUPLICATE_CITATION_OBSERVATION", "citationObservations", observation.id));
    }
    observationIds.add(observation.id);
    const { id: _id, ...input } = observation;
    if (observation.id !== citationObservationIdentity(input)) {
      errors.push(error("CITATION_IDENTITY_MISMATCH", "citationObservations.id", observation.id));
    }
    if (!validCitationObservation(observation)) {
      errors.push(error("CITATION_SHAPE_INVALID", "citationObservations", observation.id));
    }
  }
  validateEntityIds(errors, "evidenceGaps", bundle.evidenceGaps.map((item) => ({ id: item.gapId })));
  validateEntityIds(errors, "legalResearchSuggestions", bundle.legalResearchSuggestions
    .map((item) => ({ id: item.suggestionId })));
  validateEntityIds(errors, "suggestedFollowUpMissions", bundle.suggestedFollowUpMissions
    .map((item) => ({ id: item.suggestionId })));
  validateEntityIds(errors, "humanDecisionEscalations", bundle.humanDecisionEscalations
    .map((item) => ({ id: item.escalationId })));
  const suggestionIds = new Set(bundle.legalResearchSuggestions.map((item) => item.suggestionId));
  for (const escalation of bundle.humanDecisionEscalations) {
    if (escalation.state !== "HUMAN_DECISION_REQUIRED"
      || escalation.relatedSuggestionIds.some((id) => !suggestionIds.has(id))) {
      errors.push(error("HUMAN_ESCALATION_INVALID", "humanDecisionEscalations", escalation.escalationId));
    }
  }
  for (const followUp of bundle.suggestedFollowUpMissions) {
    if (followUp.parentMissionId !== mission.missionId
      || followUp.originatingGapIds.some((id) => !bundle.evidenceGaps.some((gap) => gap.gapId === id))) {
      errors.push(error("FOLLOW_UP_MISSION_MISMATCH", "suggestedFollowUpMissions", followUp.suggestionId));
    }
  }
  const budgetState = assessResearchBudget(mission.budget, bundle.researchToolExecutions);
  if (budgetState.exceeded) errors.push(error("BUDGET_EXCEEDED", "researchToolExecutions", bundle.executionId));
  if (budgetState.exhausted && bundle.completionState !== "BUDGET_EXHAUSTED") {
    errors.push(error("BUDGET_EXHAUSTION_NOT_DECLARED", "completionState", bundle.executionId));
  }
  for (const unsafe of unsafePaths(bundle)) {
    errors.push(error(
      unsafe.kind === "CANONICAL"
        ? "CANONICAL_AUTHORITY_FIELD_FORBIDDEN"
        : unsafe.kind === "PROFILE"
          ? "PROFILE_FIELD_FORBIDDEN"
          : "CREDENTIAL_FIELD_FORBIDDEN",
      unsafe.path,
      bundle.executionId,
    ));
  }
  return sortErrors(errors);
}

export type ResearchMissionDisposition = Readonly<{
  missionId: string;
  status: "DEFERRED" | "REJECTED";
  reasonCode: string;
}>;

export interface ResearchBridgeApplicationService {
  getPendingResearchMissions(): Promise<readonly ResearchMission[]>;
  getResearchMission(missionId: string): Promise<ResearchMission | null>;
  submitResearchEvidenceBundle(bundle: ResearchEvidenceBundle): Promise<void>;
  rejectOrDeferResearchMission(disposition: ResearchMissionDisposition): Promise<void>;
}

export const FUTURE_MCP_RESEARCH_TOOL_MAPPING = Object.freeze({
  get_pending_research_missions: "getPendingResearchMissions",
  get_research_mission: "getResearchMission",
  submit_research_evidence_bundle: "submitResearchEvidenceBundle",
  reject_or_defer_research_mission: "rejectOrDeferResearchMission",
} as const);

export const CONFIRMED_RESEARCH_TOOL_ROLES = Object.freeze({
  SIMPLICITER: {
    role: "LEGAL_RESEARCH_STRATEGIST",
    capabilities: ["SEMANTIC_DISCOVERY", "EXACT_RETRIEVAL", "CROSS_JURISDICTION_DISCOVERY"],
    sourceFamilies: [
      "ITALIAN_LEGISLATION",
      "EU_LEGISLATION",
      "CASSAZIONE",
      "CORTE_COSTITUZIONALE",
      "GIURISPRUDENZA_DI_MERITO",
      "GIUSTIZIA_AMMINISTRATIVA",
      "CJEU",
      "CNF",
      "ECHR",
    ],
  },
  MOONLIT: {
    role: "CITATION_AUTHORITY_INTELLIGENCE",
    capabilities: ["SEMANTIC_DISCOVERY", "KEYWORD_DISCOVERY", "FULL_TEXT_RETRIEVAL", "CITATION_NETWORK"],
  },
  LEGAL_DATA_HUNTER: {
    role: "BROAD_DISCOVERY",
    capabilities: ["SEMANTIC_DISCOVERY", "KEYWORD_DISCOVERY"],
  },
} as const satisfies Readonly<Record<string, Readonly<{
  role: ResearchToolRole;
  capabilities: readonly ResearchCapability[];
  sourceFamilies?: readonly ResearchSourceFamily[];
}>>>);