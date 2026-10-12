import { createHash } from "node:crypto";

import {
  RESEARCH_BRIDGE_VERSION,
  createResearchMission,
  validateResearchMission,
  type ResearchMission,
} from "./bridge";
import type { ResearchServiceActor } from "./persistence";

export const LIVE_ACCEPTANCE_CASE_REFERENCE = "ACCEPTANCE_TEST_LEGAL_RESEARCH_V1" as const;
export const LIVE_ACCEPTANCE_RESEARCH_MODE = "CROSS_JURISDICTION_CHECK" as const;
export const LIVE_ACCEPTANCE_QUESTION =
  "In materia di concessioni demaniali o portuali, quali principi regolano la necessità di una procedura comparativa quando vi siano più soggetti interessati al rilascio, rinnovo o prosecuzione della concessione, anche alla luce dei principi nazionali ed europei di concorrenza e trasparenza?" as const;

export const LIVE_ACCEPTANCE_BUDGET = Object.freeze({
  maxTotalResearchCalls: 15,
  maxMoonlitCalls: 6,
  maxSimpliciterCalls: 6,
  maxLegalDataHunterCalls: 6,
});

export type LiveAcceptanceTarget = "TEMP_VALIDATION" | "PREVIEW_STAGING";

export type LiveAcceptanceMissionSummary = Readonly<{
  executionMode: "DRY_RUN" | "EXECUTE";
  target: LiveAcceptanceTarget;
  missionId: string;
  missionFingerprint: string;
  caseReference: string;
  researchMode: typeof LIVE_ACCEPTANCE_RESEARCH_MODE;
  referenceDate: string;
  budget: typeof LIVE_ACCEPTANCE_BUDGET;
  questionHash: string;
  persistenceOutcome?: "CREATED" | "REUSED";
}>;

export type LiveAcceptanceMissionPersistence = (
  input: Readonly<{ mission: ResearchMission; actor: ResearchServiceActor }>,
) => Promise<Readonly<{ outcome: "CREATED" | "REUSED" }>>;

export class LiveAcceptanceMissionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LiveAcceptanceMissionError";
  }
}

function explicitReferenceDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new LiveAcceptanceMissionError("REFERENCE_DATE_REQUIRED");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new LiveAcceptanceMissionError("REFERENCE_DATE_INVALID");
  }
  return value;
}

export function parseLiveAcceptanceTarget(value: string | undefined): LiveAcceptanceTarget {
  if (value === "PRODUCTION") throw new LiveAcceptanceMissionError("PRODUCTION_TARGET_FORBIDDEN");
  if (value !== "TEMP_VALIDATION" && value !== "PREVIEW_STAGING") {
    throw new LiveAcceptanceMissionError("EXPLICIT_NON_PRODUCTION_TARGET_REQUIRED");
  }
  return value;
}

export function createLiveAcceptanceMission(referenceDate: string): ResearchMission {
  const mission = createResearchMission({
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    caseReference: {
      caseId: LIVE_ACCEPTANCE_CASE_REFERENCE,
      fascicoloReference: LIVE_ACCEPTANCE_CASE_REFERENCE,
    },
    legalIssueIds: ["ACCEPTANCE_COMPARATIVE_PROCEDURE"],
    legalPropositionIds: ["ACCEPTANCE_COMPETITION_TRANSPARENCY"],
    referenceDate: explicitReferenceDate(referenceDate),
    mode: LIVE_ACCEPTANCE_RESEARCH_MODE,
    researchQuestion: LIVE_ACCEPTANCE_QUESTION,
    knownAuthorities: [],
    excludedAuthorities: [],
    preferredSourceFamilies: [
      "ITALIAN_LEGISLATION",
      "EU_LEGISLATION",
      "GIUSTIZIA_AMMINISTRATIVA",
      "CASSAZIONE",
      "CJEU",
    ],
    missingSourceFamilies: [
      "ITALIAN_LEGISLATION",
      "EU_LEGISLATION",
      "GIUSTIZIA_AMMINISTRATIVA",
      "CASSAZIONE",
      "CJEU",
    ],
    knownCounterArguments: [
      "Identify adverse or qualifying authority without presupposing a legal conclusion.",
    ],
    knownEvidenceGaps: [
      { gapId: "ACCEPTANCE_ADVERSE_AUTHORITY", kind: "NO_ADVERSE_AUTHORITY_CHECK" },
      { gapId: "ACCEPTANCE_EU_AUTHORITY", kind: "NO_EU_CHECK", sourceFamily: "CJEU" },
      { gapId: "ACCEPTANCE_CASSATION_AUTHORITY", kind: "NO_CASSATION_CHECK", sourceFamily: "CASSAZIONE" },
      { gapId: "ACCEPTANCE_FULL_TEXT", kind: "FULL_TEXT_NOT_VERIFIED" },
      { gapId: "ACCEPTANCE_OFFICIAL_IDENTITY", kind: "OFFICIAL_IDENTITY_NOT_VERIFIED" },
      { gapId: "ACCEPTANCE_TREATMENT", kind: "UNRESOLVED_AUTHORITY_TREATMENT" },
    ],
    requiredOutput: {
      authorityCandidates: true,
      citationObservations: true,
      legalResearchSuggestions: true,
      evidenceGaps: true,
      fullTextRequired: true,
    },
    budget: LIVE_ACCEPTANCE_BUDGET,
    status: "PENDING",
    executionPlan: {
      requiredCapabilities: [
        "SEMANTIC_DISCOVERY",
        "EXACT_RETRIEVAL",
        "FULL_TEXT_RETRIEVAL",
        "CITATION_NETWORK",
        "CROSS_JURISDICTION_DISCOVERY",
        "ADVERSE_AUTHORITY_DISCOVERY",
      ],
      preferredToolIds: ["SIMPLICITER", "MOONLIT", "LEGAL_DATA_HUNTER"],
    },
  });
  const errors = validateResearchMission(mission);
  if (errors.length > 0) throw new LiveAcceptanceMissionError("MISSION_VALIDATION_FAILED");
  return mission;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function summary(
  mission: ResearchMission,
  target: LiveAcceptanceTarget,
  executionMode: "DRY_RUN" | "EXECUTE",
  persistenceOutcome?: "CREATED" | "REUSED",
): LiveAcceptanceMissionSummary {
  return {
    executionMode,
    target,
    missionId: mission.missionId,
    missionFingerprint: mission.missionId,
    caseReference: mission.caseReference.caseId,
    researchMode: mission.mode as typeof LIVE_ACCEPTANCE_RESEARCH_MODE,
    referenceDate: mission.referenceDate,
    budget: LIVE_ACCEPTANCE_BUDGET,
    questionHash: digest(mission.researchQuestion),
    ...(persistenceOutcome ? { persistenceOutcome } : {}),
  };
}

export async function runLiveAcceptanceMission(input: Readonly<{
  referenceDate: string;
  target: string | undefined;
  vercelEnvironment?: string;
  execute?: boolean;
  enabled?: string;
  actorId?: string;
  tenantId?: string;
  persist?: LiveAcceptanceMissionPersistence;
}>): Promise<LiveAcceptanceMissionSummary> {
  if (input.vercelEnvironment?.trim().toLowerCase() === "production") {
    throw new LiveAcceptanceMissionError("PRODUCTION_ENVIRONMENT_FORBIDDEN");
  }
  const target = parseLiveAcceptanceTarget(input.target);
  const mission = createLiveAcceptanceMission(input.referenceDate);
  if (!input.execute) return summary(mission, target, "DRY_RUN");

  if (input.enabled !== "1") throw new LiveAcceptanceMissionError("LIVE_ACCEPTANCE_NOT_ENABLED");
  if (!input.actorId?.trim() || !input.tenantId?.trim()) {
    throw new LiveAcceptanceMissionError("OPERATOR_IDENTITY_REQUIRED");
  }
  if (!input.persist) throw new LiveAcceptanceMissionError("PERSISTENCE_SERVICE_REQUIRED");

  const persisted = await input.persist({
    mission,
    actor: { actorId: input.actorId.trim(), tenantId: input.tenantId.trim() },
  });
  return summary(mission, target, "EXECUTE", persisted.outcome);
}